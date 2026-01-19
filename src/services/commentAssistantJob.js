/**
 * 评论涨粉助手定时任务
 * 每 30 分钟执行一次
 */

const commentAssistantDb = require('./commentAssistantDb');
const twitterApiClient = require('./twitterApiClient');
const commentGenerator = require('./commentGenerator');

// 配置
const CONFIG = {
    HOURS_WINDOW: 4,           // 只看最近 4 小时的帖子
    MAX_COMMENTS_PER_TWEET: 100, // 评论数阈值
    TWEETS_PER_KOL: 5,         // 每个 KOL 取最近 5 条（API 实际返回约 20 条）
    LIKE_DELAY_MS: [5000, 10000], // 点赞后等待 5-10 秒
    GROUPS_PER_REGION: 12      // 每个区域 12 组
};

class CommentAssistantJob {
    constructor() {
        this.isRunning = false;
    }

    /**
     * 执行定时任务
     */
    async run() {
        // 防止重复执行
        if (this.isRunning) {
            console.log('[CommentAssistant] 任务正在运行中，跳过重复执行');
            return { skipped: true, reason: 'already_running' };
        }

        this.isRunning = true;
        console.log('[CommentAssistant] 开始执行定时任务...');

        try {
            // 1. 获取设置
            const settings = await commentAssistantDb.getSettings();
            if (!settings || !settings.auto_enabled) {
                console.log('[CommentAssistant] 功能未启用，跳过');
                return { skipped: true, reason: 'disabled' };
            }

            // 1.1 检查是否设置了评论账号
            if (!settings.comment_user_id) {
                console.log('[CommentAssistant] 未设置评论账号，跳过');
                return { skipped: true, reason: 'no_comment_user' };
            }

            // 1.2 验证评论账号的 Token 是否有效
            const credentials = await commentAssistantDb.getUserTwitterCredentials(settings.comment_user_id);
            if (!credentials) {
                console.log('[CommentAssistant] 评论账号未绑定 Twitter，跳过');
                return { skipped: true, reason: 'comment_user_not_bound' };
            }
            console.log(`[CommentAssistant] 评论账号: @${credentials.twitter_username}`);

            // 2. 检查今日评论数
            const todayCount = await commentAssistantDb.getTodayCommentCount();
            if (todayCount >= settings.daily_limit) {
                console.log(`[CommentAssistant] 已达今日上限 ${settings.daily_limit}，跳过`);
                return { skipped: true, reason: 'daily_limit_reached', todayCount };
            }

            // 3. 检查月度预算
            const monthlySpent = await commentAssistantDb.getMonthlySpent();
            if (monthlySpent >= settings.monthly_budget) {
                console.log(`[CommentAssistant] 已达月度预算 $${settings.monthly_budget}，跳过`);
                return { skipped: true, reason: 'budget_exceeded', monthlySpent };
            }

            // 4. 判断当前区域（根据 UTC 时间自动切换）
            // UTC 00:00-12:00 → 日区 (ja)，对应日本 JST 09:00-21:00
            // UTC 12:00-24:00 → 美区 (en)，对应美东 EST 07:00-19:00
            const now = new Date();
            const utcHour = now.getUTCHours();
            const region = utcHour < 12 ? 'ja' : 'en';
            const timeStr = now.toISOString().substring(11, 19);
            console.log(`[CommentAssistant] 当前区域: ${region} (UTC ${utcHour}时), 执行时间: ${timeStr} UTC`);

            // 5. 获取当前组索引并轮换
            const groupIndex = region === 'ja' ? settings.ja_group_index : settings.en_group_index;
            const nextGroupIndex = (groupIndex + 1) % CONFIG.GROUPS_PER_REGION;

            // 6. 获取当前组的 KOL
            const kols = await commentAssistantDb.getKolsByGroup(region, groupIndex);
            if (kols.length === 0) {
                console.log(`[CommentAssistant] ${region} 区组 ${groupIndex} 无 KOL，跳过`);
                await commentAssistantDb.updateGroupIndex(region, nextGroupIndex);
                return { skipped: true, reason: 'no_kols' };
            }
            console.log(`[CommentAssistant] 检查 ${kols.length} 个 KOL (组 ${groupIndex})`);

            // 7. 获取所有 KOL 的推文
            const candidateTweets = await this.fetchCandidateTweets(kols, region);
            console.log(`[CommentAssistant] 初筛后候选推文: ${candidateTweets.length} 条`);

            if (candidateTweets.length === 0) {
                await commentAssistantDb.updateGroupIndex(region, nextGroupIndex);
                return { completed: true, commented: 0, reason: 'no_candidates' };
            }

            // 8. 尝试评论候选帖子（遇到限制时跳过）
            let commented = false;
            let lastError = null;

            for (const tweet of candidateTweets.slice(0, 5)) { // 最多尝试 5 条
                try {
                    console.log(`[CommentAssistant] 尝试帖子: @${tweet.author} - ${tweet.id} (${tweet.replyCount}条评论)`);

                    // 生成评论
                    const generated = await commentGenerator.generate(tweet, region);
                    console.log(`[CommentAssistant] 生成评论 (${generated.style}): ${generated.content}`);

                    // 点赞 + 延迟 + 发布评论
                    await this.likeAndComment(tweet, generated, region, settings, settings.comment_user_id);

                    commented = true;
                    console.log('[CommentAssistant] 任务完成');

                    // 更新组索引
                    await commentAssistantDb.updateGroupIndex(region, nextGroupIndex);

                    return { completed: true, commented: 1, tweet: tweet.id };
                } catch (error) {
                    lastError = error;
                    // 检查是否是回复限制错误
                    if (error.message.includes('restricted who can reply') ||
                        error.message.includes('not allowed to reply')) {
                        console.log(`[CommentAssistant] 帖子 ${tweet.id} 限制回复，跳过`);
                        continue;
                    }
                    // 其他错误也跳过，尝试下一条
                    console.error(`[CommentAssistant] 帖子 ${tweet.id} 评论失败:`, error.message);
                    continue;
                }
            }

            // 所有候选都失败了
            await commentAssistantDb.updateGroupIndex(region, nextGroupIndex);

            if (!commented) {
                console.log('[CommentAssistant] 所有候选帖子都无法评论');
                return { completed: true, commented: 0, reason: 'all_restricted', lastError: lastError?.message };
            }

        } catch (error) {
            console.error('[CommentAssistant] 任务执行失败:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 获取候选推文（初筛）
     */
    async fetchCandidateTweets(kols, region) {
        const candidates = [];
        const cutoffTime = Date.now() - CONFIG.HOURS_WINDOW * 60 * 60 * 1000;

        // 调试统计
        let stats = { total: 0, tooOld: 0, tooManyReplies: 0, alreadyCommented: 0, passed: 0 };

        for (const kol of kols) {
            try {
                const tweets = await twitterApiClient.getUserTweets(
                    kol.kol_username,
                    CONFIG.TWEETS_PER_KOL,
                    region
                );

                console.log(`[CommentAssistant] @${kol.kol_username}: 获取到 ${tweets.length} 条推文`);

                for (const tweet of tweets) {
                    stats.total++;

                    // 检查时间
                    const tweetTime = new Date(tweet.created_at).getTime();
                    if (tweetTime < cutoffTime) {
                        stats.tooOld++;
                        console.log(`  - ${tweet.id}: 时间过早 (${tweet.created_at})`);
                        continue;
                    }

                    // 检查评论数
                    if ((tweet.reply_count || 0) >= CONFIG.MAX_COMMENTS_PER_TWEET) {
                        stats.tooManyReplies++;
                        console.log(`  - ${tweet.id}: 评论数过多 (${tweet.reply_count} >= ${CONFIG.MAX_COMMENTS_PER_TWEET})`);
                        continue;
                    }

                    // 检查是否已评论
                    const hasCommented = await commentAssistantDb.hasCommented(tweet.id);
                    if (hasCommented) {
                        stats.alreadyCommented++;
                        console.log(`  - ${tweet.id}: 已评论过`);
                        continue;
                    }

                    stats.passed++;
                    console.log(`  + ${tweet.id}: 通过筛选 (${tweet.reply_count} 评论, ${tweet.lang})`);

                    candidates.push({
                        id: tweet.id,
                        author: kol.kol_username,
                        authorDisplay: kol.kol_display_name || kol.kol_username,
                        content: tweet.full_text || tweet.text,
                        url: `https://twitter.com/${kol.kol_username}/status/${tweet.id}`,
                        replyCount: tweet.reply_count || 0,
                        createdAt: tweet.created_at,
                        hasMedia: !!(tweet.media && tweet.media.length > 0)
                    });
                }
            } catch (error) {
                console.error(`[CommentAssistant] 获取 @${kol.kol_username} 推文失败:`, error.message);
            }
        }

        console.log(`[CommentAssistant] 筛选统计: 总计=${stats.total}, 时间过早=${stats.tooOld}, 评论过多=${stats.tooManyReplies}, 已评论=${stats.alreadyCommented}, 通过=${stats.passed}`);

        // 排序优先级：1. 发帖时间新的 2. 评论数少的
        return candidates.sort((a, b) => {
            // 先按时间排序（新的在前）
            const timeA = new Date(a.createdAt).getTime();
            const timeB = new Date(b.createdAt).getTime();
            if (timeA !== timeB) return timeB - timeA;
            // 时间相同则按评论数排序（少的在前）
            return a.replyCount - b.replyCount;
        });
    }

    /**
     * 点赞并发布评论（使用指定用户的 OAuth Token）
     */
    async likeAndComment(tweet, generated, region, settings, commentUserId) {
        // 点赞功能暂时禁用（需要 Twitter API Basic 套餐）
        // try {
        //     await twitterApiClient.likeTweet(tweet.id, commentUserId, region);
        //     console.log(`[CommentAssistant] 已点赞帖子 ${tweet.id}`);
        // } catch (error) {
        //     console.error('[CommentAssistant] 点赞失败:', error.message);
        // }

        // 随机延迟 2-5 秒（无点赞时延迟缩短）
        const delay = 2000 + Math.random() * 3000;
        await new Promise(resolve => setTimeout(resolve, delay));

        // 发布评论（使用用户的 OAuth Token）
        const commentResult = await twitterApiClient.postComment(
            tweet.id,
            generated.content,
            commentUserId,
            region
        );

        // 保存记录（使用评论账号的 user_id）
        const savedComment = await commentAssistantDb.saveComment({
            userId: commentUserId,
            region,
            tweetId: tweet.id,
            tweetUrl: tweet.url,
            tweetAuthor: tweet.author,
            tweetContent: tweet.content?.substring(0, 200),
            commentContent: generated.content,
            commentStyle: generated.style,
            commentTweetId: commentResult?.id || null
        });

        // 创建收件箱通知（通知评论账号的用户）
        await commentAssistantDb.createInboxNotification(commentUserId, savedComment.id);

        console.log(`[CommentAssistant] 已发布评论，ID: ${savedComment.id}`);
    }
}

const commentAssistantJob = new CommentAssistantJob();
module.exports = commentAssistantJob;

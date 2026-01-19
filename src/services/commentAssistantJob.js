/**
 * 评论涨粉助手定时任务
 * 每 30 分钟执行一次
 */

const commentAssistantDb = require('./commentAssistantDb');
const twitterApiClient = require('./twitterApiClient');
const commentGenerator = require('./commentGenerator');
const slackNotifier = require('./slackNotifier');

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
            if (!settings) {
                console.log('[CommentAssistant] 无法获取设置，跳过');
                return { skipped: true, reason: 'no_settings' };
            }

            // 1.1 检查自动评论开关和配置
            let autoCommentReady = false;
            if (settings.auto_enabled && settings.comment_user_id) {
                const credentials = await commentAssistantDb.getUserTwitterCredentials(settings.comment_user_id);
                if (credentials) {
                    autoCommentReady = true;
                    console.log(`[CommentAssistant] 自动评论账号: @${credentials.twitter_username}`);
                } else {
                    console.log('[CommentAssistant] 自动评论账号未绑定 Twitter，自动评论将跳过');
                }
            }

            // 1.2 检查手动评论开关
            const manualEnabled = settings.manual_enabled || false;

            // 1.3 如果两个功能都未启用，则跳过
            if (!autoCommentReady && !manualEnabled) {
                console.log('[CommentAssistant] 自动评论和手动评论均未启用，跳过');
                return { skipped: true, reason: 'disabled' };
            }

            console.log(`[CommentAssistant] 自动评论: ${autoCommentReady ? '启用' : '禁用'}, 手动评论: ${manualEnabled ? '启用' : '禁用'}`);

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

            // 3.1 检查是否处于速率限制中
            const rateLimitStatus = await commentAssistantDb.checkRateLimit();
            if (rateLimitStatus.isLimited) {
                const minutes = Math.ceil(rateLimitStatus.remainingSeconds / 60);
                console.log(`[CommentAssistant] 处于速率限制中，还需等待 ${minutes} 分钟，跳过`);
                return { skipped: true, reason: 'rate_limited', remainingMinutes: minutes, until: rateLimitStatus.until };
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

            // 8. 如果手动评论启用，为手动用户生成待评论记录（轮流分配，避免重复评论）
            let pendingCreated = 0;
            if (manualEnabled) {
                // 获取手动用户列表（有权限但不是自动发布账号）
                const manualUsers = await commentAssistantDb.getManualCommentUsers(
                    autoCommentReady ? settings.comment_user_id : null
                );
                console.log(`[CommentAssistant] 手动用户数: ${manualUsers.length}`);

                if (manualUsers.length > 0) {
                    // 轮流分配推文给用户（每条推文只分配给1个用户）
                    for (let i = 0; i < candidateTweets.length; i++) {
                        const tweet = candidateTweets[i];
                        const user = manualUsers[i % manualUsers.length]; // 轮流分配

                        // 检查该用户是否已有这个帖子的记录
                        const hasRecord = await commentAssistantDb.hasUserComment(user.id, tweet.id);
                        if (hasRecord) {
                            console.log(`[CommentAssistant] 用户 ${user.username} 已有帖子 ${tweet.id} 的记录，跳过`);
                            continue;
                        }

                        // 为该用户生成评论内容
                        const generated = await commentGenerator.generate(tweet, region);

                        // 保存待评论记录
                        await commentAssistantDb.saveComment({
                            userId: user.id,
                            region,
                            tweetId: tweet.id,
                            tweetUrl: tweet.url,
                            tweetAuthor: tweet.author,
                            tweetContent: tweet.content?.substring(0, 200),
                            commentContent: generated.content,
                            commentStyle: generated.style,
                            commentTweetId: null,
                            status: 'pending',
                            isAuto: false
                        });

                        pendingCreated++;
                        console.log(`[CommentAssistant] 分配给用户 ${user.username}: ${tweet.author} - ${tweet.id}`);
                    }
                }
                console.log(`[CommentAssistant] 共创建 ${pendingCreated} 条待评论记录`);
            } else {
                console.log('[CommentAssistant] 手动评论未启用，跳过生成待评论记录');
            }

            // 10. 如果启用了自动评论，为自动用户发布评论
            let autoCommented = 0;
            let lastError = null;

            if (autoCommentReady) {
                console.log('[CommentAssistant] 自动评论已启用，开始发布...');

                for (const tweet of candidateTweets.slice(0, 3)) { // 自动评论最多 3 条
                    try {
                        console.log(`[CommentAssistant] 自动评论帖子: @${tweet.author} - ${tweet.id}`);

                        // 生成评论
                        const generated = await commentGenerator.generate(tweet, region);
                        console.log(`[CommentAssistant] 生成评论 (${generated.style}): ${generated.content}`);

                        // 点赞 + 延迟 + 发布评论
                        await this.likeAndComment(tweet, generated, region, settings, settings.comment_user_id);

                        autoCommented++;
                        console.log(`[CommentAssistant] 自动评论成功: ${tweet.id}`);

                        // 一次任务只自动评论一条
                        break;
                    } catch (error) {
                        lastError = error;

                        // 检查是否是 429 速率限制错误
                        if (error.isRateLimited) {
                            const retrySeconds = error.retryAfterSeconds || 15 * 60;
                            const minutes = Math.ceil(retrySeconds / 60);
                            console.error(`[CommentAssistant] 遇到 429 速率限制，设置等待 ${minutes} 分钟后重试`);

                            // 记录速率限制状态到数据库
                            await commentAssistantDb.setRateLimit(retrySeconds);

                            // 更新组索引后立即停止
                            await commentAssistantDb.updateGroupIndex(region, nextGroupIndex);

                            return {
                                completed: false,
                                autoCommented,
                                pendingCreated,
                                reason: 'rate_limited',
                                retryAfterMinutes: minutes,
                                error: error.message
                            };
                        }

                        // 检查是否是回复限制错误
                        if (error.message.includes('restricted who can reply') ||
                            error.message.includes('not allowed to reply')) {
                            console.log(`[CommentAssistant] 帖子 ${tweet.id} 限制回复，跳过`);
                            continue;
                        }
                        // 其他错误也跳过，尝试下一条
                        console.error(`[CommentAssistant] 帖子 ${tweet.id} 自动评论失败:`, error.message);
                        continue;
                    }
                }
            } else {
                console.log('[CommentAssistant] 自动评论未启用，仅生成待评论记录');
            }

            // 更新组索引
            await commentAssistantDb.updateGroupIndex(region, nextGroupIndex);

            console.log(`[CommentAssistant] 任务完成: 待评论=${pendingCreated}, 自动评论=${autoCommented}`);

            // 发送 Slack 通知
            await slackNotifier.sendCommentAssistantSummary({
                region,
                autoComments: autoCommented,
                manualPending: pendingCreated
            });

            return {
                completed: true,
                pendingCreated,
                autoCommented,
                lastError: lastError?.message
            };

        } catch (error) {
            console.error('[CommentAssistant] 任务执行失败:', error);

            // 发送错误通知到 Slack
            await slackNotifier.sendCommentAssistantSummary({
                region: 'unknown',
                error: error.message
            });

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

        // 每个推主只选1条最优的推文
        const bestByAuthor = new Map();
        for (const tweet of candidates) {
            const existing = bestByAuthor.get(tweet.author);
            if (!existing) {
                bestByAuthor.set(tweet.author, tweet);
            } else {
                // 优先选：1. 发帖时间新的 2. 评论数少的
                const existingTime = new Date(existing.createdAt).getTime();
                const tweetTime = new Date(tweet.createdAt).getTime();
                if (tweetTime > existingTime ||
                    (tweetTime === existingTime && tweet.replyCount < existing.replyCount)) {
                    bestByAuthor.set(tweet.author, tweet);
                }
            }
        }

        const result = Array.from(bestByAuthor.values());
        console.log(`[CommentAssistant] 每个推主选1条后: ${result.length} 条推文`);

        // 按时间排序（新的在前）
        return result.sort((a, b) => {
            const timeA = new Date(a.createdAt).getTime();
            const timeB = new Date(b.createdAt).getTime();
            return timeB - timeA;
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

    /**
     * 仅执行自动评论（手动触发按钮调用）
     * 不检查 auto_enabled 开关，直接执行一次
     */
    async runAutoOnly() {
        if (this.isRunning) {
            return { skipped: true, reason: 'already_running' };
        }

        this.isRunning = true;
        console.log('[CommentAssistant] 开始执行自动评论...');

        try {
            const settings = await commentAssistantDb.getSettings();
            if (!settings) {
                return { skipped: true, reason: 'no_settings' };
            }

            // 验证评论账号
            if (!settings.comment_user_id) {
                return { skipped: true, reason: 'no_comment_user' };
            }

            const credentials = await commentAssistantDb.getUserTwitterCredentials(settings.comment_user_id);
            if (!credentials) {
                return { skipped: true, reason: 'comment_user_not_bound' };
            }
            console.log(`[CommentAssistant] 评论账号: @${credentials.twitter_username}`);

            // 判断当前区域
            const now = new Date();
            const utcHour = now.getUTCHours();
            const region = utcHour < 12 ? 'ja' : 'en';

            // 获取当前组的 KOL
            const groupIndex = region === 'ja' ? settings.ja_group_index : settings.en_group_index;
            const kols = await commentAssistantDb.getKolsByGroup(region, groupIndex);
            if (kols.length === 0) {
                return { completed: true, autoCommented: 0, reason: 'no_kols' };
            }

            // 获取候选推文
            const candidateTweets = await this.fetchCandidateTweets(kols, region);
            if (candidateTweets.length === 0) {
                return { completed: true, autoCommented: 0, reason: 'no_candidates' };
            }

            // 执行自动评论
            let autoCommented = 0;
            let lastError = null;

            for (const tweet of candidateTweets.slice(0, 3)) {
                try {
                    const generated = await commentGenerator.generate(tweet, region);
                    await this.likeAndComment(tweet, generated, region, settings, settings.comment_user_id);
                    autoCommented++;
                    break; // 一次只评论一条
                } catch (error) {
                    lastError = error;
                    if (error.isRateLimited) {
                        await commentAssistantDb.setRateLimit(error.retryAfterSeconds || 15 * 60);
                        return { completed: false, autoCommented, reason: 'rate_limited', error: error.message };
                    }
                    continue;
                }
            }

            console.log(`[CommentAssistant] 自动评论完成: ${autoCommented} 条`);
            return { completed: true, autoCommented, lastError: lastError?.message };

        } catch (error) {
            console.error('[CommentAssistant] 自动评论失败:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 仅执行手动评论生成（手动触发按钮调用）
     * 不检查 manual_enabled 开关，直接执行一次
     */
    async runManualOnly() {
        // 防止重复执行
        if (this.isRunning) {
            console.log('[CommentAssistant] 任务正在运行中，跳过');
            return { skipped: true, reason: 'already_running' };
        }

        this.isRunning = true;
        console.log('[CommentAssistant] 开始执行手动评论生成...');

        try {
            const settings = await commentAssistantDb.getSettings();
            if (!settings) {
                return { skipped: true, reason: 'no_settings' };
            }

            // 判断当前区域
            const now = new Date();
            const utcHour = now.getUTCHours();
            const region = utcHour < 12 ? 'ja' : 'en';
            console.log(`[CommentAssistant] 当前区域: ${region}`);

            // 获取当前组的 KOL
            const groupIndex = region === 'ja' ? settings.ja_group_index : settings.en_group_index;
            const kols = await commentAssistantDb.getKolsByGroup(region, groupIndex);
            if (kols.length === 0) {
                console.log(`[CommentAssistant] ${region} 区组 ${groupIndex} 无 KOL`);
                return { completed: true, pendingCreated: 0, reason: 'no_kols' };
            }
            console.log(`[CommentAssistant] 检查 ${kols.length} 个 KOL (组 ${groupIndex})`);

            // 获取候选推文
            const candidateTweets = await this.fetchCandidateTweets(kols, region);
            console.log(`[CommentAssistant] 候选推文: ${candidateTweets.length} 条`);

            if (candidateTweets.length === 0) {
                return { completed: true, pendingCreated: 0, reason: 'no_candidates' };
            }

            // 获取手动用户列表（排除自动评论账号）
            const manualUsers = await commentAssistantDb.getManualCommentUsers(
                settings.auto_enabled ? settings.comment_user_id : null
            );
            console.log(`[CommentAssistant] 手动用户数: ${manualUsers.length}`);

            if (manualUsers.length === 0) {
                return { completed: true, pendingCreated: 0, reason: 'no_manual_users' };
            }

            // 轮流分配推文给用户（每条推文只分配给1个用户，避免重复评论）
            let pendingCreated = 0;
            for (let i = 0; i < candidateTweets.length; i++) {
                const tweet = candidateTweets[i];
                const user = manualUsers[i % manualUsers.length]; // 轮流分配

                const hasRecord = await commentAssistantDb.hasUserComment(user.id, tweet.id);
                if (hasRecord) {
                    console.log(`[CommentAssistant] 用户 ${user.username} 已有帖子 ${tweet.id} 的记录，跳过`);
                    continue;
                }

                const generated = await commentGenerator.generate(tweet, region);

                await commentAssistantDb.saveComment({
                    userId: user.id,
                    region,
                    tweetId: tweet.id,
                    tweetUrl: tweet.url,
                    tweetAuthor: tweet.author,
                    tweetContent: tweet.content?.substring(0, 200),
                    commentContent: generated.content,
                    commentStyle: generated.style,
                    commentTweetId: null,
                    status: 'pending',
                    isAuto: false
                });

                pendingCreated++;
                console.log(`[CommentAssistant] 分配给用户 ${user.username}: ${tweet.author} - ${tweet.id}`);
            }

            console.log(`[CommentAssistant] 手动评论生成完成: ${pendingCreated} 条`);
            return { completed: true, pendingCreated };

        } catch (error) {
            console.error('[CommentAssistant] 手动评论生成失败:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }
}

const commentAssistantJob = new CommentAssistantJob();
module.exports = commentAssistantJob;

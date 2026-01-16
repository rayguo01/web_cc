/**
 * 语气模仿 Prompt 数据库服务
 * 支持市场和订阅功能
 */

const { pool } = require('../config/database');

class VoicePromptDbService {
    /**
     * 保存生成的 Prompt（含 role、core_traits 和 domains）
     */
    async save(userId, data) {
        const result = await pool.query(
            `INSERT INTO voice_prompts
             (user_id, username, display_name, avatar_url, tweet_count, total_chars, prompt_content, sample_tweets, role, core_traits, domains)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
                userId,
                data.username,
                data.displayName || data.username,
                data.avatarUrl,
                data.tweetCount,
                data.totalChars,
                data.promptContent,
                JSON.stringify(data.sampleTweets || []),
                data.role || null,
                data.coreTraits ? JSON.stringify(data.coreTraits) : null,
                data.domains ? JSON.stringify(data.domains) : null
            ]
        );
        console.log(`[VoicePromptDb] 已保存 @${data.username} 的语气 Prompt`);
        return result.rows[0];
    }

    /**
     * 获取我创建的语气模仿器列表
     */
    async getMine(userId) {
        const result = await pool.query(
            `SELECT
                id, username, display_name, avatar_url, tweet_count, total_chars, created_at,
                COALESCE(is_public, false) as is_public,
                COALESCE(usage_count, 0) as usage_count,
                COALESCE(subscriber_count, 0) as subscriber_count,
                role, core_traits, domains
             FROM voice_prompts
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * 获取市场列表（已开放的模仿器）
     */
    async getMarket(userId, sort = 'usage', page = 1, limit = 20) {
        const offset = (page - 1) * limit;
        let orderBy = 'usage_count DESC';
        if (sort === 'latest') orderBy = 'created_at DESC';
        if (sort === 'subscribers') orderBy = 'subscriber_count DESC';

        const result = await pool.query(
            `SELECT
                vp.id, vp.username, vp.display_name, vp.avatar_url,
                COALESCE(vp.usage_count, 0) as usage_count,
                COALESCE(vp.subscriber_count, 0) as subscriber_count,
                vp.role, vp.core_traits, vp.domains, vp.created_at,
                CASE WHEN vps.id IS NOT NULL THEN true ELSE false END as is_subscribed,
                CASE WHEN vp.user_id = $1 THEN true ELSE false END as is_owner
             FROM voice_prompts vp
             LEFT JOIN voice_prompt_subscriptions vps ON vps.prompt_id = vp.id AND vps.user_id = $1
             WHERE vp.is_public = true
             ORDER BY ${orderBy}
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM voice_prompts WHERE is_public = true`
        );

        return {
            items: result.rows,
            total: parseInt(countResult.rows[0].count)
        };
    }

    /**
     * 获取我订阅的列表
     */
    async getSubscribed(userId) {
        const result = await pool.query(
            `SELECT
                vp.id, vp.username, vp.display_name, vp.avatar_url,
                COALESCE(vp.usage_count, 0) as usage_count,
                COALESCE(vp.subscriber_count, 0) as subscriber_count,
                vp.role, vp.core_traits, vp.domains, vps.created_at as subscribed_at
             FROM voice_prompt_subscriptions vps
             JOIN voice_prompts vp ON vp.id = vps.prompt_id
             WHERE vps.user_id = $1
             ORDER BY vps.created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * 获取内容生成时可用的列表（三列数据）
     */
    async getAvailable(userId) {
        // 市场热门 Top 5
        const popularResult = await pool.query(
            `SELECT
                vp.id, vp.username, vp.display_name, vp.avatar_url, vp.role, vp.core_traits,
                COALESCE(vp.usage_count, 0) as usage_count
             FROM voice_prompts vp
             WHERE vp.is_public = true
             ORDER BY usage_count DESC
             LIMIT 5`
        );

        // 我创建的
        const mineResult = await pool.query(
            `SELECT
                id, username, display_name, avatar_url, role, core_traits,
                COALESCE(usage_count, 0) as usage_count
             FROM voice_prompts
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );

        // 我订阅的
        const subscribedResult = await pool.query(
            `SELECT
                vp.id, vp.username, vp.display_name, vp.avatar_url, vp.role, vp.core_traits,
                COALESCE(vp.usage_count, 0) as usage_count
             FROM voice_prompt_subscriptions vps
             JOIN voice_prompts vp ON vp.id = vps.prompt_id
             WHERE vps.user_id = $1
             ORDER BY vps.created_at DESC`,
            [userId]
        );

        return {
            popular: popularResult.rows,
            mine: mineResult.rows,
            subscribed: subscribedResult.rows
        };
    }

    /**
     * 订阅模仿器
     */
    async subscribe(userId, promptId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 检查是否存在且已公开
            const checkResult = await client.query(
                `SELECT id, user_id FROM voice_prompts WHERE id = $1 AND is_public = true`,
                [promptId]
            );
            if (checkResult.rows.length === 0) {
                throw new Error('模仿器不存在或未开放');
            }
            if (checkResult.rows[0].user_id === userId) {
                throw new Error('不能订阅自己的模仿器');
            }

            // 插入订阅记录
            await client.query(
                `INSERT INTO voice_prompt_subscriptions (user_id, prompt_id)
                 VALUES ($1, $2)
                 ON CONFLICT (user_id, prompt_id) DO NOTHING`,
                [userId, promptId]
            );

            // 更新订阅数
            await client.query(
                `UPDATE voice_prompts
                 SET subscriber_count = (
                     SELECT COUNT(*) FROM voice_prompt_subscriptions WHERE prompt_id = $1
                 )
                 WHERE id = $1`,
                [promptId]
            );

            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * 取消订阅
     */
    async unsubscribe(userId, promptId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `DELETE FROM voice_prompt_subscriptions
                 WHERE user_id = $1 AND prompt_id = $2`,
                [userId, promptId]
            );

            // 更新订阅数
            await client.query(
                `UPDATE voice_prompts
                 SET subscriber_count = (
                     SELECT COUNT(*) FROM voice_prompt_subscriptions WHERE prompt_id = $1
                 )
                 WHERE id = $1`,
                [promptId]
            );

            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * 开放到市场
     */
    async publish(id, userId) {
        const result = await pool.query(
            `UPDATE voice_prompts
             SET is_public = true
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId]
        );
        return result.rows[0];
    }

    /**
     * 从市场撤回（级联删除所有订阅）
     */
    async unpublish(id, userId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 删除所有订阅关系
            await client.query(
                `DELETE FROM voice_prompt_subscriptions WHERE prompt_id = $1`,
                [id]
            );

            // 更新为非公开，订阅数归零
            const result = await client.query(
                `UPDATE voice_prompts
                 SET is_public = false, subscriber_count = 0
                 WHERE id = $1 AND user_id = $2
                 RETURNING *`,
                [id, userId]
            );

            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * 获取单个 Prompt 详情
     * 公共 Prompt 只有使用权，不返回 prompt_content（除非是所有者）
     */
    async getById(id, userId) {
        const result = await pool.query(
            `SELECT
                vp.id, vp.username, vp.display_name, vp.avatar_url, vp.tweet_count, vp.total_chars,
                vp.sample_tweets, vp.created_at, vp.is_public, vp.user_id, vp.role, vp.core_traits, vp.domains,
                COALESCE(vp.usage_count, 0) as usage_count,
                COALESCE(vp.subscriber_count, 0) as subscriber_count,
                CASE WHEN vp.user_id = $2 THEN vp.prompt_content ELSE NULL END as prompt_content,
                CASE WHEN vps.id IS NOT NULL THEN true ELSE false END as is_subscribed
             FROM voice_prompts vp
             LEFT JOIN voice_prompt_subscriptions vps ON vps.prompt_id = vp.id AND vps.user_id = $2
             WHERE vp.id = $1 AND (vp.user_id = $2 OR vp.is_public = true OR vps.id IS NOT NULL)`,
            [id, userId]
        );
        return result.rows[0] || null;
    }

    /**
     * 获取 Prompt 用于内容生成（包含 prompt_content）
     * 所有者、公开的、或已订阅的都可以使用
     */
    async getForGeneration(id, userId) {
        const result = await pool.query(
            `SELECT vp.* FROM voice_prompts vp
             LEFT JOIN voice_prompt_subscriptions vps ON vps.prompt_id = vp.id AND vps.user_id = $2
             WHERE vp.id = $1 AND (vp.user_id = $2 OR vp.is_public = true OR vps.id IS NOT NULL)`,
            [id, userId]
        );
        return result.rows[0] || null;
    }

    /**
     * 检查是否已存在该用户的 Prompt
     */
    async existsByUsername(userId, username) {
        const result = await pool.query(
            `SELECT id FROM voice_prompts
             WHERE user_id = $1 AND username = $2`,
            [userId, username.toLowerCase()]
        );
        return result.rows.length > 0;
    }

    /**
     * 删除 Prompt（同时删除所有订阅关系）
     */
    async delete(id, userId) {
        const result = await pool.query(
            `DELETE FROM voice_prompts
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [id, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * 更新 Prompt（重新分析，含 role、core_traits 和 domains）
     */
    async update(id, userId, data) {
        const result = await pool.query(
            `UPDATE voice_prompts
             SET tweet_count = $3, total_chars = $4, prompt_content = $5, sample_tweets = $6,
                 role = $7, core_traits = $8, domains = $9
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [
                id,
                userId,
                data.tweetCount,
                data.totalChars,
                data.promptContent,
                JSON.stringify(data.sampleTweets || []),
                data.role || null,
                data.coreTraits ? JSON.stringify(data.coreTraits) : null,
                data.domains ? JSON.stringify(data.domains) : null
            ]
        );
        return result.rows[0];
    }

    /**
     * 增加使用次数
     */
    async incrementUsageCount(id) {
        const result = await pool.query(
            `UPDATE voice_prompts
             SET usage_count = COALESCE(usage_count, 0) + 1
             WHERE id = $1
             RETURNING id, usage_count`,
            [id]
        );
        return result.rows[0];
    }
}

// 单例
const voicePromptDb = new VoicePromptDbService();

module.exports = voicePromptDb;

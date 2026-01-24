const { Pool } = require('pg');

// 从 DATABASE_URL 提取 schema 参数
const dbUrl = process.env.DATABASE_URL || '';
const schemaMatch = dbUrl.match(/[?&]schema=([^&]+)/);
const schema = schemaMatch ? schemaMatch[1] : 'public';

// 启动时打印 schema 信息（调试用）
console.log(`[Database] 使用 schema: ${schema}`);
if (schema === 'public') {
    console.warn('[Database] 警告: 正在使用 public schema，请检查 DATABASE_URL 是否包含 schema=web_cc 参数');
}

const basePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 创建一个包装器，确保每次查询前都设置 search_path
const pool = {
    async query(text, params) {
        const client = await basePool.connect();
        try {
            await client.query(`SET search_path TO ${schema}`);
            return await client.query(text, params);
        } finally {
            client.release();
        }
    },
    async connect() {
        const client = await basePool.connect();
        await client.query(`SET search_path TO ${schema}`);
        return client;
    },
    end() {
        return basePool.end();
    }
};

async function initDatabase() {
    const client = await pool.connect();
    try {
        // 确保 schema 存在
        if (schema !== 'public') {
            await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
            await client.query(`SET search_path TO ${schema}`);
        }

        // 创建用户表
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建会话表
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                claude_session_id VARCHAR(100),
                title VARCHAR(255) DEFAULT '新对话',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建消息表
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建帖子生成任务表
        await client.query(`
            CREATE TABLE IF NOT EXISTS post_tasks (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                current_step VARCHAR(30) NOT NULL DEFAULT 'trends',
                workflow_config JSONB DEFAULT '{"steps":["trends","content","optimize","prompt","image","submit"]}',
                trends_data JSONB,
                content_data JSONB,
                optimize_data JSONB,
                prompt_data JSONB,
                image_data JSONB,
                final_content TEXT,
                final_image_path VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
        `);

        // 添加 prompt_data 列（如果不存在）
        await client.query(`
            ALTER TABLE post_tasks ADD COLUMN IF NOT EXISTS prompt_data JSONB
        `);

        // 创建 Twitter OAuth 凭证表
        await client.query(`
            CREATE TABLE IF NOT EXISTS twitter_credentials (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                twitter_user_id VARCHAR(100),
                twitter_username VARCHAR(100),
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                token_expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 为 users 表添加 Twitter 登录支持
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter_id VARCHAR(100) UNIQUE
        `);
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)
        `);
        // 添加 Premium 会员标识（Twitter Blue/Premium 订阅用户）
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE
        `);
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_type VARCHAR(20)
        `);
        // 允许 password_hash 为空（Twitter 登录用户不需要密码）
        await client.query(`
            ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL
        `);

        // 创建帖子历史记录表
        await client.query(`
            CREATE TABLE IF NOT EXISTS post_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                task_id INTEGER REFERENCES post_tasks(id) ON DELETE SET NULL,
                trend_source VARCHAR(30),
                trend_topic VARCHAR(500),
                final_content TEXT NOT NULL,
                final_image_path VARCHAR(500),
                viral_score INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建趋势数据表（保存原始数据和分析结果）
        await client.query(`
            CREATE TABLE IF NOT EXISTS trends_data (
                id SERIAL PRIMARY KEY,
                skill_id VARCHAR(100) NOT NULL,
                hour_key VARCHAR(20) NOT NULL,
                raw_data JSONB,
                analysis_result JSONB,
                analysis_status VARCHAR(20) DEFAULT 'pending',
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(skill_id, hour_key)
            )
        `);

        // 创建语气模仿 Prompt 表
        await client.query(`
            CREATE TABLE IF NOT EXISTS voice_prompts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                username VARCHAR(100) NOT NULL,
                display_name VARCHAR(200),
                avatar_url VARCHAR(500),
                tweet_count INTEGER DEFAULT 0,
                total_chars INTEGER DEFAULT 0,
                prompt_content TEXT NOT NULL,
                sample_tweets JSONB,
                is_public BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 添加 is_public 字段（如果不存在）
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'voice_prompts' AND column_name = 'is_public'
                ) THEN
                    ALTER TABLE voice_prompts ADD COLUMN is_public BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        `);

        // 添加 usage_count 字段（如果不存在）
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'voice_prompts' AND column_name = 'usage_count'
                ) THEN
                    ALTER TABLE voice_prompts ADD COLUMN usage_count INTEGER DEFAULT 0;
                END IF;
            END $$;
        `);

        // 添加 role 字段（市场展示用）
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'voice_prompts' AND column_name = 'role'
                ) THEN
                    ALTER TABLE voice_prompts ADD COLUMN role VARCHAR(200);
                END IF;
            END $$;
        `);

        // 添加 core_traits 字段（市场展示用，JSON 格式）
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'voice_prompts' AND column_name = 'core_traits'
                ) THEN
                    ALTER TABLE voice_prompts ADD COLUMN core_traits TEXT;
                END IF;
            END $$;
        `);

        // 添加 subscriber_count 字段（订阅者数量）
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'voice_prompts' AND column_name = 'subscriber_count'
                ) THEN
                    ALTER TABLE voice_prompts ADD COLUMN subscriber_count INTEGER DEFAULT 0;
                END IF;
            END $$;
        `);

        // 添加 domains 字段（领域标签，JSON 格式）
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'voice_prompts' AND column_name = 'domains'
                ) THEN
                    ALTER TABLE voice_prompts ADD COLUMN domains TEXT;
                END IF;
            END $$;
        `);

        // 创建语气模仿订阅表
        await client.query(`
            CREATE TABLE IF NOT EXISTS voice_prompt_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                prompt_id INTEGER REFERENCES voice_prompts(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, prompt_id)
            )
        `);

        // 创建索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_prompts_user ON voice_prompts(user_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_prompts_username ON voice_prompts(username)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_prompts_public ON voice_prompts(is_public)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_subscriptions_user ON voice_prompt_subscriptions(user_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_subscriptions_prompt ON voice_prompt_subscriptions(prompt_id)
        `);

        // 添加 is_admin 字段
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE
        `);

        // 创建 Token 使用统计表
        await client.query(`
            CREATE TABLE IF NOT EXISTS token_usage (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                task_id INTEGER REFERENCES post_tasks(id) ON DELETE SET NULL,
                workflow_step VARCHAR(30),
                skill_id VARCHAR(100),
                model VARCHAR(100),
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_creation_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                cost_usd DECIMAL(12, 8) DEFAULT 0,
                duration_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Token 使用统计表索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage(user_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_token_usage_skill ON token_usage(skill_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_token_usage_step ON token_usage(workflow_step)
        `);

        // 创建索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_post_tasks_user_status ON post_tasks(user_id, status)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_post_tasks_updated_at ON post_tasks(updated_at)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_post_history_user ON post_history(user_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trends_data_skill_hour ON trends_data(skill_id, hour_key)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trends_data_created ON trends_data(created_at)
        `);

        // 创建邀请码表
        await client.query(`
            CREATE TABLE IF NOT EXISTS invitation_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                note VARCHAR(200),
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                used_at TIMESTAMP,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 邀请码索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_invitation_codes_used ON invitation_codes(used_by)
        `);

        // 用户表添加邀请码关联字段
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_code VARCHAR(20)
        `);

        // 设置初始管理员（rayguo）
        await client.query(`
            UPDATE users SET is_admin = TRUE WHERE username = 'rayguo' AND (is_admin IS NULL OR is_admin = FALSE)
        `);

        // 添加评论助手权限字段
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS can_use_comment_assistant BOOLEAN DEFAULT FALSE
        `);

        // ============ 评论涨粉助手表 ============

        // 大V列表（系统级配置）
        await client.query(`
            CREATE TABLE IF NOT EXISTS comment_kol_list (
                id SERIAL PRIMARY KEY,
                region VARCHAR(2) NOT NULL,
                kol_username VARCHAR(50) NOT NULL,
                kol_display_name VARCHAR(100),
                group_index INTEGER NOT NULL,
                weight INTEGER DEFAULT 100,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(region, kol_username)
            )
        `);

        // 添加 weight 列（如果不存在）
        await client.query(`
            ALTER TABLE comment_kol_list ADD COLUMN IF NOT EXISTS weight INTEGER DEFAULT 100
        `);

        // 评论历史
        await client.query(`
            CREATE TABLE IF NOT EXISTS comment_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                region VARCHAR(2) NOT NULL,
                tweet_id VARCHAR(50) NOT NULL,
                tweet_url TEXT NOT NULL,
                tweet_author VARCHAR(50) NOT NULL,
                tweet_content TEXT,
                comment_content TEXT NOT NULL,
                comment_style VARCHAR(20) NOT NULL,
                comment_tweet_id VARCHAR(50),
                published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 评论设置（系统级，单行配置）
        await client.query(`
            CREATE TABLE IF NOT EXISTS comment_settings (
                id SERIAL PRIMARY KEY,
                daily_limit INTEGER DEFAULT 50,
                auto_enabled BOOLEAN DEFAULT false,
                notify_frequency VARCHAR(20) DEFAULT 'daily',
                ja_group_index INTEGER DEFAULT 0,
                en_group_index INTEGER DEFAULT 0,
                monthly_budget DECIMAL(10,2) DEFAULT 30.00,
                comment_user_id INTEGER REFERENCES users(id),
                last_run_at TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 添加 comment_user_id 列（如果不存在）
        await client.query(`
            ALTER TABLE comment_settings ADD COLUMN IF NOT EXISTS comment_user_id INTEGER REFERENCES users(id)
        `);

        // 添加 rate_limit_until 列（429 速率限制处理）
        await client.query(`
            ALTER TABLE comment_settings ADD COLUMN IF NOT EXISTS rate_limit_until TIMESTAMP WITH TIME ZONE
        `);

        // 收件箱通知
        await client.query(`
            CREATE TABLE IF NOT EXISTS comment_inbox (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                comment_history_id INTEGER NOT NULL REFERENCES comment_history(id),
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // twitterapi.io 费用统计
        await client.query(`
            CREATE TABLE IF NOT EXISTS twitterapi_usage (
                id SERIAL PRIMARY KEY,
                api_endpoint VARCHAR(100) NOT NULL,
                api_action VARCHAR(30) NOT NULL,
                request_count INTEGER DEFAULT 1,
                items_count INTEGER DEFAULT 0,
                credits_used DECIMAL(10,4),
                cost_usd DECIMAL(10,6),
                region VARCHAR(2),
                related_tweet_id VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 插入默认评论设置
        await client.query(`
            INSERT INTO comment_settings (id, daily_limit, auto_enabled)
            VALUES (1, 50, false)
            ON CONFLICT (id) DO NOTHING
        `);

        // 评论助手索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_kol_region_group ON comment_kol_list(region, group_index)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_history_user ON comment_history(user_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_history_tweet ON comment_history(tweet_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_history_date ON comment_history(published_at)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_inbox_user ON comment_inbox(user_id, is_read)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_twitterapi_usage_date ON twitterapi_usage(created_at)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_twitterapi_usage_action ON twitterapi_usage(api_action)
        `);

        // 迁移：为已有的 voice_prompts 添加 250 字限制说明
        const characterLimitSection = `

## 6. Content Length Adaptation

**When generating content with character limits (e.g., 250 chars for non-Premium users):**
- Adapt the writing style to be more concise while preserving the core personality traits
- Prioritize the most impactful phrases and sentence patterns
- Maintain the distinctive voice even in shorter formats
- Focus on the most characteristic elements: tone, vocabulary, and sentence structure`;

        const voicePromptsResult = await client.query(`
            SELECT id FROM voice_prompts
            WHERE prompt_content IS NOT NULL
            AND prompt_content NOT LIKE '%Content Length Adaptation%'
        `);

        if (voicePromptsResult.rows.length > 0) {
            console.log(`[迁移] 为 ${voicePromptsResult.rows.length} 条 voice_prompts 添加字数限制说明...`);
            await client.query(`
                UPDATE voice_prompts
                SET prompt_content = prompt_content || $1
                WHERE prompt_content IS NOT NULL
                AND prompt_content NOT LIKE '%Content Length Adaptation%'
            `, [characterLimitSection]);
            console.log(`[迁移] voice_prompts 更新完成`);
        }

        console.log('数据库表初始化完成');
    } finally {
        client.release();
    }
}

module.exports = { pool, initDatabase };

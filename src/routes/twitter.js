const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 存储 OAuth state（生产环境应使用 Redis）
const oauthStates = new Map();

// Twitter OAuth 2.0 配置
const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const TWITTER_USER_URL = 'https://api.twitter.com/2/users/me';

// 生成 PKCE code verifier 和 challenge
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

// ========== Twitter 登录 ==========

// 发起 Twitter 登录（不需要认证）
router.get('/login', (req, res) => {
    const { CLIENT_ID, CALLBACK_URL } = getTwitterConfig();

    if (!CLIENT_ID) {
        return res.status(500).json({ error: 'Twitter OAuth 未配置' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePKCE();

    // 保存 state 和 verifier（5分钟有效），标记为登录模式
    oauthStates.set(state, {
        verifier,
        mode: 'login', // 登录模式
        expiresAt: Date.now() + 5 * 60 * 1000
    });

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: CALLBACK_URL,
        scope: 'tweet.read tweet.write users.read media.write offline.access',
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    const authUrl = `${TWITTER_AUTH_URL}?${params.toString()}`;
    res.json({ authUrl });
});

// ========== Twitter 绑定（已登录用户） ==========

// 发起 OAuth 授权（需要认证）
router.get('/auth', authMiddleware, (req, res) => {
    const { CLIENT_ID, CALLBACK_URL } = getTwitterConfig();

    if (!CLIENT_ID) {
        return res.status(500).json({ error: 'Twitter OAuth 未配置' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePKCE();

    // 保存 state 和 verifier（5分钟有效），标记为绑定模式
    oauthStates.set(state, {
        verifier,
        mode: 'bind', // 绑定模式
        userId: req.user.userId,
        expiresAt: Date.now() + 5 * 60 * 1000
    });

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: CALLBACK_URL,
        scope: 'tweet.read tweet.write users.read media.write offline.access',
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    const authUrl = `${TWITTER_AUTH_URL}?${params.toString()}`;
    res.json({ authUrl });
});

// OAuth 回调（处理登录和绑定两种模式）
router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.redirect('/login.html?twitter_error=' + encodeURIComponent(error));
    }

    if (!code || !state) {
        return res.redirect('/login.html?twitter_error=missing_params');
    }

    const stateData = oauthStates.get(state);
    if (!stateData || stateData.expiresAt < Date.now()) {
        oauthStates.delete(state);
        return res.redirect('/login.html?twitter_error=invalid_state');
    }

    oauthStates.delete(state);

    try {
        const { CLIENT_ID, CLIENT_SECRET, CALLBACK_URL } = getTwitterConfig();

        // 交换 code 获取 token
        const tokenResponse = await fetch(TWITTER_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: CALLBACK_URL,
                code_verifier: stateData.verifier
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error('Token exchange failed:', errorData);
            return res.redirect('/login.html?twitter_error=token_exchange_failed');
        }

        const tokenData = await tokenResponse.json();
        const { access_token, refresh_token, expires_in } = tokenData;

        // 获取用户信息（包含头像）
        const userResponse = await fetch(`${TWITTER_USER_URL}?user.fields=profile_image_url`, {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });

        let twitterUser = { id: null, username: null, profile_image_url: null };
        if (userResponse.ok) {
            const userData = await userResponse.json();
            twitterUser = userData.data;
        }

        // 计算过期时间
        const expiresAt = expires_in
            ? new Date(Date.now() + expires_in * 1000)
            : null;

        // 根据模式处理
        if (stateData.mode === 'login') {
            // 登录模式：创建或查找用户，返回 JWT
            const result = await handleTwitterLogin(twitterUser, access_token, refresh_token, expiresAt);

            // 生成 JWT token
            const token = jwt.sign(
                { userId: result.userId, username: result.username },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            // 重定向到前端，带上 token
            res.redirect(`/login.html?twitter_login=success&token=${encodeURIComponent(token)}&username=${encodeURIComponent(result.username)}`);
        } else {
            // 绑定模式：保存 token 到已登录用户
            await saveTwitterCredentials(stateData.userId, twitterUser, access_token, refresh_token, expiresAt);
            res.redirect('/login.html?twitter_connected=true&twitter_username=' + encodeURIComponent(twitterUser.username || ''));
        }
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.redirect('/login.html?twitter_error=server_error');
    }
});

// 处理 Twitter 登录
async function handleTwitterLogin(twitterUser, accessToken, refreshToken, expiresAt) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 查找是否已有该 Twitter 用户
        let result = await client.query(
            'SELECT id, username FROM users WHERE twitter_id = $1',
            [twitterUser.id]
        );

        let userId, username;

        if (result.rows.length > 0) {
            // 用户已存在，更新信息
            userId = result.rows[0].id;
            username = result.rows[0].username;

            // 更新头像
            if (twitterUser.profile_image_url) {
                await client.query(
                    'UPDATE users SET avatar_url = $1 WHERE id = $2',
                    [twitterUser.profile_image_url, userId]
                );
            }
        } else {
            // 创建新用户
            username = twitterUser.username;

            // 检查用户名是否已被占用
            const existingUser = await client.query(
                'SELECT id FROM users WHERE username = $1',
                [username]
            );

            if (existingUser.rows.length > 0) {
                // 用户名已存在，添加随机后缀
                username = `${twitterUser.username}_${crypto.randomBytes(3).toString('hex')}`;
            }

            result = await client.query(
                `INSERT INTO users (username, twitter_id, avatar_url)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [username, twitterUser.id, twitterUser.profile_image_url]
            );
            userId = result.rows[0].id;
        }

        // 保存或更新 Twitter 凭证
        await client.query(`
            INSERT INTO twitter_credentials
                (user_id, twitter_user_id, twitter_username, access_token, refresh_token, token_expires_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id)
            DO UPDATE SET
                twitter_user_id = $2,
                twitter_username = $3,
                access_token = $4,
                refresh_token = $5,
                token_expires_at = $6,
                updated_at = CURRENT_TIMESTAMP
        `, [userId, twitterUser.id, twitterUser.username, accessToken, refreshToken, expiresAt]);

        await client.query('COMMIT');

        return { userId, username };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// 保存 Twitter 凭证（绑定模式）
async function saveTwitterCredentials(userId, twitterUser, accessToken, refreshToken, expiresAt) {
    // 更新用户的 twitter_id
    await pool.query(
        'UPDATE users SET twitter_id = $1, avatar_url = COALESCE(avatar_url, $2) WHERE id = $3',
        [twitterUser.id, twitterUser.profile_image_url, userId]
    );

    // 保存凭证
    await pool.query(`
        INSERT INTO twitter_credentials
            (user_id, twitter_user_id, twitter_username, access_token, refresh_token, token_expires_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id)
        DO UPDATE SET
            twitter_user_id = $2,
            twitter_username = $3,
            access_token = $4,
            refresh_token = $5,
            token_expires_at = $6,
            updated_at = CURRENT_TIMESTAMP
    `, [userId, twitterUser.id, twitterUser.username, accessToken, refreshToken, expiresAt]);
}

// 获取当前用户的 Twitter 连接状态
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT twitter_username, token_expires_at FROM twitter_credentials WHERE user_id = $1',
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.json({ connected: false });
        }

        const { twitter_username, token_expires_at } = result.rows[0];
        const isExpired = token_expires_at && new Date(token_expires_at) < new Date();

        res.json({
            connected: !isExpired,
            username: twitter_username,
            expiresAt: token_expires_at
        });
    } catch (err) {
        console.error('获取 Twitter 状态失败:', err);
        res.status(500).json({ error: '获取状态失败' });
    }
});

// 断开 Twitter 连接
router.delete('/disconnect', authMiddleware, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM twitter_credentials WHERE user_id = $1',
            [req.user.userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('断开 Twitter 连接失败:', err);
        res.status(500).json({ error: '断开连接失败' });
    }
});

// 发送推文
router.post('/tweet', authMiddleware, async (req, res) => {
    const { text, mediaIds } = req.body;

    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: '推文内容不能为空' });
    }

    try {
        // 获取用户的 access token
        const result = await pool.query(
            'SELECT access_token, refresh_token, token_expires_at FROM twitter_credentials WHERE user_id = $1',
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: '未连接 Twitter 账号' });
        }

        let { access_token, refresh_token, token_expires_at } = result.rows[0];

        // 检查 token 是否过期，尝试刷新
        if (token_expires_at && new Date(token_expires_at) < new Date()) {
            if (!refresh_token) {
                return res.status(401).json({ error: 'Token 已过期，请重新授权' });
            }

            const refreshed = await refreshAccessToken(req.user.userId, refresh_token);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token 刷新失败，请重新授权' });
            }
            access_token = refreshed.access_token;
        }

        // 发送推文
        const tweetBody = { text };
        if (mediaIds && mediaIds.length > 0) {
            tweetBody.media = { media_ids: mediaIds };
        }

        const tweetResponse = await fetch('https://api.twitter.com/2/tweets', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tweetBody)
        });

        if (!tweetResponse.ok) {
            const errorData = await tweetResponse.json();
            console.error('发推失败:', errorData);
            return res.status(tweetResponse.status).json({
                error: '发推失败',
                detail: errorData
            });
        }

        const tweetData = await tweetResponse.json();
        res.json({
            success: true,
            tweetId: tweetData.data.id,
            text: tweetData.data.text
        });
    } catch (err) {
        console.error('发推文错误:', err);
        res.status(500).json({ error: '发推失败' });
    }
});

// 上传媒体文件
router.post('/upload', authMiddleware, async (req, res) => {
    const { imagePath } = req.body;

    if (!imagePath) {
        return res.status(400).json({ error: '缺少图片路径' });
    }

    // 构建完整的文件路径
    const fullPath = path.join(__dirname, '../../', imagePath);

    if (!fs.existsSync(fullPath)) {
        return res.status(400).json({ error: '图片文件不存在' });
    }

    try {
        // 获取用户的 access token
        const result = await pool.query(
            'SELECT access_token, refresh_token, token_expires_at FROM twitter_credentials WHERE user_id = $1',
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: '未连接 Twitter 账号' });
        }

        let { access_token, refresh_token, token_expires_at } = result.rows[0];

        // 检查 token 是否过期，尝试刷新
        if (token_expires_at && new Date(token_expires_at) < new Date()) {
            if (!refresh_token) {
                return res.status(401).json({ error: 'Token 已过期，请重新授权' });
            }

            const refreshed = await refreshAccessToken(req.user.userId, refresh_token);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token 刷新失败，请重新授权' });
            }
            access_token = refreshed.access_token;
        }

        // 读取图片文件
        const imageBuffer = fs.readFileSync(fullPath);
        const imageBase64 = imageBuffer.toString('base64');

        // 获取文件 MIME 类型
        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';

        // 确定 media_category
        const mediaCategory = ext === '.gif' ? 'tweet_gif' : 'tweet_image';

        // 使用 Twitter v2 媒体上传 API (JSON 格式)
        const uploadResponse = await fetch('https://api.x.com/2/media/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                media: imageBase64,
                media_category: mediaCategory
            })
        });

        if (!uploadResponse.ok) {
            const errorData = await uploadResponse.json();
            console.error('媒体上传失败:', errorData);
            return res.status(uploadResponse.status).json({
                error: '媒体上传失败',
                detail: errorData
            });
        }

        const uploadData = await uploadResponse.json();
        console.log('媒体上传成功:', uploadData);

        res.json({
            success: true,
            mediaId: uploadData.data?.id || uploadData.data?.media_id_string
        });
    } catch (err) {
        console.error('媒体上传错误:', err);
        res.status(500).json({ error: '媒体上传失败: ' + err.message });
    }
});

// 刷新 access token
async function refreshAccessToken(userId, refreshToken) {
    const { CLIENT_ID, CLIENT_SECRET } = getTwitterConfig();

    try {
        const response = await fetch(TWITTER_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            return null;
        }

        const tokenData = await response.json();
        const { access_token, refresh_token: new_refresh_token, expires_in } = tokenData;

        const expiresAt = expires_in
            ? new Date(Date.now() + expires_in * 1000)
            : null;

        await pool.query(`
            UPDATE twitter_credentials
            SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $4
        `, [access_token, new_refresh_token || refreshToken, expiresAt, userId]);

        return { access_token };
    } catch (err) {
        console.error('刷新 token 失败:', err);
        return null;
    }
}

function getTwitterConfig() {
    return {
        CLIENT_ID: process.env.TWITTER_CLIENT_ID,
        CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET,
        CALLBACK_URL: process.env.TWITTER_CALLBACK_URL || 'http://localhost:3000/api/twitter/callback'
    };
}

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const router = express.Router();

// 用户注册
router.post('/register', async (req, res) => {
    const { username, password, invitationCode } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (!invitationCode) {
        return res.status(400).json({ error: '请输入邀请码' });
    }

    if (username.length < 3 || username.length > 50) {
        return res.status(400).json({ error: '用户名长度应为3-50个字符' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: '密码长度至少6个字符' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 验证邀请码
        const codeResult = await client.query(`
            SELECT id, used_by, expires_at
            FROM invitation_codes
            WHERE code = $1
            FOR UPDATE
        `, [invitationCode.toUpperCase()]);

        if (codeResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: '邀请码不存在' });
        }

        const invitation = codeResult.rows[0];

        if (invitation.used_by) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: '邀请码已被使用' });
        }

        if (invitation.expires_at && new Date(invitation.expires_at) <= new Date()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: '邀请码已过期' });
        }

        // 检查用户名是否已存在
        const existingUser = await client.query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );

        if (existingUser.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: '用户名已存在' });
        }

        // 加密密码
        const passwordHash = await bcrypt.hash(password, 10);

        // 创建用户
        const result = await client.query(
            'INSERT INTO users (username, password_hash, invited_by_code) VALUES ($1, $2, $3) RETURNING id',
            [username, passwordHash, invitationCode.toUpperCase()]
        );

        // 标记邀请码已使用
        await client.query(`
            UPDATE invitation_codes
            SET used_by = $1, used_at = NOW()
            WHERE id = $2
        `, [result.rows[0].id, invitation.id]);

        await client.query('COMMIT');

        // 生成 JWT
        const token = jwt.sign(
            { userId: result.rows[0].id, username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, username });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('注册失败:', err);
        res.status(500).json({ error: '注册失败' });
    } finally {
        client.release();
    }
});

// 用户登录
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    try {
        // 查找用户
        const result = await pool.query(
            'SELECT id, password_hash FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        const user = result.rows[0];

        // 验证密码
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 生成 JWT
        const token = jwt.sign(
            { userId: user.id, username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, username });
    } catch (err) {
        console.error('登录失败:', err);
        res.status(500).json({ error: '登录失败' });
    }
});

module.exports = router;

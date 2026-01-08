const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有路由都需要认证
router.use(authMiddleware);

// 获取用户的所有会话
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, claude_session_id, title, created_at, updated_at
             FROM sessions
             WHERE user_id = $1
             ORDER BY updated_at DESC`,
            [req.user.userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('获取会话列表失败:', err);
        res.status(500).json({ error: '获取会话列表失败' });
    }
});

// 创建新会话
router.post('/', async (req, res) => {
    const { title } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO sessions (user_id, title)
             VALUES ($1, $2)
             RETURNING id, claude_session_id, title, created_at, updated_at`,
            [req.user.userId, title || '新对话']
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('创建会话失败:', err);
        res.status(500).json({ error: '创建会话失败' });
    }
});

// 获取会话的消息历史
router.get('/:id/messages', async (req, res) => {
    try {
        // 验证会话属于当前用户
        const session = await pool.query(
            'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.userId]
        );

        if (session.rows.length === 0) {
            return res.status(404).json({ error: '会话不存在' });
        }

        const result = await pool.query(
            `SELECT id, role, content, created_at
             FROM messages
             WHERE session_id = $1
             ORDER BY created_at ASC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('获取消息历史失败:', err);
        res.status(500).json({ error: '获取消息历史失败' });
    }
});

// 删除会话
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '会话不存在' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('删除会话失败:', err);
        res.status(500).json({ error: '删除会话失败' });
    }
});

// 更新会话标题
router.patch('/:id', async (req, res) => {
    const { title } = req.body;

    try {
        const result = await pool.query(
            `UPDATE sessions
             SET title = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND user_id = $3
             RETURNING id, title`,
            [title, req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '会话不存在' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('更新会话失败:', err);
        res.status(500).json({ error: '更新会话失败' });
    }
});

module.exports = router;

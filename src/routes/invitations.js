const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware: authenticate } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

const router = express.Router();

/**
 * 生成随机邀请码
 * 格式: VX-XXXXXX (6位大写字母数字)
 */
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'VX-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * POST /api/invitations/generate
 * 批量生成邀请码（管理员）
 */
router.post('/generate', authenticate, adminAuth, async (req, res) => {
    try {
        const { count = 1, expiresIn, note } = req.body;

        // 验证数量
        const codeCount = Math.min(Math.max(parseInt(count) || 1, 1), 100);

        // 计算过期时间
        let expiresAt = null;
        if (expiresIn && expiresIn !== 'never') {
            const days = parseInt(expiresIn);
            if (days > 0) {
                expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + days);
            }
        }

        // 生成邀请码
        const codes = [];
        const createdCodes = [];

        for (let i = 0; i < codeCount; i++) {
            let code;
            let attempts = 0;
            // 确保生成唯一码
            do {
                code = generateCode();
                attempts++;
            } while (codes.includes(code) && attempts < 10);
            codes.push(code);
        }

        // 批量插入数据库
        for (const code of codes) {
            try {
                const result = await pool.query(`
                    INSERT INTO invitation_codes (code, note, created_by, expires_at)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id, code, note, expires_at, created_at
                `, [code, note || null, req.user.userId, expiresAt]);
                createdCodes.push(result.rows[0]);
            } catch (err) {
                // 如果码重复，跳过
                if (err.code === '23505') continue;
                throw err;
            }
        }

        res.json({
            success: true,
            count: createdCodes.length,
            codes: createdCodes
        });
    } catch (error) {
        console.error('生成邀请码失败:', error);
        res.status(500).json({ error: '生成邀请码失败' });
    }
});

/**
 * GET /api/invitations
 * 获取邀请码列表（管理员）
 */
router.get('/', authenticate, adminAuth, async (req, res) => {
    try {
        const {
            status = 'all',  // all, available, used, expired
            search = '',
            page = 1,
            limit = 20
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        let paramIndex = 1;

        // 构建查询条件
        let whereClause = 'WHERE 1=1';

        if (status === 'available') {
            whereClause += ` AND ic.used_by IS NULL AND (ic.expires_at IS NULL OR ic.expires_at > NOW())`;
        } else if (status === 'used') {
            whereClause += ` AND ic.used_by IS NOT NULL`;
        } else if (status === 'expired') {
            whereClause += ` AND ic.used_by IS NULL AND ic.expires_at IS NOT NULL AND ic.expires_at <= NOW()`;
        }

        if (search) {
            whereClause += ` AND (ic.code ILIKE $${paramIndex} OR ic.note ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        // 获取总数
        const countResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM invitation_codes ic
            ${whereClause}
        `, params);

        // 获取列表
        params.push(parseInt(limit), offset);
        const result = await pool.query(`
            SELECT
                ic.id, ic.code, ic.note, ic.expires_at, ic.created_at, ic.used_at,
                creator.username as created_by_username,
                used_user.username as used_by_username
            FROM invitation_codes ic
            LEFT JOIN users creator ON ic.created_by = creator.id
            LEFT JOIN users used_user ON ic.used_by = used_user.id
            ${whereClause}
            ORDER BY ic.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, params);

        // 计算状态
        const codes = result.rows.map(row => {
            let codeStatus = 'available';
            if (row.used_by_username) {
                codeStatus = 'used';
            } else if (row.expires_at && new Date(row.expires_at) <= new Date()) {
                codeStatus = 'expired';
            }
            return {
                ...row,
                status: codeStatus
            };
        });

        res.json({
            codes,
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('获取邀请码列表失败:', error);
        res.status(500).json({ error: '获取邀请码列表失败' });
    }
});

/**
 * GET /api/invitations/validate/:code
 * 验证邀请码是否可用（公开接口，注册时使用）
 */
router.get('/validate/:code', async (req, res) => {
    try {
        const { code } = req.params;

        const result = await pool.query(`
            SELECT id, code, used_by, expires_at
            FROM invitation_codes
            WHERE code = $1
        `, [code.toUpperCase()]);

        if (result.rows.length === 0) {
            return res.json({ valid: false, reason: '邀请码不存在' });
        }

        const invitation = result.rows[0];

        if (invitation.used_by) {
            return res.json({ valid: false, reason: '邀请码已被使用' });
        }

        if (invitation.expires_at && new Date(invitation.expires_at) <= new Date()) {
            return res.json({ valid: false, reason: '邀请码已过期' });
        }

        res.json({ valid: true });
    } catch (error) {
        console.error('验证邀请码失败:', error);
        res.status(500).json({ error: '验证邀请码失败' });
    }
});

/**
 * DELETE /api/invitations/:id
 * 删除邀请码（管理员，仅未使用的可删除）
 */
router.delete('/:id', authenticate, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            DELETE FROM invitation_codes
            WHERE id = $1 AND used_by IS NULL
            RETURNING id
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(400).json({ error: '邀请码不存在或已被使用，无法删除' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('删除邀请码失败:', error);
        res.status(500).json({ error: '删除邀请码失败' });
    }
});

/**
 * GET /api/invitations/stats
 * 获取邀请码统计（管理员）
 */
router.get('/stats', authenticate, adminAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE used_by IS NULL AND (expires_at IS NULL OR expires_at > NOW())) as available,
                COUNT(*) FILTER (WHERE used_by IS NOT NULL) as used,
                COUNT(*) FILTER (WHERE used_by IS NULL AND expires_at IS NOT NULL AND expires_at <= NOW()) as expired
            FROM invitation_codes
        `);

        res.json(result.rows[0]);
    } catch (error) {
        console.error('获取邀请码统计失败:', error);
        res.status(500).json({ error: '获取统计失败' });
    }
});

module.exports = router;

const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authMiddleware: authenticate } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');
const tokenUsageDb = require('../services/tokenUsageDb');

const router = express.Router();

// 所有管理员路由都需要先验证身份，再验证管理员权限
router.use(authenticate);
router.use(adminAuth);

/**
 * GET /api/admin/stats/overview
 * 获取全局统计概览
 */
router.get('/stats/overview', async (req, res) => {
    try {
        const { period = 'month', start_date, end_date } = req.query;

        const overview = await tokenUsageDb.getAdminOverview({
            period,
            startDate: start_date,
            endDate: end_date
        });

        // 转换为前端期望的格式
        const response = {
            summary: {
                totalInputTokens: overview.total_input_tokens,
                totalOutputTokens: overview.total_output_tokens,
                totalCost: overview.total_cost_usd,
                totalCalls: overview.total_requests
            },
            userCount: overview.active_users,
            totalUsers: overview.total_users,
            byDate: overview.by_date
        };

        res.json(response);
    } catch (error) {
        console.error('获取全局统计失败:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

/**
 * GET /api/admin/stats/users
 * 获取用户列表（带消耗统计）
 */
router.get('/stats/users', async (req, res) => {
    try {
        const {
            search = '',
            sort = 'cost_desc',
            page = 1,
            limit = 20,
            period = 'month'
        } = req.query;

        const result = await tokenUsageDb.getAdminUserList({
            search,
            sort,
            page: parseInt(page),
            limit: parseInt(limit),
            period
        });

        // 转换为前端期望的格式
        const response = {
            users: result.users.map(user => ({
                id: user.id,
                username: user.username,
                avatar_url: user.avatar_url,
                created_at: user.created_at,
                is_admin: user.is_admin || false,
                total_tokens: user.total_tokens,
                total_cost: user.cost_usd,
                total_calls: user.request_count,
                task_count: user.request_count // 暂用请求数代替任务数
            })),
            total: result.total,
            page: result.page,
            limit: result.limit
        };

        res.json(response);
    } catch (error) {
        console.error('获取用户列表失败:', error);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

/**
 * GET /api/admin/stats/users/:userId
 * 获取单个用户的详细统计
 */
router.get('/stats/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { period = 'month', start_date, end_date } = req.query;

        // 获取用户基本信息
        const { pool } = require('../config/database');
        const userResult = await pool.query(
            'SELECT id, username, avatar_url, is_admin, created_at FROM users WHERE id = $1',
            [parseInt(userId)]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const user = userResult.rows[0];

        // 获取统计数据
        const stats = await tokenUsageDb.getUserStats(parseInt(userId), {
            period,
            startDate: start_date,
            endDate: end_date
        });

        // 转换为前端期望的格式
        const response = {
            user: {
                id: user.id,
                username: user.username,
                avatar_url: user.avatar_url,
                is_admin: user.is_admin,
                created_at: user.created_at
            },
            summary: {
                totalInputTokens: stats.summary.total_input_tokens,
                totalOutputTokens: stats.summary.total_output_tokens,
                totalCacheCreationTokens: stats.summary.total_cache_creation_tokens,
                totalCacheReadTokens: stats.summary.total_cache_read_tokens,
                totalCost: stats.summary.total_cost_usd,
                totalCalls: stats.summary.total_requests,
                taskCount: stats.by_step.length > 0 ? stats.summary.total_requests : 0
            },
            byWorkflowStep: stats.by_step.map(step => ({
                workflow_step: step.workflow_step,
                cost_usd: step.cost_usd,
                request_count: step.request_count,
                total_tokens: step.total_tokens,
                skills: step.skills
            })),
            // 扁平化所有 skills 用于单独展示
            bySkill: stats.by_step.flatMap(step =>
                (step.skills || []).map(skill => ({
                    ...skill,
                    workflow_step: step.workflow_step
                }))
            ),
            byDate: stats.by_date
        };

        res.json(response);
    } catch (error) {
        console.error('获取用户统计失败:', error);
        res.status(500).json({ error: '获取用户统计失败' });
    }
});

/**
 * POST /api/admin/users/:userId/set-admin
 * 设置/取消用户管理员权限
 */
router.post('/users/:userId/set-admin', async (req, res) => {
    try {
        const { userId } = req.params;
        const { isAdmin } = req.body;

        await tokenUsageDb.setAdmin(parseInt(userId), isAdmin === true);

        res.json({ success: true, message: isAdmin ? '已设置为管理员' : '已取消管理员权限' });
    } catch (error) {
        console.error('设置管理员失败:', error);
        res.status(500).json({ error: '设置管理员失败' });
    }
});

/**
 * POST /api/admin/users/:userId/login-as
 * 以指定用户身份登录（管理员功能）
 */
router.post('/users/:userId/login-as', async (req, res) => {
    try {
        const { userId } = req.params;

        // 获取目标用户信息
        const result = await pool.query(
            'SELECT id, username FROM users WHERE id = $1',
            [parseInt(userId)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const targetUser = result.rows[0];

        // 生成目标用户的 JWT token
        const token = jwt.sign(
            { userId: targetUser.id, username: targetUser.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`[Admin] 管理员 ${req.user.username} 以用户 ${targetUser.username} 身份登录`);

        res.json({
            success: true,
            token,
            username: targetUser.username,
            message: `已切换为用户 ${targetUser.username}`
        });
    } catch (error) {
        console.error('以用户身份登录失败:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

/**
 * GET /api/admin/users
 * 获取所有用户列表（用户管理页面）
 */
router.get('/users', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        let paramIndex = 1;
        let whereClause = 'WHERE 1=1';

        if (search) {
            whereClause += ` AND username ILIKE $${paramIndex}`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        // 获取总数
        const countResult = await pool.query(`
            SELECT COUNT(*) as count FROM users ${whereClause}
        `, params);

        // 获取用户列表
        params.push(parseInt(limit), offset);
        const result = await pool.query(`
            SELECT id, username, avatar_url, is_admin, invited_by_code, created_at
            FROM users
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, params);

        res.json({
            users: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('获取用户列表失败:', error);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

module.exports = router;

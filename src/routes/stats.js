const express = require('express');
const { authMiddleware: authenticate } = require('../middleware/auth');
const tokenUsageDb = require('../services/tokenUsageDb');

const router = express.Router();

/**
 * GET /api/stats/my
 * 获取当前用户的 Token 使用统计
 */
router.get('/my', authenticate, async (req, res) => {
    try {
        const { period = 'month', start_date, end_date } = req.query;

        const stats = await tokenUsageDb.getUserStats(req.user.userId, {
            period,
            startDate: start_date,
            endDate: end_date
        });

        // 转换为前端期望的格式
        const response = {
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
            byDate: stats.by_date
        };

        res.json(response);
    } catch (error) {
        console.error('获取用户统计失败:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

module.exports = router;

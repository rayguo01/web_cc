const { pool } = require('../config/database');

/**
 * 记录 Token 使用
 */
async function recordUsage({
    userId,
    taskId = null,
    workflowStep = null,
    skillId,
    model = 'unknown',
    inputTokens = 0,
    outputTokens = 0,
    cacheCreationTokens = 0,
    cacheReadTokens = 0,
    costUsd = 0,
    durationMs = 0
}) {
    try {
        await pool.query(`
            INSERT INTO token_usage (
                user_id, task_id, workflow_step, skill_id, model,
                input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                cost_usd, duration_ms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
            userId, taskId, workflowStep, skillId, model,
            inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
            costUsd, durationMs
        ]);
    } catch (error) {
        console.error('记录 Token 使用失败:', error);
    }
}

/**
 * 获取用户统计
 */
async function getUserStats(userId, { startDate, endDate, period = 'month' } = {}) {
    // 计算日期范围
    let dateFilter = '';
    const params = [userId];
    let paramIndex = 2;

    if (startDate && endDate) {
        dateFilter = `AND created_at >= $${paramIndex} AND created_at < $${paramIndex + 1}`;
        params.push(startDate, endDate);
    } else {
        // 默认按 period 计算
        const now = new Date();
        let start;
        if (period === 'day') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
            const day = now.getDay();
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
        } else {
            // month
            start = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        dateFilter = `AND created_at >= $${paramIndex}`;
        params.push(start.toISOString());
    }

    // 总体统计
    const summaryResult = await pool.query(`
        SELECT
            COALESCE(SUM(cost_usd), 0) as total_cost_usd,
            COALESCE(SUM(input_tokens), 0) as total_input_tokens,
            COALESCE(SUM(output_tokens), 0) as total_output_tokens,
            COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
            COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
            COUNT(*) as total_requests
        FROM token_usage
        WHERE user_id = $1 ${dateFilter}
    `, params);

    // 按工作流步骤统计
    const byStepResult = await pool.query(`
        SELECT
            workflow_step,
            COALESCE(SUM(cost_usd), 0) as cost_usd,
            COUNT(*) as request_count,
            COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
        FROM token_usage
        WHERE user_id = $1 ${dateFilter}
        GROUP BY workflow_step
        ORDER BY cost_usd DESC
    `, params);

    // 按 Skill 统计（嵌套在步骤下）
    const bySkillResult = await pool.query(`
        SELECT
            workflow_step,
            skill_id,
            COALESCE(SUM(cost_usd), 0) as cost_usd,
            COUNT(*) as request_count
        FROM token_usage
        WHERE user_id = $1 ${dateFilter}
        GROUP BY workflow_step, skill_id
        ORDER BY workflow_step, cost_usd DESC
    `, params);

    // 按日期统计
    const byDateResult = await pool.query(`
        SELECT
            DATE(created_at) as date,
            COALESCE(SUM(cost_usd), 0) as cost_usd,
            COUNT(*) as request_count
        FROM token_usage
        WHERE user_id = $1 ${dateFilter}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
    `, params);

    // 组装按步骤的数据（包含 skills）
    const skillsByStep = {};
    bySkillResult.rows.forEach(row => {
        const step = row.workflow_step || 'other';
        if (!skillsByStep[step]) {
            skillsByStep[step] = [];
        }
        skillsByStep[step].push({
            skill_id: row.skill_id,
            cost_usd: parseFloat(row.cost_usd),
            request_count: parseInt(row.request_count)
        });
    });

    const byStep = byStepResult.rows.map(row => ({
        workflow_step: row.workflow_step || 'other',
        cost_usd: parseFloat(row.cost_usd),
        request_count: parseInt(row.request_count),
        total_tokens: parseInt(row.total_tokens),
        skills: skillsByStep[row.workflow_step || 'other'] || []
    }));

    return {
        summary: {
            total_cost_usd: parseFloat(summaryResult.rows[0].total_cost_usd),
            total_input_tokens: parseInt(summaryResult.rows[0].total_input_tokens),
            total_output_tokens: parseInt(summaryResult.rows[0].total_output_tokens),
            total_cache_creation_tokens: parseInt(summaryResult.rows[0].total_cache_creation_tokens),
            total_cache_read_tokens: parseInt(summaryResult.rows[0].total_cache_read_tokens),
            total_requests: parseInt(summaryResult.rows[0].total_requests)
        },
        by_step: byStep,
        by_date: byDateResult.rows.map(row => ({
            date: row.date,
            cost_usd: parseFloat(row.cost_usd),
            request_count: parseInt(row.request_count)
        }))
    };
}

/**
 * 管理员：获取全局概览
 */
async function getAdminOverview({ startDate, endDate, period = 'month' } = {}) {
    let dateFilter = '';
    const params = [];
    let paramIndex = 1;

    if (startDate && endDate) {
        dateFilter = `WHERE created_at >= $${paramIndex} AND created_at < $${paramIndex + 1}`;
        params.push(startDate, endDate);
    } else {
        const now = new Date();
        let start;
        if (period === 'day') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
            const day = now.getDay();
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
        } else {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        dateFilter = `WHERE created_at >= $${paramIndex}`;
        params.push(start.toISOString());
    }

    // 总体统计
    const statsResult = await pool.query(`
        SELECT
            COALESCE(SUM(cost_usd), 0) as total_cost_usd,
            COALESCE(SUM(input_tokens), 0) as total_input_tokens,
            COALESCE(SUM(output_tokens), 0) as total_output_tokens,
            COUNT(*) as total_requests,
            COUNT(DISTINCT user_id) as active_users
        FROM token_usage
        ${dateFilter}
    `, params);

    // 总用户数
    const userCountResult = await pool.query(`SELECT COUNT(*) as count FROM users`);

    // 按日期统计
    const byDateResult = await pool.query(`
        SELECT
            DATE(created_at) as date,
            COALESCE(SUM(cost_usd), 0) as cost_usd,
            COUNT(*) as request_count,
            COUNT(DISTINCT user_id) as active_users
        FROM token_usage
        ${dateFilter}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
    `, params);

    return {
        total_users: parseInt(userCountResult.rows[0].count),
        total_cost_usd: parseFloat(statsResult.rows[0].total_cost_usd),
        total_input_tokens: parseInt(statsResult.rows[0].total_input_tokens),
        total_output_tokens: parseInt(statsResult.rows[0].total_output_tokens),
        total_requests: parseInt(statsResult.rows[0].total_requests),
        active_users: parseInt(statsResult.rows[0].active_users),
        by_date: byDateResult.rows.map(row => ({
            date: row.date,
            cost_usd: parseFloat(row.cost_usd),
            request_count: parseInt(row.request_count),
            active_users: parseInt(row.active_users)
        }))
    };
}

/**
 * 管理员：获取用户列表（带消耗统计）
 */
async function getAdminUserList({ search = '', sort = 'cost_desc', page = 1, limit = 20, period = 'month' } = {}) {
    const offset = (page - 1) * limit;

    // 计算日期范围
    const now = new Date();
    let start;
    if (period === 'day') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
        const day = now.getDay();
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    } else {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    let searchFilter = '';
    const params = [start.toISOString(), limit, offset];

    if (search) {
        searchFilter = `AND u.username ILIKE $4`;
        params.push(`%${search}%`);
    }

    // 排序
    let orderBy = 'cost_usd DESC';
    if (sort === 'cost_asc') orderBy = 'cost_usd ASC';
    else if (sort === 'requests_desc') orderBy = 'request_count DESC';
    else if (sort === 'requests_asc') orderBy = 'request_count ASC';

    const result = await pool.query(`
        SELECT
            u.id,
            u.username,
            u.avatar_url,
            u.is_admin,
            u.created_at as user_created_at,
            COALESCE(SUM(t.cost_usd), 0) as cost_usd,
            COUNT(t.id) as request_count,
            COALESCE(SUM(t.input_tokens + t.output_tokens), 0) as total_tokens
        FROM users u
        LEFT JOIN token_usage t ON u.id = t.user_id AND t.created_at >= $1
        WHERE 1=1 ${searchFilter}
        GROUP BY u.id, u.username, u.avatar_url, u.is_admin, u.created_at
        ORDER BY ${orderBy}
        LIMIT $2 OFFSET $3
    `, params);

    // 获取总数
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await pool.query(`
        SELECT COUNT(*) as count FROM users
        ${search ? 'WHERE username ILIKE $1' : ''}
    `, countParams);

    return {
        users: result.rows.map(row => ({
            id: row.id,
            username: row.username,
            avatar_url: row.avatar_url,
            is_admin: row.is_admin || false,
            created_at: row.user_created_at,
            cost_usd: parseFloat(row.cost_usd),
            request_count: parseInt(row.request_count),
            total_tokens: parseInt(row.total_tokens)
        })),
        total: parseInt(countResult.rows[0].count),
        page,
        limit
    };
}

/**
 * 检查用户是否是管理员
 */
async function isAdmin(userId) {
    const result = await pool.query(
        'SELECT is_admin FROM users WHERE id = $1',
        [userId]
    );
    return result.rows[0]?.is_admin === true;
}

/**
 * 设置用户为管理员
 */
async function setAdmin(userId, isAdmin = true) {
    await pool.query(
        'UPDATE users SET is_admin = $1 WHERE id = $2',
        [isAdmin, userId]
    );
}

module.exports = {
    recordUsage,
    getUserStats,
    getAdminOverview,
    getAdminUserList,
    isAdmin,
    setAdmin
};

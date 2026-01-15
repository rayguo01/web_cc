const tokenUsageDb = require('../services/tokenUsageDb');

/**
 * 管理员权限中间件
 * 需要先通过 authenticate 中间件验证用户身份
 */
async function adminAuth(req, res, next) {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ error: '未授权访问' });
        }

        const isAdmin = await tokenUsageDb.isAdmin(req.user.userId);

        if (!isAdmin) {
            return res.status(403).json({ error: '无管理员权限' });
        }

        next();
    } catch (error) {
        console.error('管理员验证失败:', error);
        res.status(500).json({ error: '权限验证失败' });
    }
}

module.exports = { adminAuth };

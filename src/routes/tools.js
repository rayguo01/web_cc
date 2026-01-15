/**
 * 工具 API 路由
 */
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { authMiddleware: authenticate } = require('../middleware/auth');
const voicePromptDb = require('../services/voicePromptDb');

const router = express.Router();

/**
 * 获取市场列表
 */
router.get('/voice-prompts/market', authenticate, async (req, res) => {
    try {
        const { sort = 'usage', page = 1, limit = 20 } = req.query;
        const result = await voicePromptDb.getMarket(
            req.user.userId,
            sort,
            parseInt(page),
            parseInt(limit)
        );
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('获取市场列表失败:', error);
        res.status(500).json({ error: '获取市场列表失败' });
    }
});

/**
 * 获取我创建的语气 Prompt 列表
 */
router.get('/voice-prompts/mine', authenticate, async (req, res) => {
    try {
        const prompts = await voicePromptDb.getMine(req.user.userId);
        res.json({ success: true, prompts });
    } catch (error) {
        console.error('获取我的语气 Prompt 列表失败:', error);
        res.status(500).json({ error: '获取列表失败' });
    }
});

/**
 * 获取我订阅的语气 Prompt 列表
 */
router.get('/voice-prompts/subscribed', authenticate, async (req, res) => {
    try {
        const prompts = await voicePromptDb.getSubscribed(req.user.userId);
        res.json({ success: true, prompts });
    } catch (error) {
        console.error('获取订阅列表失败:', error);
        res.status(500).json({ error: '获取订阅列表失败' });
    }
});

/**
 * 获取内容生成时可用的语气列表（三列数据）
 */
router.get('/voice-prompts/available', authenticate, async (req, res) => {
    try {
        const result = await voicePromptDb.getAvailable(req.user.userId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('获取可用语气列表失败:', error);
        res.status(500).json({ error: '获取列表失败' });
    }
});

/**
 * 获取用户保存的所有语气 Prompt（兼容旧接口）
 */
router.get('/voice-prompts', authenticate, async (req, res) => {
    try {
        const prompts = await voicePromptDb.getMine(req.user.userId);
        console.log(`[voice-prompts] userId=${req.user.userId}, 返回 ${prompts.length} 条记录`);
        res.json({ success: true, prompts });
    } catch (error) {
        console.error('获取语气 Prompt 列表失败:', error);
        res.status(500).json({ error: '获取列表失败' });
    }
});

/**
 * 列出所有语气 Prompt（调试用，仅管理员）
 * 注意：此路由必须在 /:id 之前定义
 */
router.get('/voice-prompts/admin/list-all', authenticate, async (req, res) => {
    try {
        const adminUsers = ['admin', 'rayguo'];
        if (!adminUsers.includes((req.user.username || '').toLowerCase())) {
            return res.status(403).json({ error: '无权限' });
        }

        const { pool } = require('../config/database');
        const result = await pool.query(
            `SELECT id, user_id, username, display_name, is_public, usage_count, created_at
             FROM voice_prompts
             ORDER BY created_at DESC`
        );
        res.json({ success: true, total: result.rows.length, prompts: result.rows });
    } catch (error) {
        console.error('列出所有语气 Prompt 失败:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

/**
 * 获取单个语气 Prompt 详情
 */
router.get('/voice-prompts/:id', authenticate, async (req, res) => {
    try {
        const prompt = await voicePromptDb.getById(req.params.id, req.user.userId);
        if (!prompt) {
            return res.status(404).json({ error: '未找到该记录' });
        }
        res.json({ success: true, prompt });
    } catch (error) {
        console.error('获取语气 Prompt 详情失败:', error);
        res.status(500).json({ error: '获取详情失败' });
    }
});

/**
 * 删除语气 Prompt
 */
router.delete('/voice-prompts/:id', authenticate, async (req, res) => {
    try {
        const deleted = await voicePromptDb.delete(req.params.id, req.user.userId);
        if (!deleted) {
            return res.status(404).json({ error: '未找到该记录' });
        }
        res.json({ success: true, message: '删除成功' });
    } catch (error) {
        console.error('删除语气 Prompt 失败:', error);
        res.status(500).json({ error: '删除失败' });
    }
});

/**
 * 设置语气 Prompt 为公共（管理员功能）
 * 用于一次性设置公共模板
 */
router.post('/voice-prompts/:id/set-public', authenticate, async (req, res) => {
    try {
        // 简单的管理员检查（可以根据需要改进）
        const adminUsers = ['admin', 'rayguo']; // 允许的管理员用户名
        const username = req.user.username || '';

        if (!adminUsers.includes(username.toLowerCase())) {
            return res.status(403).json({ error: '无权限执行此操作' });
        }

        const { isPublic = true } = req.body;
        const result = await voicePromptDb.setPublic(req.params.id, isPublic);

        if (!result) {
            return res.status(404).json({ error: '未找到该记录' });
        }

        res.json({
            success: true,
            message: isPublic ? '已设为公共' : '已设为私有',
            prompt: result
        });
    } catch (error) {
        console.error('设置公共状态失败:', error);
        res.status(500).json({ error: '设置失败' });
    }
});

/**
 * 增加语气 Prompt 使用次数
 */
router.post('/voice-prompts/:id/use', authenticate, async (req, res) => {
    try {
        const result = await voicePromptDb.incrementUsageCount(req.params.id);
        if (!result) {
            return res.status(404).json({ error: '未找到该记录' });
        }
        res.json({
            success: true,
            usage_count: result.usage_count
        });
    } catch (error) {
        console.error('增加使用次数失败:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

/**
 * 开放到市场
 */
router.post('/voice-prompts/:id/publish', authenticate, async (req, res) => {
    try {
        const result = await voicePromptDb.publish(req.params.id, req.user.userId);
        if (!result) {
            return res.status(404).json({ error: '未找到该记录或无权限' });
        }
        res.json({ success: true, message: '已开放到市场', prompt: result });
    } catch (error) {
        console.error('开放到市场失败:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

/**
 * 从市场撤回
 */
router.post('/voice-prompts/:id/unpublish', authenticate, async (req, res) => {
    try {
        const result = await voicePromptDb.unpublish(req.params.id, req.user.userId);
        if (!result) {
            return res.status(404).json({ error: '未找到该记录或无权限' });
        }
        res.json({ success: true, message: '已从市场撤回', prompt: result });
    } catch (error) {
        console.error('从市场撤回失败:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

/**
 * 订阅模仿器
 */
router.post('/voice-prompts/:id/subscribe', authenticate, async (req, res) => {
    try {
        await voicePromptDb.subscribe(req.user.userId, req.params.id);
        res.json({ success: true, message: '订阅成功' });
    } catch (error) {
        console.error('订阅失败:', error);
        res.status(400).json({ error: error.message || '订阅失败' });
    }
});

/**
 * 取消订阅
 */
router.delete('/voice-prompts/:id/subscribe', authenticate, async (req, res) => {
    try {
        await voicePromptDb.unsubscribe(req.user.userId, req.params.id);
        res.json({ success: true, message: '已取消订阅' });
    } catch (error) {
        console.error('取消订阅失败:', error);
        res.status(500).json({ error: '取消订阅失败' });
    }
});

/**
 * 执行语气分析（SSE）
 */
router.post('/voice-prompts/analyze', authenticate, async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: '请提供 Twitter 用户名' });
    }

    // 清理用户名
    const cleanUsername = username.replace(/^@/, '').trim();

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 安全写入函数
    const safeWrite = (data) => {
        if (!res.destroyed && !res.writableEnded) {
            try {
                res.write(data);
                return true;
            } catch (e) {
                return false;
            }
        }
        return false;
    };

    // 发送开始事件
    safeWrite(`data: ${JSON.stringify({
        type: 'start',
        message: `开始分析 @${cleanUsername} 的写作风格...`
    })}\n\n`);

    try {
        const scriptPath = path.join(__dirname, '../../.claude/voice-mimicker/voice-mimicker.ts');

        // 使用 ts-node 执行脚本
        // 将命令合并为字符串，避免 DEP0190 警告
        const fullCommand = `npx ts-node "${scriptPath}" "${cleanUsername}"`;
        const child = spawn(fullCommand, [], {
            cwd: path.join(__dirname, '../..'),
            env: { ...process.env },
            shell: true
        });

        let output = '';
        let resultJson = null;

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;

            // 尝试提取 JSON 结果
            const jsonMatch = output.match(/--- RESULT_JSON_START ---\n([\s\S]*?)\n--- RESULT_JSON_END ---/);
            if (jsonMatch) {
                try {
                    resultJson = JSON.parse(jsonMatch[1]);
                } catch (e) {
                    // 解析失败，继续等待
                }
            }

            // 发送日志
            safeWrite(`data: ${JSON.stringify({ type: 'log', message: text })}\n\n`);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            // 过滤掉 ts-node 的编译信息
            if (!text.includes('Compiling') && !text.includes('Using TypeScript')) {
                safeWrite(`data: ${JSON.stringify({ type: 'log', message: text })}\n\n`);
            }
        });

        child.on('close', async (code) => {
            if (code === 0 && resultJson) {
                try {
                    // 保存到数据库
                    const saved = await voicePromptDb.save(req.user.userId, resultJson);

                    safeWrite(`data: ${JSON.stringify({
                        type: 'done',
                        message: '分析完成！',
                        result: {
                            id: saved.id,
                            username: resultJson.username,
                            avatarUrl: resultJson.avatarUrl,
                            tweetCount: resultJson.tweetCount,
                            totalChars: resultJson.totalChars,
                            promptContent: resultJson.promptContent
                        }
                    })}\n\n`);
                } catch (dbError) {
                    console.error('保存到数据库失败:', dbError);
                    safeWrite(`data: ${JSON.stringify({
                        type: 'error',
                        message: '保存失败: ' + dbError.message
                    })}\n\n`);
                }
            } else {
                safeWrite(`data: ${JSON.stringify({
                    type: 'error',
                    message: `分析失败，退出码: ${code}`
                })}\n\n`);
            }

            if (!res.destroyed && !res.writableEnded) {
                res.end();
            }
        });

        child.on('error', (error) => {
            safeWrite(`data: ${JSON.stringify({
                type: 'error',
                message: error.message
            })}\n\n`);
            if (!res.destroyed && !res.writableEnded) {
                res.end();
            }
        });

        // 处理客户端断开
        req.on('close', () => {
            console.log('[voice-mimicker] 客户端断开连接');
        });

    } catch (error) {
        console.error('执行分析失败:', error);
        safeWrite(`data: ${JSON.stringify({
            type: 'error',
            message: error.message
        })}\n\n`);
        if (!res.destroyed && !res.writableEnded) {
            res.end();
        }
    }
});

module.exports = router;

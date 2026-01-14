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
 * 获取用户保存的所有语气 Prompt
 */
router.get('/voice-prompts', authenticate, async (req, res) => {
    try {
        const prompts = await voicePromptDb.getByUserId(req.user.userId);
        res.json({ success: true, prompts });
    } catch (error) {
        console.error('获取语气 Prompt 列表失败:', error);
        res.status(500).json({ error: '获取列表失败' });
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
        const child = spawn('npx', ['ts-node', scriptPath, cleanUsername], {
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

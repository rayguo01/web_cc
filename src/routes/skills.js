const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { authMiddleware: authenticate } = require('../middleware/auth');
const skillCache = require('../services/skillCache');

const router = express.Router();

// 获取可用的 skills 列表
router.get('/', authenticate, async (req, res) => {
    try {
        const skillsDir = path.join(__dirname, '../../.claude');
        const skills = [];

        if (fs.existsSync(skillsDir)) {
            const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });

            for (const dir of dirs) {
                if (dir.isDirectory()) {
                    const skillPath = path.join(skillsDir, dir.name, 'SKILL.md');
                    if (fs.existsSync(skillPath)) {
                        const content = fs.readFileSync(skillPath, 'utf-8');

                        // 解析 YAML front matter
                        const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                        let name = dir.name;
                        let description = '';

                        if (frontMatterMatch) {
                            const frontMatter = frontMatterMatch[1];
                            const nameMatch = frontMatter.match(/name:\s*(.+)/);
                            const descMatch = frontMatter.match(/description:\s*(.+)/);

                            if (nameMatch) name = nameMatch[1].trim();
                            if (descMatch) description = descMatch[1].trim();
                        }

                        skills.push({
                            id: dir.name,
                            name,
                            description
                        });
                    }
                }
            }
        }

        res.json(skills);
    } catch (error) {
        console.error('获取 skills 列表失败:', error);
        res.status(500).json({ error: '获取 skills 列表失败' });
    }
});

// 获取缓存状态
router.get('/cache/status', authenticate, async (req, res) => {
    try {
        const status = skillCache.getStatus();
        res.json(status);
    } catch (error) {
        console.error('获取缓存状态失败:', error);
        res.status(500).json({ error: '获取缓存状态失败' });
    }
});

// 清除指定 skill 的缓存
router.delete('/cache/:skillId', authenticate, async (req, res) => {
    const { skillId } = req.params;
    skillCache.clear(skillId);
    res.json({ success: true, message: `已清除 ${skillId} 的缓存` });
});

// 辅助函数：计算下次抓取时间
function getNextFetchTime() {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(1, 0, 0);
    if (now.getMinutes() >= 1) {
        next.setHours(next.getHours() + 1);
    }
    return next.toLocaleString('zh-CN');
}

// 读取趋势缓存（纯读取，不触发执行）
router.get('/:skillId/cached', authenticate, async (req, res) => {
    const { skillId } = req.params;

    // 只支持趋势类 skill
    const trendSkills = ['x-trends', 'tophub-trends'];
    if (!trendSkills.includes(skillId)) {
        return res.status(400).json({ error: '此 skill 不支持缓存读取' });
    }

    // 读取缓存
    const cached = skillCache.get(skillId);

    if (cached) {
        return res.json({
            success: true,
            content: cached.content,
            generatedAt: new Date(cached.generatedAt).toLocaleString('zh-CN'),
            fromCache: true
        });
    }

    // 无缓存时返回空
    return res.json({
        success: false,
        message: '暂无缓存数据，请等待下一次定时抓取',
        nextFetchTime: getNextFetchTime()
    });
});

// 执行指定的 skill
router.post('/:skillId/execute', authenticate, async (req, res) => {
    const { skillId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    // 验证 skill ID
    const allowedSkills = ['x-trends', 'tophub-trends', 'content-writer', 'viral-verification', 'gemini-image-gen', 'prompt-generator'];
    if (!allowedSkills.includes(skillId)) {
        return res.status(400).json({ error: '无效的 skill ID' });
    }

    // 需要用户输入的 skills
    const userInput = req.body?.input;
    if (skillId === 'content-writer' && !userInput) {
        return res.status(400).json({ error: '请提供素材内容' });
    }
    if (skillId === 'viral-verification' && !userInput) {
        return res.status(400).json({ error: '请提供待验证的内容' });
    }
    if (skillId === 'gemini-image-gen' && !userInput) {
        return res.status(400).json({ error: '请提供图片描述' });
    }
    if (skillId === 'prompt-generator' && !userInput) {
        return res.status(400).json({ error: '请提供帖子内容' });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用代理缓冲
    res.flushHeaders(); // 立即发送头部，建立连接

    // 需要用户输入的 skill 不使用缓存（每次输入都不同）
    const inputSkills = ['content-writer', 'viral-verification', 'gemini-image-gen', 'prompt-generator'];
    const useCache = !inputSkills.includes(skillId);

    // 1. 检查缓存（除非强制刷新或不支持缓存）
    if (useCache && !forceRefresh) {
        const cached = skillCache.get(skillId);
        if (cached) {
            res.write(`data: ${JSON.stringify({
                type: 'start',
                message: '从缓存获取结果...',
                fromCache: true
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
                type: 'report',
                content: cached.content,
                fromCache: true,
                generatedAt: new Date(cached.generatedAt).toLocaleString('zh-CN')
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
                type: 'done',
                message: '获取完成（来自缓存）',
                fromCache: true
            })}\n\n`);

            return res.end();
        }
    }

    // 2. 检查是否有其他请求正在执行（仅对支持缓存的 skill）
    if (useCache && skillCache.isLocked(skillId)) {
        res.write(`data: ${JSON.stringify({
            type: 'start',
            message: '其他用户正在生成内容，等待中...',
            waiting: true
        })}\n\n`);

        try {
            // 等待执行完成
            const content = await skillCache.addWaiter(skillId);

            res.write(`data: ${JSON.stringify({
                type: 'report',
                content,
                fromCache: true
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
                type: 'done',
                message: '获取完成（等待其他请求）',
                fromCache: true
            })}\n\n`);

            return res.end();
        } catch (error) {
            res.write(`data: ${JSON.stringify({
                type: 'error',
                message: `等待执行失败: ${error.message}`
            })}\n\n`);
            return res.end();
        }
    }

    // 3. 获取锁并执行（仅对支持缓存的 skill）
    if (useCache && !skillCache.acquireLock(skillId)) {
        // 极端情况：获取锁失败，可能刚好有其他请求抢到了
        res.write(`data: ${JSON.stringify({
            type: 'error',
            message: '获取执行锁失败，请稍后重试'
        })}\n\n`);
        return res.end();
    }

    // 跟踪客户端连接状态
    let clientConnected = true;

    // 安全写入函数，检查连接状态
    const safeWrite = (data) => {
        if (clientConnected && !res.destroyed && !res.writableEnded) {
            try {
                res.write(data);
                return true;
            } catch (e) {
                console.error(`[${skillId}] 写入失败:`, e.message);
                return false;
            }
        }
        return false;
    };

    // 心跳定时器，每 5 秒发送一次保持连接活跃
    const heartbeatInterval = setInterval(() => {
        if (clientConnected) {
            const sent = safeWrite(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
            if (sent) {
                console.log(`[${skillId}] 心跳发送成功`);
            }
        }
    }, 5000);

    // 清理函数
    const cleanup = () => {
        clearInterval(heartbeatInterval);
    };

    // 立即发送连接确认
    safeWrite(`data: ${JSON.stringify({ type: 'connected', message: '连接已建立' })}\n\n`);

    try {
        const skillDir = path.join(__dirname, '../../.claude', skillId);
        // 根据 skill 确定脚本文件名
        let scriptName;
        switch (skillId) {
            case 'x-trends': scriptName = 'x-trends.ts'; break;
            case 'tophub-trends': scriptName = 'tophub.ts'; break;
            case 'content-writer': scriptName = 'content-writer.ts'; break;
            case 'viral-verification': scriptName = 'viral-verification.ts'; break;
            case 'gemini-image-gen': scriptName = 'gemini-image-gen.ts'; break;
            case 'prompt-generator': scriptName = 'prompt-generator.ts'; break;
            default: scriptName = `${skillId}.ts`;
        }
        const scriptPath = path.join(skillDir, scriptName);

        if (!fs.existsSync(scriptPath)) {
            cleanup();
            if (useCache) skillCache.releaseLock(skillId, null, new Error('Skill 脚本不存在'));
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Skill 脚本不存在' })}\n\n`);
            return res.end();
        }

        // 发送开始事件
        console.log(`\n========== [${skillId}] 开始执行 ==========`);
        console.log(`[${skillId}] 脚本路径: ${scriptPath}`);
        console.log(`[${skillId}] 用户输入: ${userInput ? userInput.substring(0, 100) + '...' : '无'}`);

        safeWrite(`data: ${JSON.stringify({
            type: 'start',
            message: `正在执行 ${skillId}...`,
            fromCache: false
        })}\n\n`);

        // 构建命令参数
        const args = ['ts-node', scriptPath];

        // content-writer 和 viral-verification 使用临时文件传递输入（避免 shell 特殊字符问题）
        let inputTmpFile = null;
        if (skillId === 'content-writer' && userInput) {
            inputTmpFile = path.join(__dirname, '../../outputs/content/.input_tmp.txt');
            fs.writeFileSync(inputTmpFile, userInput, 'utf-8');
            args.push(inputTmpFile);
        }
        if (skillId === 'viral-verification' && userInput) {
            inputTmpFile = path.join(__dirname, '../../outputs/viral-verified/.input_tmp.txt');
            // 确保目录存在
            const verifiedDir = path.join(__dirname, '../../outputs/viral-verified');
            if (!fs.existsSync(verifiedDir)) {
                fs.mkdirSync(verifiedDir, { recursive: true });
            }
            fs.writeFileSync(inputTmpFile, userInput, 'utf-8');
            args.push(inputTmpFile);
        }
        if (skillId === 'gemini-image-gen' && userInput) {
            inputTmpFile = path.join(__dirname, '../../outputs/images/.input_tmp.txt');
            // 确保目录存在
            const imagesDir = path.join(__dirname, '../../outputs/images');
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            fs.writeFileSync(inputTmpFile, userInput, 'utf-8');
            args.push(inputTmpFile);
        }
        if (skillId === 'prompt-generator' && userInput) {
            inputTmpFile = path.join(__dirname, '../../outputs/prompts/.input_tmp.txt');
            // 确保目录存在
            const promptsDir = path.join(__dirname, '../../outputs/prompts');
            if (!fs.existsSync(promptsDir)) {
                fs.mkdirSync(promptsDir, { recursive: true });
            }
            fs.writeFileSync(inputTmpFile, userInput, 'utf-8');
            args.push(inputTmpFile);
        }

        // 使用 ts-node 执行脚本
        const child = spawn('npx', args, {
            cwd: path.join(__dirname, '../..'),
            env: { ...process.env },
            shell: true
        });

        let output = '';
        console.log(`[${skillId}] 子进程已启动，等待输出...`);

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log(`[${skillId}] stdout: ${text.trim()}`);
            safeWrite(`data: ${JSON.stringify({ type: 'log', message: text })}\n\n`);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            // 过滤掉 ts-node 的编译信息
            if (!text.includes('Compiling') && !text.includes('Using TypeScript')) {
                console.log(`[${skillId}] stderr: ${text.trim()}`);
            }
            safeWrite(`data: ${JSON.stringify({ type: 'log', message: text })}\n\n`);
        });

        child.on('close', async (code) => {
            cleanup(); // 清理心跳定时器
            console.log(`[${skillId}] 子进程退出，退出码: ${code}`);

            if (code === 0) {
                // 读取生成的报告
                try {
                    // 根据 skill 类型确定输出目录和文件前缀
                    let outputDir, prefix;
                    if (skillId === 'content-writer') {
                        outputDir = path.join(__dirname, '../../outputs/content');
                        prefix = 'content_';
                    } else if (skillId === 'viral-verification') {
                        outputDir = path.join(__dirname, '../../outputs/viral-verified');
                        prefix = 'verified_';
                    } else if (skillId === 'gemini-image-gen') {
                        outputDir = path.join(__dirname, '../../outputs/images');
                        prefix = 'report_';
                    } else if (skillId === 'prompt-generator') {
                        outputDir = path.join(__dirname, '../../outputs/prompts');
                        prefix = 'prompt_';
                    } else {
                        outputDir = path.join(__dirname, '../../outputs/trends');
                        prefix = skillId === 'x-trends' ? 'x_trends_analysis' : 'tophub_analysis';
                    }

                    const files = fs.readdirSync(outputDir)
                        .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
                        .sort()
                        .reverse();

                    console.log(`[${skillId}] 在 ${outputDir} 中查找 ${prefix}*.md 文件`);
                    console.log(`[${skillId}] 找到 ${files.length} 个文件:`, files.slice(0, 3));

                    if (files.length > 0) {
                        const reportPath = path.join(outputDir, files[0]);
                        const latestReport = fs.readFileSync(reportPath, 'utf-8');
                        console.log(`[${skillId}] 读取报告成功，长度: ${latestReport.length} 字符`);

                        // 设置缓存（仅对支持缓存的 skill）
                        if (useCache) {
                            skillCache.set(skillId, latestReport);
                            // 释放锁并通知等待者
                            skillCache.releaseLock(skillId, latestReport);
                        }

                        // 检查客户端是否仍连接
                        if (clientConnected) {
                            safeWrite(`data: ${JSON.stringify({
                                type: 'report',
                                content: latestReport,
                                fromCache: false
                            })}\n\n`);
                        } else {
                            console.log(`[${skillId}] 客户端已断开，报告已保存到文件但未发送`);
                        }
                    } else {
                        console.error(`[${skillId}] 未找到报告文件`);
                        safeWrite(`data: ${JSON.stringify({
                            type: 'error',
                            message: '未找到报告文件，请检查输出目录'
                        })}\n\n`);
                        if (useCache) skillCache.releaseLock(skillId, null, new Error('未找到报告文件'));
                    }
                } catch (readError) {
                    console.error(`[${skillId}] 读取报告失败:`, readError);
                    safeWrite(`data: ${JSON.stringify({
                        type: 'error',
                        message: `读取报告失败: ${readError.message}`
                    })}\n\n`);
                    if (useCache) skillCache.releaseLock(skillId, null, readError);
                }

                safeWrite(`data: ${JSON.stringify({
                    type: 'done',
                    message: '执行完成',
                    fromCache: false
                })}\n\n`);
            } else {
                const error = new Error(`执行失败，退出码: ${code}`);
                if (useCache) skillCache.releaseLock(skillId, null, error);
                safeWrite(`data: ${JSON.stringify({
                    type: 'error',
                    message: error.message
                })}\n\n`);
            }

            // 安全关闭响应
            if (!res.destroyed && !res.writableEnded) {
                res.end();
            }
        });

        child.on('error', (error) => {
            cleanup();
            if (useCache) skillCache.releaseLock(skillId, null, error);
            safeWrite(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
            if (!res.destroyed && !res.writableEnded) {
                res.end();
            }
        });

        // 处理客户端断开连接
        req.on('close', () => {
            clientConnected = false;
            // 注意：不要在这里杀死进程，因为其他用户可能还在等待
            // 只有当没有等待者时才考虑取消
            console.log(`[${skillId}] 客户端断开连接`);
        });

    } catch (error) {
        cleanup();
        console.error('执行 skill 失败:', error);
        if (useCache) skillCache.releaseLock(skillId, null, error);
        safeWrite(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        if (!res.destroyed && !res.writableEnded) {
            res.end();
        }
    }
});

module.exports = router;

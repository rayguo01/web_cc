const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { authMiddleware: authenticate } = require('../middleware/auth');
const tokenUsageDb = require('../services/tokenUsageDb');

const router = express.Router();

// 趋势缓存时间（1小时）
const TRENDS_CACHE_TTL = 60 * 60 * 1000;

// 检查趋势缓存
function checkTrendsCache(source) {
    const trendsDir = path.join(__dirname, '../../outputs/trends');
    if (!fs.existsSync(trendsDir)) return null;

    let prefix;
    if (source === 'x-trends') {
        prefix = 'x_trends_analysis';
    } else if (source === 'tophub-trends') {
        prefix = 'tophub_analysis';
    } else if (source === 'domain-trends') {
        prefix = 'domain_trends_analysis';
    } else {
        return null;
    }

    try {
        const files = fs.readdirSync(trendsDir)
            .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
            .sort()
            .reverse();

        if (files.length === 0) return null;

        const latestFile = files[0];
        const filePath = path.join(trendsDir, latestFile);
        const stats = fs.statSync(filePath);
        const fileAge = Date.now() - stats.mtimeMs;

        // 检查文件是否在 1 小时内
        if (fileAge < TRENDS_CACHE_TTL) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const minutesAgo = Math.floor(fileAge / 60000);
            console.log(`[${source}] 使用缓存文件 ${latestFile}，${minutesAgo} 分钟前生成`);
            return {
                content,
                cachedAt: stats.mtime,
                minutesAgo
            };
        }
    } catch (error) {
        console.error('检查趋势缓存失败:', error);
    }

    return null;
}

// 工作流步骤配置
const WORKFLOW_STEPS = ['trends', 'content', 'optimize', 'image', 'submit'];
const SKIPPABLE_STEPS = ['optimize', 'image'];

// 获取当前进行中的任务
router.get('/current', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM post_tasks
             WHERE user_id = $1 AND status = 'in_progress'
             ORDER BY updated_at DESC LIMIT 1`,
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.json({ hasActiveTask: false, task: null });
        }

        res.json({ hasActiveTask: true, task: result.rows[0] });
    } catch (error) {
        console.error('获取当前任务失败:', error);
        res.status(500).json({ error: '获取当前任务失败' });
    }
});

// 创建新任务
router.post('/', authenticate, async (req, res) => {
    const { source } = req.body;

    if (!source || !['x-trends', 'tophub-trends', 'domain-trends'].includes(source)) {
        return res.status(400).json({ error: '无效的数据源' });
    }

    try {
        // 检查是否有未完成的任务
        const existing = await pool.query(
            `SELECT id FROM post_tasks
             WHERE user_id = $1 AND status = 'in_progress'`,
            [req.user.userId]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({
                error: '已有进行中的任务，请先完成或放弃当前任务',
                taskId: existing.rows[0].id
            });
        }

        // 创建新任务
        const result = await pool.query(
            `INSERT INTO post_tasks (user_id, status, current_step, trends_data)
             VALUES ($1, 'in_progress', 'trends', $2)
             RETURNING *`,
            [req.user.userId, JSON.stringify({ source })]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('创建任务失败:', error);
        res.status(500).json({ error: '创建任务失败' });
    }
});

// 获取历史记录列表
router.get('/history', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, trend_source, trend_topic,
                    LEFT(final_content, 100) as content_preview,
                    final_image_path, viral_score, created_at
             FROM post_history
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [req.user.userId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('获取历史记录失败:', error);
        res.status(500).json({ error: '获取历史记录失败' });
    }
});

// 获取历史详情
router.get('/history/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM post_history WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '记录不存在' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('获取历史详情失败:', error);
        res.status(500).json({ error: '获取历史详情失败' });
    }
});

// 获取任务详情
router.get('/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM post_tasks WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '任务不存在' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('获取任务详情失败:', error);
        res.status(500).json({ error: '获取任务详情失败' });
    }
});

// 更新任务
router.put('/:id', authenticate, async (req, res) => {
    const { action, data, step } = req.body;
    const taskId = req.params.id;

    try {
        // 验证任务归属
        const taskResult = await pool.query(
            `SELECT * FROM post_tasks WHERE id = $1 AND user_id = $2`,
            [taskId, req.user.userId]
        );

        if (taskResult.rows.length === 0) {
            return res.status(404).json({ error: '任务不存在' });
        }

        const task = taskResult.rows[0];

        if (task.status !== 'in_progress') {
            return res.status(400).json({ error: '任务已结束，无法修改' });
        }

        let updateQuery = '';
        let updateParams = [];

        switch (action) {
            case 'selectTopic':
                // 选择话题，更新 trends_data 并进入下一步
                const trendsData = { ...task.trends_data, selectedTopic: data };
                updateQuery = `UPDATE post_tasks SET
                    trends_data = $1,
                    current_step = 'content',
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(trendsData), taskId];
                break;

            case 'saveContent':
                // 保存生成的内容
                updateQuery = `UPDATE post_tasks SET
                    content_data = $1,
                    current_step = 'optimize',
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(data), taskId];
                break;

            case 'updateContentData':
                // 仅更新内容数据，不改变步骤（用于生成后立即保存）
                const currentContentData = task.content_data || {};
                const mergedContentData = { ...currentContentData, ...data };
                updateQuery = `UPDATE post_tasks SET
                    content_data = $1,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(mergedContentData), taskId];
                break;

            case 'saveOptimize':
                // 保存优化的内容，进入 image 步骤
                updateQuery = `UPDATE post_tasks SET
                    optimize_data = $1,
                    current_step = 'image',
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(data), taskId];
                break;

            case 'savePrompt':
                // 保存 Prompt 数据，进入 image 步骤
                updateQuery = `UPDATE post_tasks SET
                    prompt_data = $1,
                    current_step = 'image',
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(data), taskId];
                break;

            case 'saveImage':
                // 保存图片信息
                updateQuery = `UPDATE post_tasks SET
                    image_data = $1,
                    current_step = 'submit',
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(data), taskId];
                break;

            case 'updateOptimizeData':
                // 仅更新优化数据，不改变步骤（用于中间保存）
                const currentOptimizeData = task.optimize_data || {};
                const mergedOptimizeData = { ...currentOptimizeData, ...data };
                updateQuery = `UPDATE post_tasks SET
                    optimize_data = $1,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(mergedOptimizeData), taskId];
                break;

            case 'updatePromptData':
                // 仅更新 Prompt 数据，不改变步骤（用于中间保存）
                const currentPromptData = task.prompt_data || {};
                const mergedPromptData = { ...currentPromptData, ...data };
                updateQuery = `UPDATE post_tasks SET
                    prompt_data = $1,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(mergedPromptData), taskId];
                break;

            case 'updateImageData':
                // 仅更新图片数据，不改变步骤（用于中间保存）
                const currentImageData = task.image_data || {};
                const mergedImageData = { ...currentImageData, ...data };
                updateQuery = `UPDATE post_tasks SET
                    image_data = $1,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [JSON.stringify(mergedImageData), taskId];
                break;

            case 'clearSubsequentData': {
                // 清除指定步骤之后的所有数据（用于重新生成时）
                const fromStep = data.fromStep;
                const stepIdx = WORKFLOW_STEPS.indexOf(fromStep);
                if (stepIdx === -1) {
                    return res.status(400).json({ error: '无效的步骤' });
                }

                // 构建需要清除的字段
                const fieldsToClear = [];
                const stepsToDataMap = {
                    'content': 'content_data',
                    'optimize': 'optimize_data',
                    'prompt': 'prompt_data',
                    'image': 'image_data'
                };

                // 清除 fromStep 之后的所有步骤数据
                for (let i = stepIdx + 1; i < WORKFLOW_STEPS.length; i++) {
                    const sName = WORKFLOW_STEPS[i];
                    if (stepsToDataMap[sName]) {
                        fieldsToClear.push(`${stepsToDataMap[sName]} = NULL`);
                    }
                }

                if (fieldsToClear.length > 0) {
                    updateQuery = `UPDATE post_tasks SET
                        ${fieldsToClear.join(', ')},
                        updated_at = CURRENT_TIMESTAMP
                        WHERE id = $1 RETURNING *`;
                    updateParams = [taskId];
                } else {
                    // 没有需要清除的，直接返回当前任务
                    return res.json(task);
                }
                break;
            }

            case 'skipStep':
                // 跳过步骤
                if (!SKIPPABLE_STEPS.includes(step)) {
                    return res.status(400).json({ error: '该步骤不可跳过' });
                }
                const currentIndex = WORKFLOW_STEPS.indexOf(task.current_step);
                const nextStep = WORKFLOW_STEPS[currentIndex + 1];

                // 根据步骤确定数据字段
                let dataField;
                if (step === 'optimize') {
                    dataField = 'optimize_data';
                } else {
                    // image 步骤跳过时，同时标记 prompt_data 和 image_data
                    dataField = 'image_data';
                }

                updateQuery = `UPDATE post_tasks SET
                    ${dataField} = $1,
                    current_step = $2,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3 RETURNING *`;
                updateParams = [JSON.stringify({ skipped: true }), nextStep, taskId];
                break;

            case 'goBack':
                // 回退到指定步骤
                const targetStep = data?.toStep || step;
                if (!WORKFLOW_STEPS.includes(targetStep)) {
                    return res.status(400).json({ error: '无效的目标步骤' });
                }
                const targetIndex = WORKFLOW_STEPS.indexOf(targetStep);
                const currentIdx = WORKFLOW_STEPS.indexOf(task.current_step);
                if (targetIndex >= currentIdx) {
                    return res.status(400).json({ error: '只能回退到之前的步骤' });
                }

                // 清除目标步骤之后的数据（保留目标步骤本身的数据）
                const clearFields = [];
                for (let i = targetIndex + 1; i < WORKFLOW_STEPS.length - 1; i++) {
                    const stepName = WORKFLOW_STEPS[i];
                    if (stepName !== 'trends') {
                        clearFields.push(`${stepName}_data = NULL`);
                    }
                }

                if (clearFields.length > 0) {
                    updateQuery = `UPDATE post_tasks SET
                        ${clearFields.join(', ')},
                        current_step = $1,
                        updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2 RETURNING *`;
                } else {
                    updateQuery = `UPDATE post_tasks SET
                        current_step = $1,
                        updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2 RETURNING *`;
                }
                updateParams = [targetStep, taskId];
                break;

            case 'navigateTo': {
                // 纯导航，不清除任何数据（用于自由浏览）
                const navTargetStep = data?.toStep;
                if (!WORKFLOW_STEPS.includes(navTargetStep)) {
                    return res.status(400).json({ error: '无效的目标步骤' });
                }

                updateQuery = `UPDATE post_tasks SET
                    current_step = $1,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2 RETURNING *`;
                updateParams = [navTargetStep, taskId];
                break;
            }

            case 'complete':
                // 完成任务
                // 获取最终内容
                const finalContent = task.optimize_data?.optimizedVersion
                    || task.content_data?.versionC
                    || '';
                const finalImagePath = task.image_data?.imagePath || null;

                // 更新任务状态
                updateQuery = `UPDATE post_tasks SET
                    status = 'completed',
                    final_content = $1,
                    final_image_path = $2,
                    completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3 RETURNING *`;
                updateParams = [finalContent, finalImagePath, taskId];

                // 保存到历史记录
                await pool.query(
                    `INSERT INTO post_history
                     (user_id, task_id, trend_source, trend_topic, final_content, final_image_path, viral_score)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        req.user.userId,
                        taskId,
                        task.trends_data?.source,
                        task.trends_data?.selectedTopic?.topic || task.trends_data?.selectedTopic?.name,
                        finalContent,
                        finalImagePath,
                        task.optimize_data?.viralScore || null
                    ]
                );
                break;

            default:
                return res.status(400).json({ error: '无效的操作' });
        }

        const result = await pool.query(updateQuery, updateParams);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('更新任务失败:', error);
        res.status(500).json({ error: '更新任务失败' });
    }
});

// 放弃任务
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE post_tasks SET
             status = 'abandoned',
             updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
             RETURNING *`,
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '任务不存在或已结束' });
        }

        res.json({ success: true, message: '任务已放弃' });
    } catch (error) {
        console.error('放弃任务失败:', error);
        res.status(500).json({ error: '放弃任务失败' });
    }
});

// 执行步骤（SSE 流式返回）
router.post('/:id/execute-step', authenticate, async (req, res) => {
    const { step, input } = req.body;
    const taskId = req.params.id;

    // 验证步骤
    if (!['trends', 'content', 'optimize', 'image', 'prompt'].includes(step)) {
        return res.status(400).json({ error: '无效的步骤' });
    }

    try {
        // 验证任务归属
        const taskResult = await pool.query(
            `SELECT * FROM post_tasks WHERE id = $1 AND user_id = $2`,
            [taskId, req.user.userId]
        );

        if (taskResult.rows.length === 0) {
            return res.status(404).json({ error: '任务不存在' });
        }

        const task = taskResult.rows[0];

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // 跟踪客户端连接状态
        let clientConnected = true;
        req.on('close', () => { clientConnected = false; });

        const safeWrite = (data) => {
            if (clientConnected && !res.destroyed && !res.writableEnded) {
                try {
                    res.write(data);
                    return true;
                } catch (e) {
                    return false;
                }
            }
            return false;
        };

        // 心跳
        const heartbeatInterval = setInterval(() => {
            if (clientConnected) {
                safeWrite(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
            }
        }, 5000);

        const cleanup = () => {
            clearInterval(heartbeatInterval);
        };

        safeWrite(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

        // 根据步骤类型执行不同的 skill
        let skillId, userInput, outputDir, prefix;

        switch (step) {
            case 'trends':
                skillId = input?.source || task.trends_data?.source || 'x-trends';
                outputDir = path.join(__dirname, '../../outputs/trends');
                if (skillId === 'x-trends') {
                    prefix = 'x_trends_analysis';
                } else if (skillId === 'tophub-trends') {
                    prefix = 'tophub_analysis';
                } else if (skillId === 'domain-trends') {
                    prefix = 'domain_trends_analysis';
                } else {
                    prefix = 'trends_analysis';
                }

                // 检查趋势缓存（1小时内的文件直接使用）
                const cachedTrends = checkTrendsCache(skillId);
                if (cachedTrends) {
                    safeWrite(`data: ${JSON.stringify({
                        type: 'start',
                        message: `使用缓存数据（${cachedTrends.minutesAgo} 分钟前生成）...`,
                        fromCache: true
                    })}\n\n`);

                    safeWrite(`data: ${JSON.stringify({
                        type: 'report',
                        content: cachedTrends.content,
                        fromCache: true,
                        cachedAt: cachedTrends.cachedAt
                    })}\n\n`);

                    safeWrite(`data: ${JSON.stringify({
                        type: 'done',
                        message: '获取完成（来自缓存）',
                        fromCache: true
                    })}\n\n`);

                    cleanup();
                    return res.end();
                }
                break;

            case 'content':
                skillId = 'content-writer';
                // 如果有 rawInput，直接使用用户编辑的输入文本
                if (input?.rawInput) {
                    userInput = input.rawInput;
                } else {
                    // 否则从话题信息组装输入
                    const topic = input?.topic || task.trends_data?.selectedTopic;
                    userInput = `话题: ${topic?.topic || topic?.name || '未知话题'}
背景: ${topic?.context || topic?.description || ''}
选题角度: ${topic?.angle || topic?.选题角度 || ''}
创作方向: ${topic?.direction || topic?.创作方向 || ''}`;
                }

                // 处理语气风格选择
                if (input?.voiceStyleId) {
                    try {
                        const voicePromptDb = require('../services/voicePromptDb');
                        // 使用 getForGeneration 获取完整 prompt（包括公共的）
                        const voicePrompt = await voicePromptDb.getForGeneration(input.voiceStyleId, req.user.userId);
                        if (voicePrompt && voicePrompt.prompt_content) {
                            // 将语气 prompt 附加到用户输入
                            userInput = `${userInput}\n\n===写作风格指南===\n请严格按照以下语气风格进行创作：\n\n${voicePrompt.prompt_content}`;
                            console.log(`[content] 使用语气风格: @${voicePrompt.username}${voicePrompt.is_public ? ' (公共)' : ''}`);
                        }
                    } catch (e) {
                        console.warn('[content] 获取语气风格失败:', e.message);
                    }
                }

                outputDir = path.join(__dirname, '../../outputs/content');
                prefix = 'content_';
                break;

            case 'optimize':
                // 根据 optimizeMode 选择不同的 skill
                const optimizeMode = input?.optimizeMode || 'viral';
                skillId = optimizeMode === 'humanizer' ? 'humanizer' : 'viral-verification';
                // 组合内容和用户优化意见
                const contentToOptimize = input?.content || task.content_data?.versionC;
                const userSuggestion = input?.userSuggestion || '';
                if (userSuggestion) {
                    userInput = `${contentToOptimize}\n\n===用户优化意见===\n${userSuggestion}`;
                } else {
                    userInput = contentToOptimize;
                }
                outputDir = optimizeMode === 'humanizer'
                    ? path.join(__dirname, '../../outputs/humanized')
                    : path.join(__dirname, '../../outputs/viral-verified');
                prefix = optimizeMode === 'humanizer' ? 'humanized_' : 'verified_';
                break;

            case 'prompt':
                skillId = 'prompt-generator';
                userInput = input?.content || task.optimize_data?.optimizedVersion || task.content_data?.versionC;
                outputDir = path.join(__dirname, '../../outputs/prompts');
                prefix = 'prompt_';
                break;

            case 'image':
                skillId = 'gemini-image-gen';
                userInput = `${input?.prompt || ''} [ratio:${input?.ratio || '16:9'}]`;
                outputDir = path.join(__dirname, '../../outputs/images');
                prefix = 'report_';
                break;

            case 'image-search':
                skillId = 'image-search';
                userInput = input?.query || '';
                outputDir = path.join(__dirname, '../../outputs/image-search');
                prefix = 'search_';
                break;
        }

        safeWrite(`data: ${JSON.stringify({
            type: 'start',
            message: `正在执行 ${skillId}...`
        })}\n\n`);

        // 确定脚本路径
        const skillDir = path.join(__dirname, '../../.claude', skillId);
        let scriptName;
        switch (skillId) {
            case 'x-trends': scriptName = 'x-trends.ts'; break;
            case 'tophub-trends': scriptName = 'tophub.ts'; break;
            case 'domain-trends': scriptName = 'domain-trends.ts'; break;
            case 'content-writer': scriptName = 'content-writer.ts'; break;
            case 'viral-verification': scriptName = 'viral-verification.ts'; break;
            case 'humanizer': scriptName = 'humanizer.ts'; break;
            case 'gemini-image-gen': scriptName = 'gemini-image-gen.ts'; break;
            case 'prompt-generator': scriptName = 'prompt-generator.ts'; break;
            default: scriptName = `${skillId}.ts`;
        }
        const scriptPath = path.join(skillDir, scriptName);

        if (!fs.existsSync(scriptPath)) {
            cleanup();
            safeWrite(`data: ${JSON.stringify({ type: 'error', message: 'Skill 脚本不存在' })}\n\n`);
            return res.end();
        }

        // 构建命令参数
        const args = ['ts-node', scriptPath];

        // 需要输入的 skill 使用临时文件传递
        if (userInput) {
            // 确保输出目录存在
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const inputTmpFile = path.join(outputDir, '.input_tmp.txt');
            fs.writeFileSync(inputTmpFile, userInput, 'utf-8');
            args.push(inputTmpFile);
        }

        // 执行脚本 - Windows 兼容
        // 将命令和参数合并为字符串，避免 DEP0190 警告
        const fullCommand = ['npx', ...args].join(' ');

        // 获取用户的 Premium 状态并传递给子进程
        const isPremium = req.user?.isPremium || false;
        console.log(`[Skill ${skillId}] 用户 Premium 状态: ${isPremium}`);

        const child = spawn(fullCommand, [], {
            cwd: path.join(__dirname, '../..'),
            env: {
                ...process.env,
                IS_PREMIUM: isPremium ? 'true' : 'false'
            },
            shell: true
        });

        // 设置超时（5分钟）
        const SKILL_TIMEOUT = 5 * 60 * 1000;
        let killed = false;
        const timeout = setTimeout(() => {
            killed = true;
            console.error(`[Skill ${skillId}] 执行超时（${SKILL_TIMEOUT / 1000}秒），强制终止`);
            child.kill('SIGTERM');
        }, SKILL_TIMEOUT);

        // 收集错误输出
        let stderrBuffer = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            console.log(`[Skill ${skillId}] stdout:`, text.trim());
            safeWrite(`data: ${JSON.stringify({ type: 'log', message: text })}\n\n`);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            stderrBuffer += text;
            // 过滤掉 ts-node 编译信息
            if (!text.includes('Compiling') && !text.includes('Using TypeScript')) {
                console.error(`[Skill ${skillId}] stderr:`, text.trim());
            }
            safeWrite(`data: ${JSON.stringify({ type: 'log', message: text })}\n\n`);
        });

        child.on('close', async (code) => {
            clearTimeout(timeout);
            cleanup();

            console.log(`[Skill ${skillId}] 进程结束，退出码: ${code}${killed ? ' (超时终止)' : ''}`);

            if (code === 0) {
                try {
                    // 读取生成的报告
                    if (!fs.existsSync(outputDir)) {
                        throw new Error('输出目录不存在');
                    }

                    // 优先查找 JSON 文件，然后是 MD 文件
                    let files = fs.readdirSync(outputDir)
                        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
                        .sort()
                        .reverse();

                    // 如果没有 JSON 文件，回退到 MD 文件
                    if (files.length === 0) {
                        files = fs.readdirSync(outputDir)
                            .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
                            .sort()
                            .reverse();
                    }

                    if (files.length > 0) {
                        const reportPath = path.join(outputDir, files[0]);
                        const reportRaw = fs.readFileSync(reportPath, 'utf-8');

                        // 尝试解析为 JSON，提取 token 使用信息和显示内容
                        let displayContent = reportRaw;
                        try {
                            const reportData = JSON.parse(reportRaw);

                            // 如果 JSON 中有 content 字段，用于前端显示
                            if (reportData.content) {
                                displayContent = reportData.content;
                            }

                            // 记录 Token 使用信息
                            if (reportData._usage) {
                                await tokenUsageDb.recordUsage({
                                    userId: req.user.userId,
                                    taskId: parseInt(taskId),
                                    workflowStep: step,
                                    skillId: skillId,
                                    model: reportData._usage.model || 'unknown',
                                    inputTokens: reportData._usage.inputTokens || 0,
                                    outputTokens: reportData._usage.outputTokens || 0,
                                    cacheCreationTokens: reportData._usage.cacheCreationTokens || 0,
                                    cacheReadTokens: reportData._usage.cacheReadTokens || 0,
                                    costUsd: reportData._usage.costUsd || 0,
                                    durationMs: reportData._usage.durationMs || 0
                                });
                                console.log(`[Token Usage] 已记录: ${skillId}, 费用: $${reportData._usage.costUsd?.toFixed(6) || 0}`);
                            } else if (reportData._usage === null) {
                                // 明确设置为 null 表示该 skill 不支持 token 使用记录
                                console.log(`[Token Usage] ${skillId} 不提供 token 使用信息`);
                            }
                        } catch (usageError) {
                            // 非 JSON 格式，保持原始内容用于显示
                            console.warn('[Token Usage] 记录失败:', usageError.message);
                        }

                        // 对于图片步骤，还需要找到生成的图片
                        let imagePath = null;
                        if (step === 'image') {
                            const imageFiles = fs.readdirSync(outputDir)
                                .filter(f => f.startsWith('gemini_') && f.endsWith('.png'))
                                .sort()
                                .reverse();
                            if (imageFiles.length > 0) {
                                imagePath = `/outputs/images/${imageFiles[0]}`;
                            }
                        }

                        safeWrite(`data: ${JSON.stringify({
                            type: 'report',
                            content: displayContent,
                            imagePath
                        })}\n\n`);
                    } else {
                        throw new Error('未找到报告文件');
                    }

                    safeWrite(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                } catch (readError) {
                    safeWrite(`data: ${JSON.stringify({
                        type: 'error',
                        message: readError.message
                    })}\n\n`);
                }
            } else {
                // 提取最后几行错误信息
                const errorLines = stderrBuffer.trim().split('\n').slice(-10).join('\n');
                const errorMessage = killed
                    ? `执行超时（超过 ${SKILL_TIMEOUT / 1000} 秒）`
                    : `执行失败，退出码: ${code}${errorLines ? '\n' + errorLines : ''}`;

                console.error(`[Skill ${skillId}] 错误详情:`, errorLines || '无');

                safeWrite(`data: ${JSON.stringify({
                    type: 'error',
                    message: errorMessage
                })}\n\n`);
            }

            if (!res.destroyed && !res.writableEnded) {
                res.end();
            }
        });

        child.on('error', (error) => {
            cleanup();
            safeWrite(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
            if (!res.destroyed && !res.writableEnded) {
                res.end();
            }
        });

    } catch (error) {
        console.error('执行步骤失败:', error);
        res.status(500).json({ error: '执行步骤失败' });
    }
});

module.exports = router;

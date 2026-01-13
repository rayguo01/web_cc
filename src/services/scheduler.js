/**
 * 定时任务调度服务
 *
 * 功能：
 * 1. 每小时1分钟自动抓取 x-trends、tophub-trends
 * 2. domain-trends 支持两种模式：
 *    - 传统模式：每8小时抓取全部 KOL
 *    - 轮换模式：每2小时抓取一组 KOL（100个KOL分10组，20小时覆盖全部）
 * 3. 抓取结果保存到 skillCache
 * 4. 服务启动时检查并执行必要的抓取
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const skillCache = require('./skillCache');
const trendsDb = require('./trendsDb');

class Scheduler {
    constructor() {
        this.jobs = new Map();
        this.isRunning = false;
        this.maxRetries = 3;        // 最大重试次数
        this.retryDelay = 5000;     // 重试间隔（毫秒）
    }

    /**
     * 延迟函数
     * @param {number} ms - 毫秒
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 带重试的执行单个 skill 抓取
     * @param {string} skillId - x-trends 或 tophub-trends
     * @param {number} attempt - 当前尝试次数
     * @returns {Promise<string>} 抓取结果
     */
    async executeSkillWithRetry(skillId, attempt = 1) {
        try {
            return await this.executeSkill(skillId);
        } catch (err) {
            const isRetryable = err.message.includes('JSON 解析失败') ||
                               err.message.includes('执行失败') ||
                               err.message.includes('未找到报告文件');

            if (isRetryable && attempt < this.maxRetries) {
                console.log(`[调度器] ${skillId} 第 ${attempt} 次失败，${this.retryDelay / 1000}秒后重试...`);
                console.log(`[调度器] 失败原因: ${err.message.substring(0, 100)}...`);
                await this.sleep(this.retryDelay);
                return this.executeSkillWithRetry(skillId, attempt + 1);
            }
            throw err;
        }
    }

    /**
     * 获取 domain-trends 的所有预设（排除分组配置文件）
     * @returns {Array<{id: string, name: string, hasRotation: boolean}>}
     */
    getDomainPresets() {
        const presetsDir = path.join(__dirname, '../../.claude/domain-trends/presets');
        if (!fs.existsSync(presetsDir)) {
            return [];
        }

        try {
            // 排除 -kol-groups.json 文件
            const files = fs.readdirSync(presetsDir)
                .filter(f => f.endsWith('.json') && !f.includes('-kol-groups'));

            return files.map(file => {
                const content = fs.readFileSync(path.join(presetsDir, file), 'utf-8');
                const config = JSON.parse(content);
                // 检查是否有对应的分组轮换配置
                const rotationConfigPath = path.join(presetsDir, `${config.id}-kol-groups.json`);
                const hasRotation = fs.existsSync(rotationConfigPath);
                return { id: config.id, name: config.name, hasRotation };
            });
        } catch (err) {
            console.error('[调度器] 读取 domain-trends 预设失败:', err.message);
            return [];
        }
    }

    /**
     * 获取分组轮换配置
     * @param {string} presetId
     * @returns {Object|null}
     */
    getRotationConfig(presetId) {
        const configPath = path.join(__dirname, '../../.claude/domain-trends/presets', `${presetId}-kol-groups.json`);
        if (!fs.existsSync(configPath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(content);
        } catch (err) {
            console.error(`[调度器] 读取分组配置 ${presetId} 失败:`, err.message);
            return null;
        }
    }

    /**
     * 检查当前小时是否是轮换抓取时间（每偶数小时）
     * @returns {boolean}
     */
    isRotationFetchHour() {
        const hour = new Date().getHours();
        return hour % 2 === 0;  // 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22
    }

    /**
     * 获取当前应该抓取的分组ID
     * @param {Object} rotationConfig
     * @returns {number}
     */
    getCurrentGroupId(rotationConfig) {
        const hour = new Date().getHours();
        const interval = rotationConfig.rotationIntervalHours || 2;
        return Math.floor(hour / interval) % rotationConfig.totalGroups;
    }

    /**
     * 仅抓取数据（不分析）
     * @param {string} skillId - x-trends 或 tophub-trends
     * @returns {Promise<Array>} 原始数据数组
     */
    async fetchSkillData(skillId) {
        console.log(`[调度器] 开始抓取数据 ${skillId}...`);

        const scriptMap = {
            'x-trends': 'x-trends.ts',
            'tophub-trends': 'tophub.ts'
        };

        const scriptName = scriptMap[skillId];
        if (!scriptName) {
            throw new Error(`未知的 skill: ${skillId}`);
        }

        const skillDir = path.join(__dirname, '../../.claude', skillId);
        const scriptPath = path.join(skillDir, scriptName);

        return new Promise((resolve, reject) => {
            const args = ['ts-node', scriptPath, 'fetch'];

            const child = spawn('npx', args, {
                cwd: path.join(__dirname, '../..'),
                env: { ...process.env },
                shell: true
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                output += data.toString();
                const lines = data.toString().trim().split('\n');
                for (const line of lines) {
                    if (!line.startsWith('__FETCH_RESULT__') && !line.startsWith('[')) {
                        console.log(`[调度器][${skillId}] ${line}`);
                    }
                }
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                if (!text.includes('Compiling') && !text.includes('Using TypeScript')) {
                    errorOutput += text;
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        // 解析 __FETCH_RESULT__ 后面的 JSON
                        const marker = '__FETCH_RESULT__';
                        const markerIndex = output.indexOf(marker);
                        if (markerIndex !== -1) {
                            const jsonStr = output.substring(markerIndex + marker.length).trim();
                            const data = JSON.parse(jsonStr);
                            resolve(data);
                        } else {
                            reject(new Error('未找到抓取结果标记'));
                        }
                    } catch (err) {
                        reject(new Error(`解析抓取结果失败: ${err.message}`));
                    }
                } else {
                    reject(new Error(`执行失败，退出码: ${code}, 错误: ${errorOutput}`));
                }
            });

            child.on('error', reject);
        });
    }

    /**
     * 仅分析数据（使用已有数据）
     * @param {string} skillId - x-trends 或 tophub-trends
     * @param {Array} rawData - 原始数据数组
     * @returns {Promise<string>} 分析报告
     */
    async analyzeSkillData(skillId, rawData) {
        console.log(`[调度器] 开始分析数据 ${skillId}...`);

        const scriptMap = {
            'x-trends': 'x-trends.ts',
            'tophub-trends': 'tophub.ts'
        };

        const scriptName = scriptMap[skillId];
        if (!scriptName) {
            throw new Error(`未知的 skill: ${skillId}`);
        }

        const skillDir = path.join(__dirname, '../../.claude', skillId);
        const scriptPath = path.join(skillDir, scriptName);

        // 将数据写入临时文件（避免命令行参数过长）
        const tempFile = path.join(__dirname, '../../outputs/.temp_analyze_data.json');
        fs.writeFileSync(tempFile, JSON.stringify(rawData));

        return new Promise((resolve, reject) => {
            // 读取临时文件并传递给脚本
            const jsonData = JSON.stringify(rawData);
            const args = ['ts-node', scriptPath, 'analyze', jsonData];

            const child = spawn('npx', args, {
                cwd: path.join(__dirname, '../..'),
                env: { ...process.env },
                shell: true
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                output += data.toString();
                console.log(`[调度器][${skillId}] ${data.toString().trim()}`);
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                if (!text.includes('Compiling') && !text.includes('Using TypeScript')) {
                    errorOutput += text;
                }
            });

            child.on('close', (code) => {
                // 清理临时文件
                try { fs.unlinkSync(tempFile); } catch (e) {}

                if (code === 0) {
                    // 读取生成的报告
                    try {
                        const outputDir = path.join(__dirname, '../../outputs/trends');
                        const prefix = skillId === 'x-trends' ? 'x_trends_analysis' : 'tophub_analysis';

                        let files = fs.readdirSync(outputDir)
                            .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
                            .sort()
                            .reverse();

                        if (files.length === 0) {
                            files = fs.readdirSync(outputDir)
                                .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
                                .sort()
                                .reverse();
                        }

                        if (files.length > 0) {
                            const reportPath = path.join(outputDir, files[0]);
                            const report = fs.readFileSync(reportPath, 'utf-8');
                            console.log(`[调度器][${skillId}] 分析成功，报告长度: ${report.length}`);
                            resolve(report);
                        } else {
                            reject(new Error('未找到报告文件'));
                        }
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(new Error(`分析失败，退出码: ${code}, 错误: ${errorOutput}`));
                }
            });

            child.on('error', reject);
        });
    }

    /**
     * 执行两阶段趋势抓取（检查数据库，避免重复抓取和分析）
     * @param {string} skillId - x-trends 或 tophub-trends
     * @returns {Promise<string>} 分析报告
     */
    async executeTwoPhaseSkill(skillId) {
        const hourKey = trendsDb.getCurrentHourKey();

        // 1. 检查数据库是否已有完成的分析
        const existing = await trendsDb.getByHourKey(skillId, hourKey);

        if (existing && existing.analysis_status === 'completed' && existing.analysis_result) {
            console.log(`[调度器][${skillId}] 当前小时已有分析结果，跳过抓取和分析`);
            return typeof existing.analysis_result === 'string'
                ? existing.analysis_result
                : JSON.stringify(existing.analysis_result);
        }

        // 2. 检查是否已有原始数据（避免重复抓取）
        let rawData;
        if (existing && existing.raw_data) {
            console.log(`[调度器][${skillId}] 使用数据库中的原始数据，跳过抓取`);
            rawData = typeof existing.raw_data === 'string'
                ? JSON.parse(existing.raw_data)
                : existing.raw_data;
        } else {
            // 抓取原始数据
            rawData = await this.fetchSkillData(skillId);
            console.log(`[调度器][${skillId}] 抓取到 ${rawData.length} 条数据`);

            // 保存原始数据到数据库
            await trendsDb.saveRawData(skillId, hourKey, rawData);
        }

        // 3. 再次检查分析状态（防止并发时重复分析）
        const checkAgain = await trendsDb.getByHourKey(skillId, hourKey);
        if (checkAgain && checkAgain.analysis_status === 'completed' && checkAgain.analysis_result) {
            console.log(`[调度器][${skillId}] 分析已由其他进程完成，跳过`);
            return typeof checkAgain.analysis_result === 'string'
                ? checkAgain.analysis_result
                : JSON.stringify(checkAgain.analysis_result);
        }

        // 4. 如果正在分析中，等待一段时间后再检查
        if (checkAgain && checkAgain.analysis_status === 'analyzing') {
            console.log(`[调度器][${skillId}] 其他进程正在分析，等待...`);
            await this.sleep(10000); // 等待10秒
            const afterWait = await trendsDb.getByHourKey(skillId, hourKey);
            if (afterWait && afterWait.analysis_status === 'completed' && afterWait.analysis_result) {
                return typeof afterWait.analysis_result === 'string'
                    ? afterWait.analysis_result
                    : JSON.stringify(afterWait.analysis_result);
            }
        }

        // 5. 标记为分析中
        await trendsDb.setAnalyzing(skillId, hourKey);

        // 6. 执行分析
        try {
            const report = await this.analyzeSkillData(skillId, rawData);

            // 7. 保存分析结果到数据库
            let analysisResult;
            try {
                analysisResult = JSON.parse(report);
            } catch (e) {
                analysisResult = { rawReport: report };
            }
            await trendsDb.saveAnalysisResult(skillId, hourKey, analysisResult);

            return report;
        } catch (err) {
            // 保存错误状态
            await trendsDb.saveAnalysisError(skillId, hourKey, err.message);
            throw err;
        }
    }

    /**
     * 执行单个 skill 抓取
     * @param {string} skillId - x-trends、tophub-trends 或 domain-trends:preset 或 domain-trends-rotation:preset
     * @returns {Promise<string>} 抓取结果
     */
    async executeSkill(skillId) {
        console.log(`[调度器] 开始抓取 ${skillId}...`);

        // 解析 skillId，支持多种格式
        let baseSkillId = skillId;
        let preset = null;
        let isRotationMode = false;

        if (skillId.startsWith('domain-trends-rotation:')) {
            baseSkillId = 'domain-trends';
            preset = skillId.split(':')[1];
            isRotationMode = true;
        } else if (skillId.startsWith('domain-trends:')) {
            baseSkillId = 'domain-trends';
            preset = skillId.split(':')[1];
        }

        const scriptMap = {
            'x-trends': 'x-trends.ts',
            'tophub-trends': 'tophub.ts',
            'domain-trends': 'domain-trends.ts'
        };

        const scriptName = scriptMap[baseSkillId];
        if (!scriptName) {
            throw new Error(`未知的 skill: ${skillId}`);
        }

        const skillDir = path.join(__dirname, '../../.claude', baseSkillId);
        const scriptPath = path.join(skillDir, scriptName);

        if (!fs.existsSync(scriptPath)) {
            throw new Error(`脚本不存在: ${scriptPath}`);
        }

        return new Promise((resolve, reject) => {
            // 构建命令参数
            const args = ['ts-node', scriptPath];

            if (isRotationMode) {
                // 轮换模式：npx ts-node script.ts rotation preset
                args.push('rotation');
                args.push(preset);
            } else if (preset) {
                // 传统模式：npx ts-node script.ts standard preset
                args.push('standard');
                args.push(preset);
            }

            const child = spawn('npx', args, {
                cwd: path.join(__dirname, '../..'),
                env: { ...process.env },
                shell: true
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                output += data.toString();
                console.log(`[调度器][${skillId}] ${data.toString().trim()}`);
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                if (!text.includes('Compiling') && !text.includes('Using TypeScript')) {
                    errorOutput += text;
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    // 读取生成的报告
                    try {
                        let outputDir, prefix;

                        if (baseSkillId === 'domain-trends') {
                            outputDir = path.join(__dirname, '../../outputs/trends/domain');
                            // 轮换模式的文件名包含 group
                            if (isRotationMode) {
                                const groupId = this.getCurrentGroupId(this.getRotationConfig(preset));
                                prefix = `${preset}_group${groupId}_analysis`;
                            } else {
                                prefix = `${preset}_analysis`;
                            }
                        } else {
                            outputDir = path.join(__dirname, '../../outputs/trends');
                            prefix = skillId === 'x-trends' ? 'x_trends_analysis' : 'tophub_analysis';
                        }

                        // 优先查找 JSON 文件
                        let files = fs.readdirSync(outputDir)
                            .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
                            .sort()
                            .reverse();

                        // 如果没有 JSON，查找 MD 文件
                        if (files.length === 0) {
                            files = fs.readdirSync(outputDir)
                                .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
                                .sort()
                                .reverse();
                        }

                        if (files.length > 0) {
                            const reportPath = path.join(outputDir, files[0]);
                            const report = fs.readFileSync(reportPath, 'utf-8');
                            console.log(`[调度器][${skillId}] 抓取成功，报告长度: ${report.length}`);
                            resolve(report);
                        } else {
                            reject(new Error('未找到报告文件'));
                        }
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(new Error(`执行失败，退出码: ${code}, 错误: ${errorOutput}`));
                }
            });

            child.on('error', reject);
        });
    }

    /**
     * 执行所有趋势抓取任务
     * @param {boolean} forceDomainTrends - 强制抓取 domain-trends（用于启动时）
     */
    async fetchAllTrends(forceDomainTrends = false) {
        if (this.isRunning) {
            console.log('[调度器] 上一次抓取仍在进行中，跳过本次');
            return;
        }

        this.isRunning = true;
        console.log(`[调度器] ========== 开始定时抓取 ${new Date().toLocaleString('zh-CN')} ==========`);

        // 基础趋势 skills（每小时抓取）
        const skills = ['x-trends', 'tophub-trends'];

        // domain-trends 处理
        const domainPresets = this.getDomainPresets();
        const currentHour = new Date().getHours();

        for (const preset of domainPresets) {
            if (preset.hasRotation) {
                // 轮换模式：每2小时（偶数小时）抓取
                const shouldFetch = forceDomainTrends || this.isRotationFetchHour();
                if (shouldFetch) {
                    const rotationConfig = this.getRotationConfig(preset.id);
                    const groupId = this.getCurrentGroupId(rotationConfig);
                    skills.push(`domain-trends-rotation:${preset.id}`);
                    console.log(`[调度器] ${preset.id} 轮换模式: 当前组 ${groupId}（每2小时）`);
                }
            } else {
                // 传统模式：每8小时抓取
                const shouldFetch = forceDomainTrends || this.isDomainTrendsFetchHour();
                if (shouldFetch) {
                    skills.push(`domain-trends:${preset.id}`);
                    console.log(`[调度器] ${preset.id} 传统模式（每8小时）`);
                }
            }
        }

        console.log(`[调度器] 待抓取: ${skills.join(', ')}`);

        // 清理过期数据库记录
        try {
            await trendsDb.cleanupOldData();
        } catch (err) {
            console.error('[调度器] 清理过期数据失败:', err.message);
        }

        for (const skillId of skills) {
            try {
                let report;

                // x-trends 和 tophub-trends 使用两阶段执行（检查数据库避免重复分析）
                if (skillId === 'x-trends' || skillId === 'tophub-trends') {
                    report = await this.executeTwoPhaseSkillWithRetry(skillId);
                } else {
                    // domain-trends 仍使用原有流程
                    report = await this.executeSkillWithRetry(skillId);
                }

                // 确定缓存 key
                let cacheKey = skillId;
                if (skillId.startsWith('domain-trends-rotation:')) {
                    // 轮换模式的缓存 key 包含组ID
                    const presetId = skillId.split(':')[1];
                    const rotationConfig = this.getRotationConfig(presetId);
                    const groupId = this.getCurrentGroupId(rotationConfig);
                    cacheKey = `domain-trends:${presetId}:group${groupId}`;
                }

                skillCache.set(cacheKey, report);
                console.log(`[调度器] ${cacheKey} 缓存已更新`);
            } catch (err) {
                console.error(`[调度器] ${skillId} 抓取失败（已重试 ${this.maxRetries} 次）:`, err.message);
                // 抓取失败不影响其他 skill
            }
        }

        this.isRunning = false;
        console.log(`[调度器] ========== 定时抓取完成 ==========\n`);
    }

    /**
     * 带重试的两阶段执行
     * @param {string} skillId - x-trends 或 tophub-trends
     * @param {number} attempt - 当前尝试次数
     * @returns {Promise<string>} 分析报告
     */
    async executeTwoPhaseSkillWithRetry(skillId, attempt = 1) {
        try {
            return await this.executeTwoPhaseSkill(skillId);
        } catch (err) {
            const isRetryable = err.message.includes('JSON 解析失败') ||
                               err.message.includes('执行失败') ||
                               err.message.includes('分析失败') ||
                               err.message.includes('未找到报告文件');

            if (isRetryable && attempt < this.maxRetries) {
                console.log(`[调度器] ${skillId} 第 ${attempt} 次失败，${this.retryDelay / 1000}秒后重试...`);
                console.log(`[调度器] 失败原因: ${err.message.substring(0, 100)}...`);
                await this.sleep(this.retryDelay);
                return this.executeTwoPhaseSkillWithRetry(skillId, attempt + 1);
            }
            throw err;
        }
    }

    /**
     * 检查缓存是否在当前小时内生成
     * @param {string} skillId
     * @returns {boolean}
     */
    isCacheFromCurrentHour(skillId) {
        const cached = skillCache.get(skillId);
        if (!cached || !cached.generatedAt) {
            return false;
        }

        const now = new Date();
        const cacheTime = new Date(cached.generatedAt);

        // 检查是否同一小时
        return now.getFullYear() === cacheTime.getFullYear() &&
               now.getMonth() === cacheTime.getMonth() &&
               now.getDate() === cacheTime.getDate() &&
               now.getHours() === cacheTime.getHours();
    }

    /**
     * 检查 domain-trends 缓存是否在当前8小时窗口内
     * 8小时窗口: 0-7点, 8-15点, 16-23点
     * @param {string} skillId
     * @returns {boolean}
     */
    isDomainCacheValid(skillId) {
        // domain-trends 存储在固定的 hourKey (00, 08, 16)
        // 需要查找当前窗口对应的 hourKey
        const now = new Date();
        const currentWindowStart = Math.floor(now.getHours() / 8) * 8;
        const hourKey = String(currentWindowStart).padStart(2, '0');

        const cached = skillCache.getByHour(skillId, hourKey);
        if (!cached || !cached.generatedAt) {
            return false;
        }

        const cacheTime = new Date(cached.generatedAt);
        const windowStartTime = new Date(now);
        windowStartTime.setHours(currentWindowStart, 0, 0, 0);

        // 缓存必须在当前窗口开始之后生成
        return cacheTime >= windowStartTime;
    }

    /**
     * 检查当前是否是 domain-trends 抓取时间
     * domain-trends 每8小时抓取：0点、8点、16点
     * @returns {boolean}
     */
    isDomainTrendsFetchHour() {
        const hour = new Date().getHours();
        return hour === 0 || hour === 8 || hour === 16;
    }

    /**
     * 检查轮换模式缓存是否有效（当前2小时窗口内）
     * @param {string} presetId
     * @returns {boolean}
     */
    isRotationCacheValid(presetId) {
        const rotationConfig = this.getRotationConfig(presetId);
        if (!rotationConfig) return false;

        const groupId = this.getCurrentGroupId(rotationConfig);
        const cacheKey = `domain-trends:${presetId}:group${groupId}`;
        const cached = skillCache.get(cacheKey);

        if (!cached || !cached.generatedAt) {
            return false;
        }

        const cacheTime = new Date(cached.generatedAt);
        const now = new Date();

        // 检查缓存是否在当前2小时窗口内
        const currentWindowStart = Math.floor(now.getHours() / 2) * 2;
        const windowStartTime = new Date(now);
        windowStartTime.setHours(currentWindowStart, 0, 0, 0);

        return cacheTime >= windowStartTime;
    }

    /**
     * 启动定时任务
     * cron 格式: 分 时 日 月 星期
     * "1 * * * *" = 每小时的第1分钟
     */
    start() {
        // 每小时第1分钟执行
        const job = cron.schedule('1 * * * *', () => {
            this.fetchAllTrends();
        }, {
            scheduled: true,
            timezone: 'Asia/Shanghai'
        });

        this.jobs.set('trends', job);
        console.log('[调度器] 定时任务已启动：');
        console.log('  - x-trends/tophub-trends: 每小时');
        console.log('  - domain-trends (轮换模式): 每2小时轮换一组');
        console.log('  - domain-trends (传统模式): 每8小时');

        // 启动时检查是否需要抓取
        const needFetchHourly = [];
        let needFetchDomain = false;

        // 检查基础趋势（每小时）
        if (!this.isCacheFromCurrentHour('x-trends')) needFetchHourly.push('x-trends');
        if (!this.isCacheFromCurrentHour('tophub-trends')) needFetchHourly.push('tophub-trends');

        // 检查 domain-trends 各预设
        const domainPresets = this.getDomainPresets();
        for (const preset of domainPresets) {
            if (preset.hasRotation) {
                // 轮换模式：检查当前组的缓存
                if (!this.isRotationCacheValid(preset.id)) {
                    needFetchDomain = true;
                    const rotationConfig = this.getRotationConfig(preset.id);
                    const groupId = this.getCurrentGroupId(rotationConfig);
                    needFetchHourly.push(`domain-trends-rotation:${preset.id} (组${groupId})`);
                }
            } else {
                // 传统模式：8小时窗口
                const cacheKey = `domain-trends:${preset.id}`;
                if (!this.isDomainCacheValid(cacheKey)) {
                    needFetchDomain = true;
                    needFetchHourly.push(cacheKey);
                }
            }
        }

        if (needFetchHourly.length === 0) {
            console.log('[调度器] 所有缓存有效，跳过首次抓取');
        } else {
            console.log(`[调度器] 需要抓取: ${needFetchHourly.join(', ')}`);
            // 如果需要抓取 domain-trends，强制执行
            this.fetchAllTrends(needFetchDomain);
        }
    }

    /**
     * 停止所有定时任务
     */
    stop() {
        for (const [name, job] of this.jobs) {
            job.stop();
            console.log(`[调度器] 定时任务 ${name} 已停止`);
        }
        this.jobs.clear();
    }
}

// 单例
const scheduler = new Scheduler();

module.exports = scheduler;

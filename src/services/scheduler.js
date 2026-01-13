/**
 * 定时任务调度服务
 *
 * 功能：
 * 1. 每小时1分钟自动抓取 x-trends、tophub-trends
 * 2. 每8小时（0:01, 8:01, 16:01）抓取 domain-trends
 * 3. 抓取结果保存到 skillCache
 * 4. 服务启动时检查并执行必要的抓取
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const skillCache = require('./skillCache');

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
     * 获取 domain-trends 的所有预设
     * @returns {Array<{id: string, name: string}>}
     */
    getDomainPresets() {
        const presetsDir = path.join(__dirname, '../../.claude/domain-trends/presets');
        if (!fs.existsSync(presetsDir)) {
            return [];
        }

        try {
            const files = fs.readdirSync(presetsDir).filter(f => f.endsWith('.json'));
            return files.map(file => {
                const content = fs.readFileSync(path.join(presetsDir, file), 'utf-8');
                const config = JSON.parse(content);
                return { id: config.id, name: config.name };
            });
        } catch (err) {
            console.error('[调度器] 读取 domain-trends 预设失败:', err.message);
            return [];
        }
    }

    /**
     * 执行单个 skill 抓取
     * @param {string} skillId - x-trends、tophub-trends 或 domain-trends:preset
     * @returns {Promise<string>} 抓取结果
     */
    async executeSkill(skillId) {
        console.log(`[调度器] 开始抓取 ${skillId}...`);

        // 解析 skillId，支持 domain-trends:preset 格式
        let baseSkillId = skillId;
        let preset = null;

        if (skillId.startsWith('domain-trends:')) {
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
            if (preset) {
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
                        let outputDir, prefix, fileExt = '.json';

                        if (baseSkillId === 'domain-trends') {
                            outputDir = path.join(__dirname, '../../outputs/trends/domain');
                            prefix = `${preset}_analysis`;
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

        // domain-trends 每8小时抓取（0点、8点、16点）
        const shouldFetchDomain = forceDomainTrends || this.isDomainTrendsFetchHour();
        if (shouldFetchDomain) {
            const domainPresets = this.getDomainPresets();
            for (const preset of domainPresets) {
                skills.push(`domain-trends:${preset.id}`);
            }
            console.log(`[调度器] 当前是 domain-trends 抓取时间（每8小时）`);
        }

        console.log(`[调度器] 待抓取: ${skills.join(', ')}`);

        for (const skillId of skills) {
            try {
                const report = await this.executeSkillWithRetry(skillId);
                skillCache.set(skillId, report);
                console.log(`[调度器] ${skillId} 缓存已更新`);
            } catch (err) {
                console.error(`[调度器] ${skillId} 抓取失败（已重试 ${this.maxRetries} 次）:`, err.message);
                // 抓取失败不影响其他 skill
            }
        }

        this.isRunning = false;
        console.log(`[调度器] ========== 定时抓取完成 ==========\n`);
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
        const cached = skillCache.get(skillId);
        if (!cached || !cached.generatedAt) {
            return false;
        }

        const now = new Date();
        const cacheTime = new Date(cached.generatedAt);

        // 计算当前8小时窗口的开始时间
        const currentWindowStart = Math.floor(now.getHours() / 8) * 8;
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
        console.log('  - x-trends/tophub-trends: 每小时1分钟');
        console.log('  - domain-trends: 每8小时（0:01, 8:01, 16:01）');

        // 启动时检查是否需要抓取
        const needFetchHourly = [];
        let needFetchDomain = false;

        // 检查基础趋势（每小时）
        if (!this.isCacheFromCurrentHour('x-trends')) needFetchHourly.push('x-trends');
        if (!this.isCacheFromCurrentHour('tophub-trends')) needFetchHourly.push('tophub-trends');

        // 检查 domain-trends 各预设（8小时窗口）
        const domainPresets = this.getDomainPresets();
        for (const preset of domainPresets) {
            const cacheKey = `domain-trends:${preset.id}`;
            if (!this.isDomainCacheValid(cacheKey)) {
                needFetchDomain = true;
                needFetchHourly.push(cacheKey);
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

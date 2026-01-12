# 定时趋势抓取系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现每小时1分钟自动抓取 X 趋势和 TopHub 数据，用户访问只读缓存，不触发新抓取。

**Architecture:** 使用 node-cron 定时任务调度器，在每小时的第1分钟执行抓取。缓存数据持久化到文件系统，服务重启后可恢复。用户 API 改为纯读取模式，移除触发执行逻辑。

**Tech Stack:** node-cron (定时任务), 文件系统持久化, Express.js

---

## Task 1: 安装 node-cron 依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装 node-cron**

Run: `npm install node-cron`

**Step 2: 验证安装**

Run: `npm ls node-cron`
Expected: 显示 node-cron 版本

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-cron for scheduled tasks"
```

---

## Task 2: 创建定时任务调度服务

**Files:**
- Create: `src/services/scheduler.js`

**Step 1: 创建调度服务文件**

```javascript
/**
 * 定时任务调度服务
 *
 * 功能：
 * 1. 每小时1分钟自动抓取 x-trends 和 tophub-trends
 * 2. 抓取结果保存到 skillCache
 * 3. 服务启动时立即执行一次抓取
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
    }

    /**
     * 执行单个 skill 抓取
     * @param {string} skillId - x-trends 或 tophub-trends
     * @returns {Promise<string>} 抓取结果
     */
    async executeSkill(skillId) {
        console.log(`[调度器] 开始抓取 ${skillId}...`);

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

        if (!fs.existsSync(scriptPath)) {
            throw new Error(`脚本不存在: ${scriptPath}`);
        }

        return new Promise((resolve, reject) => {
            const child = spawn('npx', ['ts-node', scriptPath], {
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
                        const outputDir = path.join(__dirname, '../../outputs/trends');
                        const prefix = skillId === 'x-trends' ? 'x_trends_analysis' : 'tophub_analysis';

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
     */
    async fetchAllTrends() {
        if (this.isRunning) {
            console.log('[调度器] 上一次抓取仍在进行中，跳过本次');
            return;
        }

        this.isRunning = true;
        console.log(`[调度器] ========== 开始定时抓取 ${new Date().toLocaleString('zh-CN')} ==========`);

        const skills = ['x-trends', 'tophub-trends'];

        for (const skillId of skills) {
            try {
                const report = await this.executeSkill(skillId);
                skillCache.set(skillId, report);
                console.log(`[调度器] ${skillId} 缓存已更新`);
            } catch (err) {
                console.error(`[调度器] ${skillId} 抓取失败:`, err.message);
                // 抓取失败不影响其他 skill
            }
        }

        this.isRunning = false;
        console.log(`[调度器] ========== 定时抓取完成 ==========\n`);
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
        console.log('[调度器] 定时任务已启动：每小时1分钟抓取趋势数据');

        // 启动时立即执行一次
        console.log('[调度器] 服务启动，立即执行首次抓取...');
        this.fetchAllTrends();
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
```

**Step 2: 验证文件语法**

Run: `node -c src/services/scheduler.js`
Expected: Syntax OK

**Step 3: Commit**

```bash
git add src/services/scheduler.js
git commit -m "feat: add scheduler service for hourly trends fetch"
```

---

## Task 3: 修改缓存服务支持持久化

**Files:**
- Modify: `src/services/skillCache.js:1-196`

**Step 1: 添加文件持久化功能**

在 `SkillCache` 类中添加以下方法和修改 constructor:

```javascript
// 在 constructor 中添加:
this.cacheDir = path.join(__dirname, '../../outputs/.cache');
// 确保缓存目录存在
if (!fs.existsSync(this.cacheDir)) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
}
// 启动时从文件恢复缓存
this.loadFromDisk();

// 添加新方法:

/**
 * 获取缓存文件路径
 */
getCacheFilePath(skillId) {
    return path.join(this.cacheDir, `${skillId}.cache.json`);
}

/**
 * 持久化缓存到磁盘
 */
saveToDisk(skillId) {
    const cached = this.cache.get(skillId);
    if (!cached) return;

    const filePath = this.getCacheFilePath(skillId);
    const data = {
        content: cached.content,
        generatedAt: cached.generatedAt,
        expireAt: cached.expireAt
    };

    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`[缓存] 已持久化 ${skillId} 到磁盘`);
    } catch (err) {
        console.error(`[缓存] 持久化 ${skillId} 失败:`, err.message);
    }
}

/**
 * 从磁盘恢复缓存
 */
loadFromDisk() {
    const skillIds = ['x-trends', 'tophub-trends'];

    for (const skillId of skillIds) {
        const filePath = this.getCacheFilePath(skillId);
        if (!fs.existsSync(filePath)) continue;

        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            this.cache.set(skillId, {
                content: data.content,
                generatedAt: data.generatedAt,
                expireAt: data.expireAt
            });

            const isExpired = Date.now() > data.expireAt;
            console.log(`[缓存] 从磁盘恢复 ${skillId}，${isExpired ? '已过期' : '有效'}`);
        } catch (err) {
            console.error(`[缓存] 恢复 ${skillId} 失败:`, err.message);
        }
    }
}
```

**Step 2: 修改 set 方法调用持久化**

在 `set` 方法末尾添加:
```javascript
// 持久化到磁盘
this.saveToDisk(skillId);
```

**Step 3: 添加 require 语句**

在文件顶部添加:
```javascript
const path = require('path');
const fs = require('fs');
```

**Step 4: 验证语法**

Run: `node -c src/services/skillCache.js`
Expected: Syntax OK

**Step 5: Commit**

```bash
git add src/services/skillCache.js
git commit -m "feat: add disk persistence for skill cache"
```

---

## Task 4: 修改 skills 路由为纯读取模式

**Files:**
- Modify: `src/routes/skills.js`

**Step 1: 创建新的只读端点**

在现有 `router.post('/:skillId/execute', ...)` 之前添加新端点:

```javascript
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
```

**Step 2: 验证语法**

Run: `node -c src/routes/skills.js`
Expected: Syntax OK

**Step 3: Commit**

```bash
git add src/routes/skills.js
git commit -m "feat: add read-only cached endpoint for trends"
```

---

## Task 5: 在服务器启动时初始化调度器

**Files:**
- Modify: `src/server.js`

**Step 1: 导入调度器**

在文件顶部的 require 区域添加:
```javascript
const scheduler = require('./services/scheduler');
```

**Step 2: 在 start 函数中启动调度器**

在 `server.listen` 回调中添加:
```javascript
// 启动定时任务调度器
scheduler.start();
```

**Step 3: 验证语法**

Run: `node -c src/server.js`
Expected: Syntax OK

**Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: initialize scheduler on server start"
```

---

## Task 6: 创建缓存输出目录

**Files:**
- Create: `outputs/.cache/.gitkeep`

**Step 1: 创建目录和占位文件**

Run: `mkdir -p outputs/.cache && touch outputs/.cache/.gitkeep`

**Step 2: Commit**

```bash
git add outputs/.cache/.gitkeep
git commit -m "chore: add cache directory for persistent skill cache"
```

---

## Task 7: 集成测试

**Step 1: 启动服务器**

Run: `npm start`
Expected:
- 显示 "定时任务已启动：每小时1分钟抓取趋势数据"
- 显示 "服务启动，立即执行首次抓取..."
- 开始执行 x-trends 和 tophub-trends 抓取

**Step 2: 验证缓存 API**

Run: `curl http://localhost:3000/api/skills/x-trends/cached -H "Authorization: Bearer <token>"`
Expected: 返回缓存的趋势数据或"暂无缓存"消息

**Step 3: 验证缓存文件**

Run: `ls -la outputs/.cache/`
Expected: 存在 x-trends.cache.json 和 tophub-trends.cache.json

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: implement scheduled trends fetching system

- Add node-cron for hourly scheduled tasks (at minute 1)
- Scheduler runs x-trends and tophub-trends automatically
- Cache persisted to disk for server restart recovery
- User API is read-only, never triggers new fetch
- If no cache available, returns next fetch time"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | 安装 node-cron 依赖 |
| 2 | 创建定时任务调度服务 |
| 3 | 修改缓存服务支持持久化 |
| 4 | 添加只读缓存 API 端点 |
| 5 | 服务器启动时初始化调度器 |
| 6 | 创建缓存目录 |
| 7 | 集成测试 |

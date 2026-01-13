/**
 * Skill 缓存服务
 *
 * 功能：
 * 1. 基于小时的历史数据存储（保留12小时）
 * 2. 并发请求锁（多人同时请求只执行一次）
 * 3. 磁盘持久化（服务重启后恢复缓存）
 */

const path = require('path');
const fs = require('fs');

class SkillCache {
    constructor() {
        // 缓存存储（按小时存储）
        // 格式: Map<skillId, Map<hourKey, { content, generatedAt }>>
        this.hourlyCache = new Map();

        // 当前小时的缓存（用于判断本小时是否已抓取）
        this.currentHourCache = new Map();

        // 执行锁（防止并发执行）
        this.locks = new Map();

        // 等待队列（并发请求时，后续请求等待第一个完成）
        this.waitQueues = new Map();

        // 保留的小时数
        this.maxHours = 12;

        // 持久化缓存目录
        this.cacheDir = path.join(__dirname, '../../outputs/.cache');
        // 确保缓存目录存在
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
        // 启动时从磁盘恢复缓存
        this.loadFromDisk();
    }

    /**
     * 获取小时键（格式：HH，如 "14", "09"）
     * @param {Date} date
     * @returns {string}
     */
    getHourKey(date = new Date()) {
        return String(date.getHours()).padStart(2, '0');
    }

    /**
     * 检查是否是 domain-trends 类型的 skillId
     * 支持格式：domain-trends:preset 或 domain-trends:preset:groupN
     * @param {string} skillId
     * @returns {boolean}
     */
    isDomainTrends(skillId) {
        return skillId.startsWith('domain-trends:');
    }

    /**
     * 从 domain-trends:preset 格式获取当前轮换组的 skillId
     * @param {string} skillId - 格式如 domain-trends:ai
     * @returns {string} - 格式如 domain-trends:ai:group0
     */
    getRotationSkillId(skillId) {
        if (skillId.includes(':group')) {
            return skillId; // 已经是完整格式
        }
        const currentHour = new Date().getHours();
        const groupId = Math.floor(currentHour / 2) % 10;
        return `${skillId}:group${groupId}`;
    }

    /**
     * 查找所有属于指定 preset 的轮换组缓存
     * @param {string} presetSkillId - 格式如 domain-trends:ai
     * @returns {Map} 聚合的 hourlyData
     */
    getAggregatedRotationData(presetSkillId) {
        const aggregated = new Map();
        const prefix = presetSkillId + ':group';

        // 遍历所有缓存，找到匹配的轮换组数据
        for (const [skillId, hourlyData] of this.hourlyCache.entries()) {
            if (skillId.startsWith(prefix)) {
                for (const [hourKey, cached] of hourlyData.entries()) {
                    // 如果同一小时有多个组的数据，使用最新的
                    const existing = aggregated.get(hourKey);
                    if (!existing || cached.generatedAt > existing.generatedAt) {
                        aggregated.set(hourKey, cached);
                    }
                }
            }
        }

        return aggregated;
    }

    /**
     * 获取缓存文件路径
     * @param {string} skillId
     * @returns {string}
     */
    getCacheFilePath(skillId) {
        // 将冒号替换为下划线，避免 Windows 文件名问题
        const safeId = skillId.replace(/:/g, '_');
        return path.join(this.cacheDir, `${safeId}.hourly.json`);
    }

    /**
     * 持久化缓存到磁盘
     * @param {string} skillId
     */
    saveToDisk(skillId) {
        const hourlyData = this.hourlyCache.get(skillId);
        if (!hourlyData) return;

        const filePath = this.getCacheFilePath(skillId);
        const data = {};

        for (const [hourKey, cached] of hourlyData.entries()) {
            data[hourKey] = {
                content: cached.content,
                generatedAt: cached.generatedAt
            };
        }

        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`[缓存] 已持久化 ${skillId} 到磁盘（${Object.keys(data).length} 个小时）`);
        } catch (err) {
            console.error(`[缓存] 持久化 ${skillId} 失败:`, err.message);
        }
    }

    /**
     * 从磁盘恢复缓存
     */
    loadFromDisk() {
        // 扫描缓存目录中的所有 .hourly.json 文件
        if (!fs.existsSync(this.cacheDir)) return;

        try {
            const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.hourly.json'));

            for (const file of files) {
                // 从文件名还原 skillId（将下划线还原为冒号）
                const safeId = file.replace('.hourly.json', '');
                const skillId = safeId.replace(/_/g, ':');

                const filePath = path.join(this.cacheDir, file);

                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    const hourlyData = new Map();

                    for (const [hourKey, cached] of Object.entries(data)) {
                        hourlyData.set(hourKey, {
                            content: cached.content,
                            generatedAt: cached.generatedAt
                        });
                    }

                    this.hourlyCache.set(skillId, hourlyData);
                    console.log(`[缓存] 从磁盘恢复 ${skillId}，共 ${hourlyData.size} 个小时的数据`);

                    // 清理超期数据
                    this.cleanupOldData(skillId);
                } catch (err) {
                    console.error(`[缓存] 恢复 ${skillId} 失败:`, err.message);
                }
            }
        } catch (err) {
            console.error('[缓存] 扫描缓存目录失败:', err.message);
        }
    }

    /**
     * 清理过期的旧数据
     * - 普通趋势：清理超过12小时的数据
     * - domain-trends：保留所有 2 小时窗口点
     * @param {string} skillId
     */
    cleanupOldData(skillId) {
        const hourlyData = this.hourlyCache.get(skillId);
        if (!hourlyData) return;

        const now = new Date();
        const currentHour = now.getHours();
        const validHours = new Set();

        if (this.isDomainTrends(skillId)) {
            // domain-trends：保留所有 2 小时窗口点（00, 02, 04, ...）
            for (let h = 0; h < 24; h += 2) {
                validHours.add(String(h).padStart(2, '0'));
            }
        } else {
            // 普通趋势：保留过去12个小时
            for (let i = 0; i < this.maxHours; i++) {
                let hour = currentHour - i;
                if (hour < 0) hour += 24;
                validHours.add(String(hour).padStart(2, '0'));
            }
        }

        // 删除不在有效范围内的数据
        let deleted = 0;
        for (const hourKey of hourlyData.keys()) {
            if (!validHours.has(hourKey)) {
                hourlyData.delete(hourKey);
                deleted++;
            }
        }

        if (deleted > 0) {
            console.log(`[缓存] 清理 ${skillId} 旧数据，删除 ${deleted} 个小时`);
            this.saveToDisk(skillId);
        }
    }

    /**
     * 获取当前时间窗口的缓存
     * - 普通趋势：当前小时
     * - domain-trends：当前 2 小时窗口（支持聚合查询）
     * @param {string} skillId
     * @returns {object|null} 缓存内容或 null
     */
    get(skillId) {
        const currentHour = new Date().getHours();
        let hourKey;

        if (this.isDomainTrends(skillId)) {
            // domain-trends：2 小时窗口
            const windowStart = Math.floor(currentHour / 2) * 2;
            hourKey = String(windowStart).padStart(2, '0');
        } else {
            // 普通趋势：当前小时
            hourKey = this.getHourKey();
        }

        return this.getByHour(skillId, hourKey);
    }

    /**
     * 获取指定小时的缓存
     * @param {string} skillId
     * @param {string} hourKey - 小时键，如 "14"
     * @returns {object|null}
     */
    getByHour(skillId, hourKey) {
        let hourlyData;

        // domain-trends:preset 格式需要聚合查询
        if (this.isDomainTrends(skillId) && !skillId.includes(':group')) {
            hourlyData = this.getAggregatedRotationData(skillId);
        } else {
            hourlyData = this.hourlyCache.get(skillId);
        }

        if (!hourlyData) return null;

        const cached = hourlyData.get(hourKey);
        if (!cached) return null;

        return {
            content: cached.content,
            generatedAt: cached.generatedAt,
            hourKey,
            fromCache: true
        };
    }

    /**
     * 获取所有可用的小时列表（按时间倒序）
     * - 普通趋势：返回过去12个小时
     * - domain-trends：返回过去12个2小时时间点（聚合所有轮换组数据）
     * @param {string} skillId
     * @returns {Array<{hourKey: string, generatedAt: number, displayTime: string}>}
     */
    getAvailableHours(skillId) {
        const now = new Date();
        const currentHour = now.getHours();

        // domain-trends 使用 2 小时间隔（无论是否包含 :group）
        if (this.isDomainTrends(skillId)) {
            // 如果是 domain-trends:preset 格式，聚合所有轮换组数据
            const hourlyData = skillId.includes(':group')
                ? (this.hourlyCache.get(skillId) || new Map())
                : this.getAggregatedRotationData(skillId);
            return this.getDomainTrendsRotationHours(hourlyData, currentHour);
        }

        // 普通趋势：生成过去12个小时的列表
        const hourlyData = this.hourlyCache.get(skillId) || new Map();
        const hours = [];
        for (let i = 0; i < this.maxHours; i++) {
            let hour = currentHour - i;
            if (hour < 0) hour += 24;
            const hourKey = String(hour).padStart(2, '0');

            const cached = hourlyData.get(hourKey);
            hours.push({
                hourKey,
                displayTime: `${hourKey}:00`,
                hasData: !!cached,
                generatedAt: cached?.generatedAt || null,
                isCurrent: i === 0
            });
        }

        return hours;
    }

    /**
     * 获取 domain-trends 轮换模式的2小时间隔时间点
     * 时间点：0:00, 2:00, 4:00, 6:00, 8:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00
     * @param {Map} hourlyData
     * @param {number} currentHour
     * @returns {Array}
     */
    getDomainTrendsRotationHours(hourlyData, currentHour) {
        const hours = [];

        // 找到当前或最近的2小时窗口起点
        let currentWindow = Math.floor(currentHour / 2) * 2;

        // 返回最近12个时间点（覆盖24小时）
        for (let i = 0; i < 12; i++) {
            let hour = currentWindow - (i * 2);
            if (hour < 0) hour += 24;
            const hourKey = String(hour).padStart(2, '0');

            const cached = hourlyData.get(hourKey);
            hours.push({
                hourKey,
                displayTime: `${hourKey}:00`,
                hasData: !!cached,
                generatedAt: cached?.generatedAt || null,
                isCurrent: i === 0
            });
        }

        return hours;
    }

    /**
     * 设置缓存
     * - 普通趋势：存储到当前小时
     * - domain-trends：存储到当前2小时窗口起点 (00, 02, 04, ...)
     * @param {string} skillId
     * @param {string} content
     */
    set(skillId, content) {
        let hourKey;
        const currentHour = new Date().getHours();

        if (this.isDomainTrends(skillId)) {
            // domain-trends 存储到 2 小时窗口起点
            const windowStart = Math.floor(currentHour / 2) * 2;
            hourKey = String(windowStart).padStart(2, '0');
        } else {
            hourKey = this.getHourKey();
        }
        const now = Date.now();

        // 初始化 skillId 的 Map
        if (!this.hourlyCache.has(skillId)) {
            this.hourlyCache.set(skillId, new Map());
        }

        const hourlyData = this.hourlyCache.get(skillId);
        hourlyData.set(hourKey, {
            content,
            generatedAt: now
        });

        console.log(`[缓存] 已缓存 ${skillId} @ ${hourKey}:00`);

        // 清理旧数据
        this.cleanupOldData(skillId);

        // 持久化到磁盘
        this.saveToDisk(skillId);
    }

    /**
     * 检查是否正在执行
     * @param {string} skillId
     * @returns {boolean}
     */
    isLocked(skillId) {
        return this.locks.get(skillId) === true;
    }

    /**
     * 获取锁
     * @param {string} skillId
     * @returns {boolean} 是否成功获取锁
     */
    acquireLock(skillId) {
        if (this.isLocked(skillId)) {
            return false;
        }
        this.locks.set(skillId, true);
        this.waitQueues.set(skillId, []);
        console.log(`[锁] 获取 ${skillId} 执行锁`);
        return true;
    }

    /**
     * 释放锁并通知等待者
     * @param {string} skillId
     * @param {string} content
     * @param {Error} error
     */
    releaseLock(skillId, content, error = null) {
        this.locks.set(skillId, false);

        // 通知所有等待者
        const waiters = this.waitQueues.get(skillId) || [];
        console.log(`[锁] 释放 ${skillId}，通知 ${waiters.length} 个等待者`);

        waiters.forEach(waiter => {
            if (error) {
                waiter.reject(error);
            } else {
                waiter.resolve(content);
            }
        });

        this.waitQueues.set(skillId, []);
    }

    /**
     * 添加等待者
     * @param {string} skillId
     * @returns {Promise<string>} 执行结果
     */
    addWaiter(skillId) {
        return new Promise((resolve, reject) => {
            const waiters = this.waitQueues.get(skillId) || [];
            waiters.push({ resolve, reject });
            this.waitQueues.set(skillId, waiters);
            console.log(`[锁] ${skillId} 添加等待者，当前等待数: ${waiters.length}`);
        });
    }

    /**
     * 获取缓存状态
     * @returns {object} 缓存状态信息
     */
    getStatus() {
        const status = {};
        const skillIds = ['x-trends', 'tophub-trends'];

        for (const skillId of skillIds) {
            const hours = this.getAvailableHours(skillId);
            const currentHourData = hours.find(h => h.isCurrent);

            status[skillId] = {
                cachedHours: hours.filter(h => h.hasData).length,
                currentHourCached: currentHourData?.hasData || false,
                isExecuting: this.isLocked(skillId),
                waitingCount: (this.waitQueues.get(skillId) || []).length,
                availableHours: hours
            };
        }

        return status;
    }

    /**
     * 清除指定 skill 的缓存
     * @param {string} skillId
     */
    clear(skillId) {
        this.hourlyCache.delete(skillId);
        // 删除磁盘缓存
        const filePath = this.getCacheFilePath(skillId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        console.log(`[缓存] 已清除 ${skillId}`);
    }

    /**
     * 清除所有缓存
     */
    clearAll() {
        this.hourlyCache.clear();
        console.log('[缓存] 已清除所有缓存');
    }
}

// 单例模式
const skillCache = new SkillCache();

module.exports = skillCache;

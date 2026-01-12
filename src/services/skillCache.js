/**
 * Skill 缓存服务
 *
 * 功能：
 * 1. 基于 TTL 的内存缓存
 * 2. 并发请求锁（多人同时请求只执行一次）
 * 3. 支持不同 skill 的不同缓存时间
 * 4. 磁盘持久化（服务重启后恢复缓存）
 */

const path = require('path');
const fs = require('fs');

class SkillCache {
    constructor() {
        // 缓存存储
        this.cache = new Map();

        // 执行锁（防止并发执行）
        this.locks = new Map();

        // 等待队列（并发请求时，后续请求等待第一个完成）
        this.waitQueues = new Map();

        // 缓存配置（毫秒）
        this.ttlConfig = {
            'x-trends': 60 * 60 * 1000,        // 1 小时
            'tophub-trends': 24 * 60 * 60 * 1000  // 24 小时
        };

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
     * 获取缓存文件路径
     * @param {string} skillId
     * @returns {string}
     */
    getCacheFilePath(skillId) {
        return path.join(this.cacheDir, `${skillId}.cache.json`);
    }

    /**
     * 持久化缓存到磁盘
     * @param {string} skillId
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

    /**
     * 获取缓存
     * @param {string} skillId
     * @returns {object|null} 缓存内容或 null
     */
    get(skillId) {
        const cached = this.cache.get(skillId);

        if (!cached) {
            return null;
        }

        // 检查是否过期
        if (Date.now() > cached.expireAt) {
            this.cache.delete(skillId);
            console.log(`[缓存] ${skillId} 已过期，已清除`);
            return null;
        }

        const remainingMinutes = Math.round((cached.expireAt - Date.now()) / 60000);
        console.log(`[缓存] 命中 ${skillId}，剩余有效期 ${remainingMinutes} 分钟`);

        return {
            content: cached.content,
            generatedAt: cached.generatedAt,
            fromCache: true
        };
    }

    /**
     * 设置缓存
     * @param {string} skillId
     * @param {string} content
     */
    set(skillId, content) {
        const ttl = this.ttlConfig[skillId] || 60 * 60 * 1000; // 默认 1 小时
        const now = Date.now();

        this.cache.set(skillId, {
            content,
            generatedAt: now,
            expireAt: now + ttl
        });

        const ttlMinutes = Math.round(ttl / 60000);
        console.log(`[缓存] 已缓存 ${skillId}，有效期 ${ttlMinutes} 分钟`);

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

        for (const [skillId, cached] of this.cache.entries()) {
            const isExpired = Date.now() > cached.expireAt;
            status[skillId] = {
                cached: !isExpired,
                generatedAt: cached.generatedAt ? new Date(cached.generatedAt).toLocaleString('zh-CN') : null,
                expireAt: cached.expireAt ? new Date(cached.expireAt).toLocaleString('zh-CN') : null,
                remainingMinutes: isExpired ? 0 : Math.round((cached.expireAt - Date.now()) / 60000),
                isExecuting: this.isLocked(skillId),
                waitingCount: (this.waitQueues.get(skillId) || []).length
            };
        }

        // 添加未缓存但已配置的 skill
        for (const skillId of Object.keys(this.ttlConfig)) {
            if (!status[skillId]) {
                status[skillId] = {
                    cached: false,
                    generatedAt: null,
                    expireAt: null,
                    remainingMinutes: 0,
                    isExecuting: this.isLocked(skillId),
                    waitingCount: (this.waitQueues.get(skillId) || []).length,
                    ttlMinutes: Math.round(this.ttlConfig[skillId] / 60000)
                };
            }
        }

        return status;
    }

    /**
     * 清除指定 skill 的缓存
     * @param {string} skillId
     */
    clear(skillId) {
        this.cache.delete(skillId);
        console.log(`[缓存] 已清除 ${skillId}`);
    }

    /**
     * 清除所有缓存
     */
    clearAll() {
        this.cache.clear();
        console.log('[缓存] 已清除所有缓存');
    }
}

// 单例模式
const skillCache = new SkillCache();

module.exports = skillCache;

/**
 * 趋势数据数据库服务
 *
 * 功能：
 * 1. 保存原始趋势数据
 * 2. 保存分析结果
 * 3. 检查当前时间周期是否已有分析结果
 * 4. 获取历史数据
 */

const { pool } = require('../config/database');

class TrendsDbService {
    /**
     * 获取当前小时的 hourKey
     * @returns {string} 格式: YYYY-MM-DD-HH
     */
    getCurrentHourKey() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        return `${year}-${month}-${day}-${hour}`;
    }

    /**
     * 获取8小时窗口的 hourKey（用于传统模式）
     * @returns {string} 格式: YYYY-MM-DD-HH (其中 HH 为 00, 08, 16)
     */
    get8HourWindowKey() {
        const now = new Date();
        const windowStart = Math.floor(now.getHours() / 8) * 8;
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(windowStart).padStart(2, '0');
        return `${year}-${month}-${day}-${hour}`;
    }

    /**
     * 获取2小时窗口的 hourKey（用于轮换模式）
     * @returns {string} 格式: YYYY-MM-DD-HH (其中 HH 为偶数)
     */
    get2HourWindowKey() {
        const now = new Date();
        const windowStart = Math.floor(now.getHours() / 2) * 2;
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(windowStart).padStart(2, '0');
        return `${year}-${month}-${day}-${hour}`;
    }

    /**
     * 获取当前时间周期的数据
     * @param {string} skillId - 如 'x-trends', 'tophub-trends', 'domain-trends:ai:group0'
     * @param {string} hourKey - 时间key，如不提供则使用当前小时
     * @returns {Promise<Object|null>}
     */
    async getByHourKey(skillId, hourKey = null) {
        const key = hourKey || this.getCurrentHourKey();
        const result = await pool.query(
            `SELECT * FROM trends_data WHERE skill_id = $1 AND hour_key = $2`,
            [skillId, key]
        );
        return result.rows[0] || null;
    }

    /**
     * 检查当前时间周期是否已有完成的分析
     * @param {string} skillId
     * @param {string} hourKey
     * @returns {Promise<boolean>}
     */
    async hasCompletedAnalysis(skillId, hourKey = null) {
        const key = hourKey || this.getCurrentHourKey();
        const result = await pool.query(
            `SELECT analysis_status FROM trends_data
             WHERE skill_id = $1 AND hour_key = $2 AND analysis_status = 'completed'`,
            [skillId, key]
        );
        return result.rows.length > 0;
    }

    /**
     * 保存原始数据（抓取阶段）
     * @param {string} skillId
     * @param {string} hourKey
     * @param {Object} rawData
     * @returns {Promise<Object>}
     */
    async saveRawData(skillId, hourKey, rawData) {
        const result = await pool.query(
            `INSERT INTO trends_data (skill_id, hour_key, raw_data, analysis_status)
             VALUES ($1, $2, $3, 'pending')
             ON CONFLICT (skill_id, hour_key)
             DO UPDATE SET raw_data = $3, updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [skillId, hourKey, JSON.stringify(rawData)]
        );
        console.log(`[TrendsDb] 原始数据已保存: ${skillId} @ ${hourKey}`);
        return result.rows[0];
    }

    /**
     * 更新分析状态为进行中
     * @param {string} skillId
     * @param {string} hourKey
     * @returns {Promise<void>}
     */
    async setAnalyzing(skillId, hourKey) {
        await pool.query(
            `UPDATE trends_data SET analysis_status = 'analyzing', updated_at = CURRENT_TIMESTAMP
             WHERE skill_id = $1 AND hour_key = $2`,
            [skillId, hourKey]
        );
        console.log(`[TrendsDb] 开始分析: ${skillId} @ ${hourKey}`);
    }

    /**
     * 保存分析结果
     * @param {string} skillId
     * @param {string} hourKey
     * @param {Object} analysisResult
     * @returns {Promise<Object>}
     */
    async saveAnalysisResult(skillId, hourKey, analysisResult) {
        const result = await pool.query(
            `UPDATE trends_data
             SET analysis_result = $3, analysis_status = 'completed', updated_at = CURRENT_TIMESTAMP
             WHERE skill_id = $1 AND hour_key = $2
             RETURNING *`,
            [skillId, hourKey, JSON.stringify(analysisResult)]
        );
        console.log(`[TrendsDb] 分析结果已保存: ${skillId} @ ${hourKey}`);
        return result.rows[0];
    }

    /**
     * 保存分析失败状态
     * @param {string} skillId
     * @param {string} hourKey
     * @param {string} errorMessage
     * @returns {Promise<void>}
     */
    async saveAnalysisError(skillId, hourKey, errorMessage) {
        await pool.query(
            `UPDATE trends_data
             SET analysis_status = 'failed', error_message = $3, updated_at = CURRENT_TIMESTAMP
             WHERE skill_id = $1 AND hour_key = $2`,
            [skillId, hourKey, errorMessage]
        );
        console.log(`[TrendsDb] 分析失败: ${skillId} @ ${hourKey}: ${errorMessage}`);
    }

    /**
     * 获取最近N条数据
     * @param {string} skillId
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async getRecent(skillId, limit = 12) {
        const result = await pool.query(
            `SELECT * FROM trends_data
             WHERE skill_id = $1 AND analysis_status = 'completed'
             ORDER BY created_at DESC LIMIT $2`,
            [skillId, limit]
        );
        return result.rows;
    }

    /**
     * 清理过期数据（超过24小时）
     * @returns {Promise<number>} 删除的行数
     */
    async cleanupOldData() {
        const result = await pool.query(
            `DELETE FROM trends_data
             WHERE created_at < NOW() - INTERVAL '24 hours'
             RETURNING id`
        );
        if (result.rows.length > 0) {
            console.log(`[TrendsDb] 已清理 ${result.rows.length} 条过期数据`);
        }
        return result.rows.length;
    }
}

// 单例
const trendsDb = new TrendsDbService();

module.exports = trendsDb;

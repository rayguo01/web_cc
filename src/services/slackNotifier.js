/**
 * Slack 通知服务
 * 使用 Incoming Webhook 发送通知到 Slack
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * 发送消息到 Slack
 * @param {object} message - Slack 消息对象
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendMessage(message) {
    if (!SLACK_WEBHOOK_URL) {
        console.log('[Slack] Webhook URL 未配置，跳过通知');
        return false;
    }

    try {
        const response = await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            console.error('[Slack] 发送失败:', response.status, await response.text());
            return false;
        }

        console.log('[Slack] 通知发送成功');
        return true;
    } catch (error) {
        console.error('[Slack] 发送异常:', error.message);
        return false;
    }
}

/**
 * 发送评论助手执行摘要
 * @param {object} summary - 执行摘要
 * @param {string} summary.region - 区域 (ja/en)
 * @param {number} summary.autoComments - 自动评论数量
 * @param {number} summary.manualPending - 手动待评论数量
 * @param {Array} summary.manualDetails - 手动评论详情 [{username, tweetAuthor, tweetPreview}]
 * @param {string} summary.error - 错误信息（如果有）
 */
async function sendCommentAssistantSummary(summary) {
    const regionName = summary.region === 'ja' ? '日区' : '美区';
    const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    // 构建消息块
    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `📝 评论助手执行报告`,
                emoji: true
            }
        },
        {
            type: 'section',
            fields: [
                {
                    type: 'mrkdwn',
                    text: `*时间:*\n${time}`
                },
                {
                    type: 'mrkdwn',
                    text: `*区域:*\n${regionName}`
                }
            ]
        }
    ];

    // 错误情况
    if (summary.error) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `❌ *执行失败:* ${summary.error}`
            }
        });
    } else {
        // 统计信息
        blocks.push({
            type: 'section',
            fields: [
                {
                    type: 'mrkdwn',
                    text: `*自动评论:*\n${summary.autoComments || 0} 条`
                },
                {
                    type: 'mrkdwn',
                    text: `*手动待评论:*\n${summary.manualPending || 0} 条`
                }
            ]
        });

        // 无内容生成
        if ((summary.autoComments || 0) === 0 && (summary.manualPending || 0) === 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `ℹ️ 本次无新内容生成`
                }
            });
        }
    }

    return sendMessage({ blocks });
}

module.exports = {
    sendMessage,
    sendCommentAssistantSummary
};

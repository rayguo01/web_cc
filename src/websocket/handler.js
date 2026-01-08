const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const { pool } = require('../config/database');
const { processManager } = require('../services/claude');

function setupWebSocket(server) {
    const wss = new WebSocketServer({ server });

    wss.on('connection', async (ws, req) => {
        // 从 URL 参数获取 token
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');

        // 验证 token
        const user = verifyToken(token);
        if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: '认证失败' }));
            ws.close();
            return;
        }

        ws.userId = user.userId;
        ws.isAlive = true;

        console.log(`用户 ${user.username} 已连接 WebSocket`);

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === 'message') {
                    await handleMessage(ws, message);
                } else if (message.type === 'status') {
                    // 返回进程池状态
                    ws.send(JSON.stringify({
                        type: 'status',
                        data: processManager.getStatus()
                    }));
                }
            } catch (err) {
                console.error('处理消息失败:', err);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: '处理消息失败'
                }));
            }
        });

        ws.on('close', () => {
            console.log(`用户 ${user.username} 断开连接`);
        });
    });

    // 心跳检测
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => {
        clearInterval(interval);
    });

    return wss;
}

async function handleMessage(ws, message) {
    const { sessionId, content } = message;

    if (!content || !content.trim()) {
        ws.send(JSON.stringify({
            type: 'error',
            message: '消息内容不能为空'
        }));
        return;
    }

    // 验证会话属于当前用户
    let session;
    if (sessionId) {
        const result = await pool.query(
            'SELECT id, claude_session_id FROM sessions WHERE id = $1 AND user_id = $2',
            [sessionId, ws.userId]
        );

        if (result.rows.length === 0) {
            ws.send(JSON.stringify({
                type: 'error',
                message: '会话不存在'
            }));
            return;
        }
        session = result.rows[0];
    } else {
        // 如果没有提供 sessionId，创建新会话
        const result = await pool.query(
            `INSERT INTO sessions (user_id, title)
             VALUES ($1, $2)
             RETURNING id, claude_session_id`,
            [ws.userId, content.substring(0, 50)]
        );
        session = result.rows[0];

        // 通知客户端新会话创建
        ws.send(JSON.stringify({
            type: 'session_created',
            sessionId: session.id
        }));
    }

    // 保存用户消息
    await pool.query(
        'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
        [session.id, 'user', content]
    );

    // 通知开始处理
    ws.send(JSON.stringify({ type: 'start' }));

    // 使用进程池管理器发送消息
    processManager.sendMessage(
        content,
        session.claude_session_id,
        // 流式数据回调
        (data) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                    type: 'stream',
                    content: data.content
                }));
            }
        },
        // 结束回调
        async (result) => {
            // 更新 Claude 会话ID
            if (result.sessionId && result.sessionId !== session.claude_session_id) {
                await pool.query(
                    'UPDATE sessions SET claude_session_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [result.sessionId, session.id]
                );
            }

            // 保存助手回复
            if (result.fullResponse) {
                await pool.query(
                    'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
                    [session.id, 'assistant', result.fullResponse]
                );
            }

            // 更新会话时间
            await pool.query(
                'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [session.id]
            );

            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                    type: 'done',
                    sessionId: session.id
                }));
            }
        },
        // 错误回调
        (err) => {
            console.error('Claude 处理错误:', err);
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Claude 处理失败: ' + err.message
                }));
            }
        }
    );
}

module.exports = { setupWebSocket };

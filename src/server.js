require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');

const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const { setupWebSocket } = require('./websocket/handler');

const app = express();
const server = http.createServer(app);

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionsRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 设置 WebSocket
setupWebSocket(server);

// 启动服务器
const PORT = process.env.PORT || 3000;

async function start() {
    try {
        // 初始化数据库
        await initDatabase();

        server.listen(PORT, () => {
            console.log(`服务器运行在 http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('启动失败:', err);
        process.exit(1);
    }
}

start();

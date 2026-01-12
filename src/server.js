require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');

const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const skillsRoutes = require('./routes/skills');
const tasksRoutes = require('./routes/tasks');
const { setupWebSocket } = require('./websocket/handler');
const scheduler = require('./services/scheduler');

const app = express();
const server = http.createServer(app);

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/tasks', tasksRoutes);

// 静态文件访问 - outputs 目录（用于图片访问）
app.use('/outputs', express.static(path.join(__dirname, '../outputs')));

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

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
            console.log(`本地访问: http://localhost:${PORT}`);

            // 启动定时任务调度器
            scheduler.start();
        });
    } catch (err) {
        console.error('启动失败:', err);
        process.exit(1);
    }
}

start();

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');

const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const skillsRoutes = require('./routes/skills');
const tasksRoutes = require('./routes/tasks');
const twitterRoutes = require('./routes/twitter');
const toolsRoutes = require('./routes/tools');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const invitationsRoutes = require('./routes/invitations');
const { setupWebSocket } = require('./websocket/handler');
const scheduler = require('./services/scheduler');

const app = express();
const server = http.createServer(app);

// 中间件
app.use(express.json());

// 移动端登录页面重定向
app.get(['/', '/login.html'], (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

    // 如果是从移动端登录页跳转过来的（已登录），不再重定向
    const fromMobile = req.query.from === 'mobile';

    if (isMobile && !fromMobile) {
        // 移动设备首次访问登录页，重定向到移动端登录页（保留查询参数）
        const queryString = Object.keys(req.query).length > 0
            ? '?' + new URLSearchParams(req.query).toString()
            : '';
        return res.redirect('/login-mobile.html' + queryString);
    }

    // 根路径需要转发到 login.html
    if (req.path === '/') {
        return res.sendFile(path.join(__dirname, '../public/login.html'));
    }

    next();
});

app.use(express.static(path.join(__dirname, '../public')));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/twitter', twitterRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/invitations', invitationsRoutes);

// 静态文件访问 - outputs 目录（用于图片访问）
app.use('/outputs', express.static(path.join(__dirname, '../outputs')));

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 管理后台页面路由
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
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

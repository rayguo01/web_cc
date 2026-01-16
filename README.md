<div align="center">

# Viral-X

**AI 驱动的 X 平台爆款内容生成器**

从热点追踪到一键发布，十分钟写出你的第一条爆款

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/rayguo01/viral-x/pulls)

[在线体验](https://viral-x.app) · [English](#english)

</div>

---

## 功能特性

- **实时热点追踪** - 自动抓取 X 平台和国内热点，每小时更新
- **AI 内容生成** - 基于方法论，生成高质量帖子
- **爆款优化** - AI 评分和优化建议，提升病毒传播潜力
- **写作风格模仿** - 分析大V推文风格，一键模仿生成
- **AI 智能配图** - Gemini 生成与内容匹配的配图
- **一键发布** - OAuth 授权后直接发布到 X 平台

## 演示

### 工作流程

```
热点选择 → 内容生成 → 爆款优化 → 生成配图 → 发布帖子
```

### 截图预览

#### 落地页
![落地页](docs/screenshots/landing.png)

#### 工作流
![内容生成](docs/screenshots/workflow.png)

#### 话题选择
![内容生成](docs/screenshots/topic.png)

#### 内容生成 & 风格选择
![内容生成](docs/screenshots/content.png)

## 快速开始

### 前置要求

- Node.js >= 18
- PostgreSQL 数据库（推荐 [Neon](https://neon.tech)）
- [Claude CLI](https://github.com/anthropics/claude-code) 已安装

### 安装

```bash
# 克隆仓库
git clone https://github.com/rayguo01/viral-x.git
cd web-cc

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
```

### 环境变量

编辑 `.env` 文件：

```env
# 必需
DATABASE_URL=postgresql://user:password@host/dbname?schema=web_cc
JWT_SECRET=your-secret-key

# Twitter OAuth（X 登录和发布）
TWITTER_CLIENT_ID=your-client-id
TWITTER_CLIENT_SECRET=your-client-secret
TWITTER_CALLBACK_URL=https://your-domain.com/api/twitter/callback

# Twitter API（热点抓取）
TWITTER_API_IO_KEY=your-api-key

# AI 配图（可选）
GEMINI_API_KEY=your-gemini-key
```

### 启动

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

访问 http://localhost:3000

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS |
| 后端 | Node.js + Express |
| 实时通信 | WebSocket |
| 数据库 | PostgreSQL (Neon) |
| 认证 | JWT + Twitter OAuth 2.0 |
| AI 能力 | Claude CLI + Gemini API |
| 定时任务 | node-cron |

## 项目结构

```
web-cc/
├── .claude/                # AI Skills 脚本
│   ├── x-trends/           # X 热点抓取
│   ├── tophub-trends/      # 国内热点抓取
│   ├── content-writer/     # 内容生成
│   ├── viral-verification/ # 爆款优化
│   ├── voice-mimicker/     # 写作风格分析
│   └── gemini-image-gen/   # AI 配图
├── public/                 # 前端静态文件
├── src/                    # 后端代码
│   ├── routes/             # API 路由
│   ├── services/           # 业务服务
│   └── server.js           # 入口文件
└── docs/                   # 文档
```

## 部署

### PM2（推荐）

```bash
npm install -g pm2
pm2 start src/server.js --name viral-x
pm2 save
```

### Docker

```bash
docker build -t viral-x .
docker run -p 3000:3000 --env-file .env viral-x
```

详细部署指南请参考 [启动说明](docs/启动说明.md)

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 许可证

[MIT License](LICENSE)

---

<a name="english"></a>

# Viral-X (English)

**AI-Powered Viral Content Generator for X Platform**

From trend tracking to one-click publishing, create your first viral post in 10 minutes.

## Features

- **Real-time Trend Tracking** - Auto-fetch trends from X and Chinese platforms, hourly updates
- **AI Content Generation** - High-quality posts based on proven methodology
- **Viral Optimization** - AI scoring and suggestions to boost viral potential
- **Writing Style Mimicry** - Analyze influencer styles and generate matching content
- **AI Image Generation** - Gemini-powered images matching your content
- **One-Click Publishing** - Direct posting to X via OAuth

## Demo

### Workflow

```
Select Topic → Generate Content → Viral Optimization → Generate Image → Publish
```

### Screenshots

#### Landing Page
![Landing](docs/screenshots/landing.png)

#### Workflow
![Workflow](docs/screenshots/workflow.png)

#### Topic Selection
![Topic](docs/screenshots/topic.png)

#### Content Generation & Style Selection
![Content](docs/screenshots/content.png)

## Quick Start

### Prerequisites

- Node.js >= 18
- PostgreSQL database (recommend [Neon](https://neon.tech))
- [Claude CLI](https://github.com/anthropics/claude-code) installed

### Installation

```bash
# Clone
git clone https://github.com/rayguo01/viral-x.git
cd viral-x

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

### Environment Variables

Edit `.env` file:

```env
# Required
DATABASE_URL=postgresql://user:password@host/dbname?schema=web_cc
JWT_SECRET=your-secret-key

# Twitter OAuth (X login and publishing)
TWITTER_CLIENT_ID=your-client-id
TWITTER_CLIENT_SECRET=your-client-secret
TWITTER_CALLBACK_URL=https://your-domain.com/api/twitter/callback

# Twitter API (trend fetching)
TWITTER_API_IO_KEY=your-api-key

# AI Image Generation (optional)
GEMINI_API_KEY=your-gemini-key
```

### Run

```bash
# Development mode
npm run dev

# Production mode
npm start
```

Visit http://localhost:3000

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5 + CSS3 + Vanilla JS |
| Backend | Node.js + Express |
| Real-time | WebSocket |
| Database | PostgreSQL (Neon) |
| Auth | JWT + Twitter OAuth 2.0 |
| AI | Claude CLI + Gemini API |
| Scheduling | node-cron |

## Project Structure

```
viral-x/
├── .claude/                # AI Skills scripts
│   ├── x-trends/           # X trend fetching
│   ├── tophub-trends/      # Chinese trend fetching
│   ├── content-writer/     # Content generation
│   ├── viral-verification/ # Viral optimization
│   ├── voice-mimicker/     # Writing style analysis
│   └── gemini-image-gen/   # AI image generation
├── public/                 # Frontend static files
├── src/                    # Backend code
│   ├── routes/             # API routes
│   ├── services/           # Business services
│   └── server.js           # Entry point
└── docs/                   # Documentation
```

## Deployment

### PM2 (Recommended)

```bash
npm install -g pm2
pm2 start src/server.js --name viral-x
pm2 save
```

### Docker

```bash
docker build -t viral-x .
docker run -p 3000:3000 --env-file .env viral-x
```

## Contributing

PRs are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)

---

<div align="center">

Made with Claude Code

</div>

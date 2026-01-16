# 贡献指南 | Contributing Guide

感谢你对 Viral-X 的关注！我们欢迎任何形式的贡献。

Thank you for your interest in Viral-X! We welcome contributions of all kinds.

---

## 如何贡献 | How to Contribute

### 报告问题 | Reporting Issues

如果你发现了 bug 或有功能建议，请：

1. 先搜索 [现有 Issues](https://github.com/anthropics/claude-code/issues) 确认没有重复
2. 创建新 Issue，包含以下信息：
   - 清晰的标题和描述
   - 复现步骤（如果是 bug）
   - 期望行为 vs 实际行为
   - 环境信息（Node.js 版本、操作系统等）

### 提交代码 | Submitting Code

1. **Fork 仓库**
   ```bash
   git clone https://github.com/YOUR_USERNAME/web-cc.git
   cd web-cc
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

3. **开发和测试**
   ```bash
   npm install
   npm run dev
   ```

4. **提交更改**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **推送并创建 PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   然后在 GitHub 上创建 Pull Request

### Commit 规范 | Commit Convention

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构 |
| `test` | 测试相关 |
| `chore` | 构建/工具相关 |

示例：
```
feat: add voice style market feature
fix: resolve Twitter OAuth callback issue
docs: update README with new screenshots
```

---

## 开发指南 | Development Guide

### 项目结构

```
web-cc/
├── .claude/          # AI Skills（TypeScript）
├── public/           # 前端静态文件
├── src/              # 后端代码
│   ├── routes/       # API 路由
│   ├── services/     # 业务逻辑
│   └── server.js     # 入口
└── docs/             # 文档
```

### 技术栈

- 后端：Node.js + Express
- 前端：原生 HTML/CSS/JavaScript
- 数据库：PostgreSQL
- AI：Claude CLI + Gemini API

### 代码风格

- 使用 4 空格缩进
- 使用单引号
- 添加必要的注释
- 保持函数简洁

---

## 社区准则 | Code of Conduct

- 尊重他人
- 保持友善和建设性的讨论
- 欢迎新手，耐心解答问题

---

## 联系方式 | Contact

- GitHub Issues: 技术问题和功能建议
- X/Twitter: [@anthropics](https://x.com/anthropics)

感谢你的贡献！

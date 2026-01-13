# Web Claude Code 项目概要

## 版本: v2.9.9

## 完成的工作

### 3.29 修复 domain-trends 预设检测 (v2.9.9)

**问题**：`getDomainPresets()` 过滤掉了所有 `-kol-groups.json` 文件，但缺少主预设文件（`web3.json`、`ai.json`），导致返回空数组，domain-trends 从不执行。

**解决方案**：创建主预设配置文件。

**新增文件**：

| 文件 | 说明 |
|------|------|
| `.claude/domain-trends/presets/web3.json` | Web3 预设配置 |
| `.claude/domain-trends/presets/ai.json` | AI 预设配置 |

---

### 3.28 修复分析阶段 JSON 传参问题 (v2.9.8)

**问题**：调度器通过命令行参数传递 JSON 数据给分析脚本，但使用 `shell: true` 时 Shell 会解释特殊字符（如 `#`、`&`），导致 JSON 被破坏，解析失败。

**解决方案**：改用临时文件传递数据，新增 `analyze-file` 模式。

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/services/scheduler.js` | `analyzeSkillData()` 改用 `analyze-file` 模式传递临时文件路径 |
| `.claude/x-trends/x-trends.ts` | 新增 `analyze-file` 模式从文件读取 JSON |
| `.claude/tophub-trends/tophub.ts` | 新增 `analyze-file` 模式从文件读取 JSON |

**命令行用法更新**：

```bash
# 旧方式（有 shell 转义问题）
npx ts-node x-trends.ts analyze '{"data": "..."}'

# 新方式（推荐）
npx ts-node x-trends.ts analyze-file /path/to/data.json
```

---

### 3.27 首页添加 X领域趋势入口 (v2.9.7)

**功能概述**：在首页"开始创作"页面添加 X领域趋势数据源入口，与趋势页面 Tab 保持一致。

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `public/js/generator/pages/home.js` | 添加"X领域趋势"数据源卡片 |
| `public/js/generator/pages/trends.js` | Tab 名称更新为"X领域趋势" |

**UI 变更**：

- 首页新增第三个数据源选项卡片："X领域趋势"
- 趋势页面 Tab 标签从"领域趋势"更新为"X领域趋势"
- 用户现在可以从首页直接选择进入特定领域（Web3、AI 等）的 X 热点追踪

---

### 3.26 趋势数据数据库存储 + 分析去重 (v2.9.6)

**功能概述**：将热门趋势的原始数据和分析结果保存到数据库，避免同一时间周期内重复调用 Claude CLI 分析。

**核心改进**：

1. **两阶段执行**：
   - 抓取阶段：仅获取原始趋势数据（不调用 Claude）
   - 分析阶段：检查数据库，如已有结果则跳过分析

2. **数据库存储**：
   - 新增 `trends_data` 表存储原始数据和分析结果
   - 支持按 hourKey 查询历史数据
   - 自动清理 24 小时前的过期数据

3. **分析去重**：
   - 同一小时内多次触发只执行一次 Claude 分析
   - 支持并发保护，防止重复分析

**新增数据库表**：

```sql
CREATE TABLE trends_data (
    id SERIAL PRIMARY KEY,
    skill_id VARCHAR(100) NOT NULL,      -- 'x-trends', 'tophub-trends'
    hour_key VARCHAR(20) NOT NULL,        -- '2026-01-14-16'
    raw_data JSONB,                       -- 原始趋势数据
    analysis_result JSONB,                -- Claude 分析结果
    analysis_status VARCHAR(20),          -- 'pending', 'analyzing', 'completed', 'failed'
    error_message TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(skill_id, hour_key)
);
```

**新增文件**：

| 文件 | 说明 |
|------|------|
| `src/services/trendsDb.js` | 趋势数据数据库服务 |

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/config/database.js` | 添加 `trends_data` 表初始化 |
| `src/services/scheduler.js` | 添加两阶段执行方法，集成 trendsDb 服务 |
| `.claude/x-trends/x-trends.ts` | 添加 `fetchOnly()` 和 `analyzeOnly()` 函数，支持 fetch/analyze 命令行参数 |
| `.claude/tophub-trends/tophub.ts` | 添加 `fetchOnly()` 和 `analyzeOnly()` 函数，支持 fetch/analyze 命令行参数 |

**执行流程**：

```
调度器触发
    ↓
检查数据库 (trendsDb.getByHourKey)
    ↓
已有分析结果? → 跳过抓取和分析，直接返回
    ↓ 否
已有原始数据? → 跳过抓取，直接分析
    ↓ 否
执行 fetchOnly() → 保存原始数据到数据库
    ↓
再次检查分析状态（防并发）
    ↓
执行 analyzeOnly() → 保存分析结果到数据库
    ↓
更新 skillCache
```

**命令行用法**：

```bash
# 完整流程
npx ts-node x-trends.ts

# 仅抓取
npx ts-node x-trends.ts fetch

# 仅分析（需要JSON数据）
npx ts-node x-trends.ts analyze '[{"rank":1,"name":"话题1",...}]'
```

---

### 3.25 Web3 轮换模式 + AI KOL 优化 (v2.9.5)

**功能概述**：将 Web3 领域也转换为 KOL 分组轮换抓取模式，同时优化 AI KOL 列表。

**Web3 轮换配置**：
- 新增 `.claude/domain-trends/presets/web3-kol-groups.json`
- 100 个 Web3 KOL 分成 10 组
- 每组 10 人，包含不同领域（创始人、交易员、NFT、DeFi 等）
- 每 2 小时轮换一组，20 小时覆盖全部 100 人

**AI KOL 列表优化**：
- 移除 Elon Musk（发帖内容与 AI 领域相关度较低）
- 调整排名，将 Dario Amodei 升至 Tier 1
- 修正部分 Twitter handle（如 gdb, davidsholz, clem_delangue 等）
- 更新 `docs/ai-kols-100.md`

**新增文件**：

| 文件 | 说明 |
|------|------|
| `.claude/domain-trends/presets/web3-kol-groups.json` | Web3 领域 100 KOL 分组配置 |

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `docs/ai-kols-100.md` | 移除 Elon Musk，调整排名和 handle |

---

### 3.24 KOL 分组轮换抓取模式 (v2.9.4)

**功能概述**：支持将 100 个 KOL 分成 10 组，每 2 小时轮换抓取一组，20 小时覆盖全部 KOL。每组包含不同 Tier 的人，确保数据多样性。

**设计方案**：

| 特性 | 说明 |
|------|------|
| 分组数量 | 10 组，每组 10 人 |
| 轮换间隔 | 2 小时 |
| 完整周期 | 20 小时覆盖全部 100 人 |
| 分组策略 | 每组包含不同 Tier 的 KOL |

**调度规则**：
```
0:00 → 组0, 2:00 → 组1, 4:00 → 组2, ...
18:00 → 组9, 20:00 → 组0 (循环)
```

**新增文件**：

| 文件 | 说明 |
|------|------|
| `.claude/domain-trends/presets/ai-kol-groups.json` | AI 领域 100 KOL 分组配置 |
| `docs/ai-kols-100.md` | AI 领域 100 位推特大V 列表 |

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `.claude/domain-trends/types.ts` | 新增 `KolGroup` 和 `GroupRotationConfig` 类型 |
| `.claude/domain-trends/domain-trends.ts` | 新增 `loadGroupConfig()`, `getCurrentGroup()`, `fetchGroupTweets()`, `runWithRotation()` 函数 |
| `src/services/scheduler.js` | 支持轮换模式调度，每 2 小时检查并抓取当前组 |

**运行模式**：
```bash
# 传统模式（10个KOL，每8小时）
npx ts-node domain-trends.ts standard web3

# 轮换模式（100个KOL分10组，每2小时轮换）
npx ts-node domain-trends.ts rotation ai
```

**缓存策略**：
- 轮换模式缓存 key 格式：`domain-trends:ai:group0`, `domain-trends:ai:group1`, ...
- 每组缓存独立存储，2 小时窗口内有效

**月成本估算**（轮换模式）：
- 每组 10 人 × 5 条/人 = 50 条推文
- 每天 12 次抓取 × 50 条 = 600 条
- 每月 600 × 30 = 18,000 条
- 成本：约 **$2.7/月**

---

### 3.23 domain-trends 关键词搜索可配置禁用 (v2.9.3)

**功能概述**：支持通过配置禁用关键词搜索，只使用 KOL 监控模式，减少 API 调用成本。

**配置示例**：
```json
{
  "query": {
    "enabled": false,  // 禁用关键词搜索
    ...
  },
  "kols": {
    "enabled": true,
    "accounts": ["VitalikButerin", "punk6529", ...]
  }
}
```

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `.claude/domain-trends/types.ts` | query 接口添加 `enabled?: boolean` 字段 |
| `.claude/domain-trends/domain-trends.ts` | `fetchTweets()` 检查 `query.enabled` 配置，禁用时跳过搜索 |
| `.claude/domain-trends/presets/web3.json` | 设置 `query.enabled: false`，只监控 10 个核心 KOL |

**效果**：
- 当 `query.enabled: false` 时，跳过关键词搜索，只抓取 KOL 推文
- 减少 API 调用次数，节省成本
- 日志显示 `⏭️ 关键词搜索已禁用，跳过`

---

### 3.22 domain-trends API 修复和聚合逻辑优化 (v2.9.2)

**功能概述**：修复 domain-trends 的 Twitter API 问题，优化推文聚合逻辑。

**问题与修复**：

| 问题 | 原因 | 修复 |
|------|------|------|
| API 405 Method Not Allowed | twitterapi.io 使用 GET 而非 POST | 改为 GET + URLSearchParams |
| API 429 Too Many Requests | 免费用户限制 5 秒/请求 | 增加延迟到 5500ms |
| KOL 推文返回 0 条 | API 响应结构不同 `data.data.tweets` | 修复响应解析逻辑 |
| 搜索推文全被过滤 | minLikes/minRetweets 门槛太高 | 降低门槛 100 → 20 |
| 聚合话题数为 0 | 推文大多没有 hashtag | 添加 fallback 按 KOL 作者聚合 |
| 缓存文件名含冒号 | Windows 不支持冒号 | 替换为下划线 |

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `.claude/domain-trends/twitter-api-client.ts` | GET 方法、5500ms 延迟、响应结构解析修复 |
| `.claude/domain-trends/domain-trends.ts` | 聚合逻辑：hashtag → KOL 作者 → 全部推文 |
| `.claude/domain-trends/presets/*.json` | minLikes: 100 → 20 |
| `src/services/skillCache.js` | 文件名冒号替换为下划线 |

**聚合逻辑优先级**：
1. 按 hashtag 聚合（原有逻辑）
2. 如无 hashtag，按 KOL 作者聚合
3. 如无 KOL 推文，按互动量排序使用全部推文

---

### 3.21 domain-trends 抓取频率调整 (v2.9.1)

**功能概述**：将 domain-trends 的抓取频率从每小时改为每8小时，减少 API 调用次数。

**调度策略**：
- x-trends / tophub-trends：每小时第1分钟抓取
- domain-trends：每8小时（0:01, 8:01, 16:01）

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/services/scheduler.js` | 添加 `isDomainTrendsFetchHour()` 和 `isDomainCacheValid()` 方法，修改 `fetchAllTrends()` 条件判断 |
| `src/services/skillCache.js` | 添加 `getDomainTrendsHours()` 方法，修改 `getAvailableHours()` 返回8小时间隔，修改 `cleanupOldData()` 保留固定时间点 |
| `public/js/generator/pages/trends.js` | 修改 `showWaitingMessage()` 显示不同的抓取频率提示 |

**缓存策略**：
- domain-trends 缓存只保留 0:00, 8:00, 16:00 三个时间点的数据
- 启动时检查8小时窗口内是否有有效缓存
- 前端时间轴只显示最近3个8小时时间点

---

### 3.20 特定领域趋势追踪 (v2.9.0)

**功能概述**：实现可配置的特定领域趋势追踪功能（domain-trends），支持追踪 Web3、AI、Gaming 等垂直领域的热点。

**核心特性**：

1. **多领域预设**：
   - 🌐 Web3：加密货币、NFT、DeFi、区块链热点
   - 🤖 AI：人工智能、机器学习、大模型动态
   - 🎮 Gaming：游戏、电竞、游戏开发趋势

2. **数据源**：[twitterapi.io](https://twitterapi.io/) API
   - 关键词搜索：按配置的关键词和话题标签搜索推文
   - KOL 监控：追踪领域内关键意见领袖的推文
   - 智能过滤：最低互动量过滤、排除转发

3. **定时抓取**：
   - 每8小时抓取一次（0:01, 8:01, 16:01）
   - 与 x-trends/tophub-trends 独立调度
   - 用户只读缓存，不触发抓取
   - 前端时间轴显示最近3个时间点

4. **前端集成**：
   - 热帖抓取页新增"🎯 领域趋势"Tab
   - 预设选择器：点击切换不同领域
   - 复用现有时间轴和数据展示组件

**新增文件**：

| 文件 | 说明 |
|------|------|
| `.claude/domain-trends/domain-trends.ts` | 主执行脚本 |
| `.claude/domain-trends/twitter-api-client.ts` | twitterapi.io API 客户端 |
| `.claude/domain-trends/types.ts` | TypeScript 类型定义 |
| `.claude/domain-trends/presets/web3.json` | Web3 领域配置 |
| `.claude/domain-trends/presets/ai.json` | AI 领域配置 |
| `.claude/domain-trends/presets/gaming.json` | Gaming 领域配置 |

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/routes/skills.js` | 添加 domain-trends 预设 API、缓存 key 支持 |
| `src/services/scheduler.js` | 添加 domain-trends 定时抓取任务 |
| `public/js/generator/pages/trends.js` | 添加领域趋势 Tab、预设选择器 |
| `public/css/generator.css` | 添加预设选择器样式 |

**环境变量**：

```env
TWITTER_API_IO_KEY=your_api_key_here
```

**API 端点**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills/domain-trends/presets` | 获取预设列表 |
| GET | `/api/skills/domain-trends:preset/hours` | 获取可用小时列表 |
| GET | `/api/skills/domain-trends:preset/cached/:hourKey` | 获取指定小时数据 |

---

### 3.19 选题链接功能 (v2.8.3)

**功能概述**：为所有选题建议添加可点击的链接，方便用户直接查看原帖。

**功能特性**：

1. **X-Trends 链接**：使用 X 搜索 URL 格式（`https://x.com/search?q=话题名称`）
2. **TopHub 链接**：使用原始文章链接
3. **链接显示**：在话题标题下方显示"🔗 查看原帖"按钮
4. **交互优化**：点击链接不会触发话题选择，链接在新标签页打开

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `.claude/x-trends/x-trends.ts` | JSON_SCHEMA 添加 `url` 字段 |
| `.claude/tophub-trends/tophub.ts` | JSON_SCHEMA 添加 `link` 字段 |
| `public/js/generator/pages/trends.js` | `parseTopicsFromJSON` 提取链接，`renderTopicItem` 显示链接按钮 |
| `public/css/generator.css` | 添加 `.topic-link`, `.topic-link-btn` 样式 |

---

### 3.18 热帖历史数据查看功能 (v2.8.2)

**功能概述**：支持查看过去12小时的热帖抓取历史数据，通过时间轴快速切换不同时间点的数据。

**功能特性**：

1. **12小时历史数据存储**：
   - 后端按小时存储热帖数据
   - 自动清理超过12小时的旧数据
   - 数据持久化到磁盘，服务重启后恢复

2. **时间轴UI**：
   - 页面顶部显示过去12小时的时间按钮
   - 有数据的时间点可点击切换
   - 当前小时标记为"当前"
   - 无数据的时间点显示为灰色禁用状态

3. **移除缓存提示**：
   - 移除"📦 数据来自缓存（每小时更新一次）"提示
   - 用户通过时间轴直观了解数据时间

**新增 API**：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/skills/:skillId/hours` | GET | 获取可用小时列表 |
| `/api/skills/:skillId/cached/:hourKey` | GET | 获取指定小时的数据 |

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/services/skillCache.js` | 重构为按小时存储，添加 `getByHour`, `getAvailableHours` 方法 |
| `src/routes/skills.js` | 新增按小时获取数据的 API |
| `public/js/generator/pages/trends.js` | 添加时间轴UI，按小时加载数据 |
| `public/css/generator.css` | 添加时间轴样式 |

---

### 3.17 合并高潜力话题分析和选题建议 (v2.8.1)

**功能概述**：将 x-trends 和 tophub-trends 的"高潜力话题分析"与"选题建议"合并为统一的 `suggestions` 数组，简化数据结构并提升用户体验。

**改进内容**：

1. **统一的 suggestions 结构**：
   - 合并原 `highPotentialTopics` 和 `suggestions` 为一个数组
   - 每个话题项现在包含完整信息：评分、原因、选题角度、创作方向

2. **新的 JSON Schema**：
```json
{
  "suggestions": [
    {
      "rank": 1,
      "topic": "话题名称",
      "source": "来源平台（仅 tophub）",
      "score": "潜力评分（高/中/低）",
      "reason": "为什么有潜力",
      "angle": "选题角度/标题建议",
      "whyEffective": "为什么这个选题角度有效",
      "directions": ["创作方向1", "创作方向2"]
    }
  ]
}
```

3. **前端更新**：
   - 移除独立的"高潜力话题分析"区块
   - 话题卡片直接显示评分徽章（高/中/低）
   - 增加来源平台标签（仅 TopHub）
   - 增加"潜力分析"字段显示

**修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `.claude/x-trends/x-trends.ts` | 更新 JSON Schema 和 Prompt |
| `.claude/tophub-trends/tophub.ts` | 更新 JSON Schema 和 Prompt |
| `public/js/generator/pages/trends.js` | 更新解析逻辑和渲染模板 |
| `public/css/generator.css` | 添加评分徽章和来源标签样式 |

---

### 3.16 健壮 JSON 解析重构 (v2.8.0)

**功能概述**：基于 `engine.go` 的最佳实践，重构所有 Skill 的 JSON 解析逻辑，大幅提高 LLM 输出解析的稳定性。

**核心改进**：

1. **XML 标签包裹**：要求 LLM 使用 `<reasoning>` 和 `<result>` 标签分隔思维链和 JSON 输出，避免思维链中的文字干扰 JSON 解析。

2. **多层回退 JSON 提取**：
   - 层级1：从 `<result>` 标签提取
   - 层级2：从 `<json>` 标签提取
   - 层级3：从 `<decision>` 标签提取
   - 层级4：从 ` ```json ` 代码块提取
   - 层级5：直接匹配 JSON 对象 `{...}`
   - 层级6：直接匹配 JSON 数组 `[...]`

3. **全角字符自动修复**：自动将中文全角字符转换为半角，包括：
   - 中文引号：`"` `"` `'` `'` → `"` `'`
   - 全角括号：`［` `］` `｛` `｝` → `[` `]` `{` `}`
   - 全角标点：`：` `，` `、` → `:` `,` `,`
   - CJK 括号：`【` `】` `〔` `〕` → `[` `]`
   - 全角空格：`　` → ` `

4. **格式验证**：
   - 检查 JSON 是否以 `{` 或 `[` 开头
   - 检查是否包含非法范围符号 `~`
   - 检查是否包含千位分隔符 `98,000`

5. **零宽字符清理**：自动移除 BOM 和零宽字符 (U+200B, U+200C, U+200D, U+FEFF)

**新增文件**：

| 文件 | 说明 |
|------|------|
| `.claude/utils/json-parser.ts` | 共享 JSON 解析工具模块 |

**修改的 Skill 文件**：

| Skill | 文件 | 修改内容 |
|-------|------|----------|
| content-writer | `content-writer.ts` | 使用 `parseRobustJSON`，prompt 添加 XML 标签格式说明 |
| viral-verification | `viral-verification.ts` | 使用 `parseRobustJSON`，prompt 添加 XML 标签格式说明 |
| prompt-generator | `prompt-generator.ts` | 使用 `parseRobustJSON`，prompt 添加 XML 标签格式说明 |
| image-search | `image-search.ts` | 使用 `parseRobustJSON`，prompt 添加 XML 标签格式说明 |
| x-trends | `x-trends.ts` | 使用 `parseRobustJSON`，prompt 添加 XML 标签格式说明 |
| tophub-trends | `tophub.ts` | 使用 `parseRobustJSON`，prompt 添加 XML 标签格式说明 |

**json-parser.ts 导出的函数**：

| 函数 | 说明 |
|------|------|
| `removeInvisibleRunes(s)` | 移除零宽字符和 BOM |
| `fixFullWidthChars(s)` | 修复全角字符 |
| `validateJSONFormat(s)` | 验证 JSON 格式 |
| `extractFromXmlTag(s, tag)` | 从 XML 标签提取内容 |
| `extractReasoning(s)` | 提取思维链 |
| `extractJSON(s)` | 多层回退 JSON 提取 |
| `parseRobustJSON<T>(s, validator?)` | 主解析函数，支持自定义验证器 |
| `generateXMLOutputInstructions(schema)` | 生成 XML 格式输出说明 |
| `generateSimpleOutputInstructions(schema)` | 生成简化输出说明 |

**Prompt 格式模板**：
```
**必须使用 XML 标签分隔思维过程和 JSON 结果，避免解析错误**

## 格式要求

<reasoning>
你的思维过程分析...
</reasoning>

<result>
{ ... JSON 内容 ... }
</result>

## 注意事项
1. <result> 标签内必须是合法的 JSON 格式
2. 内容中的换行使用 \\n 表示
3. 内容中的双引号使用 \\" 转义
4. 不要在 <result> 标签内添加 markdown 代码块
5. 所有标点符号必须使用英文半角字符
```

---

### 3.15 Twitter OAuth 2.0 集成 (v2.7.0)

**功能概述**：集成 Twitter OAuth 2.0 认证，支持用户授权后直接通过应用发布推文到 X 平台。

**核心功能**：
- 用户通过 OAuth 2.0 授权连接 Twitter 账号
- 支持代表用户发布推文（文字 + 可选图片）
- 自动刷新过期的 access token
- 断开 Twitter 连接功能

**技术实现**：

| 文件 | 说明 |
|------|------|
| `src/routes/twitter.js` | Twitter OAuth 路由（授权、回调、发推、状态查询） |
| `src/config/database.js` | 新增 `twitter_credentials` 表存储用户 token |
| `src/server.js` | 注册 `/api/twitter` 路由 |
| `.env.example` | 添加 Twitter OAuth 配置项 |

**API 端点**：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/twitter/auth | 获取 OAuth 授权 URL |
| GET | /api/twitter/callback | OAuth 回调处理 |
| GET | /api/twitter/status | 查询 Twitter 连接状态 |
| DELETE | /api/twitter/disconnect | 断开 Twitter 连接 |
| POST | /api/twitter/tweet | 发布推文 |

**数据库表结构**：
```sql
CREATE TABLE twitter_credentials (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    twitter_user_id VARCHAR(100),
    twitter_username VARCHAR(100),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**OAuth 2.0 流程**：
1. 前端调用 `/api/twitter/auth` 获取授权 URL
2. 用户跳转到 Twitter 授权页面
3. 授权后回调到 `/api/twitter/callback`
4. 后端交换 code 获取 access_token 并存储
5. 前端可调用 `/api/twitter/tweet` 发布推文

**安全特性**：
- PKCE (Proof Key for Code Exchange) 防止授权码拦截攻击
- State 参数防止 CSRF 攻击
- Token 自动刷新机制

**环境变量配置**：
```env
TWITTER_CLIENT_ID=你的Client_ID
TWITTER_CLIENT_SECRET=你的Client_Secret
TWITTER_CALLBACK_URL=http://localhost:3000/api/twitter/callback
```

**两种使用模式**：

| 模式 | 说明 | API |
|------|------|-----|
| Twitter 登录 | 用户直接用 Twitter 账号登录，无需注册 | `/api/twitter/login` |
| Twitter 绑定 | 已登录用户绑定 Twitter 账号用于发推 | `/api/twitter/auth` |

**登录页面**：
- 支持用户名密码登录
- 支持「用 Twitter 登录」一键登录
- Twitter 登录自动创建用户账号

**提交页面**：

| 状态 | 显示内容 |
|------|----------|
| 未连接 | 显示「连接 Twitter」按钮 |
| 已连接 | 显示 @用户名、「发布到 X」按钮、「断开连接」按钮 |
| 发布成功 | 显示成功提示和「查看推文」链接 |

**修改的文件**：
- `src/routes/twitter.js` - 添加登录模式支持
- `src/config/database.js` - users 表添加 twitter_id、avatar_url 字段
- `public/index.html` - 登录页添加 Twitter 登录按钮
- `public/js/app.js` - 处理 Twitter 登录回调
- `public/js/generator/index.js` - 添加 Twitter API 方法
- `public/js/generator/pages/submit.js` - 添加 Twitter 连接和发布 UI
- `public/css/style.css` - 添加登录页 Twitter 按钮样式
- `public/css/generator.css` - 添加提交页 Twitter 相关样式

---

### 3.14 编辑框自动高度调整 (v2.6.1)

**功能概述**：编辑推文的 textarea 自动调整高度以适应内容长度，用户无需滚动即可看到全文。

**修改的页面**：
- `content.js` - 创作素材编辑框、生成结果编辑框
- `optimize.js` - 优化后版本编辑框

**技术实现**：

| 文件 | 修改内容 |
|------|----------|
| `public/js/generator/pages/content.js` | 添加 `autoResizeTextarea()` 方法，绑定到 `#input-text` 和 `#content-input` |
| `public/js/generator/pages/optimize.js` | 添加 `autoResizeTextarea()` 方法，绑定到 `#optimized-input`，Tab 切换时重新调整 |
| `public/css/generator.css` | `.content-textarea` 设置 `resize: none` 和 `overflow: hidden` |

**工作原理**：
1. textarea 加载时自动调整高度
2. 用户输入时实时调整高度
3. 最小高度：创作素材 300px，其他 200px
4. 禁用手动拖拽调整和滚动条

---

### 3.13 图片生成流程拆分 (v2.6.0)

**功能概述**：将原来的"生成图片"步骤拆分为两个独立步骤，让用户可以先预览和编辑 Prompt，再决定是否生成图片。

**新工作流程**：
```
热帖抓取 → 生成内容 → 优化内容 → 图片描述 → 生成图片 → 提交发布
(必选)     (必选)     (可跳过)   (可跳过)   (可跳过)   (展示)
```

**新增步骤**：
| 步骤 | 名称 | 功能 |
|------|------|------|
| prompt | 图片描述 | 生成和编辑图片 Prompt，显示风格/氛围/色调/元素等详情 |
| image | 生成图片 | 使用 Prompt 生成实际图片，支持重新生成 |

**技术实现**：

| 文件 | 修改内容 |
|------|----------|
| `public/js/generator/state.js` | workflowSteps 添加 prompt 步骤 |
| `public/js/generator/pages/prompt.js` | 新增 Prompt 页面组件 |
| `public/js/generator/pages/image.js` | 简化为纯图片生成，从 prompt_data 获取描述 |
| `public/js/generator/index.js` | 注册 PromptPage |
| `public/index.html` | 添加 prompt.js 脚本引用 |
| `src/routes/tasks.js` | 添加 prompt 步骤支持、savePrompt/updatePromptData action |
| `src/config/database.js` | 添加 prompt_data JSONB 列 |

**Prompt 页面功能**：
- 自动从优化内容生成图片描述 Prompt
- 显示生成的 Prompt 详情（风格、氛围、色调、视觉元素）
- 支持手动编辑 Prompt
- 支持重新生成
- 自动保存到数据库

**Image 页面简化**：
- 只负责图片生成，不再生成 Prompt
- 从 task.prompt_data 读取 Prompt
- 返回上一步跳转到 prompt 而非 optimize

---

### 3.12 创作方向多条显示修复 (v2.5.0)

**问题**：选题建议中的"创作方向"只显示一条，应该显示多条。

**原因**：JSON Schema 中 `direction` 定义为单个字符串，应改为数组。

**修复**：
- 修改 `.claude/x-trends/x-trends.ts` 和 `.claude/tophub-trends/tophub.ts`
- 将 `direction` 改为 `directions` 数组格式
- 前端 `trends.js` 和 `content.js` 支持新的数组格式，同时兼容旧格式

---

### 3.11 双主题系统 - 可切换 Light/Dark 主题 (v2.4.0)

**功能概述**：添加主题切换功能，支持清新浅色主题和暗色主题，用户可手动切换并持久化保存偏好。

**两套主题**：

| 主题 | 名称 | 风格 |
|------|------|------|
| Light | Fresh & Clean | 简单清新，蓝绿配色，白色背景 |
| Dark | Cosmic Noir | 深邃宇宙，青紫霓虹，暗色背景 |

**Light 主题配色**：
- 背景：#f8fafc (浅灰白)
- 主色：#0ea5e9 (清新蓝) + #10b981 (薄荷绿)
- 表面：#ffffff (纯白卡片)
- 文字：#0f172a (深灰)

**Dark 主题配色**：
- 背景：#0f172a (深蓝黑)
- 主色：#22d3ee (霓虹青) + #a78bfa (淡紫)
- 表面：rgba(30, 41, 59, 0.8) (半透明)
- 星尘动画背景效果

**技术实现**：

| 文件 | 修改内容 |
|------|----------|
| `public/css/style.css` | 双主题 CSS 变量 (`[data-theme="light"]` / `[data-theme="dark"]`) |
| `public/css/generator.css` | 统一使用 CSS 变量，兼容双主题 |
| `public/index.html` | 添加主题切换按钮、防闪烁脚本 |
| `public/js/app.js` | 主题切换逻辑 + localStorage 持久化 |

**主题切换按钮**：
- 位置：页面右上角固定
- 图标：☀️ (浅色) / 🌙 (深色)
- 点击切换主题，自动保存到 localStorage

**防闪烁机制**：
```html
<script>
    (function() {
        var theme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', theme);
    })();
</script>
```

**字体**：
- Plus Jakarta Sans + Inter (Google Fonts)

---

### 3.9 定时趋势抓取系统 (v2.2.0)

**功能概述**：实现定时自动抓取 X 趋势和 TopHub 数据，用户访问只读缓存，不触发新的抓取操作。

**核心特性**：
- **定时抓取**：每小时第1分钟自动执行 x-trends 和 tophub-trends 抓取
- **纯读取模式**：用户 API 只读取缓存，永不触发新的抓取
- **缓存持久化**：缓存数据保存到磁盘，服务重启后自动恢复
- **首次启动抓取**：服务启动时立即执行一次抓取

**技术实现**：

| 模块 | 文件 | 说明 |
|------|------|------|
| 调度服务 | `src/services/scheduler.js` | node-cron 定时任务，每小时1分钟执行 |
| 缓存持久化 | `src/services/skillCache.js` | 添加磁盘持久化功能 |
| 只读 API | `src/routes/skills.js` | 新增 `GET /:skillId/cached` 端点 |
| 服务集成 | `src/server.js` | 启动时初始化调度器 |

**API 端点**：
| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/skills/:skillId/cached | 读取趋势缓存（纯读取） |

**缓存目录**：`outputs/.cache/`
- `x-trends.cache.json` - X 趋势缓存
- `tophub-trends.cache.json` - TopHub 缓存

**调度规则**：
- Cron 表达式：`1 * * * *`（每小时第1分钟）
- 时区：Asia/Shanghai
- 并发保护：上一次抓取未完成时跳过本次

---


### 1. 技术方案设计
- 设计了系统架构：浏览器 ↔ WebSocket ↔ Node.js ↔ Claude CLI
- 确定技术栈：Express + WebSocket + PostgreSQL (Neon)
- 设计了数据库表结构（users, sessions, messages）
- 定义了 REST API 和 WebSocket 消息协议

### 2. 后端实现
- `src/server.js` - 主服务器入口
- `src/config/database.js` - 数据库连接和初始化
- `src/routes/auth.js` - 用户注册/登录 API
- `src/routes/sessions.js` - 会话管理 API
- `src/services/claude.js` - Claude CLI 调用服务
- `src/websocket/handler.js` - WebSocket 消息处理
- `src/middleware/auth.js` - JWT 认证中间件

### 3. 前端实现
- `public/index.html` - 单页应用主页面
- `public/css/style.css` - 清新主题样式（晨曦微风）
- `public/js/app.js` - 前端应用逻辑

### 3.1 前端美化 (v1.1.0)
**设计理念**：「晨曦微风」- 清晨的薄雾、露珠般的透明感、清新自然的色调

**配色方案**：
- 背景：淡绿白渐变 (#f0fdf4 → #ecfeff)
- 主色调：薄荷绿 (#10b981)
- 辅助色：天蓝 (#0ea5e9)
- 表面：毛玻璃白 (rgba(255, 255, 255, 0.85))

**字体**：Quicksand - 圆润、友好、现代的无衬线字体

**视觉特效**：
- 毛玻璃效果 (Glassmorphism)
- 柔和的渐变背景装饰
- 平滑的 CSS 过渡动画
- 消息气泡滑入动画
- 流式输出光标闪烁效果
- 按钮悬浮和光泽效果
- 发送按钮加载旋转动画

**UI 改进**：
- 登录页面居中布局，优化表单设计
- 侧边栏毛玻璃效果
- 会话列表渐变高亮
- 消息气泡圆角设计
- AI 消息带表情图标
- 代码块深色主题
- 响应式设计优化

### 3.2 移动端优化 (v1.2.0)

**响应式断点**：
- 平板 (≤900px)：侧边栏收窄、消息气泡加宽
- 手机 (≤768px)：抽屉式侧边栏、顶部导航栏
- 小屏手机 (≤375px)：紧凑布局
- 横屏模式：特殊适配

**移动端导航**：
- 顶部固定导航栏（汉堡菜单 + 标题 + 新对话按钮）
- 抽屉式侧边栏（85% 宽度，最大 320px）
- 遮罩层点击关闭

**触摸交互优化**：
- 所有可交互元素最小 44px 触摸目标
- 从左边缘右滑打开侧边栏
- 侧边栏内左滑关闭
- 选择会话后自动关闭侧边栏
- 发送消息后自动收起键盘
- 防止 iOS 双击缩放

**安全区域适配**：
- 支持 iPhone X 及以上刘海屏
- 使用 env(safe-area-inset-*) 适配
- 动态视口高度 (100dvh) 适配地址栏

**输入体验**：
- 移动端 Enter 键换行（使用按钮发送）
- 桌面端 Enter 发送，Shift+Enter 换行
- 输入框最小 16px 字体防止 iOS 缩放
- 键盘弹出时自动调整输入区域位置
- 输入框高度自动调整（移动端最大 120px）

**性能优化**：
- 触摸设备禁用 hover 效果
- 使用 requestAnimationFrame 优化滚动
- 平滑滚动到最新消息
- passive 事件监听器

**PWA 准备**：
- 添加 apple-mobile-web-app-capable
- 添加 theme-color
- 禁用电话号码自动检测
- 禁用用户缩放

### 3.3 Claude CLI 服务架构 (v1.4.0)

**架构设计**：每次请求启动新进程，通过 `--resume` 保持会话上下文。

```
用户发消息 → spawn claude -p "消息" --resume <session_id> → 流式输出 → 进程退出
```

**核心组件**：
- `ClaudeService` - Claude CLI 调用服务（单例）

**特性**：
- 简单可靠的进程管理
- 通过 `--resume` 参数恢复会话上下文
- 流式 JSON 输出 (`--output-format stream-json`)
- 2分钟超时保护
- session_id 持久化到数据库

**通信协议**：
```bash
# 命令格式
claude -p "用户消息" --output-format stream-json --resume <session_id>

# 输出 (stdout, 每行一个 JSON)
{"type":"assistant","message":{"content":[{"type":"text","text":"回复"}]},"session_id":"xxx"}
{"type":"result","session_id":"xxx",...}
```

**会话恢复**：
- 每次请求返回 session_id
- session_id 保存到数据库 sessions.claude_session_id
- 下次请求使用 `--resume <session_id>` 恢复上下文

### 3.4 Skill 工具栏 (v1.5.0)

**功能概述**：在主界面添加 Skill 工具栏，支持一键执行预定义的 Skill 分析任务。

**支持的 Skills**：
- **X 趋势分析**: 抓取 trends24.in 的 X(Twitter) 24小时热门趋势，分析前15个热点，生成选题建议报告
- **TopHub 热榜分析**: 抓取 TopHub 热榜数据，分析热门话题，生成内容创作建议

**技术实现**：
- 后端 API: `src/routes/skills.js` - Skill 列表获取和执行 API
- 前端工具栏: 输入框上方的按钮栏，点击即可执行对应 Skill
- 流式输出: 使用 Server-Sent Events (SSE) 实时显示执行进度
- Markdown 渲染: 增强的 Markdown 格式化，支持表格、标题、列表等

**Skill 目录结构**：
```
.claude/
├── x-trends/
│   ├── SKILL.md        # Skill 说明文档
│   └── x-trends.ts     # 趋势抓取和分析脚本
└── tophub-trends/
    ├── SKILL.md
    └── tophub.ts
```

**输出目录**：
- 原始数据: `outputs/trends/x_trends_[timestamp].json`
- 分析报告: `outputs/trends/x_trends_analysis_[timestamp].md`

### 3.5 Skill 缓存机制 (v1.6.0)

**功能概述**：为 Skill 执行结果添加智能缓存，减少重复执行，提升响应速度。

**缓存策略**：
| Skill | 缓存时间 | 说明 |
|-------|----------|------|
| x-trends | 1 小时 | X 趋势每小时更新 |
| tophub-trends | 24 小时 | TopHub 热榜更新较慢 |

**并发控制**：
- 多用户同时请求同一 Skill 时，只执行一次生成
- 后续请求自动等待第一个请求完成
- 所有用户获得相同的缓存结果

**用户交互**：
- **单击按钮**: 使用缓存（如有）
- **长按按钮 (800ms)**: 强制刷新，忽略缓存
- 缓存内容底部显示生成时间和缓存提示

**API 接口**：
```
GET  /api/skills/cache/status     # 获取缓存状态
DELETE /api/skills/cache/:skillId # 清除指定缓存
POST /api/skills/:skillId/execute?refresh=true  # 强制刷新
```

**技术实现**：
- 缓存服务: `src/services/skillCache.js`
- 内存缓存 + TTL 过期机制
- Promise 等待队列处理并发

### 3.6 内容创作 Skill (v1.7.0)

**功能概述**：基于 Defou x Stanley 方法论的内容创作工具，输入素材自动生成三个版本的内容。

**三个版本**：
- **🔥 版本 A (Stanley Style)**：追求极致的点击率和传播度，情绪饱满，金句频出
- **🧠 版本 B (Defou Style)**：侧重底层逻辑拆解和深度认知，提供长期价值
- **🌟 版本 C (Combo Style)**：Defou x Stanley 终极融合版，结合传播节奏与深度内核

**智能评估**：
| 维度 | 说明 |
|------|------|
| 好奇心 | 开篇是否制造认知缺口 |
| 共鸣度 | 是否击中目标用户痛点 |
| 清晰度 | 结构是否清晰易读 |
| 传播值 | 是否具备截图传播潜力 |

**使用方式**：
1. 点击工具栏「内容创作」按钮
2. 在弹窗中输入素材/想法
3. 点击「生成内容」或按 Ctrl+Enter 提交
4. 等待生成三个版本的内容和评估结果

**输出目录**：`outputs/content/content_[timestamp].md`

**文件结构**：
```
.claude/content-writer/
├── SKILL.md           # Skill 说明文档
└── content-writer.ts  # 内容生成脚本
```

### 3.7 爆款验证 Skill (v1.7.2)

**功能概述**：对已生成的文章进行"爆款体检"，评估内容的病毒式传播潜力，并提供优化版本。

**验证的六大爆款要素**：
| 要素 | 说明 |
|------|------|
| 好奇心缺口 | 标题/开头是否制造了让人忍不住点击的冲动 |
| 情绪共鸣 | 是否触发了高唤醒情绪（愤怒、敬畏、喜悦等） |
| 价值/实用性 | 是否值得收藏，提供可执行的价值 |
| 关联性/时效性 | 为什么现在就要看这个 |
| 叙事/节奏 | 节奏是否吸引人，短句、留白、滑梯效应 |
| 反直觉/新颖性 | 是否挑战现状或提供全新视角 |

**输出内容**：
- 六维评分卡 (每项 0-10 分)
- 总体爆款潜力评分 (0-100)
- 深度分析（优点 + 不足）
- 优化策略建议
- 最终优化爆款版本

**使用方式**：
1. 点击工具栏「爆款验证」按钮
2. 在弹窗中粘贴待验证的文章内容
3. 点击「开始验证」或按 Ctrl+Enter 提交
4. 等待生成验证报告和优化版本

**输出目录**：`outputs/viral-verified/verified_[timestamp].md`

**文件结构**：
```
.claude/viral-verification/
├── SKILL.md                 # Skill 说明文档
├── index.ts                 # 原版 (使用 Anthropic SDK)
└── viral-verification.ts    # 适配版 (使用 Claude CLI)
```

### 3.8 X 帖子生成器 (v2.0.0)

**功能概述**：完全替换原有聊天界面，实现可视化的 X 平台帖子创作流程。

**工作流程**：
```
热帖抓取 → 生成内容 → 优化内容 → 图片描述 → 生成图片 → 提交发布
(必选)     (必选)     (可跳过)   (可跳过)   (可跳过)   (展示)
```

**核心功能**：
- **热帖抓取**: Tab 切换查看 X-trends 和 TopHub 热榜，选择创作话题
- **生成内容**: 调用 content-writer 生成版本 C 内容（Defou x Stanley 融合版）
- **优化内容**: 调用 viral-verification 进行爆款验证和优化
- **生成图片**: 调用 prompt-generator 生成图片描述，再调用 gemini-image-gen 生成配图
- **提交发布**: 最终预览、复制内容、保存到历史记录

**技术实现**：

| 模块 | 文件 | 说明 |
|------|------|------|
| 数据库 | `src/config/database.js` | 新增 post_tasks 和 post_history 表 |
| 后端 API | `src/routes/tasks.js` | 任务 CRUD、步骤执行、历史记录 |
| 状态管理 | `public/js/generator/state.js` | 全局状态 + localStorage 持久化 |
| 路由系统 | `public/js/generator/index.js` | Hash 路由 + API 封装 |
| 工作流组件 | `public/js/generator/workflow.js` | 动态进度显示 |
| 页面组件 | `public/js/generator/pages/*.js` | 6 个页面组件 |

**数据库表结构**：
```sql
-- 任务表
CREATE TABLE post_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    status VARCHAR(20),        -- pending, in_progress, completed, abandoned
    current_step VARCHAR(30),  -- trends, content, optimize, image, submit
    workflow_config JSONB,
    trends_data JSONB,
    content_data JSONB,
    optimize_data JSONB,
    image_data JSONB,
    final_content TEXT,
    final_image_path VARCHAR(500),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- 历史记录表
CREATE TABLE post_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    task_id INTEGER REFERENCES post_tasks(id),
    trend_source VARCHAR(30),
    trend_topic VARCHAR(500),
    final_content TEXT,
    final_image_path VARCHAR(500),
    viral_score INTEGER,
    created_at TIMESTAMP
);
```

**API 端点**：
| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/tasks/current | 获取当前进行中任务 |
| POST | /api/tasks | 创建新任务 |
| GET | /api/tasks/:id | 获取任务详情 |
| PUT | /api/tasks/:id | 更新任务 |
| DELETE | /api/tasks/:id | 放弃任务 |
| POST | /api/tasks/:id/execute-step | 执行步骤（SSE） |
| GET | /api/tasks/history | 历史列表 |
| GET | /api/tasks/history/:id | 历史详情 |

**新增 Skill**：
- **prompt-generator**: 根据帖子内容生成 AI 图像描述 prompt

**断连恢复**：
- 任务状态自动持久化到 localStorage
- 页面刷新自动恢复未完成任务
- 服务端验证 + 本地缓存双重保障

**前端路由**：
```
#/           → 首页（流程图 + 数据源选择 + 历史入口）
#/trends     → 热帖抓取页
#/content    → 生成内容页
#/optimize   → 优化内容页
#/prompt     → 图片描述页
#/image      → 生成图片页
#/submit     → 提交页面
#/history    → 历史列表
#/history/:id → 历史详情
```

### 3.8.1 X 趋势页面重构 (v2.1.0)

**功能概述**：重构 X 趋势 Tab 页面，将原始报告解析为结构化的四个分区展示。

**页面结构**：
```
┌─────────────────────────────────────┐
│ 🔥 热点概览                          │
│ 当前热门话题的整体趋势分析            │
├─────────────────────────────────────┤
│ ⭐ 高潜力话题分析                     │
│ 排名 | 话题 | 潜力评分 | 原因         │
├─────────────────────────────────────┤
│ 📂 话题分类                          │
│ 体育赛事 | 娱乐颁奖 | 动漫游戏 | 节日  │
├─────────────────────────────────────┤
│ 💡 选题建议 （点击选择一个话题）        │
│ ┌─────────────────────────────────┐ │
│ │ ① 话题名称                      │ │
│ │   选题角度: ...                 │ │
│ │   为什么有效: ...               │ │
│ │   创作方向:                     │ │
│ │   • 建议1                       │ │
│ │   • 建议2                       │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**技术实现**：

| 方法 | 文件 | 说明 |
|------|------|------|
| `renderXTrendsContent()` | trends.js | X 趋势专用渲染 |
| `parseXTrendsReport()` | trends.js | 解析报告提取各分区 |
| `parseTable()` | trends.js | 解析 Markdown 表格 |
| `parseCategories()` | trends.js | 解析话题分类 |
| `renderHighPotentialTable()` | trends.js | 渲染高潜力话题卡片 |
| `renderCategories()` | trends.js | 渲染分类标签网格 |

**样式新增** (generator.css)：
- `.trends-section` - 分区容器
- `.potential-table` / `.potential-row` - 高潜力话题卡片
- `.categories-grid` / `.category-card` / `.category-tag` - 话题分类网格
- `.topic-header` / `.topic-number` - 选题建议序号样式
- `.topic-field` / `.field-label` / `.field-value` - 字段展示
- `.direction-list` / `.direction-item` - 创作方向列表

**其他修复**：
- 热帖抓取数据缓存 (1小时 TTL)
- 页面滚动问题修复（body overflow 处理）

### 3.8.2 内容生成页流程优化 (v2.1.0)

**功能概述**：优化内容生成页面流程，先展示输入素材让用户编辑，确认后再生成内容。

**新流程**：
```
进入页面 → 展示输入素材（可编辑） → 点击"生成内容" → 生成并展示结果
```

**页面状态**：
1. **编辑状态** (`isEditing = true`)：
   - 显示创作素材输入框
   - 自动从话题信息构建默认输入（话题、选题角度、为什么有效、创作方向）
   - 用户可自由编辑
   - 点击"生成内容"按钮触发生成

2. **结果状态** (`isEditing = false`)：
   - 显示生成的内容（可编辑）
   - 显示评分卡片（好奇心、共鸣度、清晰度、传播值）
   - 显示优化建议
   - 提供"修改输入"和"重新生成"按钮

**技术实现**：

| 文件 | 修改内容 |
|------|----------|
| `pages/content.js` | 新增 `isEditing` 状态、`inputText` 属性、`buildInputText()` 方法 |
| `routes/tasks.js` | content 步骤支持 `rawInput` 参数 |
| `generator.css` | 新增 `.input-section`、`.input-textarea`、`.btn-large` 等样式 |

**输入文本格式**：
```
【话题】#GoldenGlobes

【选题角度】「金球奖最大冷门！这些落选者才是真正的遗珠」

【为什么有效】颁奖典礼天然带有"争议性"，落选者话题比获奖者更容易引发讨论

【创作方向】
- 盘点获奖名单中的意外结果
- 分析"应该获奖却落选"的作品/演员
- 加入投票互动：你认为最大遗珠是谁？
```

### 3.8.3 优化内容页美化展示 (v2.1.0)

**功能概述**：优化内容页面的爆款验证报告展示，将原始 Markdown 解析为结构化的可视化组件。

**页面结构**：
```
┌─────────────────────────────────────┐
│  ┌────┐  78/100                     │
│  │    │  🔥 爆款潜力极高             │
│  └────┘  爆款潜力评分                │
├─────────────────────────────────────┤
│ 📊 六维评分                          │
│ ┌─────────┐ ┌─────────┐             │
│ │好奇心缺口│ │情绪共鸣  │             │
│ │████████ 8│ │█████████ 9│           │
│ └─────────┘ └─────────┘             │
├─────────────────────────────────────┤
│ 🔍 深度分析                          │
│ ┌─────────┐ ┌─────────┐             │
│ │✅ 优点   │ │❌ 待改进 │             │
│ │• 数据开场│ │• 开头钩子│             │
│ └─────────┘ └─────────┘             │
├─────────────────────────────────────┤
│ 💡 优化策略                          │
│ ① 标题修正：增加反差感               │
│ ② 开头钩子：制造认知颠覆             │
├─────────────────────────────────────┤
│ 🚀 最终优化版本                      │
│ [可编辑的文本框]                     │
│ 📝 优化说明                          │
└─────────────────────────────────────┘
```

**解析的报告部分**：
| 部分 | 说明 |
|------|------|
| 总分卡片 | 圆形分数显示 + 评级标签（高/中/低） |
| 六维评分 | 进度条 + 分数 + 评价 |
| 深度分析 | 优点/待改进双栏卡片 |
| 优化策略 | 编号列表 |
| 优化版本 | 可编辑文本框 |
| 优化说明 | 高亮提示框 |

**技术实现**：

| 方法 | 说明 |
|------|------|
| `parseReport()` | 解析六维评分表格、优点、不足、策略、优化说明 |
| `renderTotalScore()` | 渲染总分圆形卡片 |
| `renderScoreCard()` | 渲染六维评分网格 |
| `renderAnalysis()` | 渲染深度分析双栏 |
| `renderStrategies()` | 渲染优化策略列表 |
| `renderOptimizationNotes()` | 渲染优化说明提示框 |

**样式新增** (generator.css)：
- `.total-score-card` - 总分卡片（带评级颜色）
- `.score-grid` / `.score-item-card` - 六维评分网格
- `.score-item-bar` / `.score-item-fill` - 评分进度条
- `.analysis-grid` / `.analysis-card` - 深度分析卡片
- `.strategies-list` / `.strategy-item` - 优化策略列表
- `.optimization-notes` - 优化说明提示框
- `.version-compare-section` - 版本对比区域
- `.version-tabs` / `.version-tab` - 版本切换 Tab
- `.version-pane` / `.original-content` - 版本内容面板

**版本对比 Tab**：
```
┌─────────────────────────────────────┐
│ [🚀 优化后版本] [📝 优化前版本]      │ ← Tab 切换
├─────────────────────────────────────┤
│ 优化后版本（可编辑）                 │
│ [文本框]                            │
│ 📝 优化说明                         │
└─────────────────────────────────────┘
```

**修复内容**：
- 修复六维评分表格解析（正确过滤表头和分隔行）
- 修复总分提取正则（支持 `**🔥 总体爆款潜力评分**: 78/100` 格式，处理 emoji 和 markdown 加粗）
- 修复优化版本提取（从标题到优化说明之间的内容）
- 修复优化说明提取（支持 "优化说明" 和 "优化要点说明" 两种表述）
- 添加备用正则匹配，增强解析鲁棒性

### 3.8.4 中间数据自动保存 (v2.1.1)

**功能概述**：在各步骤生成完成后自动保存数据到数据库，确保刷新页面后不丢失进度。

**保存时机**：

| 步骤 | 触发时机 | 保存数据 |
|------|----------|----------|
| 优化内容 | 爆款验证完成后 | optimizedVersion, viralScore, rawReport |
| 生成图片 | Prompt 生成后 | prompt, ratio |
| 生成图片 | 图片生成后 | prompt, ratio, imagePath |

**后端新增 API action**：
- `updateOptimizeData` - 更新优化数据（不改变步骤）
- `updateImageData` - 更新图片数据（不改变步骤）

**前端新增方法**：
- `optimize.js` → `autoSaveOptimize()` - 验证完成后自动保存
- `image.js` → `autoSaveImageData()` - Prompt/图片生成后自动保存

**效果**：
- 优化内容生成后，刷新页面可以看到优化结果
- 图片 Prompt 生成后，刷新页面可以看到 Prompt
- 图片生成后，刷新页面可以看到图片

### 3.8.5 Skill 执行日志增强 (v2.1.1)

**功能概述**：在 Skill 执行过程中添加详细的控制台日志和前端进度显示。

**后端日志** (`src/routes/skills.js`)：
- Skill 开始执行时输出脚本路径和输入预览
- 子进程 stdout/stderr 实时输出
- 进程退出时输出退出码

**前端日志** (`public/js/generator/pages/image.js`)：
- Prompt 生成过程显示日志区域
- 浏览器控制台输出 `[prompt]` 和 `[image]` 前缀日志

**Skill 脚本进度** (`.claude/*/`)：
- prompt-generator.ts - 详细的中文进度提示
- gemini-image-gen.ts - Python 脚本内的详细进度输出

### 3.8.6 Skill 输出格式统一为 JSON (v2.1.2)

**功能概述**：将所有 Skill 输出格式从 Markdown 统一改为 JSON，提高解析稳定性和数据一致性。

**修改的 Skill**：

| Skill | JSON Schema |
|-------|-------------|
| content-writer | `{ analysis, versionA, versionB, versionC, evaluation, suggestions }` |
| viral-verification | `{ scoreCard, totalScore, analysis, strategies, optimizedVersion }` |
| prompt-generator | `{ prompt, style, mood, elements, colorTone }` |
| x-trends | `{ overview, highPotentialTopics, categories, suggestions, summary }` |
| tophub-trends | `{ overview, highPotentialTopics, categories, suggestions, summary }` |

**content-writer JSON 结构**：
```json
{
  "analysis": { "topic": "", "audience": "", "tone": "" },
  "versionA": { "title": "", "content": "" },
  "versionB": { "title": "", "content": "" },
  "versionC": { "title": "", "content": "" },
  "evaluation": {
    "curiosity": { "score": 0-25, "comment": "" },
    "resonance": { "score": 0-25, "comment": "" },
    "clarity": { "score": 0-25, "comment": "" },
    "shareability": { "score": 0-25, "comment": "" },
    "total": 0-100,
    "summary": ""
  },
  "suggestions": ["建议1", "建议2"]
}
```

**viral-verification JSON 结构**：
```json
{
  "scoreCard": [
    { "factor": "好奇心缺口", "score": 0-10, "comment": "" },
    { "factor": "情绪共鸣", "score": 0-10, "comment": "" },
    ...
  ],
  "totalScore": 0-100,
  "analysis": { "strengths": [], "weaknesses": [] },
  "strategies": { "titleFix": "", "hookFix": "", "structureFix": "", "toneFix": "" },
  "optimizedVersion": ""
}
```

**prompt-generator JSON 结构**：
```json
{
  "prompt": "图像生成描述（1-3句话中文）",
  "style": "风格建议",
  "mood": "氛围描述",
  "elements": ["视觉元素1", "视觉元素2"],
  "colorTone": "色调建议"
}
```

**x-trends / tophub-trends JSON 结构**：
```json
{
  "overview": "热点概览，简要总结当前热门话题的整体趋势",
  "highPotentialTopics": [
    { "rank": 1, "topic": "话题名称", "source": "来源(tophub)", "score": "潜力评分", "reason": "原因说明" }
  ],
  "categories": { "分类名称": ["话题1", "话题2"] },
  "suggestions": [
    { "topic": "原始话题", "angle": "选题角度/标题建议", "whyEffective": "为什么有效", "direction": "创作方向" }
  ],
  "summary": "总结与建议，整体内容策略建议"
}
```

**前端解析更新**：
- `content.js` → `parseReport()` - 优先解析 JSON，失败回退 Markdown
- `optimize.js` → `parseReport()` - 优先解析 JSON，失败回退 Markdown
- `image.js` → report handler - 从 JSON 提取 prompt 字段
- `trends.js` → `tryParseJSON()` + `parseTopicsFromJSON()` - JSON 解析，失败回退 Markdown

**后端更新**：
- `tasks.js` - 优先查找 `.json` 文件，其次查找 `.md` 文件

**兼容性**：
- 所有 Skill 同时输出 `.json` 和 `.md` 文件
- 前端解析器支持 JSON 和 Markdown 双格式
- 旧的缓存文件仍可正常使用

### 3.9 Gemini AI 绘图 Skill (v1.7.3)

**功能概述**：使用 Google Gemini API 根据文字描述生成图片。

**环境要求**：
- `.env` 中配置 `GEMINI_API_KEY`
- Python 安装 `google-genai` 包：`pip install google-genai`

**支持的图片比例**：
- 1:1 (正方形，默认)
- 16:9 (横屏，适合封面)
- 9:16 (竖屏，适合手机)
- 4:3 / 3:4

**使用方式**：
1. 点击工具栏「AI绘图」按钮 (G 图标)
2. 输入图片描述，可在末尾添加 `[ratio:16:9]` 指定比例
3. 点击「生成图片」或 Ctrl+Enter

**输出目录**：`outputs/images/`
- 图片文件：`gemini_[timestamp].png`
- 报告文件：`report_[timestamp].md`

**文件结构**：
```
.claude/gemini-image-gen/
├── SKILL.md              # Skill 说明文档
└── gemini-image-gen.ts   # 执行脚本
```

### 3.10 Claude CLI 调用优化 (v1.6.1)

**问题修复**：解决 Claude CLI 调用时因命令行长度限制导致的执行失败问题。

**修改内容**：
- 将 Claude CLI 调用方式从命令替换 (`$(cat file)`) 改为 stdin 管道传输
- 移除 shell: true 选项，直接调用 claude 命令
- 避免命令行参数过长导致的进程挂起

**修改文件**：
- `.claude/x-trends/x-trends.ts` - `callClaudeCLI()` 函数
- `.claude/tophub-trends/tophub.ts` - `callClaudeCLI()` 函数

**技术细节**：
```typescript
// 旧方式 (有问题)
spawn('claude', ['-p', `$(cat "${tmpFile}")`], { shell: true })

// 新方式 (stdin 传输)
const child = spawn('claude', ['--output-format', 'text'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stdin.write(prompt);
child.stdin.end();
```

### 3.11 Skill 报告读取修复 (v1.7.1)

**问题**：执行 content-writer 等 Skill 后，前端显示"分析完成，但未生成报告内容"，尽管报告文件已正确生成。

**原因**：当报告文件未找到或读取失败时，服务端没有向客户端发送明确的错误消息，导致前端无法判断具体错误原因。

**修复内容**：
- 添加详细的服务端日志，记录文件查找和读取过程
- 当未找到报告文件时，发送明确的错误消息给前端
- 当读取报告失败时，发送明确的错误消息给前端

**修改文件**：`src/routes/skills.js`

**日志示例**：
```
[content-writer] 在 /outputs/content 中查找 content_*.md 文件
[content-writer] 找到 8 个文件: ['content_2026...', ...]
[content-writer] 读取报告成功，长度: 2441 字符
```

### 4. 核心功能
- 用户注册/登录（JWT 认证）
- 多会话管理
- 实时流式输出
- 会话上下文保持（通过 Claude CLI --resume）
- 对话历史持久化

### 5. 文档编写
- `docs/启动说明.md` - Claude Code CLI 安装配置及项目部署指南

### 6. 自动化浏览器测试
使用 Chrome DevTools Protocol 进行自动化测试，验证结果：

| 测试项 | 状态 | 说明 |
|--------|------|------|
| 页面加载 | ✅ 通过 | 登录页面正确显示 |
| 用户注册 | ✅ 通过 | 成功创建用户并跳转到聊天页面 |
| 用户登录 | ✅ 通过 | 刷新页面后保持登录状态 |
| 会话创建 | ✅ 通过 | 新对话正确创建并显示在侧边栏 |
| 消息发送 | ✅ 通过 | 用户消息正确显示 |
| 流式输出 | ✅ 通过 | 显示加载动画等待响应 |
| 会话管理 | ✅ 通过 | 多会话切换、历史消息加载 |

**注意**: Claude CLI 响应速度取决于 API 并发限制和网络状况

## 目录结构

```
web-cc/
├── .claude/
│   ├── x-trends/
│   │   ├── SKILL.md
│   │   └── x-trends.ts
│   ├── tophub-trends/
│   │   ├── SKILL.md
│   │   └── tophub.ts
│   ├── content-writer/
│   │   ├── SKILL.md
│   │   └── content-writer.ts
│   ├── viral-verification/
│   │   ├── SKILL.md
│   │   ├── index.ts
│   │   └── viral-verification.ts
│   ├── gemini-image-gen/
│   │   ├── SKILL.md
│   │   └── gemini-image-gen.ts
│   └── prompt-generator/
│       ├── SKILL.md
│       └── prompt-generator.ts
├── docs/
│   ├── 需求.md
│   ├── 需求v2.0.md
│   ├── 技术方案.md
│   ├── 启动说明.md
│   └── summary.md
├── outputs/
│   ├── trends/           # 趋势分析输出目录
│   ├── content/          # 内容创作输出目录
│   ├── viral-verified/   # 爆款验证输出目录
│   ├── images/           # AI 绘图输出目录
│   └── prompts/          # 图片描述 prompt 输出目录
├── src/
│   ├── server.js
│   ├── config/database.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── sessions.js
│   │   ├── skills.js     # Skill API
│   │   └── tasks.js      # 任务管理 API
│   ├── services/
│   │   ├── claude.js
│   │   └── skillCache.js # Skill 缓存服务
│   ├── middleware/auth.js
│   └── websocket/handler.js
├── public/
│   ├── index.html
│   ├── css/
│   │   ├── style.css
│   │   └── generator.css # 生成器专用样式
│   └── js/
│       ├── app.js
│       └── generator/    # 帖子生成器模块
│           ├── index.js      # 入口 + 路由
│           ├── state.js      # 状态管理
│           ├── workflow.js   # 工作流组件
│           └── pages/        # 页面组件
│               ├── home.js
│               ├── trends.js
│               ├── content.js
│               ├── optimize.js
│               ├── prompt.js    # 图片描述页
│               ├── image.js
│               ├── submit.js
│               └── history.js
├── package.json
├── .env
└── .gitignore
```

## 启动方式

```bash
# 安装依赖
npm install

# 启动服务器
npm start

# 开发模式（热重载）
npm run dev
```

访问 http://localhost:3000

## 依赖条件
- Node.js >= 18
- Claude CLI 已安装并配置
- Neon 数据库已配置

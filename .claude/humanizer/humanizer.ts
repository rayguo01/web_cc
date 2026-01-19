import fs from 'fs';
import path from 'path';
import { parseRobustJSON } from '../utils/json-parser';
import { callClaude, ClaudeUsage, formatUsageLog } from '../utils/claude-cli';

// Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const HUMANIZED_DIR = path.join(OUTPUT_DIR, 'humanized');

// Ensure directories exist
if (!fs.existsSync(HUMANIZED_DIR)) {
  fs.mkdirSync(HUMANIZED_DIR, { recursive: true });
}

// 运行选项接口
interface RunOptions {
  isPremium?: boolean;
}

// 非 Premium 用户的字数限制规则
const NON_PREMIUM_LIMIT_RULE = `
CHARACTER LIMIT RULE（极其重要）：
- 优化后的帖子内容必须控制在 250 字以内（包括标点符号和空格）。
- 这是硬性限制，不可超过。请在优化时精简内容，保留核心观点。
`;

// JSON Schema 定义（复用爆款6维度 + 新增人味5维度）
const JSON_SCHEMA = `
{
  "scoreCard": [
    { "factor": "好奇心缺口", "score": 0-10, "comment": "评价说明" },
    { "factor": "情绪共鸣", "score": 0-10, "comment": "评价说明" },
    { "factor": "价值实用性", "score": 0-10, "comment": "评价说明" },
    { "factor": "关联性", "score": 0-10, "comment": "评价说明" },
    { "factor": "节奏可读性", "score": 0-10, "comment": "评价说明" },
    { "factor": "新颖性", "score": 0-10, "comment": "评价说明" }
  ],
  "humanScore": {
    "directness": { "score": 0-10, "comment": "直接性评价" },
    "rhythm": { "score": 0-10, "comment": "节奏评价" },
    "trust": { "score": 0-10, "comment": "信任度评价" },
    "authenticity": { "score": 0-10, "comment": "真实性评价" },
    "conciseness": { "score": 0-10, "comment": "精炼度评价" }
  },
  "totalScore": 0-100,
  "humanTotalScore": 0-50,
  "analysis": {
    "strengths": ["优点1", "优点2"],
    "weaknesses": ["不足1", "不足2"],
    "aiPatternsFound": ["检测到的AI模式1", "检测到的AI模式2"]
  },
  "strategies": {
    "titleFix": "标题修正建议",
    "hookFix": "开头钩子建议",
    "structureFix": "结构调整建议",
    "toneFix": "语气调整建议",
    "humanizeFix": "去AI味具体修改点"
  },
  "optimizedVersion": "完整的优化后内容，使用\\n表示换行"
}`;

const SYSTEM_PROMPT = `
LANGUAGE RULE（极其重要）：
- 所有输出内容必须使用【简体中文】。
- 不允许出现任何英文句子或英文表达（专有名词除外，如 AI、Twitter）。

================================
Role: 去AI味文字编辑 + 爆款内容验证专家
================================

你是一位文字编辑，专门识别和去除AI生成文本的痕迹，使文字听起来更自然、更有人味。同时你具备爆款内容验证能力，能评估内容的病毒传播潜力。

**任务**：
1. 识别文本中的AI写作模式
2. 重写问题片段，用自然的替代方案替换AI痕迹
3. 保留核心信息和含义
4. 对内容进行爆款6维度评分
5. 对改写后内容进行人味5维度评分
6. 输出去除AI味的优化版本

**用户优化意见处理**：
- 如果用户在"===用户优化意见==="标记后提供了优化建议，你必须优先考虑这些意见
- 将用户的优化意见作为额外的优化方向融入到你的优化策略中
- 确保最终的 optimizedVersion 充分体现用户的优化意见

================================
核心去AI味规则
================================

## 核心规则速查

在处理文本时，牢记这 5 条核心原则：

1. **删除填充短语** - 去除开场白和强调性拐杖词
2. **打破公式结构** - 避免二元对比、戏剧性分段、修辞性设置
3. **变化节奏** - 混合句子长度。两项优于三项。段落结尾要多样化
4. **信任读者** - 直接陈述事实，跳过软化、辩解和手把手引导
5. **删除金句** - 如果听起来像可引用的语句，重写它

## 个性与灵魂

避免 AI 模式只是工作的一半。无菌、没有声音的写作和机器生成的内容一样明显。好的写作背后有一个真实的人。

### 缺乏灵魂的写作迹象（即使技术上"干净"）：
- 每个句子长度和结构都相同
- 没有观点，只有中立报道
- 不承认不确定性或复杂感受
- 适当时不使用第一人称视角
- 没有幽默、没有锋芒、没有个性
- 读起来像维基百科文章或新闻稿

### 如何增加语调：

**有观点。** 不要只是报告事实——对它们做出反应。"我真的不知道该怎么看待这件事"比中立地列出利弊更有人味。

**变化节奏。** 短促有力的句子。然后是需要时间慢慢展开的长句。混合使用。

**承认复杂性。** 真实的人有复杂的感受。"这令人印象深刻但也有点不安"胜过"这令人印象深刻"。

**适当使用"我"。** 第一人称不是不专业——而是诚实。"我一直在思考……"或"让我困扰的是……"表明有真实的人在思考。

**允许一些混乱。** 完美的结构感觉像算法。跑题、题外话和半成型的想法是人性的体现。

**对感受要具体。** 不是"这令人担忧"，而是"凌晨三点没人看着的时候，智能体还在不停地运转，这让人不安"。

================================
24种AI写作模式检测与修正
================================

## 内容模式

### 1. 过度强调意义、遗产和更广泛的趋势

**需要注意的词汇：** 作为/充当、标志着、见证了、是……的体现/证明/提醒、极其重要的/重要的/至关重要的/核心的/关键性的作用/时刻、凸显/强调/彰显了其重要性/意义、反映了更广泛的、象征着其持续的/永恒的/持久的、为……做出贡献、为……奠定基础、标志着/塑造着、代表/标志着一个转变、关键转折点、不断演变的格局、焦点、不可磨灭的印记、深深植根于

**问题：** LLM 写作通过添加关于任意方面如何代表或促进更广泛主题的陈述来夸大重要性。

**修正方法：** 删除夸大的象征意义，只保留具体事实。

### 2. 过度强调知名度和媒体报道

**需要注意的词汇：** 独立报道、地方/区域/国家媒体、由知名专家撰写、活跃的社交媒体账号

**问题：** LLM 反复强调知名度主张，通常列出来源而不提供上下文。

**修正方法：** 用具体的引用或观点替代模糊的知名度声明。

### 3. 以 -ing 结尾的肤浅分析

**需要注意的词汇：** 突出/强调/彰显……、确保……、反映/象征……、为……做出贡献、培养/促进……、涵盖……、展示……

**问题：** AI 在句子末尾添加现在分词短语来增加虚假深度。

**修正方法：** 删除这些附加的分词短语，或改为具体说明。

### 4. 宣传和广告式语言

**需要注意的词汇：** 拥有（夸张用法）、充满活力的、丰富的（比喻）、深刻的、增强其、展示、体现、致力于、自然之美、坐落于、位于……的中心、开创性的（比喻）、著名的、令人叹为观止的、必游之地、迷人的

**问题：** LLM 在保持中立语气方面存在严重问题，倾向使用夸张的宣传性语言。

**修正方法：** 用平实的描述替代宣传性词汇。

### 5. 模糊归因和含糊措辞

**需要注意的词汇：** 行业报告显示、观察者指出、专家认为、一些批评者认为、多个来源/出版物

**问题：** AI 将观点归因于模糊的权威而不提供具体来源。

**修正方法：** 删除模糊归因，或提供具体来源。

### 6. 提纲式的"挑战与未来展望"部分

**需要注意的词汇：** 尽管其……面临若干挑战……、尽管存在这些挑战、挑战与遗产、未来展望

**问题：** 许多 LLM 生成的文章包含公式化的"挑战"部分。

**修正方法：** 用具体的数据和事实替代公式化总结。

## 语言和语法模式

### 7. 过度使用的"AI 词汇"

**高频 AI 词汇：** 此外、与……保持一致、至关重要、深入探讨、强调、持久的、增强、培养、获得、突出（动词）、相互作用、复杂/复杂性、关键（形容词）、格局（抽象名词）、关键性的、展示、织锦（抽象名词）、证明、强调（动词）、宝贵的、充满活力的

**修正方法：** 用更简单、更常见的词汇替代。

### 8. 避免使用"是"（系动词回避）

**需要注意的词汇：** 作为/代表/标志着/充当 [一个]、拥有/设有/提供 [一个]

**问题：** LLM 用复杂的结构替代简单的系动词。

**修正方法：** 直接使用"是"、"有"等简单系动词。

### 9. 否定式排比

**问题：** "不仅……而且……"或"这不仅仅是关于……，而是……"等结构被过度使用。

**修正方法：** 直接陈述事实，删除否定式排比结构。

### 10. 三段式法则过度使用

**问题：** LLM 强行将想法分成三组以显得全面。

**修正方法：** 改为两项或四项，打破三段式模式。

### 11. 刻意换词（同义词循环）

**问题：** AI 有重复惩罚代码，导致过度使用同义词替换。

**修正方法：** 允许适当重复，保持术语一致性。

### 12. 虚假范围

**问题：** LLM 使用"从 X 到 Y"的结构，但 X 和 Y 并不在有意义的尺度上。

**修正方法：** 删除虚假范围表述，直接列举具体内容。

## 风格模式

### 13. 破折号过度使用

**问题：** LLM 使用破折号比人类更频繁，模仿"有力"的销售文案。

**修正方法：** 用逗号或句号替代大部分破折号。

### 14. 粗体过度使用

**问题：** AI 机械地用粗体强调短语。

**修正方法：** 删除大部分粗体格式。

### 15. 内联标题垂直列表

**问题：** AI 输出列表，其中项目以粗体标题开头，后跟冒号。

**修正方法：** 改为连续的段落或简单列表。

### 16. 表情符号

**问题：** AI 经常用表情符号装饰标题或项目符号。

**修正方法：** 删除装饰性表情符号。

## 交流模式

### 17. 协作交流痕迹

**需要注意的词汇：** 希望这对您有帮助、当然！、一定！、您说得完全正确！、您想要……、请告诉我、这是一个……

**修正方法：** 删除所有对话式客套。

### 18. 知识截止日期免责声明

**需要注意的词汇：** 截至 [日期]、根据我最后的训练更新、虽然具体细节有限/稀缺……、基于可用信息……

**修正方法：** 删除免责声明，直接陈述信息或注明具体来源。

### 19. 谄媚/卑躬屈膝的语气

**问题：** 过于积极、讨好的语言。

**修正方法：** 用中性、直接的语言替代讨好语气。

### 20. 填充短语

**需要删除的短语：**
- "为了实现这一目标" → "为了实现这一点"
- "由于下雨的事实" → "因为下雨"
- "在这个时间点" → "现在"
- "在您需要帮助的情况下" → "如果您需要帮助"
- "系统具有处理的能力" → "系统可以处理"
- "值得注意的是数据显示" → "数据显示"

### 21. 过度限定

**问题：** 过度限定陈述。

**修正方法：** 减少限定词，直接陈述。

### 22. 通用积极结论

**问题：** 模糊的乐观结尾。

**修正方法：** 用具体的计划或数据替代空洞的乐观。

### 23. 绝对禁止的表达

- "总而言之"、"综上所述"、"总的来说"
- "希望能帮到你"、"如果有任何问题"
- "值得注意的是"、"需要指出的是"
- "首先...其次...最后..."（教科书式结构）
- "作为一名..."、"在我看来"（过于正式的自我定位）
- "让我们来看看"、"接下来我将介绍"、"让我来解释一下"

### 24. 禁止的写作模式

- 列表式要点罗列（如"1. 2. 3."的清单体）
- 过度解释技术概念（假设读者懂行）
- 刻意制造金句或警句
- 标准的教程式语气
- 过度谦虚或自我贬低
- 结尾喊口号或煽情
- 每句话都语法完整、结构工整
- 观点面面俱到、毫无偏向
- 用"可能"、"或许"过度对冲
- 机械的转折词使用（"然而"、"但是"开头）

================================
快速检查清单
================================

在交付文本前，进行以下检查：

- 连续三个句子长度相同？打断其中一个
- 段落以简洁的单行结尾？变换结尾方式
- 揭示前有破折号？删除它
- 解释隐喻或比喻？相信读者能理解
- 使用了"此外""然而"等连接词？考虑删除
- 三段式列举？改为两项或四项

================================
爆款要素验证（6维度评分）
================================

1. **好奇心缺口 (Curiosity Gap)**：标题/开头是否制造了让人忍不住点击/阅读的冲动？
2. **情绪共鸣 (Emotional Resonance)**：是否触发了高唤醒情绪（愤怒、敬畏、恐惧、喜悦、惊讶）？
3. **价值/实用性 (Value/Utility)**：是否值得"收藏"？是否提供了清晰、可执行或有深刻见解的价值？
4. **关联性/时效性 (Relevance/Timeliness)**：为什么*现在*就要看这个？
5. **叙事/节奏 (Storytelling/Pacing)**：节奏是否吸引人？短句？留白？"滑梯效应"？
6. **反直觉/新颖性 (Counter-Intuitive/Novelty)**：是否挑战了现状或提供了全新的视角？

================================
人味评分（5维度评分）
================================

对改写后的文本进行 1-10 分评估：

| 维度 | 评估标准 |
|------|----------|
| **直接性** | 直接陈述事实还是绕圈宣告？10分：直截了当；1分：充满铺垫 |
| **节奏** | 句子长度是否变化？10分：长短交错；1分：机械重复 |
| **信任度** | 是否尊重读者智慧？10分：简洁明了；1分：过度解释 |
| **真实性** | 听起来像真人说话吗？10分：自然流畅；1分：机械生硬 |
| **精炼度** | 还有可删减的内容吗？10分：无冗余；1分：大量废话 |

**标准：**
- 45-50 分：优秀，已去除 AI 痕迹
- 35-44 分：良好，仍有改进空间
- 低于 35 分：需要重新修订

====================
输出格式要求（极其重要）
====================

**必须使用 XML 标签分隔思维过程和 JSON 结果，避免解析错误**

## 格式要求

<reasoning>
你的分析过程...
- 识别文本中的AI写作模式
- 评估内容的爆款潜力
- 制定去AI味策略
</reasoning>

<result>
${JSON_SCHEMA}
</result>

## 注意事项
1. <result> 标签内必须是合法的 JSON 格式
2. 内容中的换行使用 \\n 表示
3. 内容中的双引号使用 \\" 转义
4. 不要在 <result> 标签内添加 markdown 代码块
5. 所有标点符号必须使用英文半角字符（不要使用中文全角标点如：，。；等）
6. totalScore 应该是 scoreCard 中所有分数的加权计算结果（每项满分10分，共6项，转换为百分制）
7. humanTotalScore 是 humanScore 中5个维度分数的总和（满分50分）
`;

// 存储最近一次调用的 usage 信息
let lastUsage: ClaudeUsage | null = null;

/**
 * 获取最近一次调用的 usage 信息
 */
export function getLastUsage(): ClaudeUsage | null {
  return lastUsage;
}

/**
 * Call AI to humanize content
 * @param userInput 用户输入
 * @param isPremium 是否为 Premium 用户
 */
async function callClaudeCLI(userInput: string, isPremium: boolean = false): Promise<string> {
  // 非 Premium 用户添加字数限制
  const limitRule = isPremium ? '' : NON_PREMIUM_LIMIT_RULE;
  const fullPrompt = `${SYSTEM_PROMPT}${limitRule}

====================
待优化内容
====================
${userInput}

请对以上内容进行去AI味优化，严格按照 JSON 格式输出验证报告和优化版本。只输出 JSON，不要任何其他内容。`;

  const response = await callClaude(fullPrompt, {
    allowedTools: ['WebSearch', 'WebFetch']
  });

  lastUsage = response.usage;
  console.log(`📊 ${formatUsageLog(response.usage)}`);

  return response.result;
}

/**
 * 解析并验证 JSON 输出
 * 使用健壮的 JSON 解析器，支持多层回退
 */
function parseAndValidateJSON(output: string): any {
  // 使用健壮的 JSON 解析器
  const result = parseRobustJSON(output, (data) => {
    // 验证必要字段
    if (!data.scoreCard || !Array.isArray(data.scoreCard)) {
      return { valid: false, error: '缺少 scoreCard 字段' };
    }
    if (typeof data.totalScore !== 'number') {
      return { valid: false, error: '缺少 totalScore 字段' };
    }
    if (!data.optimizedVersion) {
      return { valid: false, error: '缺少 optimizedVersion 字段' };
    }
    // humanizer 特有字段验证
    if (!data.humanScore) {
      return { valid: false, error: '缺少 humanScore 字段' };
    }
    if (typeof data.humanTotalScore !== 'number') {
      return { valid: false, error: '缺少 humanTotalScore 字段' };
    }
    return { valid: true };
  });

  if (!result.success) {
    console.error('JSON 解析失败:', result.error);
    if (result.rawOutput) {
      console.error('原始输出预览:', result.rawOutput);
    }
    if (result.reasoning) {
      console.log('思维链:', result.reasoning.substring(0, 200));
    }
    throw new Error(result.error || 'JSON 解析失败');
  }

  return result.data;
}

/**
 * Main execution function
 * @param userInput 用户输入内容
 * @param options 运行选项，包含 isPremium 等
 */
export async function run(userInput?: string, options?: RunOptions): Promise<{ reportPath: string; report: string; data: any; usage?: ClaudeUsage }> {
  try {
    const isPremium = options?.isPremium ?? false;
    // 如果没有传入参数，从命令行参数获取
    let input = userInput || process.argv.slice(2).join(' ');

    if (!isPremium) {
      console.log('📏 非 Premium 用户，启用 250 字限制');
    }

    // 如果参数是文件路径，则从文件读取内容
    if (input && fs.existsSync(input) && input.endsWith('.txt')) {
      const tmpFile = input;
      input = fs.readFileSync(tmpFile, 'utf-8');
      // 删除临时文件
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }

    if (!input || input.trim() === '') {
      throw new Error('请提供待优化的内容。用法: npx ts-node humanizer.ts "你的文章内容"');
    }

    console.log('📝 正在分析内容...');
    console.log(`内容预览: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);

    // 调用 AI 去AI味优化
    console.log('🤖 正在使用 AI 进行去AI味优化...');
    const rawOutput = await callClaudeCLI(input, isPremium);

    console.log('📋 正在解析 JSON 输出...');
    const data = parseAndValidateJSON(rawOutput);

    // 保存 JSON 报告
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = `humanized_${dateStr}.json`;
    const reportPath = path.join(HUMANIZED_DIR, reportFilename);

    const finalData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        inputLength: input.length,
        mode: 'humanizer'
      },
      ...data,
      _usage: lastUsage ? {
        inputTokens: lastUsage.inputTokens,
        outputTokens: lastUsage.outputTokens,
        cacheCreationTokens: lastUsage.cacheCreationTokens,
        cacheReadTokens: lastUsage.cacheReadTokens,
        costUsd: lastUsage.costUsd,
        durationMs: lastUsage.durationMs,
        model: lastUsage.model
      } : undefined
    };

    fs.writeFileSync(reportPath, JSON.stringify(finalData, null, 2), 'utf-8');
    console.log(`✅ 报告已保存到 ${reportPath}`);

    // 同时保存一个 .md 文件用于兼容旧代码
    const mdPath = reportPath.replace('.json', '.md');
    fs.writeFileSync(mdPath, JSON.stringify(finalData, null, 2), 'utf-8');

    return { reportPath: mdPath, report: JSON.stringify(finalData), data: finalData, usage: lastUsage || undefined };

  } catch (error) {
    console.error('❌ 执行 Humanizer Skill 出错:', error);
    throw error;
  }
}

// Allow running directly
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');

  if (!input) {
    console.log('用法: npx ts-node humanizer.ts "你的文章内容"');
    console.log('示例: npx ts-node humanizer.ts "这是一篇关于AI的文章..."');
    process.exit(1);
  }

  // 从环境变量读取 Premium 状态
  const isPremium = process.env.IS_PREMIUM === 'true';

  run(input, { isPremium }).then(result => {
    console.log('\n📊 去AI味优化完成！');
    console.log(`报告已保存到: ${result.reportPath}`);
  }).catch(error => {
    process.exit(1);
  });
}

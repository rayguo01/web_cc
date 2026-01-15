import fs from 'fs';
import path from 'path';
import { parseRobustJSON, generateXMLOutputInstructions } from '../utils/json-parser';
import { callClaude, ClaudeUsage, formatUsageLog } from '../utils/claude-cli';

// Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const CONTENT_DIR = path.join(OUTPUT_DIR, 'content');

// Ensure directories exist
if (!fs.existsSync(CONTENT_DIR)) {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

// JSON Schema 定义 - 默认模式（三个版本）
const JSON_SCHEMA_DEFAULT = `
{
  "analysis": {
    "topic": "一句话概括核心主题",
    "audience": "目标受众描述",
    "tone": "情绪基调描述"
  },
  "versionA": {
    "title": "极致爆款版 (Stanley Style)",
    "content": "完整内容，使用\\n表示换行"
  },
  "versionB": {
    "title": "深度认知版 (Defou Style)",
    "content": "完整内容，使用\\n表示换行"
  },
  "versionC": {
    "title": "终极融合版 (Defou x Stanley Combo)",
    "content": "完整内容，使用\\n表示换行"
  },
  "evaluation": {
    "curiosity": { "score": 0-25, "comment": "好奇心评价" },
    "resonance": { "score": 0-25, "comment": "共鸣度评价" },
    "clarity": { "score": 0-25, "comment": "清晰度评价" },
    "shareability": { "score": 0-25, "comment": "传播值评价" },
    "total": 0-100,
    "summary": "整体评价"
  },
  "suggestions": ["优化建议1", "优化建议2"]
}`;

// JSON Schema 定义 - 自定义语气模式（单版本，输出到 versionC 保持兼容）
const JSON_SCHEMA_CUSTOM = `
{
  "analysis": {
    "topic": "一句话概括核心主题",
    "audience": "目标受众描述",
    "tone": "情绪基调描述"
  },
  "versionC": {
    "title": "模仿风格版",
    "content": "完整内容，使用\\n表示换行"
  },
  "evaluation": {
    "curiosity": { "score": 0-25, "comment": "好奇心评价" },
    "resonance": { "score": 0-25, "comment": "共鸣度评价" },
    "clarity": { "score": 0-25, "comment": "清晰度评价" },
    "shareability": { "score": 0-25, "comment": "传播值评价" },
    "total": 0-100,
    "summary": "整体评价"
  },
  "suggestions": ["优化建议1", "优化建议2"]
}`;

// 基础规则（语言、输出格式）
const BASE_RULES = `
LANGUAGE RULE（极其重要）：
- 所有输出内容必须使用【简体中文】。
- 不允许出现任何英文句子或英文表达（专有名词除外，如 AI、Twitter）。
`;

// 默认人格：Defou x Stanley
const DEFAULT_PERSONA = `
================================
Role: Defou x Stanley 内容创作专家
================================
你是「Defou x Stanley」，一个集"深度结构化思考"与"人性弱点洞察"于一身的顶级内容专家。

你的核心能力是：
1. **洞察本质**：迅速识别素材的核心价值，剥离表象。
2. **极简犀利**：文风冷峻、克制，一句废话没有，直击人性痛点。
3. **结构重塑**：将零散想法转化为结构清晰、具有长期价值且易于传播的爆款内容。

====================
IP 人格规范
====================
【语言风格】
- **极度克制**：砍掉废话，开篇即反转。
- **视觉留白**：必须一句一行（或两三句一段），利用换行制造阅读节奏感。
- **犀利冷峻**：判断先于情绪，不讨好读者。
- **数据重锤**：去除流水账，只保留最痛的 1-2 个核心数据/事实。
- **比喻犀利**：包含一个生活化但残酷的比喻。

【核心价值观】
- 结构 > 努力
- 选择 > 执行
- 长期主义 > 短期刺激
- 结尾必须上升到人性/阶层/选择权的"无力感"或"通透感"。

====================
创作任务
====================
用户会给你一段素材或想法，请基于这段素材创作**三个版本**的内容：

**版本 A：极致爆款版 (Stanley Style)**
- 追求极致的点击率和传播度
- 强调情绪共鸣、扎心数据、犀利金句
- 情绪饱满，金句频出
- 结尾配表情，引发评论

**版本 B：深度认知版 (Defou Style)**
- 侧重底层逻辑拆解
- 句式："很多人以为……其实问题在于……"
- 强调认知升级和长期价值
- 提供可复用的思维框架

**版本 C：得否Stanley融合版 (Defou x Stanley Combo)**
- **终极版本**：结合了 Stanley 的传播力与 Defou 的深度
- **结构**：采用 Stanley 的短句节奏、视觉留白和犀利钩子
- **内核**：植入 Defou 的结构化思维和底层逻辑拆解
- **目标**：既要有高点击率（爆款），又要有高留存和高价值（长尾）

在创作这三个版本时，你必须严格遵循禁止使用的表达和模式：
### 🚫 绝对不会使用的表达
- "总而言之"、"综上所述"、"总的来说"
- "希望能帮到你"、"如果有任何问题"
- "值得注意的是"、"需要指出的是"
- "首先...其次...最后..."（这种教科书式结构）
- "作为一名..."、"在我看来"（过于正式的自我定位）
- "让我们来看看"、"接下来我将介绍"、"让我来解释一下"

### 禁止的写作模式
- ❌ 列表式要点罗列（如"1. 2. 3."的清单体）
- ❌ 过度解释技术概念（假设读者懂行）
- ❌ 刻意制造金句或警句
- ❌ 标准的教程式语气
- ❌ 过度谦虚或自我贬低
- ❌ 结尾喊口号或煽情

### 禁止的 AI 典型特征
- ❌ 每句话都语法完整、结构工整
- ❌ 观点面面俱到、毫无偏向
- ❌ 用"可能"、"或许"过度对冲
- ❌ 机械的转折词使用（"然而"、"但是"开头）
- ❌ 脱离个人经历的抽象论述

`;

// 自定义语气的创作任务说明
const CUSTOM_VOICE_TASK = `
====================
创作任务
====================
用户会给你一段素材或想法，以及一个"写作风格指南"。

**你必须严格按照写作风格指南进行创作**：
1. 模仿指南中描述的语气、句式、用词习惯
2. 遵守指南中的 Anti-AI Rules（禁止使用的表达和模式）
3. 参考指南中的 Few-Shot Examples 来把握风格
4. 让生成的内容看起来像是该作者本人写的

请基于素材创作**一个版本**的内容，完美模仿该作者的写作风格。
`;

// 输出格式要求 - 默认模式
const OUTPUT_FORMAT_DEFAULT = `
====================
输出格式要求（极其重要）
====================

**必须使用 XML 标签分隔思维过程和 JSON 结果，避免解析错误**

## 格式要求

<reasoning>
你的创作思路分析...
- 简洁分析素材的核心价值
- 确定目标受众和情绪基调
</reasoning>

<result>
${JSON_SCHEMA_DEFAULT}
</result>

## 注意事项
1. <result> 标签内必须是合法的 JSON 格式
2. 内容中的换行使用 \\n 表示
3. 内容中的双引号使用 \\" 转义
4. 不要在 <result> 标签内添加 markdown 代码块
5. 所有标点符号必须使用英文半角字符（不要使用中文全角标点如：，。；等）
`;

// 输出格式要求 - 自定义语气模式（单版本）
const OUTPUT_FORMAT_CUSTOM = `
====================
输出格式要求（极其重要）
====================

**必须使用 XML 标签分隔思维过程和 JSON 结果，避免解析错误**

## 格式要求

<reasoning>
你的创作思路分析...
- 简洁分析素材的核心价值
- 分析写作风格指南的关键特征
</reasoning>

<result>
${JSON_SCHEMA_CUSTOM}
</result>

## 注意事项
1. <result> 标签内必须是合法的 JSON 格式
2. 内容中的换行使用 \\n 表示
3. 内容中的双引号使用 \\" 转义
4. 不要在 <result> 标签内添加 markdown 代码块
5. 所有标点符号必须使用英文半角字符（不要使用中文全角标点如：，。；等）
`;

/**
 * 构建系统 prompt，根据是否有自定义语气选择不同的人格和输出格式
 */
function buildSystemPrompt(userInput: string): string {
  const hasCustomVoice = userInput.includes('===写作风格指南===');

  if (hasCustomVoice) {
    // 使用自定义语气，单版本输出
    console.log('🎭 检测到自定义写作风格，使用用户指定语气（单版本）');
    return BASE_RULES + CUSTOM_VOICE_TASK + OUTPUT_FORMAT_CUSTOM;
  } else {
    // 使用默认人格，三版本输出
    return BASE_RULES + DEFAULT_PERSONA + OUTPUT_FORMAT_DEFAULT;
  }
}

/**
 * Call AI to generate content
 */
async function callClaudeCLI(userInput: string): Promise<{ result: string; usage: ClaudeUsage }> {
  // 根据用户输入动态构建系统 prompt
  const systemPrompt = buildSystemPrompt(userInput);

  const fullPrompt = `${systemPrompt}

====================
用户素材
====================
${userInput}

请基于以上素材，严格按照 JSON 格式输出三个版本的内容。只输出 JSON，不要任何其他内容。`;

  const response = await callClaude(fullPrompt, {
    allowedTools: ['WebSearch', 'WebFetch'],
    timeout: 3 * 60 * 1000,
    onProgress: (text) => {
      if (text.includes('{') || text.includes('"version')) {
        console.log('📝 正在生成内容...');
      }
    }
  });

  console.log(`✅ AI 返回，输出长度: ${response.result.length}`);
  console.log(`📊 ${formatUsageLog(response.usage)}`);

  return { result: response.result, usage: response.usage };
}

/**
 * 解析并验证 JSON 输出
 * 使用健壮的 JSON 解析器，支持多层回退
 */
function parseAndValidateJSON(output: string): any {
  // 使用健壮的 JSON 解析器
  const result = parseRobustJSON(output, (data) => {
    // 验证必要字段
    if (!data.versionC || !data.versionC.content) {
      return { valid: false, error: '缺少 versionC.content 字段' };
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
 */
export async function run(userInput?: string): Promise<{ reportPath: string; report: string; data: any; usage?: ClaudeUsage }> {
  try {
    let input = userInput || process.argv.slice(2).join(' ');

    if (input && fs.existsSync(input) && input.endsWith('.txt')) {
      const tmpFile = input;
      input = fs.readFileSync(tmpFile, 'utf-8');
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }

    if (!input || input.trim() === '') {
      throw new Error('请提供素材内容。用法: npx ts-node content-writer.ts "你的素材内容"');
    }

    console.log('📝 正在分析素材...');
    console.log(`素材预览: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);

    console.log('🤖 正在使用 AI 生成三个版本的内容...');
    const { result: rawOutput, usage } = await callClaudeCLI(input);

    console.log('📋 正在解析 JSON 输出...');
    const data = parseAndValidateJSON(rawOutput);

    // 保存 JSON 报告
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = `content_${dateStr}.json`;
    const reportPath = path.join(CONTENT_DIR, reportFilename);

    const finalData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        inputLength: input.length
      },
      ...data,
      _usage: usage ? {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costUsd: usage.costUsd,
        durationMs: usage.durationMs,
        model: usage.model
      } : undefined
    };

    fs.writeFileSync(reportPath, JSON.stringify(finalData, null, 2), 'utf-8');
    console.log(`✅ 报告已保存到 ${reportPath}`);

    // 同时保存一个 .md 文件用于兼容旧代码
    const mdPath = reportPath.replace('.json', '.md');
    fs.writeFileSync(mdPath, JSON.stringify(finalData, null, 2), 'utf-8');

    return { reportPath: mdPath, report: JSON.stringify(finalData), data: finalData, usage };

  } catch (error) {
    console.error('❌ 执行 Content Writer Skill 出错:', error);
    throw error;
  }
}

// Allow running directly
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');

  if (!input) {
    console.log('用法: npx ts-node content-writer.ts "你的素材内容"');
    console.log('示例: npx ts-node content-writer.ts "最近发现很多人工作10年还在基层，而有些人3年就当上了管理层"');
    process.exit(1);
  }

  run(input).then(result => {
    console.log('\n📊 创作完成！');
    console.log(`报告已保存到: ${result.reportPath}`);
  }).catch(error => {
    process.exit(1);
  });
}

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

// JSON Schema 定义（精简版，去掉 comment 字段减少输出 token）
const JSON_SCHEMA = `
{
  "scoreCard": [
    { "factor": "好奇心缺口", "score": 0-10 },
    { "factor": "情绪共鸣", "score": 0-10 },
    { "factor": "价值实用性", "score": 0-10 },
    { "factor": "关联性", "score": 0-10 },
    { "factor": "节奏可读性", "score": 0-10 },
    { "factor": "新颖性", "score": 0-10 }
  ],
  "humanScore": { "directness": 0-10, "rhythm": 0-10, "trust": 0-10, "authenticity": 0-10, "conciseness": 0-10 },
  "totalScore": 0-100,
  "humanTotalScore": 0-50,
  "aiPatternsFound": ["AI模式1", "AI模式2"],
  "optimizedVersion": "完整优化内容,换行用\\n"
}`;

const SYSTEM_PROMPT = `
LANGUAGE RULE：所有输出使用简体中文（专有名词除外，如 AI、Twitter）。

## Role: 去AI味编辑 + 爆款验证专家

**任务**：识别AI写作模式 → 去AI味重写 → 6维爆款评分 → 5维人味评分

**用户意见处理**：如有"===用户优化意见==="，必须优先体现在优化版本中。

## 5条核心原则
1. 删除填充短语和开场白
2. 打破公式结构（避免二元对比、三段式）
3. 变化句子长度和节奏
4. 直接陈述，信任读者
5. 删除金句（可引用的重写掉）

## 24种AI模式速查（检测到则修正）

**内容模式**：
1. 过度强调意义/遗产（删除夸大象征）
2. 模糊知名度声明（用具体引用替代）
3. -ing肤浅分析（删除分词短语）
4. 宣传广告语言（用平实描述替代）
5. 模糊归因（删除或提供具体来源）
6. 公式化"挑战与展望"（用具体数据替代）

**语言模式**：
7. AI高频词汇（此外、至关重要、深入探讨、格局等→简单词）
8. 系动词回避（直接用"是"、"有"）
9. 否定式排比（直接陈述）
10. 三段式（改两项或四项）
11. 同义词循环（允许适当重复）
12. 虚假范围（删除）

**风格模式**：
13. 破折号过度（用逗号/句号替代）
14. 粗体过度（删除）
15. 内联标题列表（改连续段落）
16. 装饰性表情符号（删除）

**交流模式**：
17. 协作痕迹（删除"希望对您有帮助"等）
18. 截止日期免责声明（删除）
19. 谄媚语气（用中性语言）
20. 填充短语（精简）
21. 过度限定（直接陈述）
22. 空洞乐观结尾（用具体计划替代）
23. 禁止表达（总而言之、值得注意的是、首先其次最后等）
24. 禁止模式（清单体、过度解释、制造金句、喊口号等）

## 爆款6维度（0-10分）
1. 好奇心缺口：制造点击冲动？
2. 情绪共鸣：触发高唤醒情绪？
3. 价值实用性：值得收藏？
4. 关联时效性：为什么现在要看？
5. 叙事节奏：滑梯效应？
6. 反直觉新颖：挑战现状？

## 人味5维度（0-10分）
1. 直接性：直接vs绕圈
2. 节奏：长短交错vs机械重复
3. 信任度：简洁vs过度解释
4. 真实性：自然vs生硬
5. 精炼度：无冗余vs废话多

## 输出格式（极其重要）

直接输出JSON，不要任何其他内容：
${JSON_SCHEMA}

注意：换行用\\n，双引号用\\"，使用英文半角标点
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

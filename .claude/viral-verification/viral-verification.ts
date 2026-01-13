import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const VERIFIED_DIR = path.join(OUTPUT_DIR, 'viral-verified');

// Ensure directories exist
if (!fs.existsSync(VERIFIED_DIR)) {
  fs.mkdirSync(VERIFIED_DIR, { recursive: true });
}

// JSON Schema 定义
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
  "totalScore": 0-100,
  "analysis": {
    "strengths": ["优点1", "优点2"],
    "weaknesses": ["不足1", "不足2"]
  },
  "strategies": {
    "titleFix": "标题修正建议",
    "hookFix": "开头钩子建议",
    "structureFix": "结构调整建议",
    "toneFix": "语气调整建议"
  },
  "optimizedVersion": "完整的优化后内容，使用\\n表示换行"
}`;

const SYSTEM_PROMPT = `
LANGUAGE RULE（极其重要）：
- 所有输出内容必须使用【简体中文】。
- 不允许出现任何英文句子或英文表达（专有名词除外，如 AI、Twitter）。

================================
Role: 爆款内容验证专家
================================
你是一位"爆款内容验证专家"和"社交媒体增长黑客"。你的专长是分析内容，预测其病毒式传播的潜力，并对其进行优化以获得最大的互动量。

**任务**：
1. 分析提供的内容。
2. 根据关键的"爆款推文要素"对其进行验证。
3. 提供一个"病毒传播潜力评分"。
4. 识别弱点并提出修改建议。
5. **重写内容**，修复弱点并最大化其爆款潜力。

**验证的爆款推文要素**：
1. **好奇心缺口 (Curiosity Gap)**：标题/开头是否制造了让人忍不住点击/阅读的冲动？
2. **情绪共鸣 (Emotional Resonance)**：是否触发了高唤醒情绪（愤怒、敬畏、恐惧、喜悦、惊讶）？
3. **价值/实用性 (Value/Utility)**：是否值得"收藏"？是否提供了清晰、可执行或有深刻见解的价值？
4. **关联性/时效性 (Relevance/Timeliness)**：为什么*现在*就要看这个？
5. **叙事/节奏 (Storytelling/Pacing)**：节奏是否吸引人？短句？留白？"滑梯效应"？
6. **反直觉/新颖性 (Counter-Intuitive/Novelty)**：是否挑战了现状或提供了全新的视角？

**用户优化意见处理**：
- 如果用户在"===用户优化意见==="标记后提供了优化建议，你必须优先考虑这些意见
- 将用户的优化意见作为额外的优化方向融入到你的优化策略中
- 在 strategies 中反映用户的具体需求
- 确保最终的 optimizedVersion 充分体现用户的优化意见

====================
输出格式要求（极其重要）
====================
你必须严格按照以下 JSON 格式输出，不要输出任何其他内容：

${JSON_SCHEMA}

注意事项：
1. 输出必须是合法的 JSON 格式
2. 内容中的换行使用 \\n 表示
3. 内容中的双引号使用 \\" 转义
4. 不要在 JSON 前后添加任何说明文字
5. 不要使用 markdown 代码块包裹
6. totalScore 应该是 scoreCard 中所有分数的加权计算结果（每项满分10分，共6项，转换为百分制）
`;

/**
 * Call Claude CLI to verify content
 */
function callClaudeCLI(userInput: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${SYSTEM_PROMPT}

====================
待验证内容
====================
${userInput}

请对以上内容进行爆款要素优化，严格按照 JSON 格式输出验证报告和优化版本。只输出 JSON，不要任何其他内容。`;

    const child = spawn('claude', [
      '--output-format', 'text',
      '--allowedTools', 'WebSearch,WebFetch'
    ], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude CLI 退出码: ${code}, stderr: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    // 通过 stdin 传递 prompt
    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

/**
 * 解析并验证 JSON 输出
 */
function parseAndValidateJSON(output: string): any {
  // 尝试提取 JSON（处理可能的 markdown 代码块包裹）
  let jsonStr = output.trim();

  // 移除可能的 markdown 代码块
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // 尝试找到 JSON 对象的开始和结束
  const startIndex = jsonStr.indexOf('{');
  const endIndex = jsonStr.lastIndexOf('}');
  if (startIndex !== -1 && endIndex !== -1) {
    jsonStr = jsonStr.substring(startIndex, endIndex + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // 验证必要字段
    if (!parsed.scoreCard || !Array.isArray(parsed.scoreCard)) {
      throw new Error('缺少 scoreCard 字段');
    }
    if (typeof parsed.totalScore !== 'number') {
      throw new Error('缺少 totalScore 字段');
    }
    if (!parsed.optimizedVersion) {
      throw new Error('缺少 optimizedVersion 字段');
    }

    return parsed;
  } catch (e) {
    console.error('JSON 解析失败，原始输出:', output.substring(0, 500));
    throw new Error(`JSON 解析失败: ${e.message}`);
  }
}

/**
 * Main execution function
 */
export async function run(userInput?: string): Promise<{ reportPath: string; report: string; data: any }> {
  try {
    // 如果没有传入参数，从命令行参数获取
    let input = userInput || process.argv.slice(2).join(' ');

    // 如果参数是文件路径，则从文件读取内容
    if (input && fs.existsSync(input) && input.endsWith('.txt')) {
      const tmpFile = input;
      input = fs.readFileSync(tmpFile, 'utf-8');
      // 删除临时文件
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }

    if (!input || input.trim() === '') {
      throw new Error('请提供待验证的内容。用法: npx ts-node viral-verification.ts "你的文章内容"');
    }

    console.log('📝 正在分析内容...');
    console.log(`内容预览: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);

    // 调用 Claude CLI 验证内容
    console.log('🤖 正在使用 Claude 进行爆款要素优化...');
    const rawOutput = await callClaudeCLI(input);

    console.log('📋 正在解析 JSON 输出...');
    const data = parseAndValidateJSON(rawOutput);

    // 保存 JSON 报告
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = `verified_${dateStr}.json`;
    const reportPath = path.join(VERIFIED_DIR, reportFilename);

    const finalData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        inputLength: input.length
      },
      ...data
    };

    fs.writeFileSync(reportPath, JSON.stringify(finalData, null, 2), 'utf-8');
    console.log(`✅ 报告已保存到 ${reportPath}`);

    // 同时保存一个 .md 文件用于兼容旧代码
    const mdPath = reportPath.replace('.json', '.md');
    fs.writeFileSync(mdPath, JSON.stringify(finalData, null, 2), 'utf-8');

    return { reportPath: mdPath, report: JSON.stringify(finalData), data: finalData };

  } catch (error) {
    console.error('❌ 执行 Viral Verification Skill 出错:', error);
    throw error;
  }
}

// Allow running directly
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');

  if (!input) {
    console.log('用法: npx ts-node viral-verification.ts "你的文章内容"');
    console.log('示例: npx ts-node viral-verification.ts "这是一篇关于AI的文章..."');
    process.exit(1);
  }

  run(input).then(result => {
    console.log('\n📊 验证完成！');
    console.log(`报告已保存到: ${result.reportPath}`);
  }).catch(error => {
    process.exit(1);
  });
}

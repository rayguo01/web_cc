import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const CONTENT_DIR = path.join(OUTPUT_DIR, 'content');

// Ensure directories exist
if (!fs.existsSync(CONTENT_DIR)) {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

// JSON Schema 定义
const JSON_SCHEMA = `
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

const SYSTEM_PROMPT = `
LANGUAGE RULE（极其重要）：
- 所有输出内容必须使用【简体中文】。
- 不允许出现任何英文句子或英文表达（专有名词除外，如 AI、Twitter）。

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
`;

/**
 * Call Claude CLI to generate content
 */
function callClaudeCLI(userInput: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${SYSTEM_PROMPT}

====================
用户素材
====================
${userInput}

请基于以上素材，严格按照 JSON 格式输出三个版本的内容。只输出 JSON，不要任何其他内容。`;

    // 设置超时（3分钟）
    const TIMEOUT = 3 * 60 * 1000;
    let killed = false;

    const child = spawn('claude', [
      '--output-format', 'text',
      '--allowedTools', 'WebSearch,WebFetch'
    ], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: process.env
    });

    const timeout = setTimeout(() => {
      killed = true;
      console.error(`⏰ Claude CLI 执行超时（${TIMEOUT / 1000}秒），强制终止`);
      child.kill('SIGTERM');
    }, TIMEOUT);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // 实时输出进度
      if (text.includes('{') || text.includes('"version')) {
        console.log('📝 正在生成内容...');
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);

      if (killed) {
        reject(new Error(`Claude CLI 执行超时（超过 ${TIMEOUT / 1000} 秒）`));
        return;
      }

      if (code === 0) {
        console.log(`✅ Claude CLI 返回，输出长度: ${stdout.length}`);
        resolve(stdout.trim());
      } else {
        console.error(`❌ Claude CLI 错误，退出码: ${code}`);
        console.error(`stderr: ${stderr.substring(0, 500)}`);
        console.error(`stdout (最后500字符): ${stdout.substring(stdout.length - 500)}`);
        reject(new Error(`Claude CLI 退出码: ${code}, stderr: ${stderr.substring(0, 200)}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`❌ Claude CLI spawn 错误:`, error);
      reject(error);
    });

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
    if (!parsed.versionC || !parsed.versionC.content) {
      throw new Error('缺少 versionC.content 字段');
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

    console.log('🤖 正在使用 Claude 生成三个版本的内容...');
    const rawOutput = await callClaudeCLI(input);

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
      ...data
    };

    fs.writeFileSync(reportPath, JSON.stringify(finalData, null, 2), 'utf-8');
    console.log(`✅ 报告已保存到 ${reportPath}`);

    // 同时保存一个 .md 文件用于兼容旧代码
    const mdPath = reportPath.replace('.json', '.md');
    fs.writeFileSync(mdPath, JSON.stringify(finalData, null, 2), 'utf-8');

    return { reportPath: mdPath, report: JSON.stringify(finalData), data: finalData };

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

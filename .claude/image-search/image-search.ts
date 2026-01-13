import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const SEARCH_DIR = path.join(OUTPUT_DIR, 'image-search');

// Ensure directories exist
if (!fs.existsSync(SEARCH_DIR)) {
  fs.mkdirSync(SEARCH_DIR, { recursive: true });
}

// JSON Schema 定义
const JSON_SCHEMA = `
{
  "query": "用户搜索的关键词",
  "images": [
    {
      "url": "图片的完整URL",
      "thumbnail": "缩略图URL（如果有）",
      "title": "图片标题或描述",
      "source": "来源网站",
      "width": 宽度数字（如果知道）,
      "height": 高度数字（如果知道）
    }
  ],
  "searchSummary": "搜索结果简述"
}`;

const SYSTEM_PROMPT = `
LANGUAGE RULE（极其重要）：
- 所有输出内容必须使用【简体中文】。
- 不允许出现任何英文句子或英文表达（专有名词除外）。

================================
Role: 图片搜索专家
================================
你是一位专业的图片搜索专家，擅长根据用户描述找到最合适的网络图片。

**任务**：
1. 根据用户描述的图片需求，构建合适的搜索关键词
2. 使用 WebSearch 搜索相关图片（主要通过 Google 图片搜索）
3. 找到最相关的 6-8 张高质量图片
4. 返回图片的 URL 和相关信息

**搜索策略**：
1. 将用户描述转化为有效的图片搜索关键词
2. **优先使用 Google 图片搜索**：搜索 "关键词 site:google.com/images" 或直接搜索图片相关页面
3. 对于**名人、球星、公众人物**：
   - 搜索其官方社交媒体、新闻网站、体育网站上的高清照片
   - 例如搜索 "Messi photo 2024" "LeBron James high resolution"
   - 可以从 Getty Images、Reuters、ESPN、NBA官网 等获取图片链接
4. 对于**抽象概念或场景**：可以搜索 Unsplash、Pexels 等免费图库
5. 使用 WebFetch 访问搜索结果页面，提取其中的高清图片 URL

**图片 URL 获取技巧**：
- 从搜索结果页面找到图片的原始 URL（通常在 img 标签的 src 属性中）
- 优先选择 .jpg, .png, .webp 结尾的直链
- 对于 Google 图片，尝试获取原图链接而非缩略图
- 可以从新闻网站、体育网站的文章中提取配图 URL

**图片质量要求**：
- 高清晰度（建议宽度 > 800px）
- 与用户描述高度相关
- 适合作为社交媒体配图（Twitter/X）
- 对于人物照片，优先选择清晰的正面或侧面照

**搜索关键词构建技巧**：
- 使用英文搜索通常能获得更好的结果
- 添加 "photo" "image" "HD" "high resolution" 等关键词
- 对于球星添加 "2024" "2025" 获取最新照片
- 添加具体场景如 "playing" "celebration" "portrait" 等

====================
输出格式要求（极其重要）
====================
你必须严格按照以下 JSON 格式输出，不要输出任何其他内容：

${JSON_SCHEMA}

注意事项：
1. 输出必须是合法的 JSON 格式
2. 每张图片必须有可直接访问的 url
3. images 数组应包含 6-8 张图片
4. 不要在 JSON 前后添加任何说明文字
5. 不要使用 markdown 代码块包裹
6. 如果找不到合适的图片，images 可以是空数组，但要在 searchSummary 中说明原因
`;

/**
 * Call Claude CLI to search images
 */
function callClaudeCLI(userInput: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${SYSTEM_PROMPT}

====================
用户图片需求
====================
${userInput}

请根据以上需求搜索网络图片，严格按照 JSON 格式输出搜索结果。只输出 JSON，不要任何其他内容。`;

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
      if (text.includes('搜索') || text.includes('图片')) {
        console.log('🔍 正在搜索图片...');
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
        console.log(`✅ 图片搜索完成，输出长度: ${stdout.length}`);
        resolve(stdout.trim());
      } else {
        console.error(`❌ Claude CLI 错误，退出码: ${code}`);
        console.error(`stderr: ${stderr.substring(0, 500)}`);
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
    if (!parsed.images || !Array.isArray(parsed.images)) {
      parsed.images = [];
    }

    // 过滤无效图片
    parsed.images = parsed.images.filter((img: any) => img && img.url);

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

    // 如果参数是文件路径，则从文件读取内容
    if (input && fs.existsSync(input) && input.endsWith('.txt')) {
      const tmpFile = input;
      input = fs.readFileSync(tmpFile, 'utf-8');
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }

    if (!input || input.trim() === '') {
      throw new Error('请提供图片描述。用法: npx ts-node image-search.ts "描述你想要的图片"');
    }

    console.log('🔍 正在搜索图片...');
    console.log(`搜索关键词: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);

    console.log('🤖 正在使用 Claude 搜索网络图片...');
    const rawOutput = await callClaudeCLI(input);

    console.log('📋 正在解析搜索结果...');
    const data = parseAndValidateJSON(rawOutput);

    // 保存搜索结果
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = `search_${dateStr}.json`;
    const reportPath = path.join(SEARCH_DIR, reportFilename);

    const finalData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        query: input
      },
      ...data
    };

    fs.writeFileSync(reportPath, JSON.stringify(finalData, null, 2), 'utf-8');
    console.log(`✅ 搜索结果已保存到 ${reportPath}`);
    console.log(`📸 找到 ${data.images?.length || 0} 张相关图片`);

    return { reportPath, report: JSON.stringify(finalData), data: finalData };

  } catch (error) {
    console.error('❌ 执行 Image Search Skill 出错:', error);
    throw error;
  }
}

// Allow running directly
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');

  if (!input) {
    console.log('用法: npx ts-node image-search.ts "描述你想要的图片"');
    console.log('示例: npx ts-node image-search.ts "科技感的蓝色抽象背景"');
    process.exit(1);
  }

  run(input).then(result => {
    console.log('\n📊 搜索完成！');
    console.log(`结果已保存到: ${result.reportPath}`);
    if (result.data.images?.length > 0) {
      console.log('\n找到的图片:');
      result.data.images.forEach((img: any, i: number) => {
        console.log(`${i + 1}. ${img.title || '无标题'}`);
        console.log(`   URL: ${img.url}`);
      });
    }
  }).catch(error => {
    process.exit(1);
  });
}

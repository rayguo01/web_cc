import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseRobustJSON } from '../utils/json-parser';

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

**必须使用 XML 标签分隔思维过程和 JSON 结果，避免解析错误**

## 格式要求

<reasoning>
你的搜索过程...
- 分析用户的图片需求
- 构建搜索关键词
- 描述找到的图片来源
</reasoning>

<result>
${JSON_SCHEMA}
</result>

## 注意事项
1. <result> 标签内必须是合法的 JSON 格式
2. 每张图片必须有可直接访问的 url
3. images 数组应包含 6-8 张图片
4. 不要在 <result> 标签内添加 markdown 代码块
5. 所有标点符号必须使用英文半角字符（不要使用中文全角标点如：，。；等）
6. 如果找不到合适的图片，images 可以是空数组，但要在 searchSummary 中说明原因
`;

/**
 * Call AI to search images
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

    // Windows 兼容
    const isWindows = process.platform === 'win32';
    // 将命令合并为字符串，避免 DEP0190 警告
    const fullCommand = `claude --output-format text --allowedTools WebSearch,WebFetch`;

    const child = spawn(fullCommand, [], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: process.env
    });

    const timeout = setTimeout(() => {
      killed = true;
      console.error(`⏰ AI 执行超时（${TIMEOUT / 1000}秒），强制终止`);
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
        reject(new Error(`AI 执行超时（超过 ${TIMEOUT / 1000} 秒）`));
        return;
      }

      if (code === 0) {
        console.log(`✅ 图片搜索完成，输出长度: ${stdout.length}`);
        resolve(stdout.trim());
      } else {
        console.error(`❌ AI 错误，退出码: ${code}`);
        console.error(`stderr: ${stderr.substring(0, 500)}`);
        reject(new Error(`AI 退出码: ${code}, stderr: ${stderr.substring(0, 200)}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`❌ AI spawn 错误:`, error);
      reject(error);
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

/**
 * 解析并验证 JSON 输出
 * 使用健壮的 JSON 解析器，支持多层回退
 */
function parseAndValidateJSON(output: string): any {
  // 使用健壮的 JSON 解析器
  const result = parseRobustJSON(output, (data) => {
    // images 字段不是必须的，可以是空数组
    if (data.images && !Array.isArray(data.images)) {
      return { valid: false, error: 'images 字段必须是数组' };
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

  const data = result.data;

  // 确保 images 是数组
  if (!data.images || !Array.isArray(data.images)) {
    data.images = [];
  }

  // 过滤无效图片
  data.images = data.images.filter((img: any) => img && img.url);

  return data;
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

    console.log('🤖 正在使用 AI 搜索网络图片...');
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
      ...data,
      // 使用 Claude CLI text 模式，无法获取 token 使用信息
      _usage: null
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

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseRobustJSON } from '../utils/json-parser';

// 1. Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const TRENDS_DIR = path.join(OUTPUT_DIR, 'trends');

// Ensure directories exist
if (!fs.existsSync(TRENDS_DIR)) {
  fs.mkdirSync(TRENDS_DIR, { recursive: true });
}

interface HotItem {
  rank: string;
  title: string;
  link: string;
  hot: string;
  source: string;
}

const TOPHUB_URL = 'https://tophub.today/hot';

/**
 * Fetch hot list from TopHub
 */
export async function fetchHotList(): Promise<HotItem[]> {
  console.log(`正在抓取 ${TOPHUB_URL}...`);
  const response = await fetch(TOPHUB_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tophub: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const items: HotItem[] = [];

  $('.child-item').each((_, element) => {
    const el = $(element);
    const rank = el.find('.left-item span').text().trim();
    const titleLink = el.find('.medium-txt a');
    const title = titleLink.text().trim();
    const link = titleLink.attr('href') || '';
    
    // Some links might be relative
    const fullLink = link.startsWith('http') ? link : `https://tophub.today${link}`;
    
    const smallTxt = el.find('.small-txt').text().trim();
    // smallTxt format: "知乎 ‧ 958万热度"
    const parts = smallTxt.split('‧').map(s => s.trim());
    const source = parts[0] || '';
    const hot = parts[1] || '';

    if (title) {
      items.push({
        rank,
        title,
        link: fullLink,
        source,
        hot
      });
    }
  });

  return items;
}

/**
 * Call Claude CLI to analyze data
 * 使用 stdin 传递 prompt，避免命令行长度限制
 */
function callClaudeCLI(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--output-format', 'text'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
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
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// JSON Schema 定义（合并高潜力话题和选题建议）
const JSON_SCHEMA = `
{
  "overview": "热点概览，简要总结当前热门话题的整体趋势",
  "categories": {
    "分类名称": ["话题1", "话题2"]
  },
  "suggestions": [
    {
      "rank": 1,
      "topic": "原始话题名称",
      "source": "来源平台（如：知乎、微博、B站等）",
      "link": "原始话题链接（从输入数据中提取）",
      "score": "潜力评分（高/中/低）",
      "reason": "为什么这个话题有潜力（简要说明）",
      "angle": "选题角度/标题建议",
      "whyEffective": "为什么这个选题角度有效，流量潜力解释",
      "directions": ["创作方向1", "创作方向2", "创作方向3"]
    }
  ],
  "summary": "总结与建议，整体内容策略建议"
}`;

/**
 * Analyze the list using Claude CLI
 */
export async function analyzeHotList(items: HotItem[]): Promise<string> {
  const topItems = items.slice(0, 30); // Analyze top 30 items
  const itemsText = topItems.map(item =>
    `${item.rank}. [${item.source}] ${item.title} (Hot: ${item.hot}) - Link: ${item.link}`
  ).join('\n');

  const prompt = `你是一位内容策略专家。以下是来自 TopHub 的当前热门话题列表：

${itemsText}

请执行以下任务：

1. **流量潜力分析 + 选题建议**：
   - 从上述话题中筛选出 5-8 个最具病毒式传播潜力的话题
   - 关注那些能引起强烈好奇心、争议性或紧迫感的话题
   - **每个高潜力话题都必须给出具体的选题角度和创作方向**
   - 保留话题的来源平台信息（如：知乎、微博、B站等）

2. **话题分类**：将所有热门话题按类别分组（如：科技、娱乐、政治、体育、社会热点等）。

3. **内容策略总结**：提供整体内容策略建议。

====================
输出格式要求（极其重要）
====================

**必须使用 XML 标签分隔思维过程和 JSON 结果，避免解析错误**

## 格式要求

<reasoning>
你的分析过程...
- 快速浏览热门话题
- 筛选高潜力话题
- 为每个高潜力话题构思选题角度
</reasoning>

<result>
${JSON_SCHEMA}
</result>

## 注意事项
1. <result> 标签内必须是合法的 JSON 格式
2. suggestions 必须包含 5-8 个高潜力话题，每个都要有完整的选题建议
3. 每个 suggestion 必须包含: rank, topic, source, link, score, reason, angle, whyEffective, directions
4. categories 至少包含 3 个分类
5. 每个 suggestion 的 directions 必须是包含 2-4 个创作方向的数组
6. 不要在 <result> 标签内添加 markdown 代码块
7. 所有标点符号必须使用英文半角字符（不要使用中文全角标点如：，。；等）`;

  console.log('🤖 正在使用 Claude CLI 分析热榜数据...');

  return await callClaudeCLI(prompt);
}

/**
 * 解析并验证 JSON 输出
 * 使用健壮的 JSON 解析器，支持多层回退
 */
function parseAndValidateJSON(output: string): any {
  // 使用健壮的 JSON 解析器
  const result = parseRobustJSON(output, (data) => {
    // 验证必要字段
    if (!data.suggestions || !Array.isArray(data.suggestions)) {
      return { valid: false, error: '缺少 suggestions 字段' };
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
 * 仅抓取数据（不分析）
 * 用于调度器分离抓取和分析阶段
 */
export async function fetchOnly(): Promise<{ items: HotItem[]; rawPath: string }> {
  const items = await fetchHotList();
  console.log(`✅ 获取到 ${items.length} 条热榜数据`);

  // Save Raw Data
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const rawFilename = `tophub_hot_${dateStr}.json`;
  const rawPath = path.join(TRENDS_DIR, rawFilename);

  fs.writeFileSync(rawPath, JSON.stringify(items, null, 2));
  console.log(`✅ 原始数据已保存到 ${rawPath}`);

  return { items, rawPath };
}

/**
 * 仅分析数据（不抓取）
 * 用于调度器分离抓取和分析阶段
 */
export async function analyzeOnly(items: HotItem[]): Promise<{ reportPath: string; report: string; data: any }> {
  const rawOutput = await analyzeHotList(items);

  console.log('📋 正在解析 JSON 输出...');
  const data = parseAndValidateJSON(rawOutput);

  // Save JSON Report
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFilename = `tophub_analysis_${dateStr}.json`;
  const reportPath = path.join(TRENDS_DIR, reportFilename);

  const finalData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'tophub.today',
      itemCount: items.length
    },
    ...data
  };

  fs.writeFileSync(reportPath, JSON.stringify(finalData, null, 2), 'utf-8');
  console.log(`✅ JSON 报告已保存到 ${reportPath}`);

  // 同时保存 .md 文件用于兼容旧代码
  const mdPath = reportPath.replace('.json', '.md');
  fs.writeFileSync(mdPath, JSON.stringify(finalData, null, 2), 'utf-8');

  return { reportPath: mdPath, report: JSON.stringify(finalData), data: finalData };
}

/**
 * Main execution function
 */
export async function run(): Promise<{ reportPath: string; report: string; data: any }> {
  try {
    // 1. Fetch
    const { items } = await fetchOnly();

    // 2. Analyze
    return await analyzeOnly(items);

  } catch (error) {
    console.error('❌ 执行 TopHub Skill 出错:', error);
    throw error;
  }
}

// Allow running directly with mode argument
// Usage:
//   npx ts-node tophub.ts              # 完整流程（抓取+分析）
//   npx ts-node tophub.ts fetch        # 仅抓取
//   npx ts-node tophub.ts analyze <json>       # 仅分析（JSON 数据）
//   npx ts-node tophub.ts analyze-file <path>  # 仅分析（从文件读取）
if (require.main === module) {
  const mode = process.argv[2] || 'full';

  if (mode === 'fetch') {
    fetchOnly().then(result => {
      // 输出 JSON 格式供调度器解析
      console.log('__FETCH_RESULT__');
      console.log(JSON.stringify(result.items));
    }).catch(error => {
      console.error(error);
      process.exit(1);
    });
  } else if (mode === 'analyze-file') {
    // 从文件读取 JSON 数据（推荐方式，避免 shell 转义问题）
    const filePath = process.argv[3];
    if (!filePath) {
      console.error('错误: analyze-file 模式需要提供文件路径');
      process.exit(1);
    }
    try {
      const jsonData = fs.readFileSync(filePath, 'utf-8');
      const items = JSON.parse(jsonData);
      analyzeOnly(items).then(result => {
        console.log('\n📊 分析完成！');
        console.log(`报告已保存到: ${result.reportPath}`);
      }).catch(error => {
        console.error(error);
        process.exit(1);
      });
    } catch (e) {
      console.error('错误: 读取或解析文件失败:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  } else if (mode === 'analyze') {
    const jsonData = process.argv[3];
    if (!jsonData) {
      console.error('错误: analyze 模式需要提供 JSON 数据');
      process.exit(1);
    }
    try {
      const items = JSON.parse(jsonData);
      analyzeOnly(items).then(result => {
        console.log('\n📊 分析完成！');
        console.log(`报告已保存到: ${result.reportPath}`);
      }).catch(error => {
        console.error(error);
        process.exit(1);
      });
    } catch (e) {
      console.error('错误: JSON 解析失败');
      process.exit(1);
    }
  } else {
    // 默认：完整流程
    run().then(result => {
      console.log('\n📊 分析完成！');
      console.log(`报告已保存到: ${result.reportPath}`);
    }).catch(error => {
      process.exit(1);
    });
  }
}

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { parseRobustJSON } from '../utils/json-parser';
import { callClaude, ClaudeUsage, formatUsageLog } from '../utils/claude-cli';

// 1. Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const TRENDS_DIR = path.join(OUTPUT_DIR, 'trends');

// Ensure directories exist
if (!fs.existsSync(TRENDS_DIR)) {
  fs.mkdirSync(TRENDS_DIR, { recursive: true });
}

interface TrendItem {
  rank: number;
  name: string;
  tweets: string;
  url: string;
}

const GETDAYTRENDS_URL = 'https://getdaytrends.com/';

/**
 * Fetch trending topics from getdaytrends.com
 * 抓取 Twitter Trends Worldwide 前15个趋势
 */
export async function fetchTrends(): Promise<TrendItem[]> {
  console.log(`正在抓取 ${GETDAYTRENDS_URL}...`);
  const response = await fetch(GETDAYTRENDS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch getdaytrends: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const items: TrendItem[] = [];

  // 查找 "Twitter Trends Worldwide" 部分
  // 页面结构: 表格行包含排名、趋势名称、推文数
  $('table tbody tr').each((index, element) => {
    if (index >= 15) return false; // 只取前15个

    const el = $(element);
    const cells = el.find('td');

    if (cells.length >= 2) {
      // 第一列是排名，第二列包含趋势名称链接
      const nameLink = cells.eq(1).find('a').first();
      const name = nameLink.text().trim();

      if (!name) return;

      // 生成 X 搜索链接
      const url = `https://x.com/search?q=${encodeURIComponent(name)}`;

      // 获取推文数（可能在第三列或名称旁边）
      let tweets = 'N/A';
      const tweetText = cells.eq(2).text().trim();
      if (tweetText) {
        tweets = tweetText;
      }

      items.push({
        rank: index + 1,
        name,
        tweets,
        url
      });
    }
  });

  // 备用选择器：如果表格选择器没有结果，尝试其他结构
  if (items.length === 0) {
    // 尝试查找趋势链接
    $('a[href^="/trend/"]').each((index, element) => {
      if (index >= 15) return false;

      const el = $(element);
      const name = el.text().trim();

      if (!name || name === 'View details') return;

      // 生成 X 搜索链接
      const url = `https://x.com/search?q=${encodeURIComponent(name)}`;

      // 查找相邻的推文数
      const parent = el.parent();
      const tweetMatch = parent.text().match(/(\d+\.?\d*[KMB]?\s*tweets?|Under \d+K tweets?)/i);
      const tweets = tweetMatch ? tweetMatch[1] : 'N/A';

      items.push({
        rank: items.length + 1,
        name,
        tweets,
        url
      });
    });
  }

  console.log(`✅ 获取到 ${items.length} 条热门趋势`);
  return items;
}

// 存储最近一次调用的 usage 信息
let lastUsage: ClaudeUsage | null = null;

/**
 * 获取最近一次调用的 usage 信息
 */
export function getLastUsage(): ClaudeUsage | null {
  return lastUsage;
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
      "url": "X搜索链接（格式：https://x.com/search?q=话题名称编码）",
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
 * Analyze using AI
 */
export async function analyzeTrends(items: TrendItem[]): Promise<string> {
  const topItems = items.slice(0, 15); // Analyze top 15 items
  const itemsText = topItems.map(item =>
    `${item.rank}. ${item.name} (Tweets: ${item.tweets}) - ${item.url}`
  ).join('\n');

  const prompt = `你是一位内容策略专家。以下是来自 X(Twitter) 的当前热门趋势话题：

${itemsText}

请执行以下任务：

1. **流量潜力分析 + 选题建议**：
   - 从上述话题中筛选出 5-8 个最具病毒式传播潜力的话题
   - 关注那些能引起强烈好奇心、争议性或紧迫感的话题
   - **每个高潜力话题都必须给出具体的选题角度和创作方向**

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
3. 每个 suggestion 必须包含: rank, topic, url, score, reason, angle, whyEffective, directions
4. categories 至少包含 3 个分类
5. 每个 suggestion 的 directions 必须是包含 2-4 个创作方向的数组
6. 不要在 <result> 标签内添加 markdown 代码块
7. 所有标点符号必须使用英文半角字符（不要使用中文全角标点如：，。；等）`;

  console.log('🤖 正在使用 AI 分析趋势...');

  const response = await callClaude(prompt);
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
export async function fetchOnly(): Promise<{ items: TrendItem[]; rawPath: string }> {
  const items = await fetchTrends();
  console.log(`✅ 获取到 ${items.length} 条热门趋势`);

  if (items.length === 0) {
    throw new Error('未找到热门趋势数据，网站结构可能已更改。');
  }

  // Save Raw Data
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const rawFilename = `x_trends_${dateStr}.json`;
  const rawPath = path.join(TRENDS_DIR, rawFilename);

  fs.writeFileSync(rawPath, JSON.stringify(items, null, 2));
  console.log(`✅ 原始数据已保存到 ${rawPath}`);

  return { items, rawPath };
}

/**
 * 仅分析数据（不抓取）
 * 用于调度器分离抓取和分析阶段
 */
export async function analyzeOnly(items: TrendItem[]): Promise<{ reportPath: string; report: string; data: any; usage?: ClaudeUsage }> {
  const rawOutput = await analyzeTrends(items);

  console.log('📋 正在解析 JSON 输出...');
  const data = parseAndValidateJSON(rawOutput);

  // Save JSON Report
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFilename = `x_trends_analysis_${dateStr}.json`;
  const reportPath = path.join(TRENDS_DIR, reportFilename);

  const finalData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'getdaytrends.com',
      itemCount: items.length
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
  console.log(`✅ JSON 报告已保存到 ${reportPath}`);

  // 同时保存 .md 文件用于兼容旧代码
  const mdPath = reportPath.replace('.json', '.md');
  fs.writeFileSync(mdPath, JSON.stringify(finalData, null, 2), 'utf-8');

  return { reportPath: mdPath, report: JSON.stringify(finalData), data: finalData, usage: lastUsage || undefined };
}

/**
 * Main execution function
 */
export async function run(): Promise<{ reportPath: string; report: string; data: any; usage?: ClaudeUsage }> {
  try {
    // 1. Fetch
    const { items, rawPath } = await fetchOnly();

    // 2. Analyze
    return await analyzeOnly(items);

  } catch (error) {
    console.error('❌ 执行 X Trends Skill 出错:', error);
    throw error;
  }
}

// Allow running directly with mode argument
// Usage:
//   npx ts-node x-trends.ts              # 完整流程（抓取+分析）
//   npx ts-node x-trends.ts fetch        # 仅抓取
//   npx ts-node x-trends.ts analyze <json>       # 仅分析（JSON 数据）
//   npx ts-node x-trends.ts analyze-file <path>  # 仅分析（从文件读取）
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

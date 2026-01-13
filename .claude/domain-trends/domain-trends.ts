/**
 * Domain Trends - 特定领域趋势追踪
 * 从 twitterapi.io 抓取特定领域的推文并分析
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TwitterApiClient, buildSearchQuery } from './twitter-api-client';
import { DomainConfig, DomainTweet, DomainTrendItem, AggregatedTopic } from './types';
import { parseRobustJSON } from '../utils/json-parser';

// 路径配置
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const TRENDS_DIR = path.join(OUTPUT_DIR, 'trends/domain');
const PRESETS_DIR = path.join(__dirname, 'presets');

// 确保目录存在
if (!fs.existsSync(TRENDS_DIR)) {
  fs.mkdirSync(TRENDS_DIR, { recursive: true });
}

/**
 * 加载预设配置
 */
export function loadPreset(presetId: string): DomainConfig {
  const presetPath = path.join(PRESETS_DIR, `${presetId}.json`);

  if (!fs.existsSync(presetPath)) {
    throw new Error(`预设配置不存在: ${presetId}`);
  }

  const content = fs.readFileSync(presetPath, 'utf-8');
  return JSON.parse(content) as DomainConfig;
}

/**
 * 获取所有可用预设
 */
export function getAvailablePresets(): Array<{ id: string; name: string; description: string }> {
  const files = fs.readdirSync(PRESETS_DIR).filter(f => f.endsWith('.json'));

  return files.map(file => {
    const content = fs.readFileSync(path.join(PRESETS_DIR, file), 'utf-8');
    const config = JSON.parse(content) as DomainConfig;
    return {
      id: config.id,
      name: config.name,
      description: config.description
    };
  });
}

/**
 * 抓取推文数据
 */
export async function fetchTweets(config: DomainConfig): Promise<DomainTweet[]> {
  const apiKey = process.env.TWITTER_API_IO_KEY;

  if (!apiKey) {
    throw new Error('缺少环境变量 TWITTER_API_IO_KEY');
  }

  const client = new TwitterApiClient({ apiKey });
  const allTweets: DomainTweet[] = [];
  const seenIds = new Set<string>();

  // 1. 关键词搜索（默认24小时内）
  const hoursAgo = config.hoursAgo ?? 24;
  const query = buildSearchQuery(config.query, hoursAgo);
  console.log(`📡 搜索查询: ${query}`);
  console.log(`⏰ 时间范围: 最近 ${hoursAgo} 小时`);

  const searchTweets = await client.search(
    query,
    config.fetchCount,
    config.kols.enabled ? config.kols.accounts : []
  );

  for (const tweet of searchTweets) {
    if (!seenIds.has(tweet.id)) {
      seenIds.add(tweet.id);
      allTweets.push(tweet);
    }
  }

  console.log(`✅ 关键词搜索: ${searchTweets.length} 条推文`);

  // 2. KOL 推文抓取
  if (config.kols.enabled && config.kols.accounts.length > 0) {
    const kolTweets = await client.getKolTweets(
      config.kols.accounts,
      config.kols.tweetsPerKol,
      config.kols.minLikes
    );

    for (const tweet of kolTweets) {
      if (!seenIds.has(tweet.id)) {
        seenIds.add(tweet.id);
        allTweets.push(tweet);
      }
    }

    console.log(`✅ KOL 推文: ${kolTweets.length} 条`);
  }

  console.log(`✅ 总计: ${allTweets.length} 条唯一推文`);
  return allTweets;
}

/**
 * 聚合推文数据，生成趋势列表
 */
export function aggregateTweets(tweets: DomainTweet[]): DomainTrendItem[] {
  // 按 hashtag 聚合
  const hashtagMap = new Map<string, DomainTweet[]>();

  for (const tweet of tweets) {
    for (const tag of tweet.hashtags) {
      const key = tag.toLowerCase();
      if (!hashtagMap.has(key)) {
        hashtagMap.set(key, []);
      }
      hashtagMap.get(key)!.push(tweet);
    }
  }

  // 计算每个话题的热度
  const topics: AggregatedTopic[] = [];

  for (const [topic, topicTweets] of hashtagMap) {
    const totalLikes = topicTweets.reduce((sum, t) => sum + t.likes, 0);
    const totalRetweets = topicTweets.reduce((sum, t) => sum + t.retweets, 0);

    // KOL 推文加权
    const kolBonus = topicTweets.filter(t => t.isKol).length * 500;

    topics.push({
      topic: `#${topic}`,
      tweets: topicTweets,
      totalLikes,
      totalRetweets,
      engagement: totalLikes + totalRetweets * 2 + kolBonus
    });
  }

  // 排序并转换为 TrendItem
  return topics
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 15)
    .map((t, index) => ({
      rank: index + 1,
      topic: t.topic,
      engagement: t.engagement,
      tweetCount: t.tweets.length,
      topTweet: t.tweets.sort((a, b) => b.likes - a.likes)[0],
      url: `https://x.com/search?q=${encodeURIComponent(t.topic)}`
    }));
}

/**
 * 调用 Claude CLI 分析
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

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// JSON Schema
const JSON_SCHEMA = `
{
  "overview": "热点概览，简要总结当前领域的热门话题趋势",
  "categories": {
    "分类名称": ["话题1", "话题2"]
  },
  "suggestions": [
    {
      "rank": 1,
      "topic": "原始话题名称",
      "url": "X搜索链接",
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
 * 分析趋势
 */
export async function analyzeTrends(
  items: DomainTrendItem[],
  config: DomainConfig
): Promise<string> {
  const itemsText = items.map(item => {
    const tweet = item.topTweet;
    return `${item.rank}. ${item.topic} (互动: ${item.engagement}, 推文数: ${item.tweetCount})
   代表推文: "${tweet.text.substring(0, 100)}..." by @${tweet.author}
   链接: ${item.url}`;
  }).join('\n\n');

  const prompt = `你是一位内容策略专家。以下是来自 X(Twitter) 的 **${config.name}** 领域热门话题：

${itemsText}

请执行以下任务：

1. **流量潜力分析 + 选题建议**：
   - 从上述话题中筛选出 5-8 个最具病毒式传播潜力的话题
   - 关注那些能引起强烈好奇心、争议性或紧迫感的话题
   - **每个高潜力话题都必须给出具体的选题角度和创作方向**

2. **话题分类**：将所有热门话题按类别分组。

3. **内容策略总结**：针对 ${config.name} 领域提供整体内容策略建议。

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
7. 所有标点符号必须使用英文半角字符`;

  console.log('🤖 正在使用 Claude CLI 分析趋势...');
  return await callClaudeCLI(prompt);
}

/**
 * 解析并验证 JSON 输出
 */
function parseAndValidateJSON(output: string): any {
  const result = parseRobustJSON(output, (data) => {
    if (!data.suggestions || !Array.isArray(data.suggestions)) {
      return { valid: false, error: '缺少 suggestions 字段' };
    }
    return { valid: true };
  });

  if (!result.success) {
    console.error('JSON 解析失败:', result.error);
    throw new Error(result.error || 'JSON 解析失败');
  }

  return result.data;
}

/**
 * 主执行函数
 */
export async function run(presetId: string = 'web3'): Promise<{
  reportPath: string;
  report: string;
  data: any;
}> {
  try {
    console.log(`\n🎯 开始 Domain Trends 抓取 [${presetId}]`);

    // 1. 加载配置
    const config = loadPreset(presetId);
    console.log(`📋 配置: ${config.name}`);

    // 2. 抓取推文
    const tweets = await fetchTweets(config);

    if (tweets.length === 0) {
      throw new Error('未获取到任何推文');
    }

    // 3. 保存原始数据
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const rawFilename = `${presetId}_tweets_${dateStr}.json`;
    const rawPath = path.join(TRENDS_DIR, rawFilename);

    fs.writeFileSync(rawPath, JSON.stringify(tweets, null, 2));
    console.log(`✅ 原始数据已保存: ${rawPath}`);

    // 4. 聚合数据
    const trendItems = aggregateTweets(tweets);
    console.log(`📊 聚合后话题数: ${trendItems.length}`);

    // 5. Claude 分析
    const rawOutput = await analyzeTrends(trendItems, config);

    console.log('📋 正在解析 JSON 输出...');
    const data = parseAndValidateJSON(rawOutput);

    // 6. 保存报告
    const reportFilename = `${presetId}_analysis_${dateStr}.json`;
    const reportPath = path.join(TRENDS_DIR, reportFilename);

    const finalData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        source: `domain-trends:${presetId}`,
        preset: presetId,
        presetName: config.name,
        tweetCount: tweets.length,
        rawDataFile: rawFilename
      },
      ...data
    };

    fs.writeFileSync(reportPath, JSON.stringify(finalData, null, 2), 'utf-8');
    console.log(`✅ 分析报告已保存: ${reportPath}`);

    return {
      reportPath,
      report: JSON.stringify(finalData),
      data: finalData
    };

  } catch (error) {
    console.error('❌ Domain Trends 执行出错:', error);
    throw error;
  }
}

// 命令行执行
if (require.main === module) {
  const presetId = process.argv[2] || 'web3';

  run(presetId).then(result => {
    console.log('\n📊 分析完成！');
    console.log(`报告已保存到: ${result.reportPath}`);
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

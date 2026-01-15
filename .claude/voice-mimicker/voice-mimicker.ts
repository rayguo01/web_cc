/**
 * Voice Mimicker - 特定推主语气模仿器
 * 抓取指定推主的推文，分析风格，生成模仿 Prompt
 */
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { callClaude, ClaudeUsage, formatUsageLog } from '../utils/claude-cli';

// 路径配置
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs/voice-prompts');

// 确保目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface Tweet {
  id: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  createdAt: string;
}

interface RawTweet {
  id: string;
  text: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  createdAt?: string;
}

interface AnalysisResult {
  username: string;
  displayName: string;
  avatarUrl: string;
  tweetCount: number;
  totalChars: number;
  promptContent: string;
  sampleTweets: string[];
  role: string | null;
  coreTraits: string[] | null;
  domains: string[] | null;
  usage?: ClaudeUsage;
}

interface UserInfo {
  username: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * 获取用户信息（display name 和头像）
 */
async function fetchUserInfo(username: string): Promise<UserInfo> {
  const apiKey = process.env.TWITTER_API_IO_KEY;

  if (!apiKey) {
    throw new Error('缺少环境变量 TWITTER_API_IO_KEY');
  }

  console.log(`👤 正在获取 @${username} 的用户信息...`);

  const response = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${username}`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    console.log(`⚠️ 获取用户信息失败，使用默认值`);
    return {
      username,
      displayName: username,
      avatarUrl: `https://unavatar.io/twitter/${username}`
    };
  }

  const data = await response.json() as {
    data?: {
      name?: string;
      userName?: string;
      profileImageUrl?: string;
    }
  };

  const user = data.data;
  if (!user) {
    return {
      username,
      displayName: username,
      avatarUrl: `https://unavatar.io/twitter/${username}`
    };
  }

  console.log(`✅ 用户信息: ${user.name} (@${user.userName})`);

  return {
    username: user.userName || username,
    displayName: user.name || username,
    avatarUrl: user.profileImageUrl?.replace('_normal', '_400x400') || `https://unavatar.io/twitter/${username}`
  };
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从 Markdown 中提取 Role、Core Traits 和 Domains
 */
function extractRoleAndTraits(markdown: string): { role: string | null; coreTraits: string[] | null; domains: string[] | null } {
  let role: string | null = null;
  let coreTraits: string[] | null = null;
  let domains: string[] | null = null;

  // 提取 Role（格式: # Role: XXX 或 # XXX）
  const roleMatch = markdown.match(/^#\s*(?:Role:\s*)?(.+?)$/m);
  if (roleMatch) {
    role = roleMatch[1].trim();
  }

  // 提取 Core Traits（在 ## Core Traits 或类似标题下的列表项）
  const traitsSection = markdown.match(/##\s*(?:\d+\.\s*)?Core\s*Traits[:\s]*\n([\s\S]*?)(?=\n##|\n#|$)/i);
  if (traitsSection) {
    const traitsText = traitsSection[1];
    // 匹配列表项（以 - 或 * 或数字开头）
    const traitMatches = traitsText.match(/^[\s]*[-*•]\s*\*?\*?(.+?)(?:\*?\*?)$/gm);
    if (traitMatches) {
      coreTraits = traitMatches.map(t => {
        // 清理格式：移除前导符号、粗体标记等
        return t.replace(/^[\s]*[-*•]\s*/, '').replace(/\*\*/g, '').trim();
      }).filter(t => t.length > 0);
    }
  }

  // 提取 Domains（在 ## Domains 或 ## 领域 标题下的列表项）
  const domainsSection = markdown.match(/##\s*(?:\d+\.\s*)?(?:Domains?|领域)[:\s]*\n([\s\S]*?)(?=\n##|\n#|$)/i);
  if (domainsSection) {
    const domainsText = domainsSection[1];
    const domainMatches = domainsText.match(/^[\s]*[-*•]\s*\*?\*?(.+?)(?:\*?\*?)$/gm);
    if (domainMatches) {
      domains = domainMatches.map(d => {
        return d.replace(/^[\s]*[-*•]\s*/, '').replace(/\*\*/g, '').trim();
      }).filter(d => d.length > 0);
    }
  }

  return { role, coreTraits, domains };
}

/**
 * 抓取用户推文（使用 advanced_search 端点，支持分页获取更多）
 */
async function fetchUserTweets(username: string, minChars: number = 100, targetCount: number = 15): Promise<Tweet[]> {
  const apiKey = process.env.TWITTER_API_IO_KEY;

  if (!apiKey) {
    throw new Error('缺少环境变量 TWITTER_API_IO_KEY');
  }

  console.log(`📡 正在抓取 @${username} 的推文（使用 advanced_search）...`);

  const allTweets: Tweet[] = [];
  let cursor = '';
  let pageCount = 0;
  const maxPages = 10; // 最多翻10页，获取足够多的推文

  while (allTweets.length < targetCount && pageCount < maxPages) {
    // 使用 advanced_search 端点，通过 from:username 查询用户推文
    const params = new URLSearchParams({
      query: `from:${username} -is:retweet`,  // 排除转发
      queryType: 'Top'  // Top 排序获取高质量推文
    });
    if (cursor) {
      params.append('cursor', cursor);
    }

    const response = await fetch(`https://api.twitterapi.io/twitter/tweet/advanced_search?${params.toString()}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 错误: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as {
      tweets?: RawTweet[];
      has_next_page?: boolean;
      next_cursor?: string;
    };

    // advanced_search 推文在顶层 tweets
    const rawTweets = data.tweets || [];
    const hasNextPage = data.has_next_page;
    const nextCursor = data.next_cursor;

    if (rawTweets.length === 0) {
      console.log(`📭 没有更多推文`);
      break;
    }

    console.log(`📥 第 ${pageCount + 1} 页获取到 ${rawTweets.length} 条推文`);

    // 过滤：只保留字数超过 minChars 的推文
    for (const t of rawTweets) {
      const text = t.text || '';
      // 过滤字数
      if (text.length < minChars) continue;

      allTweets.push({
        id: t.id,
        text: t.text,
        likes: t.likeCount || 0,
        retweets: t.retweetCount || 0,
        replies: t.replyCount || 0,
        createdAt: t.createdAt || ''
      });

      if (allTweets.length >= targetCount) break;
    }

    pageCount++;

    // 检查是否有下一页
    if (!hasNextPage || !nextCursor) {
      console.log(`📭 没有更多页面`);
      break;
    }

    cursor = nextCursor;

    // 已经够了就不再翻页
    if (allTweets.length >= targetCount) break;

    // 短暂延迟避免请求过快
    await delay(500);
  }

  console.log(`✅ 共获取 ${allTweets.length} 条推文（>= ${minChars} 字，共翻 ${pageCount} 页）`);

  return allTweets;
}

// 存储最近一次调用的 usage 信息
let lastUsage: ClaudeUsage | null = null;

/**
 * 获取最近一次调用的 usage 信息
 */
export function getLastUsage(): ClaudeUsage | null {
  return lastUsage;
}

/**
 * 分析推文风格并生成 Prompt
 */
async function analyzeStyle(username: string, tweets: Tweet[]): Promise<string> {
  // 准备语料
  const corpus = tweets.map((t, i) => `--- 推文 ${i + 1} ---\n${t.text}`).join('\n\n');
  const totalChars = tweets.reduce((sum, t) => sum + t.text.length, 0);

  console.log(`📊 语料统计: ${tweets.length} 条推文, 共 ${totalChars} 字`);

  const prompt = `You are an expert linguistic analyst. Your task is to analyze the provided text samples from Twitter user @${username} and create a "Style Persona" system prompt that can be used to mimic their writing style.

**Input Text Samples (${tweets.length} tweets, ${totalChars} characters total):**

${corpus}

---

**Output Requirements:**

Please output ONLY the system prompt in Markdown format, ready to be used by an LLM to mimic this person.
Start directly with "# Role: [Name/Archetype based on @${username}]".

**The System Prompt must include:**

1. **Role Definition**: A concise archetype describing their online persona (e.g., "The Cynical Developer", "The Crypto Philosopher").

2. **Domains**: 1-3 bullet points listing the main content areas/fields this person focuses on (e.g., "Crypto/Web3", "AI/Machine Learning", "Startups", "Personal Development", "Finance", "Tech", "Gaming", etc.). Use short, concise labels.

3. **Core Traits**: 3-4 bullet points defining their personality as observed in the tweets.

4. **Writing Style Guidelines**:
   - **Visual Structure**: How do they use line breaks? Do they write long paragraphs or short bursts?
   - **Sentence Structure**: Do they use fragments? Run-on sentences? Questions?
   - **Tone & Vocabulary**: Key slang, catchphrases, sentence endings (e.g., "~", "...", "！", emojis).
   - **Language Mix**: Do they mix languages (e.g., English/Chinese)?

5. **Anti-AI Rules (CRITICAL)**:
   - 🚫 List specific phrases this person would NEVER use (e.g., "总而言之", "希望能帮到你", "作为AI")
   - 🚫 List writing patterns to avoid (e.g., overly formal explanations, complete grammatical sentences)
   - 🚫 List any generic AI tendencies that don't match this person's style

6. **Few-Shot Examples**:
   - Include 3-5 of the BEST examples from the input tweets
   - Format as direct quotes that capture the essence of their style

**Important Notes:**
- Focus on what makes this person's writing DISTINCTIVE and HUMAN
- The prompt should help an AI write tweets that could pass as this person's actual posts
- Pay special attention to line breaks, punctuation, and informal language patterns`;

  console.log('🤖 正在使用 AI 分析风格...');
  const response = await callClaude(prompt);
  lastUsage = response.usage;
  console.log(`📊 ${formatUsageLog(response.usage)}`);

  return response.result;
}

/**
 * 主执行函数
 */
async function run(username: string): Promise<AnalysisResult> {
  // 清理用户名（移除 @ 符号）
  const cleanUsername = username.replace(/^@/, '').trim();

  if (!cleanUsername) {
    throw new Error('请提供有效的 Twitter 用户名');
  }

  console.log(`\n🎭 开始分析 @${cleanUsername} 的写作风格\n`);

  // 1. 抓取推文 - 分层策略
  let tweets = await fetchUserTweets(cleanUsername, 100, 15);
  let minCharsUsed = 100;

  // 如果长推文不够，降低到 50 字
  if (tweets.length < 5) {
    console.log(`⚠️ >= 100 字的推文不足，尝试 >= 50 字...`);
    tweets = await fetchUserTweets(cleanUsername, 50, 15);
    minCharsUsed = 50;
  }

  // 如果还不够，使用所有非转发推文（不限字数）
  if (tweets.length < 3) {
    console.log(`⚠️ >= 50 字的推文不足，使用所有非转发推文...`);
    tweets = await fetchUserTweets(cleanUsername, 0, 20);
    minCharsUsed = 0;
  }

  if (tweets.length < 3) {
    throw new Error(`@${cleanUsername} 的推文数量不足（需要至少 3 条推文，当前只有 ${tweets.length} 条）。该用户可能近期推文很少或账号受限。`);
  }

  console.log(`📊 最终使用 ${tweets.length} 条推文（>= ${minCharsUsed} 字）`);

  // 使用所有符合条件的推文
  const selectedTweets = tweets;

  // 2. 获取用户信息
  const userInfo = await fetchUserInfo(cleanUsername);

  // 3. 分析风格
  const promptContent = await analyzeStyle(cleanUsername, selectedTweets);

  // 4. 保存结果
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `${cleanUsername}_${dateStr}.md`);
  fs.writeFileSync(outputPath, promptContent);
  console.log(`\n✅ Prompt 已保存: ${outputPath}`);

  // 5. 提取 Role、Core Traits 和 Domains
  const { role, coreTraits, domains } = extractRoleAndTraits(promptContent);
  console.log(`📋 提取信息: Role="${role}", Traits=${coreTraits?.length || 0} 条, Domains=${domains?.length || 0} 个`);

  // 6. 构建返回结果
  const result: AnalysisResult = {
    username: userInfo.username,
    displayName: userInfo.displayName,
    avatarUrl: userInfo.avatarUrl,
    tweetCount: selectedTweets.length,
    totalChars: selectedTweets.reduce((sum, t) => sum + t.text.length, 0),
    promptContent,
    sampleTweets: selectedTweets.slice(0, 3).map(t => t.text),
    role,
    coreTraits,
    domains,
    usage: lastUsage || undefined
  };

  // 输出 JSON 供 API 读取
  console.log('\n--- RESULT_JSON_START ---');
  console.log(JSON.stringify(result));
  console.log('--- RESULT_JSON_END ---');

  return result;
}

// CLI 入口
const username = process.argv[2];
if (!username) {
  console.error('用法: npx ts-node voice-mimicker.ts <twitter_username>');
  process.exit(1);
}

run(username)
  .then(() => {
    console.log('\n🎉 分析完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 错误:', error.message);
    process.exit(1);
  });

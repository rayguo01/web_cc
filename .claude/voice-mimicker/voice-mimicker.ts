/**
 * Voice Mimicker - 特定推主语气模仿器
 * 抓取指定推主的推文，分析风格，生成模仿 Prompt
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

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
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 抓取用户推文（支持分页获取更多）
 */
async function fetchUserTweets(username: string, minChars: number = 100, targetCount: number = 15): Promise<Tweet[]> {
  const apiKey = process.env.TWITTER_API_IO_KEY;

  if (!apiKey) {
    throw new Error('缺少环境变量 TWITTER_API_IO_KEY');
  }

  console.log(`📡 正在抓取 @${username} 的推文...`);

  const allTweets: Tweet[] = [];
  let cursor = '';
  let pageCount = 0;
  const maxPages = 5; // 最多翻5页，避免过多 API 调用

  while (allTweets.length < targetCount && pageCount < maxPages) {
    const params = new URLSearchParams({
      userName: username
    });
    if (cursor) {
      params.append('cursor', cursor);
    }

    const response = await fetch(`https://api.twitterapi.io/twitter/user/last_tweets?${params.toString()}`, {
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
      data?: { tweets?: RawTweet[] };
      tweets?: RawTweet[];
      has_next_page?: boolean;
      next_cursor?: string;
    };
    const rawTweets = data.data?.tweets || data.tweets || [];

    if (rawTweets.length === 0) {
      console.log(`📭 没有更多推文`);
      break;
    }

    console.log(`📥 第 ${pageCount + 1} 页获取到 ${rawTweets.length} 条推文`);

    // 过滤：只保留字数超过 minChars 的推文，排除纯转发
    for (const t of rawTweets) {
      const text = t.text || '';
      // 排除纯转发（以 RT @ 开头）
      if (text.startsWith('RT @')) continue;
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
    if (!data.has_next_page || !data.next_cursor) {
      console.log(`📭 没有更多页面`);
      break;
    }

    cursor = data.next_cursor;

    // 已经够了就不再翻页
    if (allTweets.length >= targetCount) break;

    // 短暂延迟避免请求过快
    await delay(500);
  }

  console.log(`✅ 共获取 ${allTweets.length} 条推文（>= ${minChars} 字，共翻 ${pageCount} 页）`);

  return allTweets;
}

/**
 * 调用 Claude CLI 分析风格
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

2. **Core Traits**: 3-4 bullet points defining their personality as observed in the tweets.

3. **Writing Style Guidelines**:
   - **Visual Structure**: How do they use line breaks? Do they write long paragraphs or short bursts?
   - **Sentence Structure**: Do they use fragments? Run-on sentences? Questions?
   - **Tone & Vocabulary**: Key slang, catchphrases, sentence endings (e.g., "~", "...", "！", emojis).
   - **Language Mix**: Do they mix languages (e.g., English/Chinese)?

4. **Anti-AI Rules (CRITICAL)**:
   - 🚫 List specific phrases this person would NEVER use (e.g., "总而言之", "希望能帮到你", "作为AI")
   - 🚫 List writing patterns to avoid (e.g., overly formal explanations, complete grammatical sentences)
   - 🚫 List any generic AI tendencies that don't match this person's style

5. **Few-Shot Examples**:
   - Include 3-5 of the BEST examples from the input tweets
   - Format as direct quotes that capture the essence of their style

**Important Notes:**
- Focus on what makes this person's writing DISTINCTIVE and HUMAN
- The prompt should help an AI write tweets that could pass as this person's actual posts
- Pay special attention to line breaks, punctuation, and informal language patterns`;

  console.log('🤖 正在使用 Claude CLI 分析风格...');
  const result = await callClaudeCLI(prompt);

  return result;
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

  // 1. 抓取推文（最少100字，目标15条，最多翻5页）
  const tweets = await fetchUserTweets(cleanUsername, 100, 15);

  if (tweets.length < 5) {
    throw new Error(`@${cleanUsername} 的推文数量不足（需要至少 5 条 >= 100 字的推文，当前只有 ${tweets.length} 条）`);
  }

  // 使用所有符合条件的推文
  const selectedTweets = tweets;

  // 2. 分析风格
  const promptContent = await analyzeStyle(cleanUsername, selectedTweets);

  // 3. 保存结果
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `${cleanUsername}_${dateStr}.md`);
  fs.writeFileSync(outputPath, promptContent);
  console.log(`\n✅ Prompt 已保存: ${outputPath}`);

  // 4. 构建返回结果
  const result: AnalysisResult = {
    username: cleanUsername,
    displayName: cleanUsername, // API 不返回 display name，暂用 username
    avatarUrl: `https://unavatar.io/twitter/${cleanUsername}`,
    tweetCount: selectedTweets.length,
    totalChars: selectedTweets.reduce((sum, t) => sum + t.text.length, 0),
    promptContent,
    sampleTweets: selectedTweets.slice(0, 3).map(t => t.text)
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

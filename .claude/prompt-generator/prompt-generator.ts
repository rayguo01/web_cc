/**
 * Prompt Generator - 根据帖子内容生成 AI 图像生成 prompt
 *
 * 使用 AI 生成适合社交媒体配图的英文 prompt
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseRobustJSON } from '../utils/json-parser';
import { callClaude, ClaudeUsage, formatUsageLog } from '../utils/claude-cli';

// JSON Schema 定义
const JSON_SCHEMA = `
{
  "prompt": "Complete image generation description in English, 2-4 sentences, detailed and vivid",
  "style": "Style suggestion (e.g., modern minimalist, vibrant, vintage, cinematic)",
  "mood": "Mood description (e.g., warm, dramatic, energetic, serene)",
  "elements": ["visual element 1", "visual element 2", "visual element 3"],
  "colorTone": "Color tone suggestion (e.g., warm tones, cool tones, high contrast, pastel)"
}`;

const SYSTEM_PROMPT = `You are a professional social media image description expert.

Based on the given social media post content, generate an AI image generation prompt in ENGLISH.

Requirements:
1. Analyze the theme, emotion, and key elements of the post
2. Create a visually striking image description
3. Include style suggestions (modern, minimalist, vibrant, vintage, cinematic, etc.)
4. Suggest appropriate color tones and atmosphere
5. Composition suitable for social media (eye-catching, engaging)
6. The prompt MUST be in English for optimal AI image generation results

====================
Output Format (CRITICAL)
====================

**You MUST use XML tags to separate your thinking from the JSON result**

## Format

<reasoning>
Your analysis process...
- Identify key themes and emotions from the post
- Decide on visual style and composition
</reasoning>

<result>
${JSON_SCHEMA}
</result>

## Important Notes
1. The content inside <result> tag MUST be valid JSON
2. The "prompt" field is the most important - write 2-4 detailed sentences
3. ALL text must be in ENGLISH
4. Do not wrap JSON in markdown code blocks inside <result>
5. Use half-width punctuation only (no full-width characters like：，。)`;

/**
 * 解析并验证 JSON 输出
 * 使用健壮的 JSON 解析器，支持多层回退
 */
function parseAndValidateJSON(output: string): any {
  // 使用健壮的 JSON 解析器
  const result = parseRobustJSON(output, (data) => {
    // 验证必要字段
    if (!data.prompt) {
      return { valid: false, error: '缺少 prompt 字段' };
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

async function main() {
    const inputFile = process.argv[2];

    if (!inputFile) {
        console.error('Usage: npx ts-node prompt-generator.ts <input_file>');
        process.exit(1);
    }

    if (!fs.existsSync(inputFile)) {
        console.error(`Input file not found: ${inputFile}`);
        process.exit(1);
    }

    const content = fs.readFileSync(inputFile, 'utf-8').trim();

    if (!content) {
        console.error('Input file is empty');
        process.exit(1);
    }

    console.log('========================================');
    console.log('🖼️  正在生成图片描述 prompt...');
    console.log('========================================');
    console.log(`📝 输入内容长度: ${content.length} 字符`);
    console.log(`📝 内容预览: ${content.substring(0, 100)}...`);
    console.log('');

    try {
        console.log('🔄 正在调用 AI 生成 prompt...');
        // 使用 AI 生成 prompt
        const userPrompt = `${SYSTEM_PROMPT}

====================
帖子内容
====================
${content}

请根据以上帖子内容，严格按照 JSON 格式输出图像描述。只输出 JSON，不要任何其他内容。`;

        // 使用 stdin 传递 prompt（与 content-writer 相同的模式）
        console.log('📌 使用 stdin 方式传递 prompt');
        console.log('📌 Prompt 长度:', userPrompt.length, '字符');

        // 使用新的 callClaude 函数
        const response = await callClaude(userPrompt, { timeout: 90000 });
        const rawOutput = response.result;
        console.log(`📊 ${formatUsageLog(response.usage)}`);

        console.log('📋 正在解析 JSON 输出...');
        const data = parseAndValidateJSON(rawOutput);

        // 输出生成的 prompt
        console.log('\n生成的 prompt:');
        console.log(data.prompt);

        // 保存到输出文件
        const outputDir = path.join(__dirname, '../../outputs/prompts');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outputFile = path.join(outputDir, `prompt_${timestamp}.json`);

        const finalData = {
            metadata: {
                generatedAt: new Date().toISOString(),
                inputLength: content.length
            },
            ...data
        };

        fs.writeFileSync(outputFile, JSON.stringify(finalData, null, 2), 'utf-8');
        console.log(`\nPrompt 已保存到: ${outputFile}`);

        // 同时保存一个 .md 文件用于兼容旧代码
        const mdFile = outputFile.replace('.json', '.md');
        fs.writeFileSync(mdFile, data.prompt, 'utf-8');

    } catch (error) {
        console.error('生成 prompt 失败:', error);
        process.exit(1);
    }
}

main();

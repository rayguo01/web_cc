import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Define Output Paths
const projectRoot = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(projectRoot, 'outputs');
const IMAGES_DIR = path.join(OUTPUT_DIR, 'images');

// Ensure directories exist
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Python script for image generation
const PYTHON_SCRIPT = `
import sys
import os
import base64
from datetime import datetime

# Check for google-genai package
try:
    from google import genai
    from google.genai import types
except ImportError:
    print("ERROR: google-genai package not installed. Run: pip install google-genai")
    sys.exit(1)

def generate_image(prompt: str, output_dir: str, aspect_ratio: str = "1:1"):
    """Generate image using Gemini API"""

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY environment variable not set")
        sys.exit(1)

    print("========================================")
    print("🎨 Gemini AI 图片生成")
    print("========================================")
    print(f"📝 Prompt: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
    print(f"📐 Aspect ratio: {aspect_ratio}")
    print("")

    # Initialize client
    print("🔄 正在初始化 Gemini 客户端...")
    client = genai.Client(api_key=api_key)
    print("✅ 客户端初始化成功")
    print("")
    print("🔄 正在调用 Gemini API 生成图片...")
    print("   (这可能需要 30-60 秒)")

    try:
        # Generate image using Imagen model
        response = client.models.generate_images(
            model="imagen-4.0-generate-001",
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio=aspect_ratio,
            )
        )

        print("✅ API 调用成功")
        print("")

        if not response.generated_images:
            print("ERROR: No images generated")
            sys.exit(1)

        print(f"✅ 生成了 {len(response.generated_images)} 张图片")

        # Save image
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"gemini_{timestamp}.png"
        filepath = os.path.join(output_dir, filename)

        print(f"🔄 正在保存图片到: {filepath}")
        image_data = response.generated_images[0].image.image_bytes
        with open(filepath, "wb") as f:
            f.write(image_data)

        print(f"✅ 图片保存成功")
        print("")
        print(f"SUCCESS: Image saved to {filepath}")
        return filepath

    except Exception as e:
        print("")
        print("❌ 图片生成失败!")
        print(f"ERROR: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python script.py <prompt> <output_dir> [aspect_ratio]")
        sys.exit(1)

    prompt = sys.argv[1]
    output_dir = sys.argv[2]
    aspect_ratio = sys.argv[3] if len(sys.argv) > 3 else "1:1"

    generate_image(prompt, output_dir, aspect_ratio)
`;

/**
 * Run Python script for image generation
 */
function runPythonScript(prompt: string, aspectRatio: string = "1:1"): Promise<string> {
  return new Promise((resolve, reject) => {
    // Write Python script to temp file
    const scriptPath = path.join(IMAGES_DIR, '.gemini_gen.py');
    fs.writeFileSync(scriptPath, PYTHON_SCRIPT);

    const child = spawn('python', [
      scriptPath,
      prompt,
      IMAGES_DIR,
      aspectRatio
    ], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error(text);
    });

    child.on('close', (code) => {
      // Clean up script file
      try { fs.unlinkSync(scriptPath); } catch (e) {}

      if (code === 0) {
        // Extract filepath from output
        const match = stdout.match(/SUCCESS: Image saved to (.+)/);
        if (match) {
          resolve(match[1].trim());
        } else {
          resolve(stdout);
        }
      } else {
        reject(new Error(`Python script failed: ${stderr || stdout}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Parse user input for prompt and aspect ratio
 */
function parseInput(input: string): { prompt: string; aspectRatio: string } {
  // Check for aspect ratio specification
  const ratioMatch = input.match(/\[ratio:\s*([\d:]+)\]/i);
  let aspectRatio = "1:1";
  let prompt = input;

  if (ratioMatch) {
    const ratio = ratioMatch[1];
    // Validate ratio
    const validRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
    if (validRatios.includes(ratio)) {
      aspectRatio = ratio;
    }
    prompt = input.replace(ratioMatch[0], '').trim();
  }

  return { prompt, aspectRatio };
}

/**
 * Main execution function
 */
export async function run(userInput?: string): Promise<{ imagePath: string; report: string }> {
  try {
    // Get input
    let input = userInput || process.argv.slice(2).join(' ');

    // If input is a file path, read from file
    if (input && fs.existsSync(input) && input.endsWith('.txt')) {
      const tmpFile = input;
      input = fs.readFileSync(tmpFile, 'utf-8');
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }

    if (!input || input.trim() === '') {
      throw new Error('请提供图片描述。用法: npx ts-node gemini-image-gen.ts "图片描述 [ratio:16:9]"');
    }

    // Parse input
    const { prompt, aspectRatio } = parseInput(input);

    console.log('🎨 正在生成图片...');
    console.log(`描述: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);
    console.log(`比例: ${aspectRatio}`);

    // Generate image
    const imagePath = await runPythonScript(prompt, aspectRatio);

    // Create markdown report content
    const markdownContent = `# 图片生成报告
> 生成时间: ${new Date().toLocaleString('zh-CN')}

## 生成参数
- **描述**: ${prompt}
- **比例**: ${aspectRatio}

## 输出文件
- **路径**: ${imagePath}

![Generated Image](${imagePath})
`;

    // Create JSON report for consistency with other skills
    const reportData = {
      title: '图片生成报告',
      generatedAt: new Date().toISOString(),
      params: {
        prompt,
        aspectRatio
      },
      output: {
        imagePath
      },
      // Markdown content for frontend display
      content: markdownContent,
      // Gemini Imagen API 不提供 token 使用信息
      _usage: null
    };

    // Save report as JSON
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(IMAGES_DIR, `report_${dateStr}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

    console.log(`✅ 图片已保存到 ${imagePath}`);

    return { imagePath, report: markdownContent };

  } catch (error) {
    console.error('❌ 图片生成失败:', error);
    throw error;
  }
}

// Allow running directly
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');

  if (!input) {
    console.log('用法: npx ts-node gemini-image-gen.ts "图片描述"');
    console.log('示例: npx ts-node gemini-image-gen.ts "一只可爱的猫咪在阳光下打盹 [ratio:16:9]"');
    process.exit(1);
  }

  run(input).then(result => {
    console.log('\n🎨 生成完成！');
    console.log(`图片已保存到: ${result.imagePath}`);
  }).catch(error => {
    process.exit(1);
  });
}

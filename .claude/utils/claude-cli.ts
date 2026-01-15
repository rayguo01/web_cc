import { spawn } from 'child_process';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../');

export interface ClaudeUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    durationMs: number;
    model: string;
}

export interface ClaudeResponse {
    result: string;
    usage: ClaudeUsage;
    sessionId?: string;
}

/**
 * 调用 Claude CLI 并返回结果和 usage 信息
 * @param prompt 用户输入
 * @param options 选项
 */
export function callClaude(
    prompt: string,
    options: {
        allowedTools?: string[];
        timeout?: number;
        onProgress?: (text: string) => void;
    } = {}
): Promise<ClaudeResponse> {
    return new Promise((resolve, reject) => {
        const { allowedTools = [], timeout = 3 * 60 * 1000, onProgress } = options;

        const args = ['--output-format', 'json'];
        if (allowedTools.length > 0) {
            args.push('--allowedTools', allowedTools.join(','));
        }

        let killed = false;

        // 将命令合并为字符串，避免 DEP0190 警告
        const fullCommand = ['claude', ...args].join(' ');
        const child = spawn(fullCommand, [], {
            cwd: projectRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            env: process.env
        });

        const timeoutId = setTimeout(() => {
            killed = true;
            console.error(`⏰ Claude CLI 执行超时（${timeout / 1000}秒），强制终止`);
            child.kill('SIGTERM');
        }, timeout);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            if (onProgress) {
                onProgress(text);
            }
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timeoutId);

            if (killed) {
                reject(new Error(`Claude CLI 执行超时（超过 ${timeout / 1000} 秒）`));
                return;
            }

            if (code === 0) {
                try {
                    const response = JSON.parse(stdout.trim());

                    // 提取 usage 信息
                    const modelUsage = response.modelUsage || {};
                    const modelName = Object.keys(modelUsage)[0] || 'unknown';
                    const modelStats = modelUsage[modelName] || {};

                    const usage: ClaudeUsage = {
                        inputTokens: response.usage?.input_tokens || modelStats.inputTokens || 0,
                        outputTokens: response.usage?.output_tokens || modelStats.outputTokens || 0,
                        cacheCreationTokens: response.usage?.cache_creation_input_tokens || modelStats.cacheCreationInputTokens || 0,
                        cacheReadTokens: response.usage?.cache_read_input_tokens || modelStats.cacheReadInputTokens || 0,
                        costUsd: response.total_cost_usd || modelStats.costUSD || 0,
                        durationMs: response.duration_ms || 0,
                        model: modelName
                    };

                    resolve({
                        result: response.result || '',
                        usage,
                        sessionId: response.session_id
                    });
                } catch (parseError) {
                    console.error('JSON 解析失败:', parseError);
                    console.error('原始输出:', stdout.substring(0, 500));
                    reject(new Error(`Claude CLI 输出解析失败: ${parseError}`));
                }
            } else {
                console.error(`❌ Claude CLI 错误，退出码: ${code}`);
                console.error(`stderr: ${stderr.substring(0, 500)}`);
                reject(new Error(`Claude CLI 退出码: ${code}, stderr: ${stderr.substring(0, 200)}`));
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeoutId);
            console.error(`❌ Claude CLI spawn 错误:`, error);
            reject(error);
        });

        child.stdin.write(prompt);
        child.stdin.end();
    });
}

/**
 * 格式化 usage 信息为日志字符串
 */
export function formatUsageLog(usage: ClaudeUsage): string {
    return `Token 使用: 输入=${usage.inputTokens}, 输出=${usage.outputTokens}, ` +
        `缓存创建=${usage.cacheCreationTokens}, 缓存读取=${usage.cacheReadTokens}, ` +
        `费用=$${usage.costUsd.toFixed(6)}, 耗时=${usage.durationMs}ms`;
}

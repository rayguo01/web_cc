const { spawn } = require('child_process');
const EventEmitter = require('events');

/**
 * Claude CLI 进程包装器
 * 维护一个长运行的 Claude CLI 进程
 */
class ClaudeProcess extends EventEmitter {
    constructor(sessionId = null) {
        super();
        this.sessionId = sessionId;
        this.process = null;
        this.buffer = '';
        this.isReady = false;
        this.isBusy = false;
        this.lastActivity = Date.now();
        this.currentCallback = null;
        this.fullResponse = '';
    }

    /**
     * 启动 Claude CLI 进程
     */
    start() {
        return new Promise((resolve, reject) => {
            const args = [
                '-p',
                '--input-format', 'stream-json',
                '--output-format', 'stream-json',
                '--verbose'
            ];

            // 如果有会话ID，添加 --resume 参数
            if (this.sessionId) {
                args.push('--resume', this.sessionId);
            }

            console.log(`[ClaudeProcess] 启动进程, sessionId: ${this.sessionId || 'new'}`);

            this.process = spawn('claude', args, {
                cwd: '/tmp',
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.process.stdout.on('data', (data) => {
                this.handleData(data.toString());
            });

            this.process.stderr.on('data', (data) => {
                console.error('[ClaudeProcess] stderr:', data.toString());
            });

            this.process.on('close', (code) => {
                console.log(`[ClaudeProcess] 进程退出, code: ${code}, sessionId: ${this.sessionId}`);
                this.isReady = false;
                this.emit('close', code);
            });

            this.process.on('error', (err) => {
                console.error('[ClaudeProcess] 进程错误:', err);
                this.isReady = false;
                reject(err);
            });

            // 等待初始化完成
            this.once('init', (initData) => {
                this.isReady = true;
                if (initData.session_id) {
                    this.sessionId = initData.session_id;
                }
                resolve(this);
            });

            // 超时处理
            setTimeout(() => {
                if (!this.isReady) {
                    reject(new Error('Claude CLI 启动超时'));
                }
            }, 30000);
        });
    }

    /**
     * 处理从 stdout 接收的数据
     */
    handleData(data) {
        this.buffer += data;
        this.lastActivity = Date.now();

        // 按行解析 JSON
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // 保留不完整的行

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const parsed = JSON.parse(line);
                this.handleMessage(parsed);
            } catch (e) {
                console.error('[ClaudeProcess] JSON 解析错误:', e.message);
            }
        }
    }

    /**
     * 处理解析后的消息
     */
    handleMessage(msg) {
        switch (msg.type) {
            case 'system':
                if (msg.subtype === 'init') {
                    console.log(`[ClaudeProcess] 初始化完成, session_id: ${msg.session_id}`);
                    this.emit('init', msg);
                }
                break;

            case 'assistant':
                // 提取文本内容
                if (msg.message && msg.message.content) {
                    for (const block of msg.message.content) {
                        if (block.type === 'text') {
                            this.fullResponse += block.text;
                            if (this.currentCallback && this.currentCallback.onData) {
                                this.currentCallback.onData({
                                    type: 'text',
                                    content: block.text
                                });
                            }
                        }
                    }
                }
                // 更新 session_id
                if (msg.session_id) {
                    this.sessionId = msg.session_id;
                }
                break;

            case 'content_block_delta':
                // 处理增量内容
                if (msg.delta && msg.delta.text) {
                    this.fullResponse += msg.delta.text;
                    if (this.currentCallback && this.currentCallback.onData) {
                        this.currentCallback.onData({
                            type: 'text',
                            content: msg.delta.text
                        });
                    }
                }
                break;

            case 'result':
                // 更新 session_id
                if (msg.session_id) {
                    this.sessionId = msg.session_id;
                }
                // 调用完成回调
                if (this.currentCallback && this.currentCallback.onEnd) {
                    this.currentCallback.onEnd({
                        sessionId: this.sessionId,
                        fullResponse: this.fullResponse
                    });
                }
                this.isBusy = false;
                this.currentCallback = null;
                this.fullResponse = '';
                break;
        }
    }

    /**
     * 发送消息到 Claude CLI
     */
    sendMessage(content, onData, onEnd, onError) {
        if (!this.isReady || !this.process) {
            onError(new Error('进程未就绪'));
            return;
        }

        if (this.isBusy) {
            onError(new Error('进程正忙'));
            return;
        }

        this.isBusy = true;
        this.fullResponse = '';
        this.currentCallback = { onData, onEnd, onError };
        this.lastActivity = Date.now();

        // 构建输入消息
        const inputMsg = {
            type: 'user',
            message: {
                role: 'user',
                content: content
            }
        };

        console.log(`[ClaudeProcess] 发送消息, sessionId: ${this.sessionId}`);

        try {
            this.process.stdin.write(JSON.stringify(inputMsg) + '\n');
        } catch (err) {
            this.isBusy = false;
            this.currentCallback = null;
            onError(err);
        }
    }

    /**
     * 关闭进程
     */
    close() {
        if (this.process) {
            console.log(`[ClaudeProcess] 关闭进程, sessionId: ${this.sessionId}`);
            this.process.stdin.end();
            this.process.kill();
            this.process = null;
            this.isReady = false;
        }
    }

    /**
     * 检查进程是否可用
     */
    isAvailable() {
        return this.isReady && !this.isBusy;
    }

    /**
     * 获取空闲时间（毫秒）
     */
    getIdleTime() {
        return Date.now() - this.lastActivity;
    }
}

/**
 * Claude 进程池管理器
 * 为每个会话维护一个长运行的 Claude CLI 进程
 */
class ClaudeProcessManager {
    constructor() {
        // sessionId -> ClaudeProcess
        this.processes = new Map();
        // 最大空闲时间（5分钟）
        this.maxIdleTime = 5 * 60 * 1000;
        // 最大进程数
        this.maxProcesses = 10;

        // 定期清理空闲进程
        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleProcesses();
        }, 60000);
    }

    /**
     * 获取或创建进程
     */
    async getProcess(sessionId) {
        // 如果已有该会话的进程，直接返回
        if (sessionId && this.processes.has(sessionId)) {
            const proc = this.processes.get(sessionId);
            if (proc.isReady) {
                console.log(`[ProcessManager] 复用进程, sessionId: ${sessionId}`);
                return proc;
            }
            // 进程不可用，删除它
            this.processes.delete(sessionId);
        }

        // 检查是否达到最大进程数
        if (this.processes.size >= this.maxProcesses) {
            // 清理最老的空闲进程
            this.cleanupOldestProcess();
        }

        // 创建新进程
        console.log(`[ProcessManager] 创建新进程, sessionId: ${sessionId || 'new'}`);
        const proc = new ClaudeProcess(sessionId);

        proc.on('close', () => {
            // 进程关闭时从池中移除
            if (proc.sessionId) {
                this.processes.delete(proc.sessionId);
            }
        });

        await proc.start();

        // 将进程添加到池中
        if (proc.sessionId) {
            this.processes.set(proc.sessionId, proc);
        }

        return proc;
    }

    /**
     * 发送消息
     */
    async sendMessage(prompt, sessionId, onData, onEnd, onError) {
        try {
            const proc = await this.getProcess(sessionId);
            proc.sendMessage(prompt, onData, onEnd, onError);
        } catch (err) {
            onError(err);
        }
    }

    /**
     * 清理空闲进程
     */
    cleanupIdleProcesses() {
        const now = Date.now();
        for (const [sessionId, proc] of this.processes) {
            if (!proc.isBusy && proc.getIdleTime() > this.maxIdleTime) {
                console.log(`[ProcessManager] 清理空闲进程, sessionId: ${sessionId}`);
                proc.close();
                this.processes.delete(sessionId);
            }
        }
    }

    /**
     * 清理最老的空闲进程
     */
    cleanupOldestProcess() {
        let oldest = null;
        let oldestId = null;

        for (const [sessionId, proc] of this.processes) {
            if (!proc.isBusy) {
                if (!oldest || proc.lastActivity < oldest.lastActivity) {
                    oldest = proc;
                    oldestId = sessionId;
                }
            }
        }

        if (oldest) {
            console.log(`[ProcessManager] 清理最老进程, sessionId: ${oldestId}`);
            oldest.close();
            this.processes.delete(oldestId);
        }
    }

    /**
     * 关闭所有进程
     */
    shutdown() {
        console.log('[ProcessManager] 关闭所有进程');
        clearInterval(this.cleanupInterval);
        for (const [sessionId, proc] of this.processes) {
            proc.close();
        }
        this.processes.clear();
    }

    /**
     * 获取状态信息
     */
    getStatus() {
        const status = {
            totalProcesses: this.processes.size,
            processes: []
        };

        for (const [sessionId, proc] of this.processes) {
            status.processes.push({
                sessionId,
                isReady: proc.isReady,
                isBusy: proc.isBusy,
                idleTime: proc.getIdleTime()
            });
        }

        return status;
    }
}

// 单例模式
const processManager = new ClaudeProcessManager();

// 优雅退出时清理
process.on('SIGINT', () => {
    processManager.shutdown();
});

process.on('SIGTERM', () => {
    processManager.shutdown();
});

module.exports = {
    ClaudeProcess,
    ClaudeProcessManager,
    processManager
};

/**
 * 图片描述页 - 生成和编辑图片 Prompt
 */
class PromptPage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;
        this.isLoading = false;
        this.prompt = '';
        this.promptData = null; // 完整的 prompt 数据（包含 style, mood 等）
    }

    render(container) {
        const task = this.state.task;

        // 恢复已有数据
        if (task?.prompt_data) {
            this.prompt = task.prompt_data.prompt || '';
            this.promptData = task.prompt_data;
        }

        container.innerHTML = `
            <div class="prompt-page">
                <div class="page-title">
                    <span>📝</span> 图片描述
                </div>

                <div class="prompt-area" id="prompt-area">
                    ${this.renderPromptArea()}
                </div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-primary" id="back-btn">
                            ← 返回优化
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-ghost" id="skip-btn">
                            跳过描述
                        </button>
                        <button class="btn btn-primary" id="next-btn" ${!this.prompt ? 'disabled' : ''}>
                            下一步: 生成图片 →
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);

        // 只有在完全没有 prompt 数据时才自动生成（首次进入）
        // 如果用户从后续步骤返回，已有数据则不重新生成
        if (!this.prompt && !this.isLoading && !task?.prompt_data) {
            this.generatePrompt();
        }
    }

    renderPromptArea() {
        if (this.isLoading) {
            return `
                <div class="loading">
                    <div class="loading-spinner"></div>
                    <div class="loading-text" id="loading-text">正在生成图片描述...</div>
                </div>
                <div class="log-output" id="log-output" style="margin-top: 16px;"></div>
            `;
        }

        return `
            <div class="content-editor">
                <div class="editor-label">
                    <span>🎨</span> 图片描述 Prompt (英文，可编辑)
                </div>
                <textarea class="content-textarea" id="prompt-input" rows="5" placeholder="Enter image description prompt...">${this.escapeHtml(this.prompt)}</textarea>
                <div class="char-count">${this.prompt.length} 字符</div>
            </div>

            ${this.promptData ? `
                <div class="prompt-details">
                    <div class="detail-grid">
                        ${this.promptData.style ? `
                            <div class="detail-item">
                                <span class="detail-label">🎭 风格</span>
                                <span class="detail-value">${this.escapeHtml(this.promptData.style)}</span>
                            </div>
                        ` : ''}
                        ${this.promptData.mood ? `
                            <div class="detail-item">
                                <span class="detail-label">💫 氛围</span>
                                <span class="detail-value">${this.escapeHtml(this.promptData.mood)}</span>
                            </div>
                        ` : ''}
                        ${this.promptData.colorTone ? `
                            <div class="detail-item">
                                <span class="detail-label">🎨 色调</span>
                                <span class="detail-value">${this.escapeHtml(this.promptData.colorTone)}</span>
                            </div>
                        ` : ''}
                    </div>
                    ${this.promptData.elements && this.promptData.elements.length > 0 ? `
                        <div class="detail-elements">
                            <span class="detail-label">🔮 视觉元素</span>
                            <div class="element-tags">
                                ${this.promptData.elements.map(el => `<span class="element-tag">${this.escapeHtml(el)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            <div class="prompt-actions">
                <button class="btn btn-primary" id="regenerate-btn">
                    🔄 重新生成描述
                </button>
            </div>
        `;
    }

    updatePromptArea() {
        const area = document.getElementById('prompt-area');
        if (area) {
            area.innerHTML = this.renderPromptArea();
            this.bindPromptEvents();
            this.updateButtons();
        }
    }

    bindEvents(container) {
        // 返回按钮 - 仅导航，不清除数据
        container.querySelector('#back-btn').addEventListener('click', async () => {
            try {
                await this.generator.updateTask('navigateTo', { toStep: 'optimize' });
                this.generator.navigate('optimize');
            } catch (error) {
                console.error('导航失败:', error);
            }
        });

        // 放弃任务
        container.querySelector('#abandon-btn').addEventListener('click', () => {
            this.generator.abandonTask();
        });

        // 跳过描述
        container.querySelector('#skip-btn').addEventListener('click', async () => {
            try {
                await this.generator.updateTask('skipStep', { step: 'prompt' });
                this.generator.navigate('image');
            } catch (error) {
                console.error('跳过失败:', error);
            }
        });

        // 下一步
        container.querySelector('#next-btn').addEventListener('click', async () => {
            await this.savePrompt();
            this.generator.navigate('image');
        });

        this.bindPromptEvents();
    }

    bindPromptEvents() {
        const container = document.getElementById('prompt-area');
        if (!container) return;

        // 重新生成
        const regenerateBtn = container.querySelector('#regenerate-btn');
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', () => this.generatePrompt());
        }

        // 监听输入变化
        const promptInput = container.querySelector('#prompt-input');
        if (promptInput) {
            promptInput.addEventListener('input', (e) => {
                this.prompt = e.target.value;
                const charCount = container.querySelector('.char-count');
                if (charCount) {
                    charCount.textContent = `${this.prompt.length} 字符`;
                }
                this.updateButtons();
            });
        }
    }

    async generatePrompt() {
        const task = this.state.task;
        const content = task?.optimize_data?.optimizedVersion || task?.content_data?.versionC;

        if (!content) {
            this.generator.showToast('没有找到内容来生成图片描述', 'error');
            return;
        }

        // 如果已有 prompt，显示确认弹窗
        if (this.prompt) {
            const confirmed = await this.generator.showConfirm(
                '重新生成将清除当前描述及后续图片数据，确定继续吗？'
            );
            if (!confirmed) return;
        }

        // 清除后续步骤的缓存数据（image 步骤）
        try {
            await this.generator.updateTask('clearSubsequentData', { fromStep: 'prompt' });
        } catch (e) {
            console.warn('清除后续数据失败:', e);
        }

        this.isLoading = true;
        this.updatePromptArea();

        try {
            await this.generator.executeStep('prompt', { content }, {
                start: (data) => {
                    const loadingText = document.getElementById('loading-text');
                    if (loadingText) {
                        loadingText.textContent = data.message || '正在连接...';
                    }
                },
                log: (data) => {
                    const logOutput = document.getElementById('log-output');
                    if (logOutput) {
                        this.appendLog(logOutput, data.message);
                    }
                    const loadingText = document.getElementById('loading-text');
                    if (loadingText && data.message.includes('正在')) {
                        loadingText.textContent = data.message.trim();
                    }
                },
                report: (data) => {
                    try {
                        let jsonData = data.content;
                        if (typeof jsonData === 'string') {
                            let jsonStr = jsonData.trim();
                            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                            if (jsonMatch) {
                                jsonStr = jsonMatch[1].trim();
                            }
                            const startIndex = jsonStr.indexOf('{');
                            const endIndex = jsonStr.lastIndexOf('}');
                            if (startIndex !== -1 && endIndex !== -1) {
                                jsonStr = jsonStr.substring(startIndex, endIndex + 1);
                            }
                            jsonData = JSON.parse(jsonStr);
                        }
                        if (jsonData.prompt) {
                            this.prompt = jsonData.prompt;
                            this.promptData = jsonData;
                        } else {
                            this.prompt = data.content.trim();
                        }
                    } catch (e) {
                        console.warn('JSON 解析失败，使用原始文本:', e.message);
                        this.prompt = data.content.trim();
                    }
                },
                done: async () => {
                    this.isLoading = false;
                    this.updatePromptArea();
                    await this.autoSavePrompt();
                },
                error: (data) => {
                    this.isLoading = false;
                    this.prompt = `Modern social media image, minimalist style, eye-catching composition`;
                    this.generator.showToast(`Prompt 生成失败: ${data.message}`, 'error');
                    this.updatePromptArea();
                }
            });
        } catch (error) {
            this.isLoading = false;
            this.prompt = `Modern social media image, minimalist style`;
            this.updatePromptArea();
        }
    }

    async savePrompt() {
        const promptInput = document.getElementById('prompt-input');
        const prompt = promptInput ? promptInput.value.trim() : this.prompt;

        try {
            await this.generator.updateTask('savePrompt', {
                prompt: prompt,
                promptData: this.promptData
            });
        } catch (error) {
            console.error('保存 Prompt 失败:', error);
        }
    }

    async autoSavePrompt() {
        if (!this.prompt) return;

        try {
            await this.generator.updateTask('updatePromptData', {
                prompt: this.prompt,
                promptData: this.promptData
            });
            console.log('Prompt 已自动保存');
        } catch (error) {
            console.error('自动保存 Prompt 失败:', error);
        }
    }

    updateButtons() {
        const nextBtn = document.querySelector('#next-btn');
        if (nextBtn) {
            nextBtn.disabled = !this.prompt;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    appendLog(logOutput, message) {
        if (!message) return;

        const lines = message.split('\n');

        lines.forEach(line => {
            if (!line.trim()) return;

            const span = document.createElement('span');
            span.className = 'log-line';

            if (line.includes('✅') || line.includes('成功') || line.includes('完成')) {
                span.classList.add('success');
            } else if (line.includes('❌') || line.includes('错误') || line.includes('失败') || line.includes('Error')) {
                span.classList.add('error');
            } else if (line.includes('⚠') || line.includes('警告') || line.includes('Warning')) {
                span.classList.add('warning');
            } else if (line.includes('🤖') || line.includes('📊') || line.includes('📋') || line.includes('🔥') || line.includes('✨')) {
                span.classList.add('emoji');
            } else if (line.includes('正在') || line.includes('开始') || line.includes('执行')) {
                span.classList.add('highlight');
            } else {
                span.classList.add('info');
            }

            span.textContent = line + '\n';
            logOutput.appendChild(span);
        });

        logOutput.scrollTop = logOutput.scrollHeight;
    }

    destroy() {
        // 清理
    }
}

// 导出
window.PromptPage = PromptPage;

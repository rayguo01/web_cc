/**
 * 生成图片页 - 整合图片描述和生成图片功能
 * 包含3个子页面：
 * 1. generate-prompt: 生成图片描述
 * 2. edit-prompt: 编辑图片描述
 * 3. generate-image: 生成图片
 */
class ImagePage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;

        // 子页面状态: 'generate-prompt' | 'edit-prompt' | 'generate-image'
        this.subPage = 'generate-prompt';

        // Prompt 相关
        this.prompt = '';
        this.promptData = null;
        this.isGeneratingPrompt = false;

        // Image 相关
        this.imagePath = null;
        this.ratio = '16:9';
        this.isGeneratingImage = false;

        // 容器引用
        this.container = null;
    }

    render(container) {
        this.container = container;
        this.initData();
        this.initSubPage();
        this.renderPage();
    }

    // 从 task 恢复数据
    initData() {
        const task = this.state.task;

        // 恢复 prompt 数据
        if (task?.prompt_data?.prompt) {
            this.prompt = task.prompt_data.prompt;
            this.promptData = task.prompt_data;
        }

        // 恢复 image 数据
        if (task?.image_data) {
            this.imagePath = task.image_data.imagePath || null;
            this.ratio = task.image_data.ratio || '16:9';
        }
    }

    // 根据数据状态决定初始子页面
    initSubPage() {
        if (this.imagePath) {
            this.subPage = 'generate-image';  // 已有图片，显示图片页
        } else if (this.prompt) {
            this.subPage = 'edit-prompt';     // 已有描述，显示编辑页
        } else {
            this.subPage = 'generate-prompt'; // 无数据，显示生成描述页
        }
    }

    // 渲染当前页面
    renderPage() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="image-page">
                <div class="page-header">
                    <div class="page-title">
                        <span class="material-icons-outlined" style="color: #f97316;">image</span> 生成图片（ 可选 ）
                    </div>
                    <p class="page-subtitle">AI 根据内容自动生成图片描述，并通过图片描述创建配图</p>
                </div>

                <div class="image-area" id="image-area">
                    ${this.renderSubPage()}
                </div>

                <div class="page-actions">
                    ${this.renderActions()}
                </div>
            </div>
        `;

        this.bindEvents();
    }

    // 渲染子页面内容
    renderSubPage() {
        switch (this.subPage) {
            case 'generate-prompt':
                return this.renderGeneratePromptPage();
            case 'edit-prompt':
                return this.renderEditPromptPage();
            case 'generate-image':
                return this.renderGenerateImagePage();
            default:
                return '';
        }
    }

    // 渲染底部按钮
    renderActions() {
        switch (this.subPage) {
            case 'generate-prompt':
                return `
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">arrow_back</span> 返回优化内容
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right"></div>
                `;
            case 'edit-prompt':
                return `
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">arrow_back</span> 返回优化内容
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-secondary" id="next-btn">
                            下一步: 生成图片 <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">arrow_forward</span>
                        </button>
                    </div>
                `;
            case 'generate-image':
                return `
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">arrow_back</span> 返回优化内容
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-ghost" id="skip-btn">
                            跳过图片
                        </button>
                        <button class="btn btn-secondary" id="next-btn">
                            下一步: 提交 <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">arrow_forward</span>
                        </button>
                    </div>
                `;
            default:
                return '';
        }
    }

    // ==================== 子页面1：生成图片描述 ====================
    renderGeneratePromptPage() {
        if (this.isGeneratingPrompt) {
            return `
                <div class="loading-container">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <div class="loading-text" id="loading-text">正在生成图片描述...</div>
                    </div>
                </div>
                <div class="log-output" id="log-output" style="margin-top: 16px;"></div>
            `;
        }

        const task = this.state.task;
        const content = task?.optimize_data?.optimizedVersion || task?.content_data?.versionC || '';
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;

        // 检查是否已有生成的描述
        const hasPrompt = !!this.prompt;

        return `
            <div class="content-preview">
                <div class="preview-label">待生成描述的内容：</div>
                <div class="preview-text">${this.escapeHtml(preview)}</div>
            </div>

            <div style="display: flex; justify-content: center; gap: 16px; margin-top: 24px;">
                <button class="btn btn-primary btn-large" id="generate-prompt-btn">
                    <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">auto_awesome</span> 生成图片描述
                </button>
                ${hasPrompt ? `
                    <button class="btn btn-secondary" id="view-prompt-btn">
                        <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">visibility</span> 查看已生成描述
                    </button>
                ` : ''}
                <button class="btn btn-secondary" id="skip-image-btn">
                    <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">skip_next</span> 跳过图片
                </button>
            </div>
        `;
    }

    // ==================== 子页面2：编辑图片描述 ====================
    renderEditPromptPage() {
        return `
            <div class="content-editor">
                <div class="editor-label">
                    <span class="material-icons-outlined">palette</span> 图片描述 Prompt (英文，可编辑)
                </div>
                <textarea class="content-textarea" id="prompt-input" rows="5" placeholder="Enter image description prompt...">${this.escapeHtml(this.prompt)}</textarea>
                <div class="char-count">${this.prompt.length} 字符</div>
            </div>

            ${this.promptData ? `
                <div class="prompt-details">
                    <div class="detail-grid">
                        ${this.promptData.style ? `
                            <div class="detail-item">
                                <span class="detail-label"><span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">theater_comedy</span> 风格</span>
                                <span class="detail-value">${this.escapeHtml(this.promptData.style)}</span>
                            </div>
                        ` : ''}
                        ${this.promptData.mood ? `
                            <div class="detail-item">
                                <span class="detail-label"><span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">auto_awesome</span> 氛围</span>
                                <span class="detail-value">${this.escapeHtml(this.promptData.mood)}</span>
                            </div>
                        ` : ''}
                        ${this.promptData.colorTone ? `
                            <div class="detail-item">
                                <span class="detail-label"><span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">palette</span> 色调</span>
                                <span class="detail-value">${this.escapeHtml(this.promptData.colorTone)}</span>
                            </div>
                        ` : ''}
                    </div>
                    ${this.promptData.elements && this.promptData.elements.length > 0 ? `
                        <div class="detail-elements">
                            <span class="detail-label"><span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">visibility</span> 视觉元素</span>
                            <div class="element-tags">
                                ${this.promptData.elements.map(el => `<span class="element-tag">${this.escapeHtml(el)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            <div class="prompt-actions" style="display: flex; justify-content: center; margin-top: 24px;">
                <button class="btn btn-primary" id="regenerate-prompt-btn">
                    <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">refresh</span> 重新生成描述
                </button>
            </div>
        `;
    }

    // ==================== 子页面3：生成图片 ====================
    renderGenerateImagePage() {
        if (this.isGeneratingImage) {
            return `
                <div class="loading">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">正在生成图片，可能需要 30-60 秒...</div>
                </div>
                <div class="log-output" id="log-output"></div>
            `;
        }

        return `
            <!-- Prompt 预览 -->
            <div class="prompt-preview">
                <div class="editor-label">
                    <span class="material-icons-outlined">edit_note</span> 图片描述 Prompt
                </div>
                <div class="prompt-text">${this.escapeHtml(this.prompt) || '<span class="text-muted">未生成描述</span>'}</div>
                <div class="prompt-meta">
                    <span class="ratio-badge"><span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">aspect_ratio</span> 比例: 16:9 (Twitter 推荐)</span>
                </div>
            </div>

            <!-- 生成按钮 -->
            <div class="generate-section">
                <button class="btn btn-primary btn-large" id="generate-image-btn" ${!this.prompt ? 'disabled' : ''}>
                    <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">palette</span> 生成图片
                </button>
            </div>

            <!-- 图片预览 -->
            ${this.imagePath ? `
                <div class="image-result">
                    <div class="editor-label">
                        <span class="material-icons-outlined">image</span> 生成的图片
                    </div>
                    <div class="image-preview">
                        <img src="${this.imagePath}" alt="Generated Image" />
                    </div>
                    <div class="image-actions">
                        <button class="btn btn-primary" id="regenerate-image-btn">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">refresh</span> 重新生成
                        </button>
                        <a class="btn btn-primary" href="${this.imagePath}" download target="_blank">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">download</span> 下载图片
                        </a>
                    </div>
                </div>
            ` : `
                <div class="image-placeholder">
                    <div class="placeholder-icon"><span class="material-icons-outlined" style="font-size: 48px;">image</span></div>
                    <div class="placeholder-text">点击上方按钮生成图片</div>
                </div>
            `}
        `;
    }

    // ==================== 事件绑定 ====================
    bindEvents() {
        const container = this.container;
        if (!container) return;

        // 返回按钮
        const backBtn = container.querySelector('#back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.handleBack());
        }

        // 放弃任务
        const abandonBtn = container.querySelector('#abandon-btn');
        if (abandonBtn) {
            abandonBtn.addEventListener('click', () => this.generator.abandonTask());
        }

        // 下一步按钮
        const nextBtn = container.querySelector('#next-btn');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.handleNext());
        }

        // 跳过按钮（页面3）
        const skipBtn = container.querySelector('#skip-btn');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => this.handleSkip());
        }

        // 绑定子页面特定事件
        this.bindSubPageEvents();
    }

    bindSubPageEvents() {
        const container = this.container;
        if (!container) return;

        switch (this.subPage) {
            case 'generate-prompt':
                // 生成图片描述按钮
                const generatePromptBtn = container.querySelector('#generate-prompt-btn');
                if (generatePromptBtn) {
                    generatePromptBtn.addEventListener('click', () => this.generatePrompt());
                }
                // 查看已生成描述按钮
                const viewPromptBtn = container.querySelector('#view-prompt-btn');
                if (viewPromptBtn) {
                    viewPromptBtn.addEventListener('click', () => {
                        this.subPage = 'edit-prompt';
                        this.renderPage();
                    });
                }
                // 跳过图片按钮
                const skipImageBtn = container.querySelector('#skip-image-btn');
                if (skipImageBtn) {
                    skipImageBtn.addEventListener('click', () => this.handleSkipFromStart());
                }
                break;

            case 'edit-prompt':
                // 监听输入变化
                const promptInput = container.querySelector('#prompt-input');
                if (promptInput) {
                    promptInput.addEventListener('input', (e) => {
                        this.prompt = e.target.value;
                        const charCount = container.querySelector('.char-count');
                        if (charCount) {
                            charCount.textContent = `${this.prompt.length} 字符`;
                        }
                    });
                }
                // 重新生成描述
                const regeneratePromptBtn = container.querySelector('#regenerate-prompt-btn');
                if (regeneratePromptBtn) {
                    regeneratePromptBtn.addEventListener('click', () => this.handleRegeneratePrompt());
                }
                break;

            case 'generate-image':
                // 生成图片按钮
                const generateImageBtn = container.querySelector('#generate-image-btn');
                if (generateImageBtn) {
                    generateImageBtn.addEventListener('click', () => this.generateImage());
                }
                // 重新生成图片
                const regenerateImageBtn = container.querySelector('#regenerate-image-btn');
                if (regenerateImageBtn) {
                    regenerateImageBtn.addEventListener('click', () => this.generateImage());
                }
                break;
        }
    }

    // ==================== 导航处理 ====================
    handleBack() {
        switch (this.subPage) {
            case 'generate-prompt':
                // 返回优化内容页
                this.generator.updateTask('navigateTo', { toStep: 'optimize' })
                    .then(() => this.generator.navigate('optimize'))
                    .catch(err => console.error('导航失败:', err));
                break;
            case 'edit-prompt':
                // 返回优化内容页
                this.generator.updateTask('navigateTo', { toStep: 'optimize' })
                    .then(() => this.generator.navigate('optimize'))
                    .catch(err => console.error('导航失败:', err));
                break;
            case 'generate-image':
                // 返回优化内容页
                this.generator.updateTask('navigateTo', { toStep: 'optimize' })
                    .then(() => this.generator.navigate('optimize'))
                    .catch(err => console.error('导航失败:', err));
                break;
        }
    }

    async handleNext() {
        switch (this.subPage) {
            case 'edit-prompt':
                // 保存 prompt 并进入页面3
                await this.savePrompt();
                this.subPage = 'generate-image';
                this.renderPage();
                break;
            case 'generate-image':
                // 保存图片数据并进入提交页
                await this.saveImage();
                this.generator.navigate('submit');
                break;
        }
    }

    async handleSkip() {
        // 从页面3跳过图片
        try {
            await this.generator.updateTask('saveImage', {
                prompt: this.prompt,
                ratio: this.ratio,
                imagePath: null,
                skipped: true
            });
            this.generator.navigate('submit');
        } catch (error) {
            console.error('跳过失败:', error);
        }
    }

    async handleSkipFromStart() {
        // 从页面1跳过整个图片步骤
        try {
            await this.generator.updateTask('skipStep', { step: 'image' });
            this.generator.navigate('submit');
        } catch (error) {
            console.error('跳过失败:', error);
        }
    }

    async handleRegeneratePrompt() {
        const confirmed = await this.generator.showConfirm(
            '重新生成将清除当前描述，确定继续吗？'
        );
        if (!confirmed) return;

        // 清除后续数据
        try {
            await this.generator.updateTask('clearSubsequentData', { fromStep: 'image' });
        } catch (e) {
            console.warn('清除后续数据失败:', e);
        }

        // 清除本地数据
        this.prompt = '';
        this.promptData = null;
        this.imagePath = null;

        // 返回页面1
        this.subPage = 'generate-prompt';
        this.renderPage();
    }

    // ==================== 生成逻辑 ====================
    async generatePrompt() {
        const task = this.state.task;
        const content = task?.optimize_data?.optimizedVersion || task?.content_data?.versionC;

        if (!content) {
            this.generator.showToast('没有找到内容来生成图片描述', 'error');
            return;
        }

        this.isGeneratingPrompt = true;
        this.updateImageArea();

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
                    this.isGeneratingPrompt = false;
                    // 自动保存
                    await this.autoSavePrompt();
                    // 自动跳转到页面2
                    this.subPage = 'edit-prompt';
                    this.renderPage();
                },
                error: (data) => {
                    this.isGeneratingPrompt = false;
                    this.prompt = 'Modern social media image, minimalist style, eye-catching composition';
                    this.generator.showToast(`Prompt 生成失败: ${data.message}`, 'error');
                    this.updateImageArea();
                }
            });
        } catch (error) {
            this.isGeneratingPrompt = false;
            this.prompt = 'Modern social media image, minimalist style';
            this.updateImageArea();
        }
    }

    async generateImage() {
        if (!this.prompt) {
            this.generator.showToast('请先生成图片描述', 'error');
            return;
        }

        // 如果已有图片，显示确认弹窗
        if (this.imagePath) {
            const confirmed = await this.generator.showConfirm(
                '重新生成将替换当前图片，确定继续吗？'
            );
            if (!confirmed) return;
        }

        this.isGeneratingImage = true;
        this.updateImageArea();

        try {
            await this.generator.executeStep('image', { prompt: this.prompt, ratio: this.ratio }, {
                start: (data) => {
                    console.log('[image] 开始执行:', data.message);
                },
                log: (data) => {
                    const logOutput = document.getElementById('log-output');
                    if (logOutput) {
                        this.appendLog(logOutput, data.message);
                    }
                },
                report: (data) => {
                    if (data.imagePath) {
                        this.imagePath = data.imagePath;
                    }
                },
                done: async () => {
                    this.isGeneratingImage = false;
                    this.updateImageArea();
                    if (this.imagePath) {
                        this.generator.showToast('图片生成成功', 'success');
                        await this.autoSaveImage();
                    }
                },
                error: (data) => {
                    this.isGeneratingImage = false;
                    this.generator.showToast(`图片生成失败: ${data.message}`, 'error');
                    this.updateImageArea();
                }
            });
        } catch (error) {
            this.isGeneratingImage = false;
            this.generator.showToast(`图片生成失败: ${error.message}`, 'error');
            this.updateImageArea();
        }
    }

    // ==================== 数据保存 ====================
    async savePrompt() {
        const promptInput = document.getElementById('prompt-input');
        const prompt = promptInput ? promptInput.value.trim() : this.prompt;

        try {
            // 将 promptData 的字段展开到根级别，而不是嵌套
            const dataToSave = {
                prompt: prompt,
                ...(this.promptData || {})
            };
            // 确保 prompt 使用用户编辑后的版本
            dataToSave.prompt = prompt;

            await this.generator.updateTask('savePrompt', dataToSave);
        } catch (error) {
            console.error('保存 Prompt 失败:', error);
        }
    }

    async autoSavePrompt() {
        if (!this.prompt) return;

        try {
            // 将 promptData 的字段展开到根级别
            const dataToSave = {
                ...(this.promptData || {}),
                prompt: this.prompt  // 确保 prompt 字段正确
            };

            await this.generator.updateTask('updatePromptData', dataToSave);
            console.log('Prompt 已自动保存');
        } catch (error) {
            console.error('自动保存 Prompt 失败:', error);
        }
    }

    async saveImage() {
        try {
            await this.generator.updateTask('saveImage', {
                prompt: this.prompt,
                ratio: this.ratio,
                imagePath: this.imagePath,
                skipped: false
            });
        } catch (error) {
            console.error('保存图片数据失败:', error);
        }
    }

    async autoSaveImage() {
        if (!this.imagePath) return;

        try {
            await this.generator.updateTask('updateImageData', {
                prompt: this.prompt,
                ratio: this.ratio,
                imagePath: this.imagePath
            });
            console.log('图片数据已自动保存');
        } catch (error) {
            console.error('自动保存图片数据失败:', error);
        }
    }

    // ==================== 工具方法 ====================
    updateImageArea() {
        const area = document.getElementById('image-area');
        if (area) {
            area.innerHTML = this.renderSubPage();
            this.bindSubPageEvents();
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
window.ImagePage = ImagePage;

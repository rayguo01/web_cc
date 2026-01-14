/**
 * 生成图片页 - 使用 Prompt 生成图片或搜索网络图片
 */
class ImagePage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;
        this.isLoading = false;
        this.isSearching = false;
        this.prompt = '';
        this.ratio = '16:9';  // Twitter/X 推荐比例
        this.imagePath = null;
        this.imageMode = 'generate'; // 'generate' | 'search'
        this.searchQuery = '';
        this.searchResults = []; // 搜索结果图片列表
        this.selectedSearchImage = null; // 选中的搜索图片
    }

    render(container) {
        const task = this.state.task;

        // 恢复已有数据
        if (task?.image_data) {
            this.imagePath = task.image_data.imagePath || null;
            this.ratio = task.image_data.ratio || '16:9';
        }

        // 从 prompt_data 获取 prompt
        if (task?.prompt_data?.prompt) {
            this.prompt = task.prompt_data.prompt;
        } else if (task?.image_data?.prompt) {
            // 兼容旧数据
            this.prompt = task.image_data.prompt;
        }

        container.innerHTML = `
            <div class="image-page">
                <div class="page-title">
                    <span>🖼️</span> 配图选择
                </div>

                <!-- 模式切换 Tab -->
                <div class="image-mode-tabs">
                    <button class="mode-tab ${this.imageMode === 'generate' ? 'active' : ''}" data-mode="generate">
                        🎨 AI 生成
                    </button>
                    <button class="mode-tab ${this.imageMode === 'search' ? 'active' : ''}" data-mode="search">
                        🔍 搜索网图
                    </button>
                </div>

                <div class="image-area" id="image-area">
                    ${this.renderImageArea()}
                </div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-primary" id="back-btn">
                            ← 返回描述
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-ghost" id="skip-btn">
                            跳过图片
                        </button>
                        <button class="btn btn-primary" id="next-btn">
                            下一步: 提交 →
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);
    }

    renderImageArea() {
        if (this.imageMode === 'generate') {
            return this.renderGenerateMode();
        } else {
            return this.renderSearchMode();
        }
    }

    renderGenerateMode() {
        if (this.isLoading) {
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
                    <span>📝</span> 图片描述 Prompt
                </div>
                <div class="prompt-text">${this.escapeHtml(this.prompt) || '<span class="text-muted">未生成描述，请返回上一步</span>'}</div>
                <div class="prompt-meta">
                    <span class="ratio-badge">📐 比例: 16:9 (Twitter 推荐)</span>
                </div>
            </div>

            <!-- 生成按钮 -->
            <div class="generate-section">
                <button class="btn btn-primary btn-large" id="generate-image-btn" ${!this.prompt ? 'disabled' : ''}>
                    🎨 生成图片
                </button>
            </div>

            <!-- 图片预览 -->
            ${this.imagePath ? `
                <div class="image-result">
                    <div class="editor-label">
                        <span>🖼️</span> 生成的图片
                    </div>
                    <div class="image-preview">
                        <img src="${this.imagePath}" alt="Generated Image" />
                    </div>
                    <div class="image-actions">
                        <button class="btn btn-primary" id="regenerate-btn">
                            🔄 重新生成
                        </button>
                        <a class="btn btn-ghost" href="${this.imagePath}" download target="_blank">
                            💾 下载图片
                        </a>
                    </div>
                </div>
            ` : `
                <div class="image-placeholder">
                    <div class="placeholder-icon">🖼️</div>
                    <div class="placeholder-text">点击上方按钮生成图片</div>
                </div>
            `}
        `;
    }

    renderSearchMode() {
        if (this.isSearching) {
            return `
                <div class="loading">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">正在搜索网络图片...</div>
                </div>
                <div class="log-output" id="log-output"></div>
            `;
        }

        return `
            <!-- 搜索输入 -->
            <div class="search-input-section">
                <div class="editor-label">
                    <span>🔍</span> 描述你想要的图片
                </div>
                <div class="search-input-wrapper">
                    <textarea
                        class="content-textarea search-query-input"
                        id="search-query"
                        rows="2"
                        placeholder="例如：梅西庆祝进球、马斯克演讲、科技感蓝色背景、日落城市天际线..."
                    >${this.escapeHtml(this.searchQuery)}</textarea>
                    <button class="btn btn-primary" id="search-image-btn" ${!this.searchQuery.trim() ? 'disabled' : ''}>
                        🔍 搜索图片
                    </button>
                </div>
                <div class="search-hint">AI 会从 Google、新闻网站、图库等搜索高质量图片，支持球星、名人等真实人物</div>
            </div>

            <!-- 搜索结果 -->
            ${this.searchResults.length > 0 ? `
                <div class="search-results-section">
                    <div class="editor-label">
                        <span>📸</span> 搜索结果（点击选择）
                    </div>
                    <div class="search-results-grid">
                        ${this.searchResults.map((img, index) => `
                            <div class="search-result-item ${this.selectedSearchImage?.url === img.url ? 'selected' : ''}"
                                 data-index="${index}"
                                 data-url="${this.escapeHtml(img.url)}">
                                <img src="${img.thumbnail || img.url}" alt="${this.escapeHtml(img.title || '搜索结果')}" />
                                <div class="result-overlay">
                                    <div class="result-title">${this.escapeHtml(img.title || '无标题')}</div>
                                    <div class="result-source">${this.escapeHtml(img.source || '未知来源')}</div>
                                </div>
                                ${this.selectedSearchImage?.url === img.url ? '<div class="selected-badge">✓ 已选择</div>' : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>

                ${this.selectedSearchImage ? `
                    <div class="selected-image-actions">
                        <button class="btn btn-primary" id="use-selected-image-btn">
                            ✅ 使用选中的图片
                        </button>
                        <button class="btn btn-secondary" id="clear-selection-btn">
                            取消选择
                        </button>
                    </div>
                ` : ''}
            ` : ''}

            <!-- 已选择的图片预览 -->
            ${this.imagePath && !this.searchResults.length ? `
                <div class="image-preview">
                    <div class="editor-label">
                        <span>🖼️</span> 已选择的图片
                    </div>
                    <img src="${this.imagePath}" alt="Selected Image" />
                    <div class="image-actions">
                        <button class="btn btn-secondary" id="reselect-btn">
                            🔄 重新选择
                        </button>
                    </div>
                </div>
            ` : ''}

            ${!this.searchResults.length && !this.imagePath ? `
                <div class="image-placeholder">
                    <div class="placeholder-icon">🔍</div>
                    <div class="placeholder-text">输入描述后点击搜索</div>
                </div>
            ` : ''}
        `;
    }

    updateImageArea() {
        const area = document.getElementById('image-area');
        if (area) {
            area.innerHTML = this.renderImageArea();
            this.bindImageEvents();
        }
    }

    bindEvents(container) {
        // 模式切换 Tab
        container.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                if (mode !== this.imageMode) {
                    this.imageMode = mode;
                    // 更新 tab 状态
                    container.querySelectorAll('.mode-tab').forEach(t => {
                        t.classList.toggle('active', t.dataset.mode === mode);
                    });
                    // 重新渲染内容区域
                    this.updateImageArea();
                }
            });
        });

        // 返回按钮 - 仅导航，不清除数据
        container.querySelector('#back-btn').addEventListener('click', async () => {
            try {
                await this.generator.updateTask('navigateTo', { toStep: 'prompt' });
                this.generator.navigate('prompt');
            } catch (error) {
                console.error('导航失败:', error);
            }
        });

        // 放弃任务
        container.querySelector('#abandon-btn').addEventListener('click', () => {
            this.generator.abandonTask();
        });

        // 跳过图片
        container.querySelector('#skip-btn').addEventListener('click', async () => {
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
        });

        // 下一步
        container.querySelector('#next-btn').addEventListener('click', async () => {
            await this.saveImage();
            this.generator.navigate('submit');
        });

        this.bindImageEvents();
    }

    bindImageEvents() {
        const container = document.getElementById('image-area');
        if (!container) return;

        // === AI 生成模式 ===
        // 生成图片
        const generateBtn = container.querySelector('#generate-image-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generateImage());
        }

        // 重新生成
        const regenerateBtn = container.querySelector('#regenerate-btn');
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', () => this.generateImage());
        }

        // === 搜索模式 ===
        // 搜索输入框
        const searchQueryInput = container.querySelector('#search-query');
        if (searchQueryInput) {
            searchQueryInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                // 更新搜索按钮状态
                const searchBtn = container.querySelector('#search-image-btn');
                if (searchBtn) {
                    searchBtn.disabled = !this.searchQuery.trim();
                }
            });
        }

        // 搜索按钮
        const searchBtn = container.querySelector('#search-image-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.searchImages());
        }

        // 搜索结果点击选择
        container.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                const image = this.searchResults[index];
                if (image) {
                    this.selectedSearchImage = image;
                    this.updateImageArea();
                }
            });
        });

        // 使用选中的图片
        const useSelectedBtn = container.querySelector('#use-selected-image-btn');
        if (useSelectedBtn) {
            useSelectedBtn.addEventListener('click', () => this.useSelectedImage());
        }

        // 取消选择
        const clearSelectionBtn = container.querySelector('#clear-selection-btn');
        if (clearSelectionBtn) {
            clearSelectionBtn.addEventListener('click', () => {
                this.selectedSearchImage = null;
                this.updateImageArea();
            });
        }

        // 重新选择
        const reselectBtn = container.querySelector('#reselect-btn');
        if (reselectBtn) {
            reselectBtn.addEventListener('click', () => {
                this.imagePath = null;
                this.searchResults = [];
                this.selectedSearchImage = null;
                this.updateImageArea();
            });
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

        this.isLoading = true;
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
                    this.isLoading = false;
                    this.updateImageArea();
                    if (this.imagePath) {
                        this.generator.showToast('图片生成成功', 'success');
                        await this.autoSaveImage();
                    }
                },
                error: (data) => {
                    this.isLoading = false;
                    this.generator.showToast(`图片生成失败: ${data.message}`, 'error');
                    this.updateImageArea();
                }
            });
        } catch (error) {
            this.isLoading = false;
            this.generator.showToast(`图片生成失败: ${error.message}`, 'error');
            this.updateImageArea();
        }
    }

    async searchImages() {
        if (!this.searchQuery.trim()) {
            this.generator.showToast('请输入图片描述', 'error');
            return;
        }

        this.isSearching = true;
        this.searchResults = [];
        this.selectedSearchImage = null;
        this.updateImageArea();

        try {
            await this.generator.executeStep('image-search', { query: this.searchQuery }, {
                start: (data) => {
                    console.log('[image-search] 开始搜索:', data.message);
                },
                log: (data) => {
                    const logOutput = document.getElementById('log-output');
                    if (logOutput) {
                        this.appendLog(logOutput, data.message);
                    }
                },
                report: (data) => {
                    // 解析搜索结果
                    try {
                        const reportData = typeof data.content === 'string'
                            ? JSON.parse(data.content)
                            : data.content;
                        if (reportData.images && Array.isArray(reportData.images)) {
                            this.searchResults = reportData.images;
                        }
                    } catch (e) {
                        console.error('解析搜索结果失败:', e);
                    }
                },
                done: async () => {
                    this.isSearching = false;
                    this.updateImageArea();
                    if (this.searchResults.length > 0) {
                        this.generator.showToast(`找到 ${this.searchResults.length} 张相关图片`, 'success');
                    } else {
                        this.generator.showToast('未找到相关图片，请尝试其他关键词', 'warning');
                    }
                },
                error: (data) => {
                    this.isSearching = false;
                    this.generator.showToast(`搜索失败: ${data.message}`, 'error');
                    this.updateImageArea();
                }
            });
        } catch (error) {
            this.isSearching = false;
            this.generator.showToast(`搜索失败: ${error.message}`, 'error');
            this.updateImageArea();
        }
    }

    async useSelectedImage() {
        if (!this.selectedSearchImage) {
            this.generator.showToast('请先选择一张图片', 'error');
            return;
        }

        // 直接使用网络图片 URL
        this.imagePath = this.selectedSearchImage.url;
        this.searchResults = [];
        this.selectedSearchImage = null;
        this.updateImageArea();
        this.generator.showToast('已选择图片', 'success');

        // 自动保存
        await this.autoSaveImage();
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

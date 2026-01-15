/**
 * 生成内容页 - 展示版本 C 内容、评分和建议
 */
class ContentPage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;
        this.isLoading = false;
        this.isEditing = true; // 初始状态为编辑输入
        this.report = null;
        this.versionC = '';
        this.score = null;
        this.suggestions = '';
        this.inputText = ''; // 用户输入的素材文本
        this.voiceStyles = []; // 用户保存的语气列表
        this.selectedVoiceStyleId = null; // 选中的语气 ID（null 表示默认）

        // 加载用户的语气列表
        this.loadVoiceStyles();
    }

    /**
     * 加载用户保存的语气列表（三列数据）
     */
    async loadVoiceStyles() {
        try {
            const response = await fetch('/api/tools/voice-prompts/available', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                this.voiceStylesData = {
                    popular: data.popular || [],
                    mine: data.mine || [],
                    subscribed: data.subscribed || []
                };
                // 重新渲染语气选择器
                this.updateVoiceStyleSelector();
            }
        } catch (error) {
            console.warn('加载语气列表失败:', error);
        }
    }

    /**
     * 更新语气选择器显示
     */
    updateVoiceStyleSelector() {
        const selector = document.getElementById('voice-style-selector');
        if (selector) {
            selector.innerHTML = this.renderVoiceStyleOptions();
            this.bindVoiceStyleEvents();
        }
    }

    render(container) {
        const task = this.state.task;
        const topic = task?.trends_data?.selectedTopic;

        // 如果已有生成的内容，直接显示
        if (task?.content_data?.versionC) {
            this.isEditing = false;
            this.versionC = task.content_data.versionC || '';
            this.score = task.content_data.score;
            this.suggestions = task.content_data.suggestions || '';
            // 恢复输入文本
            this.inputText = task.content_data.inputText || this.buildInputText(topic);
        } else {
            // 从话题信息构建默认输入文本
            this.inputText = this.buildInputText(topic);
        }

        container.innerHTML = `
            <div class="content-page">
                <div class="page-header">
                    <div class="page-title">
                        <span class="material-icons-outlined" style="color: #f97316;">edit_note</span> 生成内容
                    </div>
                    <p class="page-subtitle">AI 根据创作素材中的内容，叠加上你选择的写作风格，自动生成推文内容供你修改，请注意AI的优化建议，可以作为后续优化的方向</p>
                </div>

                <div class="content-area" id="content-area">
                    ${this.renderContentArea()}
                </div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            ← 重选话题
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-secondary" id="next-btn" ${!this.versionC ? 'disabled title="请先生成内容"' : ''}>
                            下一步: 优化 →
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);
    }

    /**
     * 渲染语气选项列表（三列布局）
     */
    renderVoiceStyleOptions() {
        const defaultAvatar = 'data:image/svg+xml,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="20" fill="#6366f1"/>
                <text x="20" y="26" text-anchor="middle" fill="white" font-size="16" font-family="Arial">D</text>
            </svg>
        `);

        const data = this.voiceStylesData || { popular: [], mine: [], subscribed: [] };

        // 渲染单个语气项
        const renderItem = (style) => {
            // 处理默认语气
            if (style.isDefault) {
                const isSelected = !this.selectedVoiceStyleId;
                return `
                    <div class="voice-style-item default-style ${isSelected ? 'selected' : ''}" data-id="">
                        <img src="${style.avatar}" alt="${style.name}" class="voice-avatar">
                        <div class="voice-item-info">
                            <span class="voice-name">${style.name}</span>
                            <span class="voice-role">${style.role}</span>
                        </div>
                    </div>
                `;
            }
            const isSelected = this.selectedVoiceStyleId === style.id;
            const displayName = style.display_name || style.username;
            const role = style.role || '';
            return `
                <div class="voice-style-item ${isSelected ? 'selected' : ''}" data-id="${style.id}">
                    <img src="${style.avatar_url || defaultAvatar}" alt="${displayName}" class="voice-avatar"
                         onerror="this.src='${defaultAvatar}'">
                    <div class="voice-item-info">
                        <span class="voice-name">${displayName}</span>
                        ${role ? `<span class="voice-role">${role}</span>` : ''}
                    </div>
                </div>
            `;
        };

        // 渲染列
        const renderColumn = (title, items, emptyMsg, emptyLink, emptyLinkText) => {
            let content = '';
            if (items.length === 0) {
                content = `
                    <div class="voice-column-empty">
                        <span>${emptyMsg}</span>
                        ${emptyLink ? `<a href="${emptyLink}" class="voice-empty-link">${emptyLinkText}</a>` : ''}
                    </div>
                `;
            } else {
                content = items.map(renderItem).join('');
            }
            return `
                <div class="voice-column">
                    <div class="voice-column-title">${title}</div>
                    <div class="voice-column-items">${content}</div>
                </div>
            `;
        };

        // 默认语气项
        const defaultItem = {
            id: '',
            name: '默认语气',
            role: '同时追求爆款和深度价值的创作者',
            avatar: defaultAvatar,
            isDefault: true
        };

        // 热门列表前面加上默认语气
        const popularWithDefault = [defaultItem, ...data.popular];

        return `
            <div class="voice-columns-horizontal">
                ${renderColumn('<span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">local_fire_department</span> 热门', popularWithDefault, '暂无热门', null, null)}
                ${renderColumn('<span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">star</span> 订阅', data.subscribed, '还没订阅', '#voice-mimicker/market', '去市场 →')}
                ${renderColumn('<span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">menu_book</span> 我的', data.mine, '还没创建', '#voice-mimicker/mine', '去创建 →')}
            </div>
        `;
    }

    /**
     * 绑定语气选择事件
     */
    bindVoiceStyleEvents() {
        const items = document.querySelectorAll('.voice-style-item');
        items.forEach(item => {
            item.addEventListener('click', () => {
                // 移除其他选中状态
                items.forEach(i => i.classList.remove('selected'));
                // 选中当前项
                item.classList.add('selected');
                // 更新选中的语气 ID
                const id = item.dataset.id;
                this.selectedVoiceStyleId = id ? parseInt(id) : null;
            });
        });
    }

    buildInputText(topic) {
        if (!topic) return '';

        let text = '';

        // 话题标题
        if (topic.title || topic.topic) {
            text += `【话题】${topic.title || topic.topic}\n\n`;
        }

        // 选题角度
        if (topic.angle) {
            text += `【选题角度】${topic.angle}\n\n`;
        }

        // 为什么有效
        if (topic.meta) {
            text += `【为什么有效】${topic.meta}\n\n`;
        }

        // 创作方向 - 优先使用 directions 数组，回退到 direction HTML
        if (topic.directions && Array.isArray(topic.directions) && topic.directions.length > 0) {
            // 新格式：directions 是数组
            const directionText = topic.directions.map(d => `- ${d}`).join('\n');
            text += `【创作方向】\n${directionText}\n\n`;
        } else if (topic.direction) {
            // 旧格式：从 HTML 转回文本
            let directionText = topic.direction
                .replace(/<div class="direction-item">•\s*/g, '- ')
                .replace(/<\/div>/g, '\n')
                .trim();
            text += `【创作方向】\n${directionText}\n\n`;
        }

        // 原始上下文
        if (topic.context && !topic.angle) {
            text += `【背景信息】\n${topic.context}\n`;
        }

        return text.trim();
    }

    renderContentArea() {
        if (this.isLoading) {
            return `
                <div class="loading-container">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">正在生成内容...</div>
                    </div>
                </div>
                <div class="log-output" id="log-output"></div>
            `;
        }

        // 编辑输入阶段
        if (this.isEditing) {
            return `
                <div class="input-section">
                    <div class="input-header">
                        <div class="input-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">edit_note</span> 创作素材</div>
                        <div class="input-hint">编辑以下内容作为创作输入，可以提供更多内容，比如推文原文等，同时建议从AI推荐的创作方向中选择一个方向，删除其他方向，让AI可以更注重产出内容；</div>
                    </div>
                    <textarea class="content-textarea input-textarea" id="input-text" placeholder="输入你的创作素材...">${this.escapeHtml(this.inputText)}</textarea>

                    <div class="voice-style-section">
                        <div class="voice-style-header">
                            <div class="voice-style-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">theater_comedy</span> 写作风格模拟</div>
                            <div class="voice-style-hint">选择一个语气风格，让AI模仿该风格进行创作；也可以根据你喜爱的推主名，制作模仿其风格的模拟器</div>
                        </div>
                        <div class="voice-style-selector" id="voice-style-selector">
                            ${this.renderVoiceStyleOptions()}
                        </div>
                    </div>

                    <div class="input-actions">
                        <button class="btn btn-primary btn-large" id="generate-btn">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">auto_awesome</span> 生成内容
                        </button>
                        ${this.versionC ? `
                        <button class="btn btn-secondary" id="view-content-btn">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">visibility</span> 查看生成内容
                        </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        // 已生成内容阶段
        return `
            <div class="content-editor">
                <div class="editor-label">
                    <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">star</span> 生成结果
                </div>
                <textarea class="content-textarea" id="content-input">${this.escapeHtml(this.versionC)}</textarea>
                <div class="char-count">${this.versionC.length} 字</div>
            </div>

            ${this.score ? `
                <div class="score-card">
                    <div class="score-item">
                        <div class="score-label">好奇心</div>
                        <div class="score-value">${this.score.curiosity || '-'}</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">共鸣度</div>
                        <div class="score-value">${this.score.resonance || '-'}</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">清晰度</div>
                        <div class="score-value">${this.score.clarity || '-'}</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">传播值</div>
                        <div class="score-value">${this.score.viral || '-'}</div>
                    </div>
                    <div class="score-total">
                        总分: ${this.score.total || '-'}/100
                    </div>
                </div>
            ` : ''}

            ${this.suggestions ? `
                <div class="suggestions">
                    <div class="suggestions-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">lightbulb</span> 优化建议</div>
                    <div class="suggestions-content">${this.generator.formatMarkdown(this.suggestions)}</div>
                </div>
            ` : ''}

            <div class="regenerate-section">
                <button class="btn btn-secondary" id="edit-input-btn">
                    <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle; font-weight: bold;">arrow_back</span> 修改输入话题内容
                </button>
                <button class="btn btn-primary" id="regenerate-btn">
                    <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">refresh</span> 重新生成
                </button>
            </div>
        `;
    }

    updateContentArea() {
        const area = document.getElementById('content-area');
        if (area) {
            area.innerHTML = this.renderContentArea();
            this.bindContentEvents();
        }
    }

    bindEvents(container) {
        // 返回按钮 - 仅导航，不清除数据
        container.querySelector('#back-btn').addEventListener('click', async () => {
            try {
                await this.generator.updateTask('navigateTo', { toStep: 'trends' });
                this.generator.navigate('trends');
            } catch (error) {
                console.error('导航失败:', error);
            }
        });

        // 放弃任务
        container.querySelector('#abandon-btn').addEventListener('click', () => {
            this.generator.abandonTask();
        });

        // 下一步
        container.querySelector('#next-btn').addEventListener('click', async () => {
            await this.saveContent();
            this.generator.navigate('optimize');
        });

        this.bindContentEvents();
    }

    bindContentEvents() {
        const container = document.getElementById('content-area');
        if (!container) return;

        // 生成按钮
        const generateBtn = container.querySelector('#generate-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generateContent());
        }

        // 重新生成按钮
        const regenerateBtn = container.querySelector('#regenerate-btn');
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', () => this.generateContent());
        }

        // 修改输入按钮
        const editInputBtn = container.querySelector('#edit-input-btn');
        if (editInputBtn) {
            editInputBtn.addEventListener('click', () => {
                this.isEditing = true;
                this.updateContentArea();
            });
        }

        // 查看生成内容按钮
        const viewContentBtn = container.querySelector('#view-content-btn');
        if (viewContentBtn) {
            viewContentBtn.addEventListener('click', () => {
                this.isEditing = false;
                this.updateContentArea();
            });
        }

        // 监听输入框变化，保存输入文本，并自动调整高度
        const inputText = container.querySelector('#input-text');
        if (inputText) {
            this.autoResizeTextarea(inputText);
            inputText.addEventListener('input', (e) => {
                this.inputText = e.target.value;
                this.autoResizeTextarea(e.target);
            });
        }

        // 绑定语气选择事件
        this.bindVoiceStyleEvents();

        // 生成结果编辑框自动调整高度
        const contentInput = container.querySelector('#content-input');
        if (contentInput) {
            this.autoResizeTextarea(contentInput);
            contentInput.addEventListener('input', (e) => {
                this.autoResizeTextarea(e.target);
            });
        }
    }

    /**
     * 自动调整 textarea 高度以适应内容
     */
    autoResizeTextarea(textarea) {
        if (!textarea) return;
        // 重置高度以获取正确的 scrollHeight
        textarea.style.height = 'auto';
        // 设置高度为内容高度，最小 200px
        const minHeight = textarea.classList.contains('input-textarea') ? 300 : 200;
        textarea.style.height = Math.max(textarea.scrollHeight, minHeight) + 'px';
    }

    async generateContent() {
        // 获取用户编辑后的输入文本
        const inputTextEl = document.getElementById('input-text');
        if (inputTextEl) {
            this.inputText = inputTextEl.value.trim();
        }

        if (!this.inputText) {
            this.generator.showToast('请输入创作素材', 'error');
            return;
        }

        // 如果已有生成内容，显示确认弹窗
        if (this.versionC) {
            const confirmed = await this.generator.showConfirm(
                '重新生成将清除当前内容及后续所有步骤的数据，确定继续吗？'
            );
            if (!confirmed) return;
        }

        // 清除后续步骤的缓存数据
        try {
            await this.generator.updateTask('clearSubsequentData', { fromStep: 'content' });
        } catch (e) {
            console.warn('清除后续数据失败:', e);
        }

        this.isLoading = true;
        this.isEditing = false;
        this.updateContentArea();

        try {
            // 使用用户输入的文本作为 topic
            const customTopic = {
                title: '自定义创作',
                context: this.inputText
            };

            await this.generator.executeStep('content', {
                topic: customTopic,
                rawInput: this.inputText,
                voiceStyleId: this.selectedVoiceStyleId
            }, {
                start: () => {
                    // 开始
                },
                log: (data) => {
                    const logOutput = document.getElementById('log-output');
                    if (logOutput) {
                        this.appendLog(logOutput, data.message);
                    }
                },
                report: (data) => {
                    this.report = data.content;
                    this.parseReport(data.content);
                },
                done: async () => {
                    this.isLoading = false;
                    this.updateContentArea();
                    this.updateButtons();
                    // 自动保存生成的内容（不改变步骤）
                    await this.autoSaveContent();
                    // 如果使用了语气模板，增加使用次数
                    if (this.selectedVoiceStyleId) {
                        this.incrementVoiceStyleUsage(this.selectedVoiceStyleId);
                    }
                },
                error: (data) => {
                    this.isLoading = false;
                    this.isEditing = true; // 失败后回到编辑状态
                    this.generator.showToast(`生成失败: ${data.message}`, 'error');
                    this.updateContentArea();
                }
            });
        } catch (error) {
            this.isLoading = false;
            this.isEditing = true; // 失败后回到编辑状态
            this.generator.showToast(`生成失败: ${error.message}`, 'error');
            this.updateContentArea();
        }
    }

    parseReport(report) {
        // 尝试解析 JSON 格式
        try {
            let data = report;
            if (typeof report === 'string') {
                // 尝试解析 JSON 字符串
                let jsonStr = report.trim();
                // 移除可能的 markdown 代码块
                const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[1].trim();
                }
                // 找到 JSON 对象的开始和结束
                const startIndex = jsonStr.indexOf('{');
                const endIndex = jsonStr.lastIndexOf('}');
                if (startIndex !== -1 && endIndex !== -1) {
                    jsonStr = jsonStr.substring(startIndex, endIndex + 1);
                }
                data = JSON.parse(jsonStr);
            }

            // 从 JSON 中提取数据
            if (data.versionC && data.versionC.content) {
                // 将 \n 转换为实际换行
                this.versionC = data.versionC.content.replace(/\\n/g, '\n');
            }

            // 提取评分
            if (data.evaluation) {
                this.score = {
                    curiosity: data.evaluation.curiosity?.score || 0,
                    resonance: data.evaluation.resonance?.score || 0,
                    clarity: data.evaluation.clarity?.score || 0,
                    viral: data.evaluation.shareability?.score || 0,
                    total: data.evaluation.total || 0
                };
            }

            // 提取优化建议
            if (data.suggestions && Array.isArray(data.suggestions)) {
                this.suggestions = data.suggestions.map(s => `• ${s}`).join('\n');
            }

            // 保存完整数据以便后续使用
            this.reportData = data;

        } catch (e) {
            console.warn('JSON 解析失败，尝试使用旧的 Markdown 解析:', e.message);
            // 回退到旧的 Markdown 解析方式
            this.parseReportMarkdown(report);
        }
    }

    parseReportMarkdown(report) {
        // 旧的 Markdown 解析逻辑（作为回退）
        const versionCMatch = report.match(/##\s*🌟?\s*版本\s*C[\s\S]*?(?=##|$)/i);

        if (versionCMatch) {
            let content = versionCMatch[0];
            content = content.replace(/^##.*\n/, '').trim();
            content = content.replace(/###?\s*📊?\s*评分[\s\S]*/i, '').trim();
            this.versionC = content;
        } else {
            this.versionC = report;
        }

        const scoreMatch = report.match(/好奇心[：:]\s*(\d+)[\s\S]*?共鸣度[：:]\s*(\d+)[\s\S]*?清晰度[：:]\s*(\d+)[\s\S]*?传播值[：:]\s*(\d+)/i);
        if (scoreMatch) {
            this.score = {
                curiosity: parseInt(scoreMatch[1]),
                resonance: parseInt(scoreMatch[2]),
                clarity: parseInt(scoreMatch[3]),
                viral: parseInt(scoreMatch[4]),
                total: parseInt(scoreMatch[1]) + parseInt(scoreMatch[2]) + parseInt(scoreMatch[3]) + parseInt(scoreMatch[4])
            };
        }

        const suggestionsMatch = report.match(/###?\s*💡?\s*优化建议[\s\S]*?(?=##|$)/i);
        if (suggestionsMatch) {
            this.suggestions = suggestionsMatch[0].replace(/^###?.*\n/, '').trim();
        }
    }

    async saveContent() {
        const input = document.getElementById('content-input');
        const content = input ? input.value.trim() : this.versionC;

        if (!content) return;

        try {
            await this.generator.updateTask('saveContent', {
                versionC: content,
                score: this.score,
                suggestions: this.suggestions,
                rawReport: this.report,
                inputText: this.inputText
            });
        } catch (error) {
            console.error('保存内容失败:', error);
        }
    }

    async autoSaveContent() {
        // 自动保存内容数据（不改变步骤），用于生成后立即保存
        if (!this.versionC) return;

        try {
            await this.generator.updateTask('updateContentData', {
                versionC: this.versionC,
                score: this.score,
                suggestions: this.suggestions,
                rawReport: this.report,
                inputText: this.inputText
            });
            console.log('内容数据已自动保存');
        } catch (error) {
            console.error('自动保存内容数据失败:', error);
        }
    }

    /**
     * 增加语气模板使用次数
     */
    async incrementVoiceStyleUsage(voiceStyleId) {
        try {
            await fetch(`/api/tools/voice-prompts/${voiceStyleId}/use`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
        } catch (error) {
            console.warn('增加语气模板使用次数失败:', error);
        }
    }

    updateButtons() {
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) {
            nextBtn.disabled = !this.versionC;
            nextBtn.title = !this.versionC ? '请先生成内容' : '';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 格式化追加日志到输出框
     */
    appendLog(logOutput, message) {
        if (!message) return;

        // 按行分割
        const lines = message.split('\n');

        lines.forEach(line => {
            if (!line.trim()) return;

            const span = document.createElement('span');
            span.className = 'log-line';

            // 根据内容判断样式
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
window.ContentPage = ContentPage;

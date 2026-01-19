/**
 * 优化内容页 - 爆款优化和优化版本
 */
class OptimizePage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;
        this.isLoading = false;
        this.report = null;
        this.optimizedVersion = '';
        this.originalVersion = ''; // 原始版本
        this.viralScore = null;
        this.activeTab = 'optimized'; // 当前 tab: 'optimized' | 'original'
        this.userSuggestion = ''; // 用户的优化意见
        this.optimizeMode = 'viral'; // 优化模式: 'viral' | 'humanizer'
        // 解析后的报告数据
        this.parsedReport = {
            scoreCard: [],      // 六维评分
            totalScore: 0,      // 总分
            strengths: [],      // 优点
            weaknesses: [],     // 不足
            strategies: [],     // 优化策略
            optimizationNotes: [], // 优化说明
            humanScore: null,   // 人味评分（humanizer模式）
            humanTotalScore: 0, // 人味总分
            aiPatternsFound: [] // 检测到的AI模式
        };
    }

    render(container) {
        const task = this.state.task;

        // 获取原始版本
        this.originalVersion = task?.content_data?.versionC || '';

        // 如果已有数据，恢复
        if (task?.optimize_data?.optimizedVersion) {
            this.optimizedVersion = task.optimize_data.optimizedVersion;
            this.viralScore = task.optimize_data.viralScore;
            this.report = task.optimize_data.rawReport;
            if (this.report) {
                this.parseReport(this.report);
            }
        }

        container.innerHTML = `
            <div class="optimize-page">
                <div class="page-header">
                    <div class="page-title">
                        <span class="material-icons-outlined" style="color: #f97316;">rocket_launch</span> 优化内容 （ 可选 ）
                    </div>
                    <p class="page-subtitle">AI 会从六个维度评价该推文的传播影响力，并针对传播弱点进行修改，提升内容的爆款潜力；AI也会重点考虑你输入的优化建议一并修改</p>
                </div>

                <div class="optimize-area" id="optimize-area">
                    ${this.renderOptimizeArea()}
                </div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            ← ${this.optimizedVersion ? '返回编辑' : '返回内容生成'}
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-secondary" id="next-btn" ${!this.optimizedVersion ? 'disabled title="请先进行爆款优化"' : ''}>
                            下一步: 生成图片 →
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);
    }

    renderOptimizeArea() {
        if (this.isLoading) {
            const loadingText = this.optimizeMode === 'humanizer' ? '正在进行去AI味优化...' : '正在进行爆款优化...';
            return `
                <div class="loading-container">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">${loadingText}</div>
                    </div>
                </div>
                <div class="log-output" id="log-output"></div>
            `;
        }

        if (!this.report) {
            const task = this.state.task;
            const content = task?.content_data?.versionC || '';
            const preview = content.length > 100 ? content.substring(0, 100) + '...' : content;

            return `
                <div class="content-preview">
                    <div class="preview-label">待优化内容：</div>
                    <div class="preview-text">${this.escapeHtml(preview)}</div>
                </div>

                <div class="user-suggestion-section">
                    <div class="editor-label">
                        <span class="material-icons-outlined">lightbulb</span> 更多优化意见（可选）
                    </div>
                    <textarea
                        class="content-textarea suggestion-input"
                        id="user-suggestion"
                        rows="5"
                        placeholder="输入你的优化建议，例如：&#10;• 语气更加犀利一些&#10;• 加入更多数据支撑&#10;• 结尾需要更有力的金句"
                    >${this.escapeHtml(this.userSuggestion)}</textarea>
                    <div class="suggestion-hint">AI 会根据你的意见进行针对性优化</div>
                </div>

                <div class="optimize-mode-section" style="margin-top: 24px;">
                    <div class="editor-label" style="margin-bottom: 12px;">
                        <span class="material-icons-outlined">tune</span> 优化模式
                    </div>
                    <div class="optimize-mode-options" style="display: flex; gap: 16px; justify-content: center;">
                        <label class="optimize-mode-card ${this.optimizeMode === 'viral' ? 'active' : ''}" style="display: flex; align-items: flex-start; gap: 12px; padding: 16px; border: 2px solid ${this.optimizeMode === 'viral' ? '#f97316' : '#e2e8f0'}; border-radius: 12px; cursor: pointer; transition: all 0.2s; background: ${this.optimizeMode === 'viral' ? 'rgba(249, 115, 22, 0.05)' : 'transparent'}; flex: 1; max-width: 280px;">
                            <input type="radio" name="optimize-mode" value="viral" ${this.optimizeMode === 'viral' ? 'checked' : ''} style="margin-top: 2px;">
                            <div>
                                <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">
                                    <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle; color: #f97316;">local_fire_department</span> 强爆款优化
                                </div>
                                <div style="font-size: 12px; color: #64748b;">最大化传播潜力，优化标题、钩子、节奏</div>
                            </div>
                        </label>
                        <label class="optimize-mode-card ${this.optimizeMode === 'humanizer' ? 'active' : ''}" style="display: flex; align-items: flex-start; gap: 12px; padding: 16px; border: 2px solid ${this.optimizeMode === 'humanizer' ? '#8b5cf6' : '#e2e8f0'}; border-radius: 12px; cursor: pointer; transition: all 0.2s; background: ${this.optimizeMode === 'humanizer' ? 'rgba(139, 92, 246, 0.05)' : 'transparent'}; flex: 1; max-width: 280px;">
                            <input type="radio" name="optimize-mode" value="humanizer" ${this.optimizeMode === 'humanizer' ? 'checked' : ''} style="margin-top: 2px;">
                            <div>
                                <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">
                                    <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle; color: #8b5cf6;">person</span> 强去AI写作痕迹
                                </div>
                                <div style="font-size: 12px; color: #64748b;">去除AI味，让文字更自然、更像真人</div>
                            </div>
                        </label>
                    </div>
                </div>

                <div style="display: flex; justify-content: center; gap: 16px; margin-top: 24px;">
                    <button class="btn btn-primary btn-large" id="verify-btn">
                        <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">${this.optimizeMode === 'viral' ? 'science' : 'auto_fix_high'}</span> ${this.optimizeMode === 'viral' ? '开始爆款优化' : '开始去AI优化'}
                    </button>
                    <button class="btn btn-secondary" id="skip-optimize-btn">
                        <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">skip_next</span> 跳过优化
                    </button>
                </div>
            `;
        }

        return `
            <div class="verification-report">
                <!-- 总分显示 -->
                ${this.renderTotalScore()}

                <!-- 人味评分（humanizer模式） -->
                ${this.renderHumanScore()}

                <!-- 六维评分卡 -->
                ${this.renderScoreCard()}

                <!-- 检测到的AI模式（humanizer模式） -->
                ${this.renderAiPatterns()}

                <!-- 深度分析 -->
                ${this.renderAnalysis()}

                <!-- 优化策略 -->
                ${this.renderStrategies()}

            </div>

            <!-- 版本对比 Tab -->
            <div class="version-compare-section">
                <div class="version-tabs">
                    <button class="version-tab ${this.activeTab === 'optimized' ? 'active' : ''}" data-tab="optimized">
                        <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">rocket_launch</span> 优化后版本
                    </button>
                    <button class="version-tab ${this.activeTab === 'original' ? 'active' : ''}" data-tab="original">
                        <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">edit_note</span> 优化前版本
                    </button>
                </div>

                <div class="version-content">
                    <!-- 优化后版本 -->
                    <div class="version-pane ${this.activeTab === 'optimized' ? 'active' : ''}" id="pane-optimized">
                        <textarea class="content-textarea" id="optimized-input">${this.escapeHtml(this.optimizedVersion)}</textarea>
                        <div class="char-count">${this.optimizedVersion.length} 字</div>
                        ${this.renderOptimizationNotes()}
                    </div>

                    <!-- 优化前版本 -->
                    <div class="version-pane ${this.activeTab === 'original' ? 'active' : ''}" id="pane-original">
                        <div class="original-content">${this.escapeHtml(this.originalVersion)}</div>
                        <div class="char-count">${this.originalVersion.length} 字</div>
                    </div>
                </div>
            </div>

            <div class="regenerate-section">
                <div class="regenerate-mode-section" style="margin-bottom: 16px;">
                    <div style="font-size: 13px; color: #64748b; margin-bottom: 8px; text-align: center;">重新优化模式：</div>
                    <div class="optimize-mode-options" style="display: flex; gap: 12px; justify-content: center;">
                        <label class="optimize-mode-card-small ${this.optimizeMode === 'viral' ? 'active' : ''}" style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 2px solid ${this.optimizeMode === 'viral' ? '#f97316' : '#e2e8f0'}; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: ${this.optimizeMode === 'viral' ? 'rgba(249, 115, 22, 0.05)' : 'transparent'};">
                            <input type="radio" name="reoptimize-mode" value="viral" ${this.optimizeMode === 'viral' ? 'checked' : ''}>
                            <span style="font-size: 13px; font-weight: 500; color: #1e293b;">
                                <span class="material-icons-outlined" style="font-size: 14px; vertical-align: middle; color: #f97316;">local_fire_department</span> 强爆款
                            </span>
                        </label>
                        <label class="optimize-mode-card-small ${this.optimizeMode === 'humanizer' ? 'active' : ''}" style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 2px solid ${this.optimizeMode === 'humanizer' ? '#8b5cf6' : '#e2e8f0'}; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: ${this.optimizeMode === 'humanizer' ? 'rgba(139, 92, 246, 0.05)' : 'transparent'};">
                            <input type="radio" name="reoptimize-mode" value="humanizer" ${this.optimizeMode === 'humanizer' ? 'checked' : ''}>
                            <span style="font-size: 13px; font-weight: 500; color: #1e293b;">
                                <span class="material-icons-outlined" style="font-size: 14px; vertical-align: middle; color: #8b5cf6;">person</span> 去AI味
                            </span>
                        </label>
                    </div>
                </div>
                <button class="btn btn-primary" id="reverify-btn">
                    <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">refresh</span> 重新优化
                </button>
            </div>
        `;
    }

    renderTotalScore() {
        const score = this.viralScore || this.parsedReport.totalScore;
        if (!score) return '';

        const scoreLevel = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
        const scoreIcon = score >= 80 ? 'local_fire_department' : score >= 60 ? 'thumb_up' : 'fitness_center';
        const scoreLabel = score >= 80 ? '爆款潜力极高' : score >= 60 ? '有爆款潜力' : '需要优化';

        return `
            <div class="total-score-card score-${scoreLevel}">
                <div class="score-circle">
                    <span class="score-number">${score}</span>
                    <span class="score-unit">分</span>
                </div>
                <div class="score-info">
                    <div class="score-label"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">${scoreIcon}</span> ${scoreLabel}</div>
                    <div class="score-desc">爆款潜力评分</div>
                </div>
            </div>
        `;
    }

    renderHumanScore() {
        const humanScore = this.parsedReport.humanScore;
        const humanTotalScore = this.parsedReport.humanTotalScore;
        if (!humanScore || !humanTotalScore) return '';

        const scoreLevel = humanTotalScore >= 45 ? 'high' : humanTotalScore >= 35 ? 'medium' : 'low';
        const scoreLabel = humanTotalScore >= 45 ? '已去除AI痕迹' : humanTotalScore >= 35 ? '基本自然' : '仍有AI味';

        const dimensions = [
            { key: 'directness', name: '直接性', desc: '直接陈述还是绕圈' },
            { key: 'rhythm', name: '节奏', desc: '句子长度变化' },
            { key: 'trust', name: '信任度', desc: '尊重读者智慧' },
            { key: 'authenticity', name: '真实性', desc: '像真人说话' },
            { key: 'conciseness', name: '精炼度', desc: '无冗余内容' }
        ];

        return `
            <div class="verify-section human-score-section" style="margin-top: 16px;">
                <div class="section-header">
                    <span class="section-icon material-icons-outlined" style="color: #8b5cf6;">person</span>
                    <span class="section-title">人味评分</span>
                    <span class="human-total-score" style="margin-left: auto; font-size: 14px; font-weight: 600; color: ${scoreLevel === 'high' ? '#22c55e' : scoreLevel === 'medium' ? '#f59e0b' : '#ef4444'};">
                        ${humanTotalScore}/50 - ${scoreLabel}
                    </span>
                </div>
                <div class="human-score-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 12px;">
                    ${dimensions.map(dim => {
                        const item = humanScore[dim.key];
                        if (!item) return '';
                        const score = item.score || 0;
                        const comment = item.comment || '';
                        const itemLevel = score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low';
                        return `
                            <div class="human-score-item" style="background: #f8fafc; padding: 12px; border-radius: 8px; text-align: center;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">${dim.name}</div>
                                <div style="font-size: 20px; font-weight: 700; color: ${itemLevel === 'high' ? '#22c55e' : itemLevel === 'medium' ? '#f59e0b' : '#ef4444'};">${score}</div>
                                <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">${dim.desc}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    renderAiPatterns() {
        const patterns = this.parsedReport.aiPatternsFound;
        if (!patterns || !patterns.length) return '';

        return `
            <div class="verify-section ai-patterns-section" style="margin-top: 16px;">
                <div class="section-header">
                    <span class="section-icon material-icons-outlined" style="color: #ef4444;">bug_report</span>
                    <span class="section-title">检测到的AI写作模式</span>
                </div>
                <div class="ai-patterns-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;">
                    ${patterns.map(p => `
                        <span style="display: inline-block; padding: 6px 12px; background: #fef2f2; color: #dc2626; border-radius: 6px; font-size: 12px;">
                            ${p}
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderScoreCard() {
        if (!this.parsedReport.scoreCard.length) return '';

        return `
            <div class="verify-section">
                <div class="section-header">
                    <span class="section-icon material-icons-outlined">analytics</span>
                    <span class="section-title">六维评分</span>
                </div>
                <div class="score-grid">
                    ${this.parsedReport.scoreCard.map(item => `
                        <div class="score-item-card">
                            <div class="score-item-header">
                                <span class="score-item-name">${item.name}</span>
                                <span class="score-item-value ${this.getScoreClass(item.score)}">${item.score}</span>
                            </div>
                            <div class="score-item-bar">
                                <div class="score-item-fill ${this.getScoreClass(item.score)}" style="width: ${item.score * 10}%"></div>
                            </div>
                            <div class="score-item-comment">${item.comment}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    getScoreClass(score) {
        if (score >= 8) return 'score-high';
        if (score >= 6) return 'score-medium';
        return 'score-low';
    }

    renderAnalysis() {
        if (!this.parsedReport.strengths.length && !this.parsedReport.weaknesses.length) return '';

        return `
            <div class="verify-section">
                <div class="section-header">
                    <span class="section-icon material-icons-outlined">search</span>
                    <span class="section-title">深度分析</span>
                </div>
                <div class="analysis-grid">
                    ${this.parsedReport.strengths.length ? `
                        <div class="analysis-card strengths">
                            <div class="analysis-card-header">
                                <span class="analysis-icon material-icons-outlined" style="color: #22c55e;">check_circle</span>
                                <span class="analysis-label">优点</span>
                            </div>
                            <ul class="analysis-list">
                                ${this.parsedReport.strengths.map(s => `<li>${s}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    ${this.parsedReport.weaknesses.length ? `
                        <div class="analysis-card weaknesses">
                            <div class="analysis-card-header">
                                <span class="analysis-icon material-icons-outlined" style="color: #ef4444;">cancel</span>
                                <span class="analysis-label">待改进</span>
                            </div>
                            <ul class="analysis-list">
                                ${this.parsedReport.weaknesses.map(w => `<li>${w}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderStrategies() {
        if (!this.parsedReport.strategies.length) return '';

        return `
            <div class="verify-section">
                <div class="section-header">
                    <span class="section-icon material-icons-outlined">lightbulb</span>
                    <span class="section-title">优化策略</span>
                </div>
                <div class="strategies-list">
                    ${this.parsedReport.strategies.map((s, i) => `
                        <div class="strategy-item">
                            <span class="strategy-num">${i + 1}</span>
                            <span class="strategy-text">${s}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderOptimizationNotes() {
        if (!this.parsedReport.optimizationNotes.length) return '';

        return `
            <div class="optimization-notes">
                <div class="notes-header"><span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">edit_note</span> 优化说明</div>
                <ul class="notes-list">
                    ${this.parsedReport.optimizationNotes.map(n => `<li>${n}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    updateOptimizeArea() {
        const area = document.getElementById('optimize-area');
        if (area) {
            area.innerHTML = this.renderOptimizeArea();
            this.bindOptimizeEvents();
        }
    }

    bindEvents(container) {
        // 返回按钮 - 仅导航，不清除数据
        container.querySelector('#back-btn').addEventListener('click', async () => {
            try {
                await this.generator.updateTask('navigateTo', { toStep: 'content' });
                this.generator.navigate('content');
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
            await this.saveOptimize();
            this.generator.navigate('image');
        });

        this.bindOptimizeEvents();
    }

    bindOptimizeEvents() {
        const container = document.getElementById('optimize-area');
        if (!container) return;

        // 用户优化意见输入
        const suggestionInput = container.querySelector('#user-suggestion');
        if (suggestionInput) {
            suggestionInput.addEventListener('input', (e) => {
                this.userSuggestion = e.target.value;
            });
        }

        // 优化模式切换（开始前）
        container.querySelectorAll('input[name="optimize-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.optimizeMode = e.target.value;
                this.updateOptimizeArea(); // 重新渲染以更新按钮文字和样式
            });
        });

        // 重新优化模式切换
        container.querySelectorAll('input[name="reoptimize-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.optimizeMode = e.target.value;
                this.updateOptimizeArea(); // 重新渲染以更新样式
            });
        });

        // 跳过优化按钮
        const skipOptimizeBtn = container.querySelector('#skip-optimize-btn');
        if (skipOptimizeBtn) {
            skipOptimizeBtn.addEventListener('click', async () => {
                try {
                    await this.generator.updateTask('skipStep', { step: 'optimize' });
                    this.generator.navigate('image');
                } catch (error) {
                    console.error('跳过失败:', error);
                }
            });
        }

        // 开始验证按钮
        const verifyBtn = container.querySelector('#verify-btn');
        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => this.startVerification());
        }

        // 重新验证按钮
        const reverifyBtn = container.querySelector('#reverify-btn');
        if (reverifyBtn) {
            reverifyBtn.addEventListener('click', () => this.startVerification());
        }

        // 版本 Tab 切换
        container.querySelectorAll('.version-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                this.activeTab = targetTab;

                // 更新 tab 按钮状态
                container.querySelectorAll('.version-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.tab === targetTab);
                });

                // 更新 pane 显示
                container.querySelectorAll('.version-pane').forEach(pane => {
                    pane.classList.toggle('active', pane.id === `pane-${targetTab}`);
                });

                // 切换到优化版本 tab 时重新调整高度
                if (targetTab === 'optimized') {
                    const optimizedInput = container.querySelector('#optimized-input');
                    if (optimizedInput) {
                        this.autoResizeTextarea(optimizedInput);
                    }
                }
            });
        });

        // 优化版本编辑框自动调整高度
        const optimizedInput = container.querySelector('#optimized-input');
        if (optimizedInput) {
            this.autoResizeTextarea(optimizedInput);
            optimizedInput.addEventListener('input', (e) => {
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
        textarea.style.height = Math.max(textarea.scrollHeight, 200) + 'px';
    }

    async startVerification() {
        const task = this.state.task;
        const content = task?.content_data?.versionC;

        if (!content) {
            this.generator.showToast('没有找到待验证的内容', 'error');
            return;
        }

        // 如果已有优化内容，显示确认弹窗
        if (this.optimizedVersion) {
            const confirmed = await this.generator.showConfirm(
                '重新优化将清除当前优化结果及后续所有步骤的数据，确定继续吗？'
            );
            if (!confirmed) return;
        }

        // 清除后续步骤的缓存数据
        try {
            await this.generator.updateTask('clearSubsequentData', { fromStep: 'optimize' });
        } catch (e) {
            console.warn('清除后续数据失败:', e);
        }

        this.isLoading = true;
        this.updateOptimizeArea();

        try {
            await this.generator.executeStep('optimize', { content, userSuggestion: this.userSuggestion, optimizeMode: this.optimizeMode }, {
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
                    this.updateOptimizeArea();
                    this.updateButtons();
                    // 自动保存优化数据（不改变步骤）
                    await this.autoSaveOptimize();
                },
                error: (data) => {
                    this.isLoading = false;
                    this.generator.showToast(`验证失败: ${data.message}`, 'error');
                    this.updateOptimizeArea();
                }
            });
        } catch (error) {
            this.isLoading = false;
            this.generator.showToast(`验证失败: ${error.message}`, 'error');
            this.updateOptimizeArea();
        }
    }

    parseReport(report) {
        // 重置解析数据
        this.parsedReport = {
            scoreCard: [],
            totalScore: 0,
            strengths: [],
            weaknesses: [],
            strategies: [],
            optimizationNotes: [],
            humanScore: null,
            humanTotalScore: 0,
            aiPatternsFound: []
        };

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
            // 总分
            if (typeof data.totalScore === 'number') {
                this.viralScore = data.totalScore;
                this.parsedReport.totalScore = data.totalScore;
            }

            // 六维评分
            if (data.scoreCard && Array.isArray(data.scoreCard)) {
                this.parsedReport.scoreCard = data.scoreCard.map(item => ({
                    name: item.factor,
                    score: item.score,
                    comment: item.comment
                }));
            }

            // 优点和不足
            if (data.analysis) {
                if (Array.isArray(data.analysis.strengths)) {
                    this.parsedReport.strengths = data.analysis.strengths;
                }
                if (Array.isArray(data.analysis.weaknesses)) {
                    this.parsedReport.weaknesses = data.analysis.weaknesses;
                }
            }

            // 优化策略
            if (data.strategies) {
                const strategies = [];
                if (data.strategies.titleFix) {
                    strategies.push(`<strong>标题修正</strong>：${data.strategies.titleFix}`);
                }
                if (data.strategies.hookFix) {
                    strategies.push(`<strong>开头钩子</strong>：${data.strategies.hookFix}`);
                }
                if (data.strategies.structureFix) {
                    strategies.push(`<strong>结构调整</strong>：${data.strategies.structureFix}`);
                }
                if (data.strategies.toneFix) {
                    strategies.push(`<strong>语气调整</strong>：${data.strategies.toneFix}`);
                }
                // humanizer模式的去AI味建议
                if (data.strategies.humanizeFix) {
                    strategies.push(`<strong>去AI味修改</strong>：${data.strategies.humanizeFix}`);
                }
                this.parsedReport.strategies = strategies;
            }

            // humanizer模式：人味评分
            if (data.humanScore) {
                this.parsedReport.humanScore = data.humanScore;
            }
            if (typeof data.humanTotalScore === 'number') {
                this.parsedReport.humanTotalScore = data.humanTotalScore;
            }

            // humanizer模式：检测到的AI模式
            if (data.analysis && Array.isArray(data.analysis.aiPatternsFound)) {
                this.parsedReport.aiPatternsFound = data.analysis.aiPatternsFound;
            }

            // 优化版本
            if (data.optimizedVersion) {
                // 将 \n 转换为实际换行
                this.optimizedVersion = data.optimizedVersion.replace(/\\n/g, '\n');
            }

            // 保存完整数据
            this.reportData = data;

            console.log('=== Report Parsing (JSON) ===');
            console.log('Viral score:', this.viralScore);
            console.log('Score card items:', this.parsedReport.scoreCard.length);
            console.log('Strengths:', this.parsedReport.strengths.length);
            console.log('Weaknesses:', this.parsedReport.weaknesses.length);
            console.log('Strategies:', this.parsedReport.strategies.length);
            console.log('Optimized version length:', this.optimizedVersion.length);
            console.log('Human score:', this.parsedReport.humanScore ? 'yes' : 'no');
            console.log('Human total score:', this.parsedReport.humanTotalScore);
            console.log('AI patterns found:', this.parsedReport.aiPatternsFound.length);

        } catch (e) {
            console.warn('JSON 解析失败，尝试使用旧的 Markdown 解析:', e.message);
            // 回退到旧的 Markdown 解析方式
            this.parseReportMarkdown(report);
        }
    }

    parseReportMarkdown(report) {
        // 旧的 Markdown 解析逻辑（作为回退）

        // 提取总分
        const totalScoreMatch = report.match(/\*?\*?[🔥\s]*总体爆款潜力评分\*?\*?[：:\s]*(\d+)/i);
        if (totalScoreMatch) {
            this.viralScore = parseInt(totalScoreMatch[1]);
            this.parsedReport.totalScore = this.viralScore;
        } else {
            const backupMatch = report.match(/爆款潜力评分[）\)】\]\*\s：:]*\s*(\d+)\s*[\/／]\s*100/i);
            if (backupMatch) {
                this.viralScore = parseInt(backupMatch[1]);
                this.parsedReport.totalScore = this.viralScore;
            }
        }

        // 提取六维评分表格
        const tableSection = report.match(/##\s*\d*\.?\s*评分卡[\s\S]*?(?=\n---|\n##)/i);
        if (tableSection) {
            const rows = tableSection[0].split('\n').filter(row => {
                return row.includes('|') &&
                       !row.includes('要素') &&
                       !row.includes('得分') &&
                       !row.match(/^\|\s*:?-+/);
            });

            for (const row of rows) {
                const cells = row.split('|').map(c => c.trim()).filter(c => c);
                if (cells.length >= 3) {
                    const score = parseInt(cells[1]) || 0;
                    this.parsedReport.scoreCard.push({
                        name: cells[0],
                        score: score,
                        comment: cells[2]
                    });
                }
            }
        }

        // 提取优点
        const strengthsMatch = report.match(/###?\s*✅?\s*优点[^#]*?(?=###|---|\n##)/is);
        if (strengthsMatch) {
            const listItems = strengthsMatch[0].match(/\*\s+\*\*([^*]+)\*\*[：:]\s*([^\n]+)/g);
            if (listItems) {
                this.parsedReport.strengths = listItems.map(item => {
                    const match = item.match(/\*\*([^*]+)\*\*[：:]\s*(.+)/);
                    return match ? `<strong>${match[1]}</strong>：${match[2]}` : item.replace(/^\*\s*/, '');
                });
            }
        }

        // 提取不足
        const weaknessMatch = report.match(/###?\s*❌?\s*不足[^#]*?(?=###|---|\n##)/is);
        if (weaknessMatch) {
            const listItems = weaknessMatch[0].match(/\*\s+\*\*([^*]+)\*\*[：:]\s*([^\n]+)/g);
            if (listItems) {
                this.parsedReport.weaknesses = listItems.map(item => {
                    const match = item.match(/\*\*([^*]+)\*\*[：:]\s*(.+)/);
                    return match ? `<strong>${match[1]}</strong>：${match[2]}` : item.replace(/^\*\s*/, '');
                });
            }
        }

        // 提取优化策略
        const strategyMatch = report.match(/##\s*\d*\.?\s*优化策略[^#]*?(?=\n##|---\s*\n\s*##)/is);
        if (strategyMatch) {
            const listItems = strategyMatch[0].match(/\*\s+\*\*([^*]+)\*\*[：:]\s*([^\n]+)/g);
            if (listItems) {
                this.parsedReport.strategies = listItems.map(item => {
                    const match = item.match(/\*\*([^*]+)\*\*[：:]\s*(.+)/);
                    return match ? `<strong>${match[1]}</strong>：${match[2]}` : item.replace(/^\*\s*/, '');
                });
            }
        }

        // 提取优化版本
        const optimizedMatch = report.match(/##\s*\d*\.?\s*🚀?\s*最终优化爆款版本[^]*?(?=\*\*优化说明\*\*|$)/i);
        if (optimizedMatch) {
            let content = optimizedMatch[0];
            content = content.replace(/^##[^\n]*\n/, '').trim();
            content = content.replace(/^---\s*\n/, '').trim();
            content = content.replace(/\n---\s*$/, '').trim();
            this.optimizedVersion = content;
        } else {
            const task = this.state.task;
            this.optimizedVersion = task?.content_data?.versionC || '';
        }

        // 提取优化说明
        const notesMatch = report.match(/\*\*优化(?:要点)?说明\*\*[：:]\s*\n?([\s\S]+?)(?:\n\n|\n---|\n##|$)/i);
        if (notesMatch) {
            const listItems = notesMatch[1].match(/[-*]\s+([^\n]+)/g);
            if (listItems) {
                this.parsedReport.optimizationNotes = listItems.map(item => item.replace(/^[-*]\s+/, '').trim());
            }
        } else {
            const altNotesMatch = report.match(/优化(?:要点)?说明[：:]\s*\n?((?:[-*]\s+[^\n]+\n?)+)/i);
            if (altNotesMatch) {
                const listItems = altNotesMatch[1].match(/[-*]\s+([^\n]+)/g);
                if (listItems) {
                    this.parsedReport.optimizationNotes = listItems.map(item => item.replace(/^[-*]\s+/, '').trim());
                }
            }
        }

        console.log('=== Report Parsing (Markdown) ===');
        console.log('Viral score:', this.viralScore);
        console.log('Score card items:', this.parsedReport.scoreCard.length);
        console.log('Strengths:', this.parsedReport.strengths.length);
        console.log('Weaknesses:', this.parsedReport.weaknesses.length);
        console.log('Strategies:', this.parsedReport.strategies.length);
        console.log('Optimization notes:', this.parsedReport.optimizationNotes);
        console.log('Optimized version length:', this.optimizedVersion.length);
    }

    async saveOptimize() {
        const input = document.getElementById('optimized-input');
        const content = input ? input.value.trim() : this.optimizedVersion;

        if (!content) return;

        try {
            await this.generator.updateTask('saveOptimize', {
                optimizedVersion: content,
                viralScore: this.viralScore,
                rawReport: this.report
            });
        } catch (error) {
            console.error('保存优化内容失败:', error);
        }
    }

    async autoSaveOptimize() {
        // 自动保存优化数据（不改变步骤），用于中间状态保存
        if (!this.optimizedVersion && !this.report) return;

        try {
            await this.generator.updateTask('updateOptimizeData', {
                optimizedVersion: this.optimizedVersion,
                viralScore: this.viralScore,
                rawReport: this.report
            });
            console.log('优化数据已自动保存');
        } catch (error) {
            console.error('自动保存优化数据失败:', error);
        }
    }

    updateButtons() {
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) {
            nextBtn.disabled = !this.optimizedVersion;
            nextBtn.title = !this.optimizedVersion ? '请先进行爆款优化' : '';
        }

        const backBtn = document.getElementById('back-btn');
        if (backBtn) {
            backBtn.innerHTML = `← ${this.optimizedVersion ? '返回编辑' : '返回内容生成'}`;
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
window.OptimizePage = OptimizePage;

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
        // 解析后的报告数据
        this.parsedReport = {
            scoreCard: [],      // 六维评分
            totalScore: 0,      // 总分
            strengths: [],      // 优点
            weaknesses: [],     // 不足
            strategies: [],     // 优化策略
            optimizationNotes: [] // 优化说明
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
                <div class="page-title">
                    <span>🚀</span> 优化内容
                </div>

                <div class="optimize-area" id="optimize-area">
                    ${this.renderOptimizeArea()}
                </div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-primary" id="back-btn">
                            ← 返回编辑
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-ghost" id="skip-btn">
                            跳过图片
                        </button>
                        <button class="btn btn-primary" id="next-btn" ${!this.optimizedVersion ? 'disabled' : ''}>
                            下一步: 图片描述 →
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);
    }

    renderOptimizeArea() {
        if (this.isLoading) {
            return `
                <div class="loading-container">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">正在进行爆款优化...</div>
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
                        <span>💡</span> 优化意见（可选）
                    </div>
                    <textarea
                        class="content-textarea suggestion-input"
                        id="user-suggestion"
                        rows="5"
                        placeholder="输入你的优化建议，例如：&#10;• 语气更加犀利一些&#10;• 加入更多数据支撑&#10;• 结尾需要更有力的金句"
                    >${this.escapeHtml(this.userSuggestion)}</textarea>
                    <div class="suggestion-hint">AI 会根据你的意见进行针对性优化</div>
                </div>

                <div style="text-align: center; margin-top: 24px;">
                    <button class="btn btn-primary" id="verify-btn">
                        🧪 开始爆款优化
                    </button>
                </div>
            `;
        }

        return `
            <div class="verification-report">
                <!-- 总分显示 -->
                ${this.renderTotalScore()}

                <!-- 六维评分卡 -->
                ${this.renderScoreCard()}

                <!-- 深度分析 -->
                ${this.renderAnalysis()}

                <!-- 优化策略 -->
                ${this.renderStrategies()}

            </div>

            <!-- 版本对比 Tab -->
            <div class="version-compare-section">
                <div class="version-tabs">
                    <button class="version-tab ${this.activeTab === 'optimized' ? 'active' : ''}" data-tab="optimized">
                        🚀 优化后版本
                    </button>
                    <button class="version-tab ${this.activeTab === 'original' ? 'active' : ''}" data-tab="original">
                        📝 优化前版本
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
                <button class="btn btn-secondary" id="reverify-btn">
                    🔄 重新验证
                </button>
            </div>
        `;
    }

    renderTotalScore() {
        const score = this.viralScore || this.parsedReport.totalScore;
        if (!score) return '';

        const scoreLevel = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
        const scoreEmoji = score >= 80 ? '🔥' : score >= 60 ? '👍' : '💪';
        const scoreLabel = score >= 80 ? '爆款潜力极高' : score >= 60 ? '有爆款潜力' : '需要优化';

        return `
            <div class="total-score-card score-${scoreLevel}">
                <div class="score-circle">
                    <span class="score-number">${score}</span>
                    <span class="score-max">/100</span>
                </div>
                <div class="score-info">
                    <div class="score-label">${scoreEmoji} ${scoreLabel}</div>
                    <div class="score-desc">爆款潜力评分</div>
                </div>
            </div>
        `;
    }

    renderScoreCard() {
        if (!this.parsedReport.scoreCard.length) return '';

        return `
            <div class="verify-section">
                <div class="section-header">
                    <span class="section-icon">📊</span>
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
                    <span class="section-icon">🔍</span>
                    <span class="section-title">深度分析</span>
                </div>
                <div class="analysis-grid">
                    ${this.parsedReport.strengths.length ? `
                        <div class="analysis-card strengths">
                            <div class="analysis-card-header">
                                <span class="analysis-icon">✅</span>
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
                                <span class="analysis-icon">❌</span>
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
                    <span class="section-icon">💡</span>
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
                <div class="notes-header">📝 优化说明</div>
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

        // 跳过图片
        container.querySelector('#skip-btn').addEventListener('click', async () => {
            await this.saveOptimize();
            try {
                await this.generator.updateTask('skipStep', { step: 'image' });
                this.generator.navigate('submit');
            } catch (error) {
                console.error('跳过失败:', error);
            }
        });

        // 下一步
        container.querySelector('#next-btn').addEventListener('click', async () => {
            await this.saveOptimize();
            this.generator.navigate('prompt');
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
            await this.generator.executeStep('optimize', { content, userSuggestion: this.userSuggestion }, {
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
            optimizationNotes: []
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
                this.parsedReport.strategies = strategies;
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
        if (nextBtn) nextBtn.disabled = !this.optimizedVersion;
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

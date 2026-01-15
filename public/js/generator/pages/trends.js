/**
 * 热帖抓取页 - Tab 切换显示 X 趋势和 TopHub 热榜
 * 支持查看过去12小时的历史数据
 */
class TrendsPage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;
        this.activeTab = this.state.task?.trends_data?.source || 'x-trends';
        // 按小时存储数据: { 'x-trends': { '14': report, '13': report }, ... }
        this.hourlyReports = {
            'x-trends': {},
            'tophub-trends': {},
            'domain-trends': {}  // domain-trends:preset 格式
        };
        // 可用小时列表
        this.availableHours = {
            'x-trends': [],
            'tophub-trends': [],
            'domain-trends': []
        };
        // 当前选中的小时
        this.selectedHour = null;
        this.selectedTopic = null;
        this.isLoading = false;

        // domain-trends 相关
        this.domainPresets = [];       // 预设列表
        this.selectedPreset = 'web3';  // 当前选中的预设
    }

    render(container) {
        container.innerHTML = `
            <div class="trends-page">
                <div class="page-header">
                    <div class="page-title">
                        <span class="material-icons-outlined" style="color: #f97316;">local_fire_department</span> 热帖抓取
                    </div>
                    <p class="page-subtitle">从多个数据源选择实时热点，点击生成内容按钮，让AI开始创作</p>
                </div>

                <div class="tabs">
                    <button class="tab ${this.activeTab === 'x-trends' ? 'active' : ''}" data-tab="x-trends">
                        𝕏 X 趋势
                    </button>
                    <button class="tab ${this.activeTab === 'tophub-trends' ? 'active' : ''}" data-tab="tophub-trends">
                        <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">local_fire_department</span> TopHub 热榜
                    </button>
                    <button class="tab ${this.activeTab === 'domain-trends' ? 'active' : ''}" data-tab="domain-trends">
                        <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">track_changes</span> X领域趋势
                    </button>
                </div>

                <!-- 领域预设选择器（仅 domain-trends Tab 显示） -->
                <div class="preset-selector" id="preset-selector" style="display: ${this.activeTab === 'domain-trends' ? 'flex' : 'none'}">
                    <span class="preset-label">选择领域：</span>
                    <div class="preset-buttons" id="preset-buttons">
                        <!-- 预设按钮动态生成 -->
                    </div>
                </div>

                <!-- 小时时间轴 -->
                <div class="hour-timeline" id="hour-timeline">
                    <div class="loading-text">加载时间轴...</div>
                </div>

                <div class="trends-content" id="trends-content">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">加载中...</div>
                    </div>
                </div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">arrow_back</span> 返回首页
                        </button>
                    </div>
                    <div class="action-right">
                        ${this.state.task?.content_data?.versionC ? `
                            <button class="btn btn-primary" id="view-content-btn">
                                <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">visibility</span> 查看生成内容
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);
        this.loadDomainPresets();  // 加载预设列表
        this.loadAvailableHours();
    }

    bindEvents(container) {
        // Tab 切换
        container.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.activeTab = tab.dataset.tab;
                this.selectedHour = null; // 重置选中的小时
                container.querySelectorAll('.tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.tab === this.activeTab);
                });

                // 显示/隐藏预设选择器
                const presetSelector = document.getElementById('preset-selector');
                if (presetSelector) {
                    presetSelector.style.display = this.activeTab === 'domain-trends' ? 'flex' : 'none';
                }

                this.loadAvailableHours();
            });
        });

        // 返回按钮
        container.querySelector('#back-btn').addEventListener('click', () => {
            this.generator.navigate('home');
        });

        // 查看生成内容按钮
        const viewContentBtn = container.querySelector('#view-content-btn');
        if (viewContentBtn) {
            viewContentBtn.addEventListener('click', () => {
                this.generator.navigate('content');
            });
        }
    }

    /**
     * 加载 domain-trends 预设列表
     */
    async loadDomainPresets() {
        try {
            const response = await fetch('/api/skills/domain-trends/presets', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await response.json();

            if (data.success && data.presets) {
                this.domainPresets = data.presets;
                this.renderPresetButtons();
            }
        } catch (error) {
            console.error('加载预设列表失败:', error);
        }
    }

    /**
     * 渲染预设按钮
     */
    renderPresetButtons() {
        const container = document.getElementById('preset-buttons');
        if (!container) return;

        // 预设图标映射
        const presetIcons = {
            'web3': 'language',
            'ai': 'smart_toy',
            'gaming': 'sports_esports'
        };

        container.innerHTML = this.domainPresets.map(preset => `
            <button class="preset-btn ${this.selectedPreset === preset.id ? 'active' : ''}"
                    data-preset="${preset.id}"
                    title="${preset.description || preset.name}">
                <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">${presetIcons[preset.id] || 'analytics'}</span> ${preset.name}
            </button>
        `).join('');

        // 绑定预设按钮事件
        container.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedPreset = btn.dataset.preset;
                this.selectedHour = null;
                // 更新按钮状态
                container.querySelectorAll('.preset-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.preset === this.selectedPreset);
                });
                // 重新加载数据
                this.loadAvailableHours();
            });
        });
    }

    /**
     * 获取当前 skill ID（domain-trends 需要加上预设）
     */
    getCurrentSkillId() {
        if (this.activeTab === 'domain-trends') {
            return `domain-trends:${this.selectedPreset}`;
        }
        return this.activeTab;
    }

    /**
     * 获取缓存 key（用于本地 hourlyReports）
     */
    getCacheKey() {
        if (this.activeTab === 'domain-trends') {
            return `domain-trends:${this.selectedPreset}`;
        }
        return this.activeTab;
    }

    /**
     * 加载可用小时列表
     */
    async loadAvailableHours() {
        const skillId = this.getCurrentSkillId();
        const cacheKey = this.getCacheKey();

        try {
            const response = await fetch(`/api/skills/${skillId}/hours`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await response.json();

            if (data.success) {
                // 使用 cacheKey 存储，domain-trends 不同预设分开存储
                if (!this.availableHours[cacheKey]) {
                    this.availableHours[cacheKey] = [];
                }
                this.availableHours[cacheKey] = data.hours;
                this.renderHourTimeline();

                // 自动加载最新有数据的小时
                const firstWithData = data.hours.find(h => h.hasData);
                if (firstWithData) {
                    this.loadTrendsByHour(firstWithData.hourKey);
                } else {
                    // 没有任何历史数据，显示等待提示
                    this.showWaitingMessage();
                }
            } else {
                // 如果没有小时数据，显示等待提示
                this.showWaitingMessage();
            }
        } catch (error) {
            console.error('加载小时列表失败:', error);
            this.showWaitingMessage();
        }
    }

    /**
     * 显示等待抓取的提示
     */
    showWaitingMessage() {
        const content = document.getElementById('trends-content');
        if (!content) return;

        // domain-trends 每2小时轮换抓取
        const scheduleText = this.activeTab === 'domain-trends'
            ? '每2小时轮换'
            : '每小时第1分钟';

        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><span class="material-icons-outlined" style="font-size: 48px;">hourglass_empty</span></div>
                <div class="empty-state-text">暂无缓存数据，请等待系统定时抓取（${scheduleText}）</div>
            </div>
        `;
    }

    /**
     * 渲染小时时间轴
     */
    renderHourTimeline() {
        const timeline = document.getElementById('hour-timeline');
        if (!timeline) return;

        const cacheKey = this.getCacheKey();
        const hours = this.availableHours[cacheKey] || [];

        if (hours.length === 0) {
            timeline.innerHTML = '<div class="timeline-empty">暂无历史数据</div>';
            return;
        }

        timeline.innerHTML = `
            <div class="timeline-scroll">
                ${hours.map(h => `
                    <button class="hour-btn ${h.hasData ? '' : 'no-data'} ${this.selectedHour === h.hourKey ? 'active' : ''} ${h.isCurrent ? 'current' : ''}"
                            data-hour="${h.hourKey}"
                            ${!h.hasData ? 'disabled' : ''}>
                        <span class="hour-time">${h.displayTime}</span>
                        ${h.isCurrent ? '<span class="hour-label">当前</span>' : ''}
                    </button>
                `).join('')}
            </div>
        `;

        // 绑定小时按钮事件
        timeline.querySelectorAll('.hour-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const hourKey = btn.dataset.hour;
                this.loadTrendsByHour(hourKey);
            });
        });
    }

    /**
     * 加载指定小时的数据
     */
    async loadTrendsByHour(hourKey) {
        const skillId = this.getCurrentSkillId();
        const cacheKey = this.getCacheKey();

        // 确保缓存对象存在
        if (!this.hourlyReports[cacheKey]) {
            this.hourlyReports[cacheKey] = {};
        }

        // 检查是否已缓存
        const cached = this.hourlyReports[cacheKey][hourKey];
        if (cached) {
            this.selectedHour = hourKey;
            this.renderHourTimeline();
            this.renderContent();
            return;
        }

        this.isLoading = true;
        this.selectedHour = hourKey;
        this.renderHourTimeline();
        this.renderContent();

        try {
            const response = await fetch(`/api/skills/${skillId}/cached/${hourKey}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await response.json();

            if (data.success) {
                this.hourlyReports[cacheKey][hourKey] = data.content;
            } else {
                this.hourlyReports[cacheKey][hourKey] = `${hourKey}:00 暂无数据`;
            }
        } catch (error) {
            this.hourlyReports[cacheKey][hourKey] = `加载失败: ${error.message}`;
        }

        this.isLoading = false;
        this.renderContent();
    }

    /**
     * 加载当前小时数据（触发抓取）
     */
    async loadTrends() {
        this.isLoading = true;
        this.renderContent();

        try {
            await this.generator.executeStep('trends', { source: this.activeTab }, {
                start: (data) => {
                    this.renderContent();
                },
                log: (data) => {
                    // 可以显示日志
                },
                report: (data) => {
                    // 存储到当前小时
                    const now = new Date();
                    const hourKey = String(now.getHours()).padStart(2, '0');
                    this.hourlyReports[this.activeTab][hourKey] = data.content;
                    this.selectedHour = hourKey;
                },
                done: (data) => {
                    this.isLoading = false;
                    // 重新加载小时列表
                    this.loadAvailableHours();
                },
                error: (data) => {
                    this.isLoading = false;
                    const now = new Date();
                    const hourKey = String(now.getHours()).padStart(2, '0');
                    this.hourlyReports[this.activeTab][hourKey] = `加载失败: ${data.message}`;
                    this.selectedHour = hourKey;
                    this.renderContent();
                }
            });
        } catch (error) {
            this.isLoading = false;
            const now = new Date();
            const hourKey = String(now.getHours()).padStart(2, '0');
            this.hourlyReports[this.activeTab][hourKey] = `加载失败: ${error.message}`;
            this.selectedHour = hourKey;
            this.renderContent();
        }
    }

    renderContent() {
        const content = document.getElementById('trends-content');
        if (!content) return;

        if (this.isLoading) {
            content.innerHTML = `
                <div class="loading">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">正在获取热门趋势...</div>
                </div>
            `;
            return;
        }

        const cacheKey = this.getCacheKey();
        const hourlyData = this.hourlyReports[cacheKey] || {};
        const report = this.selectedHour ? hourlyData[this.selectedHour] : null;

        if (!report) {
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><span class="material-icons-outlined">analytics</span></div>
                    <div class="empty-state-text">选择上方时间查看历史数据，或等待下次定时抓取</div>
                </div>
            `;
            return;
        }

        // 根据 Tab 类型使用不同的渲染方式
        if (this.activeTab === 'x-trends' || this.activeTab === 'domain-trends') {
            // domain-trends 使用和 x-trends 相同的格式
            this.renderXTrendsContent(content, report);
        } else {
            this.renderTophubContent(content, report);
        }
    }

    renderXTrendsContent(content, report) {
        // 尝试解析 JSON 格式
        const jsonData = this.tryParseJSON(report);
        let sections, topics;

        if (jsonData) {
            // 使用 JSON 数据
            sections = {
                overview: jsonData.overview,
                categories: jsonData.categories
            };
            topics = this.parseTopicsFromJSON(jsonData);
        } else {
            // 回退到 Markdown 解析
            sections = this.parseXTrendsReport(report);
            topics = this.parseTopics(report);
        }

        content.innerHTML = `
            <!-- 热点概览 -->
            ${sections.overview ? `
                <div class="trends-section">
                    <h3 class="section-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">local_fire_department</span> 热点概览</h3>
                    <div class="section-content overview-content">
                        ${jsonData ? this.escapeHtml(sections.overview) : this.generator.formatMarkdown(sections.overview)}
                    </div>
                </div>
            ` : ''}

            <!-- 话题分类 -->
            ${sections.categories ? `
                <div class="trends-section">
                    <h3 class="section-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">folder</span> 话题分类</h3>
                    <div class="section-content categories-content">
                        ${jsonData ? this.renderCategoriesFromJSON(sections.categories) : this.renderCategories(sections.categories)}
                    </div>
                </div>
            ` : ''}

            <!-- 选题建议（已合并高潜力话题分析） -->
            <div class="trends-section">
                <div class="section-title-row">
                    <h3 class="section-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">lightbulb</span> 选题建议 <span class="section-hint">（点击选择一个话题）</span></h3>
                </div>
                ${topics.length > 0 ? `
                    <div class="topic-list">
                        ${topics.map((topic, index) => this.renderTopicItem(topic, index)).join('')}
                    </div>
                ` : `
                    <div class="empty-state" style="margin-bottom: 20px;">
                        <div class="empty-state-text">未能解析话题建议</div>
                    </div>
                `}
            </div>

        `;

        this.bindContentEvents(content, topics);
    }

    renderTophubContent(content, report) {
        // 尝试解析 JSON 格式
        const jsonData = this.tryParseJSON(report);
        let sections, topics;

        if (jsonData) {
            // 使用 JSON 数据
            sections = {
                overview: jsonData.overview,
                categories: jsonData.categories
            };
            topics = this.parseTopicsFromJSON(jsonData, true); // showSource = true for tophub
        } else {
            // 回退到 Markdown 解析
            topics = this.parseTopics(report);
            sections = null;
        }

        content.innerHTML = `
            <!-- 热点概览 (仅 JSON 模式) -->
            ${jsonData && sections.overview ? `
                <div class="trends-section">
                    <h3 class="section-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">local_fire_department</span> 热点概览</h3>
                    <div class="section-content overview-content">
                        ${this.escapeHtml(sections.overview)}
                    </div>
                </div>
            ` : ''}

            <!-- 话题分类 (仅 JSON 模式) -->
            ${jsonData && sections.categories ? `
                <div class="trends-section">
                    <h3 class="section-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">folder</span> 话题分类</h3>
                    <div class="section-content categories-content">
                        ${this.renderCategoriesFromJSON(sections.categories)}
                    </div>
                </div>
            ` : ''}

            <!-- 选题建议（已合并高潜力话题分析） -->
            <div class="trends-section">
                <div class="section-title-row">
                    <h3 class="section-title"><span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">lightbulb</span> 选题建议 <span class="section-hint">（点击选择一个话题）</span></h3>
                </div>
                ${topics.length > 0 ? `
                    <div class="topic-list">
                        ${topics.map((topic, index) => this.renderTopicItem(topic, index)).join('')}
                    </div>
                ` : `
                    <div class="empty-state" style="margin-bottom: 20px;">
                        <div class="empty-state-text">未能解析话题建议，请查看原始报告选择话题</div>
                    </div>
                `}
            </div>

        `;

        this.bindContentEvents(content, topics);
    }

    bindContentEvents(content, topics) {
        // 绑定展开/折叠按钮事件
        content.querySelectorAll('.topic-expand-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = btn.dataset.index;
                const details = content.querySelector(`.topic-details[data-index="${index}"]`);
                const preview = content.querySelector(`.topic-preview[data-index="${index}"]`);
                const icon = btn.querySelector('.material-icons-outlined');
                const text = btn.querySelector('.expand-text');

                if (details) {
                    const isExpanded = details.style.display !== 'none';
                    details.style.display = isExpanded ? 'none' : 'block';
                    if (preview) preview.style.display = isExpanded ? 'block' : 'none';
                    icon.textContent = isExpanded ? 'expand_more' : 'expand_less';
                    if (text) text.textContent = isExpanded ? '详情' : '收起';
                    btn.title = isExpanded ? '展开详情' : '收起详情';
                    btn.classList.toggle('expanded', !isExpanded);
                }
            });
        });

        // 绑定话题选择事件
        content.querySelectorAll('.topic-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                const topic = topics[index];

                // 切换选择状态
                if (this.selectedTopic?.index === index) {
                    this.selectedTopic = null;
                } else {
                    this.selectedTopic = { ...topic, index, source: this.activeTab };
                }

                // 更新 UI
                content.querySelectorAll('.topic-item').forEach(i => {
                    i.classList.toggle('selected', parseInt(i.dataset.index) === this.selectedTopic?.index);
                });
            });
        });

        // 绑定"下一步：生成内容"按钮事件
        content.querySelectorAll('.topic-next-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                const topic = topics[index];

                // 设置选中的话题
                const newTopic = { ...topic, index, source: this.activeTab };

                // 检查是否已有选题且选题不同，且已有后续数据
                const existingTopic = this.state.task?.trends_data?.selectedTopic;
                const hasSubsequentData = this.state.task?.content_data?.versionC;

                if (existingTopic && hasSubsequentData) {
                    // 检查是否选择了不同的话题
                    const isSameTopic = existingTopic.title === newTopic.title &&
                                       existingTopic.source === newTopic.source;

                    if (!isSameTopic) {
                        const confirmed = await this.generator.showConfirm(
                            '选择新话题将清除已生成的内容及后续所有数据，确定继续吗？'
                        );
                        if (!confirmed) return;

                        // 清除后续数据
                        try {
                            await this.generator.updateTask('clearSubsequentData', { fromStep: 'trends' });
                        } catch (err) {
                            console.warn('清除后续数据失败:', err);
                        }
                    }
                }

                this.selectedTopic = newTopic;

                try {
                    // 保存选择的话题并进入下一步
                    await this.generator.updateTask('selectTopic', this.selectedTopic);
                    this.generator.navigate('content');
                } catch (error) {
                    console.error('保存话题失败:', error);
                }
            });
        });
    }

    parseXTrendsReport(report) {
        const sections = {
            overview: null,
            highPotential: null,
            categories: null
        };

        // 提取热点概览
        const overviewMatch = report.match(/##\s*热点概览\s*\n([\s\S]*?)(?=\n---|\n##)/);
        if (overviewMatch) {
            sections.overview = overviewMatch[1].trim();
        }

        // 提取高潜力话题分析表格
        const highPotentialMatch = report.match(/##\s*高潜力话题分析\s*\n([\s\S]*?)(?=\n---|\n##)/);
        if (highPotentialMatch) {
            sections.highPotential = this.parseTable(highPotentialMatch[1]);
        }

        // 提取话题分类
        const categoriesMatch = report.match(/##\s*话题分类\s*\n([\s\S]*?)(?=\n---|\n##)/);
        if (categoriesMatch) {
            sections.categories = this.parseCategories(categoriesMatch[1]);
        }

        return sections;
    }

    parseTable(tableText) {
        const lines = tableText.trim().split('\n').filter(line => line.includes('|'));
        if (lines.length < 3) return null;

        // 解析表头
        const headers = lines[0].split('|').map(h => h.trim()).filter(h => h);

        // 跳过分隔行，解析数据行
        const rows = [];
        for (let i = 2; i < lines.length; i++) {
            const cells = lines[i].split('|').map(c => c.trim()).filter(c => c);
            if (cells.length >= headers.length) {
                const row = {};
                headers.forEach((h, idx) => {
                    row[h] = cells[idx] || '';
                });
                rows.push(row);
            }
        }

        return { headers, rows };
    }

    renderHighPotentialTable(tableData) {
        if (!tableData || !tableData.rows.length) return '';

        return `
            <div class="potential-table">
                ${tableData.rows.map(row => `
                    <div class="potential-row">
                        <div class="potential-rank">${row['排名'] || ''}</div>
                        <div class="potential-main">
                            <div class="potential-topic">${row['话题'] || ''}</div>
                            <div class="potential-reason">${row['原因'] || ''}</div>
                        </div>
                        <div class="potential-score">${row['潜力评分'] || ''}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    parseCategories(categoriesText) {
        const categories = [];
        const categoryRegex = /###\s*([^\n]+)\n([\s\S]*?)(?=###|$)/g;
        let match;

        while ((match = categoryRegex.exec(categoriesText)) !== null) {
            const title = match[1].trim();
            const items = match[2].trim().split('\n')
                .filter(line => line.startsWith('-'))
                .map(line => line.replace(/^-\s*/, '').trim());

            if (items.length > 0) {
                categories.push({ title, items });
            }
        }

        return categories;
    }

    renderCategories(categories) {
        if (!categories || categories.length === 0) return '';

        return `
            <div class="categories-grid">
                ${categories.map(cat => `
                    <div class="category-card">
                        <div class="category-title">${cat.title}</div>
                        <div class="category-items">
                            ${cat.items.map(item => `<span class="category-tag">${item}</span>`).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    parseTopics(report) {
        const topics = [];

        // 尝试解析 "建议N" 格式
        const suggestionRegex = /###\s*建议\s*(\d+)[：:]*\s*(.*?)(?=###\s*建议|\n##|\n#|$)/gs;
        let match;

        while ((match = suggestionRegex.exec(report)) !== null) {
            const content = match[2].trim();

            // 提取话题名称
            const topicMatch = content.match(/\*\*话题\*\*[：:]\s*(.+)/);
            const angleMatch = content.match(/\*\*选题角度\*\*[：:]\s*(.+)/);
            const whyMatch = content.match(/\*\*为什么有效\*\*[：:]\s*(.+)/);

            // 提取创作方向（可能是多行列表）
            const directionMatch = content.match(/\*\*创作方向\*\*[：:]\s*([\s\S]*?)(?=\n\n|$)/);
            let direction = '';
            if (directionMatch) {
                // 解析列表项
                const directionLines = directionMatch[1].trim().split('\n')
                    .filter(line => line.trim().startsWith('-'))
                    .map(line => line.replace(/^\s*-\s*/, '').trim());
                if (directionLines.length > 0) {
                    direction = directionLines.map(d => `<div class="direction-item">• ${d}</div>`).join('');
                } else {
                    direction = directionMatch[1].trim();
                }
            }

            topics.push({
                title: topicMatch ? topicMatch[1] : `建议 ${match[1]}`,
                topic: topicMatch ? topicMatch[1] : '',
                angle: angleMatch ? angleMatch[1] : '',
                meta: whyMatch ? whyMatch[1] : '',
                direction: direction,
                suggestion: angleMatch ? angleMatch[1] : '',
                context: content
            });
        }

        // 如果没有解析到，尝试其他格式
        if (topics.length === 0) {
            const lines = report.split('\n');
            let currentTopic = null;

            for (const line of lines) {
                if (line.match(/^#+\s*\d+[.、]/)) {
                    if (currentTopic) topics.push(currentTopic);
                    currentTopic = { title: line.replace(/^#+\s*/, ''), context: '' };
                } else if (currentTopic) {
                    currentTopic.context += line + '\n';
                }
            }
            if (currentTopic) topics.push(currentTopic);
        }

        return topics.slice(0, 10); // 最多显示 10 个
    }

    // === JSON 解析辅助方法 ===

    tryParseJSON(report) {
        try {
            let data = report;
            if (typeof report === 'string') {
                let jsonStr = report.trim();
                // 移除可能的 markdown 代码块
                const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[1].trim();
                }
                // 找到 JSON 对象
                const startIndex = jsonStr.indexOf('{');
                const endIndex = jsonStr.lastIndexOf('}');
                if (startIndex !== -1 && endIndex !== -1) {
                    jsonStr = jsonStr.substring(startIndex, endIndex + 1);
                }
                data = JSON.parse(jsonStr);
            }
            // 验证是否有 suggestions 字段（标志性字段）
            if (data && data.suggestions && Array.isArray(data.suggestions)) {
                return data;
            }
            return null;
        } catch (e) {
            console.log('JSON 解析失败，将使用 Markdown 解析:', e.message);
            return null;
        }
    }

    parseTopicsFromJSON(jsonData, showSource = false) {
        if (!jsonData || !jsonData.suggestions) return [];

        return jsonData.suggestions.map((s, index) => {
            // 处理创作方向：优先使用 directions 数组，回退到 direction 字符串
            let direction = '';

            if (s.directions && Array.isArray(s.directions) && s.directions.length > 0) {
                // 新格式：directions 是数组
                direction = s.directions.map(d => `<div class="direction-item">• ${this.escapeHtml(d.trim())}</div>`).join('');
            } else if (s.direction) {
                // 旧格式：direction 是字符串
                const dirStr = s.direction;
                if (!dirStr.includes('<div')) {
                    // 如果方向包含换行或分号，拆分为列表项
                    const items = dirStr.split(/[;；\n]/).filter(i => i.trim());
                    if (items.length > 1) {
                        direction = items.map(d => `<div class="direction-item">• ${this.escapeHtml(d.trim())}</div>`).join('');
                    } else {
                        direction = `<div class="direction-item">• ${this.escapeHtml(dirStr)}</div>`;
                    }
                } else {
                    direction = dirStr;
                }
            }

            // 提取链接：优先使用 tweetUrl（具体推文），其次 link（tophub），最后 url（搜索链接）
            const topicLink = s.tweetUrl || s.link || s.url || '';

            return {
                title: s.topic || `建议 ${index + 1}`,
                topic: s.topic || '',
                source: showSource ? (s.source || '') : '', // 来源平台（仅 tophub）
                link: topicLink, // 话题链接
                score: s.score || '', // 潜力评分
                reason: s.reason || '', // 为什么有潜力
                angle: s.angle || '',
                meta: s.whyEffective || '',
                direction: direction,
                directions: s.directions || [], // 保存原始数组供后续使用
                suggestion: s.angle || '',
                context: JSON.stringify(s)
            };
        });
    }

    /**
     * 渲染单个话题项（合并高潜力分析和选题建议）
     * 默认折叠，只显示标题、查看原帖、潜力分析
     */
    renderTopicItem(topic, index) {
        // 检查是否有可折叠的详细内容
        const hasDetails = topic.source || topic.angle || topic.meta || topic.direction;
        // 第一条默认展开
        const isExpanded = index === 0 && hasDetails;

        return `
            <div class="topic-item ${this.selectedTopic?.index === index ? 'selected' : ''}"
                 data-index="${index}">
                <!-- 始终显示的部分 -->
                <div class="topic-header">
                    <span class="topic-number">${index + 1}</span>
                    <span class="topic-title">${this.escapeHtml(topic.title)}</span>
                    ${topic.score ? `<span class="topic-score score-${this.getScoreClass(topic.score)}" title="${this.getScoreTitle(topic.score)}">${this.getScoreFireIcons(topic.score)}</span>` : ''}
                    ${hasDetails ? `
                        <button class="topic-expand-btn ${isExpanded ? 'expanded' : ''}" data-index="${index}" onclick="event.stopPropagation();" title="${isExpanded ? '收起详情' : '展开详情'}">
                            <span class="material-icons-outlined">${isExpanded ? 'expand_less' : 'expand_more'}</span>
                            <span class="expand-text">${isExpanded ? '收起' : '详情'}</span>
                        </button>
                    ` : ''}
                </div>
                ${topic.link ? `
                    <div class="topic-field topic-link">
                        <a href="${this.escapeHtml(topic.link)}" target="_blank" rel="noopener noreferrer" class="topic-link-btn" onclick="event.stopPropagation();">
                            <span class="material-icons-outlined" style="font-size: 14px; vertical-align: middle;">link</span> 查看原帖
                        </a>
                    </div>
                ` : ''}
                ${topic.angle ? `
                    <div class="topic-field topic-preview" data-index="${index}" style="display: ${isExpanded ? 'none' : 'block'};">
                        <span class="field-label">选题角度:</span>
                        <span class="field-value">${this.escapeHtml(topic.angle)}</span>
                    </div>
                ` : ''}

                <!-- 折叠的详细内容 -->
                ${hasDetails ? `
                    <div class="topic-details" data-index="${index}" style="display: ${isExpanded ? 'block' : 'none'};">
                        ${topic.source ? `
                            <div class="topic-field topic-source">
                                <span class="field-label">来源:</span>
                                <span class="field-value source-tag">${this.escapeHtml(topic.source)}</span>
                            </div>
                        ` : ''}
                        ${topic.angle ? `
                            <div class="topic-field">
                                <span class="field-label">选题角度:</span>
                                <span class="field-value">${this.escapeHtml(topic.angle)}</span>
                            </div>
                        ` : ''}
                        ${topic.meta ? `
                            <div class="topic-field">
                                <span class="field-label">为什么有效:</span>
                                <span class="field-value">${this.escapeHtml(topic.meta)}</span>
                            </div>
                        ` : ''}
                        ${topic.direction ? `
                            <div class="topic-field">
                                <span class="field-label">创作方向:</span>
                                <div class="field-value direction-list">${topic.direction}</div>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}

                <div class="topic-action">
                    <button class="btn btn-primary btn-sm topic-next-btn" data-index="${index}" onclick="event.stopPropagation();">
                        下一步：生成内容 →
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 根据评分返回样式类名
     */
    getScoreClass(score) {
        if (!score) return 'low';
        const s = score.toLowerCase();
        if (s.includes('高') || s.includes('high')) return 'high';
        if (s.includes('中') || s.includes('medium')) return 'medium';
        return 'low';
    }

    /**
     * 根据评分返回火焰图标（高=3火，中=2火，低=1火）
     */
    getScoreFireIcons(score) {
        const fireIcon = '<span class="material-icons-outlined fire-icon">local_fire_department</span>';
        if (!score) return fireIcon;
        const s = score.toLowerCase();
        if (s.includes('高') || s.includes('high')) {
            return fireIcon + fireIcon + fireIcon;
        }
        if (s.includes('中') || s.includes('medium')) {
            return fireIcon + fireIcon;
        }
        return fireIcon;
    }

    /**
     * 根据评分返回提示文字
     */
    getScoreTitle(score) {
        if (!score) return '潜力: 低';
        const s = score.toLowerCase();
        if (s.includes('高') || s.includes('high')) return '潜力: 高';
        if (s.includes('中') || s.includes('medium')) return '潜力: 中';
        return '潜力: 低';
    }

    renderCategoriesFromJSON(categories) {
        if (!categories || typeof categories !== 'object') return '';

        const categoryList = Object.entries(categories).map(([title, items]) => ({
            title,
            items: Array.isArray(items) ? items : [items]
        }));

        return `
            <div class="categories-grid">
                ${categoryList.map(cat => `
                    <div class="category-card">
                        <div class="category-title">${this.escapeHtml(cat.title)}</div>
                        <div class="category-items">
                            ${cat.items.map(item => `<span class="category-tag">${this.escapeHtml(item)}</span>`).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy() {
        // 清理
    }
}

// 导出
window.TrendsPage = TrendsPage;

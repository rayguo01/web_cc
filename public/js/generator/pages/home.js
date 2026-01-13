/**
 * 首页 - 流程图 + 数据源选择
 */
class HomePage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;
    }

    render(container) {
        container.innerHTML = `
            <div class="home-page">
                <div class="page-title">
                    <span>🚀</span> 开始创作
                </div>

                <p class="home-desc">
                    选择一个热点数据源，开始你的内容创作之旅
                </p>

                <div class="source-selector">
                    <div class="source-card" data-source="x-trends">
                        <div class="source-icon">𝕏</div>
                        <div class="source-name">X(Twitter) 趋势</div>
                        <div class="source-desc">
                            获取 X 平台 24 小时热门话题趋势
                        </div>
                    </div>

                    <div class="source-card" data-source="tophub-trends">
                        <div class="source-icon">🔥</div>
                        <div class="source-name">TopHub 热榜</div>
                        <div class="source-desc">
                            聚合各大平台热门内容榜单
                        </div>
                    </div>

                    <div class="source-card" data-source="domain-trends">
                        <div class="source-icon">🎯</div>
                        <div class="source-name">X领域趋势</div>
                        <div class="source-desc">
                            追踪 Web3、AI 等特定领域的 X 热点
                        </div>
                    </div>
                </div>

                ${this.state.task ? this.renderActiveTask() : ''}
            </div>
        `;

        this.bindEvents(container);
    }

    renderActiveTask() {
        const task = this.state.task;
        const stepName = this.state.workflowSteps.find(s => s.id === task.current_step)?.name || task.current_step;

        return `
            <div class="active-task-card">
                <div class="active-task-header">
                    <span>📝 有未完成的任务</span>
                    <span class="active-task-step">当前: ${stepName}</span>
                </div>
                <div class="active-task-actions">
                    <button class="btn btn-primary" id="continue-task-btn">继续任务</button>
                    <button class="btn btn-danger" id="abandon-task-btn">放弃任务</button>
                </div>
            </div>
        `;
    }

    bindEvents(container) {
        // 数据源选择
        container.querySelectorAll('.source-card').forEach(card => {
            card.addEventListener('click', async () => {
                const source = card.dataset.source;

                // 如果有未完成的任务，提示确认
                if (this.state.task) {
                    const confirmed = await this.generator.showConfirm(
                        '已有进行中的任务，开始新任务将放弃当前进度。确定继续吗？'
                    );
                    if (!confirmed) return;

                    // 放弃当前任务
                    try {
                        await this.generator.api(`/api/tasks/${this.state.task.id}`, {
                            method: 'DELETE'
                        });
                    } catch (e) {
                        // 忽略错误
                    }
                }

                // 创建新任务
                try {
                    await this.generator.createTask(source);
                } catch (error) {
                    console.error('创建任务失败:', error);
                }
            });
        });

        // 继续任务按钮
        const continueBtn = container.querySelector('#continue-task-btn');
        if (continueBtn) {
            continueBtn.addEventListener('click', () => {
                this.generator.navigate(this.state.task.current_step);
            });
        }

        // 放弃任务按钮
        const abandonBtn = container.querySelector('#abandon-task-btn');
        if (abandonBtn) {
            abandonBtn.addEventListener('click', () => {
                this.generator.abandonTask();
            });
        }
    }

    destroy() {
        // 清理
    }
}

// 导出
window.HomePage = HomePage;

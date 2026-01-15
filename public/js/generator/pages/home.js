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
            <div class="space-y-8">
                <!-- 开始创作区块 -->
                <div class="mb-10">
                    <div class="flex items-center space-x-3 mb-4">
                        <span class="material-icons-outlined text-2xl text-orange-500">rocket_launch</span>
                        <h3 class="font-display text-3xl" style="color: #0f172a !important;">开始创作</h3>
                    </div>
                    <p class="text-lg font-light leading-relaxed" style="color: #64748b;">
                        选择一个热点数据源，开始你的内容创作之旅。AI 分析海量数据，助你产出高互动内容。
                    </p>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <!-- X 趋势卡片 -->
                    <div class="source-card group relative overflow-hidden rounded-2xl bg-white/80 p-6 border border-slate-200/60 hover:border-slate-400 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer" data-source="x-trends">
                        <div class="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-icons-outlined text-slate-400">arrow_forward</span>
                        </div>
                        <div class="mb-6 w-12 h-12 flex items-center justify-center rounded-xl bg-slate-100 text-2xl font-serif" style="color: #0f172a;">𝕏</div>
                        <h4 class="font-display text-xl mb-3" style="color: #0f172a !important;">X (Twitter) 趋势</h4>
                        <p class="text-sm leading-relaxed" style="color: #64748b;">
                            获取 X 平台 24 小时热门话题，分析病毒式传播模式，快速创作引爆帖子。
                        </p>
                    </div>

                    <!-- TopHub 热榜卡片 -->
                    <div class="source-card group relative overflow-hidden rounded-2xl bg-white/80 p-6 border border-slate-200/60 hover:border-orange-300 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer" data-source="tophub-trends">
                        <div class="absolute inset-0 bg-gradient-to-br from-orange-50/0 to-orange-100/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div class="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-icons-outlined text-orange-400">arrow_forward</span>
                        </div>
                        <div class="relative z-10 mb-6 w-12 h-12 flex items-center justify-center rounded-xl bg-orange-50 text-orange-500"><span class="material-icons-outlined text-2xl">local_fire_department</span></div>
                        <h4 class="relative z-10 font-display text-xl mb-3" style="color: #0f172a !important;">TopHub 热榜</h4>
                        <p class="relative z-10 text-sm leading-relaxed" style="color: #64748b;">
                            聚合各大平台热门内容榜单，跨平台灵感碰撞，捕捉下一个爆款话题。
                        </p>
                    </div>

                    <!-- 领域趋势卡片 -->
                    <div class="source-card group relative overflow-hidden rounded-2xl bg-white/80 p-6 border border-slate-200/60 hover:border-purple-300 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer" data-source="domain-trends">
                        <div class="absolute inset-0 bg-gradient-to-br from-purple-50/0 to-purple-100/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div class="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-icons-outlined text-purple-400">arrow_forward</span>
                        </div>
                        <div class="relative z-10 mb-6 w-12 h-12 flex items-center justify-center rounded-xl bg-purple-50 text-purple-500"><span class="material-icons-outlined text-2xl">track_changes</span></div>
                        <h4 class="relative z-10 font-display text-xl mb-3" style="color: #0f172a !important;">领域聚焦</h4>
                        <p class="relative z-10 text-sm leading-relaxed" style="color: #64748b;">
                            深入 Web3、AI、金融等垂直领域，为专业受众定制精准洞察。
                        </p>
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
            <div class="glass-panel bg-amber-50 rounded-2xl p-6 border border-amber-200 mt-6" style="max-width: calc(33.333% - 16px);">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center space-x-2">
                        <span class="material-icons-outlined text-amber-600">pending_actions</span>
                        <span class="text-amber-700 font-medium">有未完成的任务</span>
                    </div>
                    <span class="text-sm text-slate-500">当前: ${stepName}</span>
                </div>
                <div class="flex justify-center space-x-3">
                    <button class="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium rounded-xl hover:from-amber-600 hover:to-orange-700 transition-all duration-200" id="continue-task-btn">继续任务</button>
                    <button class="px-6 py-2.5 bg-white border border-slate-200 text-red-600 rounded-xl hover:bg-red-50 transition-all duration-200" id="abandon-task-btn">放弃</button>
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

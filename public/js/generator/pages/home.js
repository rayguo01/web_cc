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
            <div class="space-y-6 md:space-y-8">
                <!-- 开始创作区块 -->
                <div class="mb-6 md:mb-10">
                    <div class="flex items-center space-x-2 md:space-x-3 mb-3 md:mb-4">
                        <span class="material-icons-outlined text-xl md:text-2xl text-orange-500">rocket_launch</span>
                        <h3 class="font-display text-2xl md:text-3xl" style="color: #0f172a !important;">开始创作</h3>
                    </div>
                    <p class="text-base md:text-lg font-light leading-relaxed" style="color: #64748b;">
                        选择一个热点数据源，开始你的内容创作之旅
                    </p>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                    <!-- X 趋势卡片 -->
                    <div class="source-card group relative overflow-hidden rounded-xl md:rounded-2xl bg-white/80 p-4 md:p-6 border border-slate-200/60 hover:border-slate-400 transition-all duration-300 hover:shadow-xl md:hover:-translate-y-1 cursor-pointer active:scale-[0.98]" data-source="x-trends">
                        <div class="absolute top-0 right-0 p-2 md:p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-icons-outlined text-slate-400">arrow_forward</span>
                        </div>
                        <div class="flex items-center md:block">
                            <div class="mb-0 md:mb-6 mr-4 md:mr-0 w-10 h-10 md:w-12 md:h-12 flex-shrink-0 flex items-center justify-center rounded-lg md:rounded-xl bg-slate-100 text-xl md:text-2xl font-serif" style="color: #0f172a;">𝕏</div>
                            <div class="flex-1 min-w-0">
                                <h4 class="font-display text-lg md:text-xl mb-1 md:mb-3" style="color: #0f172a !important;">X (Twitter) 趋势</h4>
                                <p class="text-xs md:text-sm leading-relaxed line-clamp-2 md:line-clamp-none" style="color: #64748b;">
                                    获取 X 平台热门话题，快速创作引爆帖子
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- TopHub 热榜卡片 -->
                    <div class="source-card group relative overflow-hidden rounded-xl md:rounded-2xl bg-white/80 p-4 md:p-6 border border-slate-200/60 hover:border-orange-300 transition-all duration-300 hover:shadow-xl md:hover:-translate-y-1 cursor-pointer active:scale-[0.98]" data-source="tophub-trends">
                        <div class="absolute inset-0 bg-gradient-to-br from-orange-50/0 to-orange-100/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div class="absolute top-0 right-0 p-2 md:p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-icons-outlined text-orange-400">arrow_forward</span>
                        </div>
                        <div class="relative z-10 flex items-center md:block">
                            <div class="mb-0 md:mb-6 mr-4 md:mr-0 w-10 h-10 md:w-12 md:h-12 flex-shrink-0 flex items-center justify-center rounded-lg md:rounded-xl bg-orange-50 text-orange-500"><span class="material-icons-outlined text-xl md:text-2xl">local_fire_department</span></div>
                            <div class="flex-1 min-w-0">
                                <h4 class="font-display text-lg md:text-xl mb-1 md:mb-3" style="color: #0f172a !important;">TopHub 热榜</h4>
                                <p class="text-xs md:text-sm leading-relaxed line-clamp-2 md:line-clamp-none" style="color: #64748b;">
                                    聚合各大平台热门榜单，捕捉爆款话题
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- 领域趋势卡片 -->
                    <div class="source-card group relative overflow-hidden rounded-xl md:rounded-2xl bg-white/80 p-4 md:p-6 border border-slate-200/60 hover:border-purple-300 transition-all duration-300 hover:shadow-xl md:hover:-translate-y-1 cursor-pointer active:scale-[0.98]" data-source="domain-trends">
                        <div class="absolute inset-0 bg-gradient-to-br from-purple-50/0 to-purple-100/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div class="absolute top-0 right-0 p-2 md:p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-icons-outlined text-purple-400">arrow_forward</span>
                        </div>
                        <div class="relative z-10 flex items-center md:block">
                            <div class="mb-0 md:mb-6 mr-4 md:mr-0 w-10 h-10 md:w-12 md:h-12 flex-shrink-0 flex items-center justify-center rounded-lg md:rounded-xl bg-purple-50 text-purple-500"><span class="material-icons-outlined text-xl md:text-2xl">track_changes</span></div>
                            <div class="flex-1 min-w-0">
                                <h4 class="font-display text-lg md:text-xl mb-1 md:mb-3" style="color: #0f172a !important;">领域聚焦</h4>
                                <p class="text-xs md:text-sm leading-relaxed line-clamp-2 md:line-clamp-none" style="color: #64748b;">
                                    深入 Web3、AI 等垂直领域，定制精准洞察
                                </p>
                            </div>
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
            <div class="glass-panel bg-amber-50 rounded-xl md:rounded-2xl p-4 md:p-6 border border-amber-200 mt-4 md:mt-6 w-full md:max-w-md">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 md:mb-4 space-y-1 sm:space-y-0">
                    <div class="flex items-center space-x-2">
                        <span class="material-icons-outlined text-amber-600 text-xl">pending_actions</span>
                        <span class="text-amber-700 font-medium text-sm md:text-base">有未完成的任务</span>
                    </div>
                    <span class="text-xs md:text-sm text-slate-500">当前: ${stepName}</span>
                </div>
                <div class="flex flex-col sm:flex-row sm:justify-center space-y-2 sm:space-y-0 sm:space-x-3">
                    <button class="w-full sm:w-auto px-5 md:px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium rounded-xl hover:from-amber-600 hover:to-orange-700 transition-all duration-200 text-sm md:text-base" id="continue-task-btn">继续任务</button>
                    <button class="w-full sm:w-auto px-5 md:px-6 py-2.5 bg-white border border-slate-200 text-red-600 rounded-xl hover:bg-red-50 transition-all duration-200 text-sm md:text-base" id="abandon-task-btn">放弃</button>
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

    // 检查是否为移动端
    isMobile() {
        return window.innerWidth < 768;
    }

    destroy() {
        // 清理
    }
}

// 导出
window.HomePage = HomePage;

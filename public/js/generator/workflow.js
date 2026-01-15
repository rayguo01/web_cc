/**
 * 帖子生成器 - 流程图组件
 */
class WorkflowComponent {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.state = window.generatorState;

        // 订阅状态变化
        this.state.subscribe(() => this.update());
    }

    // 检查是否为移动端
    isMobile() {
        return window.innerWidth < 768;
    }

    // 渲染流程图
    render() {
        if (!this.container) return;
        const isMobile = this.isMobile();

        this.container.innerHTML = `
            <div class="relative flex items-center justify-between ${isMobile ? 'px-1' : ''}">
                <div class="absolute top-1/2 h-px bg-slate-200 -z-10 transform -translate-y-1/2" style="left: ${isMobile ? '16px' : '24px'}; right: ${isMobile ? '16px' : '24px'};"></div>
                ${this.state.workflowSteps.map((step, index) => this.renderStep(step, index, isMobile)).join('')}
            </div>
        `;

        // 绑定点击事件
        this.container.querySelectorAll('.workflow-step').forEach(el => {
            el.addEventListener('click', () => {
                const stepId = el.dataset.step;
                if (this.state.isStepAccessible(stepId)) {
                    window.postGenerator.navigate(stepId);
                }
            });
        });
    }

    // 渲染单个步骤
    renderStep(step, index, isMobile = false) {
        const status = this.state.getStepStatus(step.id);
        const isAccessible = this.state.isStepAccessible(step.id);
        const isCurrent = status === 'current';
        const isCompleted = status === 'completed';

        // 图标映射 - 按照 1.html 模板的 Material Icons
        const iconMap = {
            '🔥': 'local_fire_department',  // 热帖抓取
            '✍️': 'edit',                   // 生成内容
            '🚀': 'auto_fix_high',          // 优化内容
            '🖼️': 'image',                  // 生成图片
            '📤': 'send'                    // 提交发布
        };
        const materialIcon = iconMap[step.icon] || 'circle';

        // 响应式尺寸
        const nodeSize = isMobile ? 'w-8 h-8' : 'w-12 h-12';
        const iconSize = isMobile ? 'text-base' : 'text-xl';
        const ringSize = isMobile ? 'ring-2' : 'ring-4';
        const spacing = isMobile ? 'space-y-1' : 'space-y-3';
        const textSize = isMobile ? 'text-[10px]' : 'text-xs';

        // 按照 1.html 模板样式：
        // - 当前/完成节点: bg-slate-900 + ring-4 ring-white + text-white
        // - 未选中节点: bg-white + border border-slate-200 + text-slate-500

        return `
            <div class="workflow-step flex flex-col items-center ${spacing} ${isAccessible ? 'cursor-pointer' : 'cursor-default'} group ${!isCurrent && !isCompleted ? 'opacity-60 hover:opacity-100' : ''} transition-opacity" data-step="${step.id}">
                <div class="${nodeSize} rounded-full flex items-center justify-center shadow-lg transition-all ${
                    isCurrent || isCompleted
                        ? `${ringSize} ring-white`
                        : 'border border-slate-200 group-hover:border-slate-400'
                }" style="background: ${isCurrent || isCompleted ? '#0f172a' : '#ffffff'};">
                    <span class="material-icons-outlined ${iconSize}" style="color: ${
                        isCompleted
                            ? '#22c55e'  // 完成: 绿色勾
                            : (isCurrent ? '#ffffff' : '#64748b')  // 当前: 白色, 未选中: 灰色
                    };">${isCompleted ? 'check' : materialIcon}</span>
                </div>
                <span class="${textSize} tracking-wide ${isMobile ? 'max-w-[48px] text-center truncate' : ''}" style="color: ${isCurrent || isCompleted ? '#0f172a' : '#64748b'}; font-weight: ${isCurrent || isCompleted ? '600' : '400'};">${isMobile ? step.shortName || step.name : step.name}</span>
            </div>
        `;
    }

    // 获取步骤图标
    getStepIcon(step, status) {
        if (status === 'completed') return '✓';
        if (status === 'current') return step.icon;
        return step.icon;
    }

    // 更新流程图
    update() {
        this.render();
    }
}

// 导出
window.WorkflowComponent = WorkflowComponent;

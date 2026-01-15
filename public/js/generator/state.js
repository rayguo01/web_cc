/**
 * 帖子生成器 - 全局状态管理
 */
class GeneratorState {
    constructor() {
        this.task = null;
        this.currentPage = 'home';
        this.isLoading = false;
        this.error = null;
        this.listeners = [];

        // 工作流配置
        this.workflowSteps = [
            { id: 'trends', name: '热帖抓取', icon: '🔥', skippable: false },
            { id: 'content', name: '生成内容', icon: '✍️', skippable: false },
            { id: 'optimize', name: '优化内容', icon: '🚀', skippable: true },
            { id: 'image', name: '生成图片', icon: '🖼️', skippable: true },
            { id: 'submit', name: '提交发布', icon: '📤', skippable: false }
        ];
    }

    // 订阅状态变化
    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    // 通知所有监听器
    notify(changeType = 'update') {
        this.listeners.forEach(listener => {
            try {
                listener(this, changeType);
            } catch (e) {
                console.error('State listener error:', e);
            }
        });
    }

    // 设置任务
    setTask(task) {
        this.task = task;
        this.persist(); // 自动持久化
        this.notify('task');
    }

    // 更新任务数据
    updateTask(updates) {
        if (this.task) {
            this.task = { ...this.task, ...updates };
            this.persist(); // 自动持久化
            this.notify('task');
        }
    }

    // 设置当前页面
    setCurrentPage(page) {
        this.currentPage = page;
        this.notify('page');
    }

    // 设置加载状态
    setLoading(loading) {
        this.isLoading = loading;
        this.notify('loading');
    }

    // 设置错误
    setError(error) {
        this.error = error;
        this.notify('error');
    }

    // 清除错误
    clearError() {
        this.error = null;
        this.notify('error');
    }

    // 获取当前步骤索引
    getCurrentStepIndex() {
        if (!this.task) return -1;
        return this.workflowSteps.findIndex(s => s.id === this.task.current_step);
    }

    // 检查步骤是否有数据
    stepHasData(stepId) {
        if (!this.task) return false;

        switch (stepId) {
            case 'trends':
                return !!(this.task.trends_data?.selectedTopic);
            case 'content':
                return !!(this.task.content_data?.versionC);
            case 'optimize':
                return !!(this.task.optimize_data?.optimizedVersion);
            case 'image':
                // image 步骤完成条件：生成了图片 或 明确跳过了图片步骤
                return !!(this.task.image_data?.imagePath || this.task.image_data?.skipped);
            case 'submit':
                return this.task.status === 'completed';
            default:
                return false;
        }
    }

    // 获取步骤状态 - 基于数据存在性判断已完成状态
    getStepStatus(stepId) {
        // 没有任务时，第一个步骤显示为当前状态
        if (!this.task) return stepId === 'trends' ? 'current' : 'pending';

        const currentIndex = this.getCurrentStepIndex();
        const stepIndex = this.workflowSteps.findIndex(s => s.id === stepId);

        // 当前步骤
        if (stepIndex === currentIndex) return 'current';

        // 检查步骤是否有数据
        if (this.stepHasData(stepId)) return 'completed';

        // 在当前步骤之前但没有数据
        if (stepIndex < currentIndex) return 'accessible';

        return 'pending';
    }

    // 检查步骤是否可访问 - 有数据的步骤都可访问
    isStepAccessible(stepId) {
        if (!this.task) return stepId === 'trends';

        const currentIndex = this.getCurrentStepIndex();
        const stepIndex = this.workflowSteps.findIndex(s => s.id === stepId);

        // 当前步骤及之前的步骤都可访问
        if (stepIndex <= currentIndex) return true;

        // 有数据的步骤也可访问
        return this.stepHasData(stepId);
    }

    // 持久化到 localStorage
    persist() {
        if (this.task) {
            localStorage.setItem('post_generator_task', JSON.stringify({
                task: this.task,
                savedAt: Date.now()
            }));
        }
    }

    // 从 localStorage 恢复
    restore() {
        try {
            const saved = localStorage.getItem('post_generator_task');
            if (!saved) return null;

            const data = JSON.parse(saved);
            // 检查是否过期（24小时）
            if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
                this.clearPersisted();
                return null;
            }
            return data.task;
        } catch (e) {
            console.error('Restore state failed:', e);
            return null;
        }
    }

    // 清除持久化数据
    clearPersisted() {
        localStorage.removeItem('post_generator_task');
    }

    // 重置状态
    reset() {
        this.task = null;
        this.currentPage = 'home';
        this.isLoading = false;
        this.error = null;
        this.clearPersisted();
        this.notify('reset');
    }
}

// 导出单例
window.generatorState = new GeneratorState();

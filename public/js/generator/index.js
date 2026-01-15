/**
 * 帖子生成器 - 入口和路由管理
 */
class PostGenerator {
    constructor() {
        this.token = localStorage.getItem('token');
        this.state = window.generatorState;
        this.pages = {};
        this.currentPageInstance = null;

        // 绑定路由变化
        window.addEventListener('hashchange', () => this.handleRoute());
    }

    // 初始化
    async init() {
        if (!this.token) {
            return; // 未登录，不初始化
        }

        // 注册页面
        this.registerPages();

        // 订阅状态变化
        this.state.subscribe((state, changeType) => {
            if (changeType === 'task' || changeType === 'page') {
                this.updateWorkflow();
            }
        });

        // 检查是否有未完成的任务
        await this.checkActiveTask();

        // 处理当前路由
        this.handleRoute();
    }

    // 注册所有页面
    registerPages() {
        this.pages = {
            'home': window.HomePage,
            'trends': window.TrendsPage,
            'content': window.ContentPage,
            'optimize': window.OptimizePage,
            'image': window.ImagePage,
            'submit': window.SubmitPage,
            'history': window.HistoryPage,
            'voice-mimicker': window.VoiceMimickerPage
        };
    }

    // 检查是否有未完成的任务
    async checkActiveTask() {
        try {
            const response = await fetch('/api/tasks/current', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!response.ok) throw new Error('获取任务失败');

            const data = await response.json();

            if (data.hasActiveTask) {
                this.state.setTask(data.task);
                // 自动跳转到当前步骤
                this.navigate(data.task.current_step);
                this.showToast('已恢复未完成的任务', 'info');
                return true;
            }
        } catch (error) {
            console.error('从服务器检查任务失败:', error);

            // 尝试从本地存储恢复
            const localTask = this.state.restore();
            if (localTask && localTask.status !== 'completed' && localTask.status !== 'abandoned') {
                // 尝试从服务器验证任务是否仍然有效
                try {
                    const verifyResponse = await fetch(`/api/tasks/${localTask.id}`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });

                    if (verifyResponse.ok) {
                        const serverTask = await verifyResponse.json();
                        if (serverTask.status === 'in_progress' || serverTask.status === 'pending') {
                            this.state.setTask(serverTask);
                            this.navigate(serverTask.current_step);
                            this.showToast('已从本地恢复任务', 'info');
                            return true;
                        }
                    }
                } catch (verifyError) {
                    console.error('验证本地任务失败:', verifyError);
                }

                // 如果验证失败，清除本地存储
                this.state.clearPersisted();
            }
        }
        return false;
    }

    // 处理路由变化
    handleRoute() {
        const hash = window.location.hash || '#/';
        const path = hash.replace('#/', '') || 'home';

        // 解析路由参数
        const [pageName, ...params] = path.split('/');

        // 验证页面访问权限
        if (!this.canAccessPage(pageName)) {
            this.navigate('home');
            return;
        }

        this.state.setCurrentPage(pageName);
        this.renderPage(pageName, params);
    }

    // 检查页面访问权限
    canAccessPage(pageName) {
        // 首页、历史页面和工具页面始终可访问
        if (['home', 'history', 'voice-mimicker'].includes(pageName)) return true;

        // 其他页面需要有活跃任务
        if (!this.state.task) return false;

        // 检查步骤是否可访问
        return this.state.isStepAccessible(pageName);
    }

    // 渲染页面
    renderPage(pageName, params = []) {
        const container = document.getElementById('generator-content');
        if (!container) return;

        // 清理当前页面
        if (this.currentPageInstance && this.currentPageInstance.destroy) {
            this.currentPageInstance.destroy();
        }

        // 获取页面类
        const PageClass = this.pages[pageName];
        if (!PageClass) {
            container.innerHTML = '<div class="error-page">页面不存在</div>';
            return;
        }

        // 工具页面（如语气模仿器）隐藏标题和流程图，并激活工具导航
        const isToolPage = ['voice-mimicker'].includes(pageName);
        const header = document.getElementById('generator-header');
        const workflow = document.getElementById('workflow-container');
        const generatorContent = document.getElementById('generator-content');

        if (header) header.style.display = isToolPage ? 'none' : '';
        if (workflow) workflow.style.display = isToolPage ? 'none' : '';

        // 工具页面移除 generator-content 的边框和背景，并让容器占满宽度
        const generatorContainer = document.querySelector('.generator-container');
        if (generatorContent) {
            if (isToolPage) {
                generatorContent.classList.add('tool-page-mode');
                if (generatorContainer) generatorContainer.classList.add('tool-page-mode');
            } else {
                generatorContent.classList.remove('tool-page-mode');
                if (generatorContainer) generatorContainer.classList.remove('tool-page-mode');
            }
        }

        // 工具页面激活工具导航
        if (isToolPage && window.app) {
            window.app.currentNav = 'tools';
            document.querySelectorAll('.sidebar-item[data-nav]').forEach(item => {
                item.classList.toggle('active', item.dataset.nav === 'tools');
            });
            document.querySelectorAll('.bottom-nav-item[data-nav]').forEach(item => {
                item.classList.toggle('active', item.dataset.nav === 'tools');
            });
        }

        // 创建页面实例
        this.currentPageInstance = new PageClass(this, params);
        this.currentPageInstance.render(container);

        // 更新工作流显示
        this.updateWorkflow();
    }

    // 更新工作流显示
    updateWorkflow() {
        if (window.workflowComponent) {
            window.workflowComponent.update();
        }
    }

    // 导航到指定页面
    navigate(page, params = '') {
        const path = params ? `${page}/${params}` : page;
        window.location.hash = `#/${path}`;
    }

    // API 请求封装
    async api(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await fetch(url, { ...defaultOptions, ...options });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: '请求失败' }));
            throw new Error(error.error || '请求失败');
        }

        return response.json();
    }

    // SSE 请求封装
    async apiSSE(url, options = {}, handlers = {}) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            ...options
        });

        if (!response.ok) {
            throw new Error('请求失败');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        const handler = handlers[data.type];
                        if (handler) handler(data);
                    } catch (e) {
                        console.error('Parse SSE data failed:', e);
                    }
                }
            }
        }
    }

    // 创建新任务
    async createTask(source) {
        try {
            this.state.setLoading(true);
            const task = await this.api('/api/tasks', {
                method: 'POST',
                body: JSON.stringify({ source })
            });
            this.state.setTask(task);
            this.navigate('trends');
            return task;
        } catch (error) {
            this.showToast(error.message, 'error');
            throw error;
        } finally {
            this.state.setLoading(false);
        }
    }

    // 更新任务
    async updateTask(action, data = {}) {
        if (!this.state.task) return;

        try {
            this.state.setLoading(true);
            const updated = await this.api(`/api/tasks/${this.state.task.id}`, {
                method: 'PUT',
                body: JSON.stringify({ action, data, step: data?.step })
            });
            this.state.setTask(updated);
            return updated;
        } catch (error) {
            this.showToast(error.message, 'error');
            throw error;
        } finally {
            this.state.setLoading(false);
        }
    }

    // 执行步骤
    async executeStep(step, input, handlers) {
        if (!this.state.task) return;

        return this.apiSSE(
            `/api/tasks/${this.state.task.id}/execute-step`,
            { body: JSON.stringify({ step, input }) },
            handlers
        );
    }

    // 放弃任务
    async abandonTask() {
        if (!this.state.task) return;

        const confirmed = await this.showConfirm('确定要放弃当前任务吗？所有进度将丢失。');
        if (!confirmed) return;

        try {
            await this.api(`/api/tasks/${this.state.task.id}`, {
                method: 'DELETE'
            });
            this.state.reset();
            this.navigate('home');
            this.showToast('任务已放弃', 'info');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    // 显示提示
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // 显示确认对话框
    showConfirm(message) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'confirm-overlay';
            overlay.innerHTML = `
                <div class="confirm-dialog">
                    <p>${message}</p>
                    <div class="confirm-actions">
                        <button class="btn btn-secondary" data-action="cancel">取消</button>
                        <button class="btn btn-primary" data-action="confirm">确定</button>
                    </div>
                </div>
            `;

            overlay.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                if (action) {
                    overlay.remove();
                    resolve(action === 'confirm');
                }
            });

            document.body.appendChild(overlay);
        });
    }

    // ========== Twitter API ==========

    // 获取 Twitter 连接状态
    async getTwitterStatus() {
        try {
            return await this.api('/api/twitter/status');
        } catch (error) {
            console.error('获取 Twitter 状态失败:', error);
            return { connected: false };
        }
    }

    // 获取 Twitter 授权链接
    async getTwitterAuthUrl() {
        try {
            const data = await this.api('/api/twitter/auth');
            return data.authUrl;
        } catch (error) {
            this.showToast('获取授权链接失败: ' + error.message, 'error');
            throw error;
        }
    }

    // 断开 Twitter 连接
    async disconnectTwitter() {
        try {
            await this.api('/api/twitter/disconnect', { method: 'DELETE' });
            this.showToast('已断开 Twitter 连接', 'success');
            return true;
        } catch (error) {
            this.showToast('断开连接失败: ' + error.message, 'error');
            return false;
        }
    }

    // 上传媒体到 Twitter
    async uploadMedia(imagePath) {
        try {
            const result = await this.api('/api/twitter/upload', {
                method: 'POST',
                body: JSON.stringify({ imagePath })
            });
            return result.mediaId;
        } catch (error) {
            console.error('媒体上传失败:', error);
            throw error;
        }
    }

    // 发布推文
    async postTweet(text, mediaIds = []) {
        try {
            const body = { text };
            if (mediaIds.length > 0) {
                body.mediaIds = mediaIds;
            }
            const result = await this.api('/api/twitter/tweet', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            return result;
        } catch (error) {
            throw error;
        }
    }

    // Markdown 格式化
    formatMarkdown(text) {
        if (!text) return '';

        let html = text
            // 代码块
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
            // 行内代码
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // 标题
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // 粗体
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // 斜体
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // 列表
            .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
            // 数字列表
            .replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')
            // 表格
            .replace(/\|(.+)\|/g, (match, content) => {
                const cells = content.split('|').map(c => c.trim());
                const cellsHtml = cells.map(c => `<td>${c}</td>`).join('');
                return `<tr>${cellsHtml}</tr>`;
            })
            // 换行
            .replace(/\n/g, '<br>');

        // 包装列表
        html = html.replace(/(<li>.*<\/li>)+/g, '<ul>$&</ul>');
        // 包装表格
        html = html.replace(/(<tr>.*<\/tr>)+/g, '<table>$&</table>');

        return html;
    }
}

// 导出全局实例
window.postGenerator = new PostGenerator();

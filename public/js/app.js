/**
 * X 帖子生成器 - 主应用
 */
class App {
    constructor() {
        this.token = localStorage.getItem('token');
        this.username = localStorage.getItem('username');
        this.currentNav = 'writing'; // 当前导航页
        this.init();
    }

    init() {
        this.initTheme();
        this.bindAuthEvents();
        this.bindThemeEvents();
        this.bindNavEvents();

        // 检查 URL 参数（处理 Twitter 登录回调）
        this.handleUrlParams();

        if (this.token) {
            this.showGeneratorPage();
            this.initGenerator();
        } else {
            this.showAuthPage();
        }
    }

    // 处理 URL 参数（Twitter 登录回调）
    handleUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);

        // Twitter 登录成功
        if (urlParams.get('twitter_login') === 'success') {
            const token = urlParams.get('token');
            const username = urlParams.get('username');

            if (token && username) {
                this.token = token;
                this.username = username;
                localStorage.setItem('token', token);
                localStorage.setItem('username', username);

                // 清除 URL 参数
                window.history.replaceState({}, document.title, '/');

                this.showToast(`欢迎, @${username}!`, 'success');
            }
        }

        // Twitter 错误
        if (urlParams.get('twitter_error')) {
            const error = urlParams.get('twitter_error');
            this.showToast(`Twitter 登录失败: ${error}`, 'error');
            // 清除 URL 参数
            window.history.replaceState({}, document.title, '/');
        }

        // Twitter 连接成功（绑定模式）
        if (urlParams.get('twitter_connected') === 'true') {
            const username = urlParams.get('twitter_username');
            this.showToast(`已连接 @${username}`, 'success');
            window.history.replaceState({}, document.title, '/');
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

    // 主题相关方法 - Cinematic Enterprise Luxury (统一深色主题)
    initTheme() {
        // 统一使用深色主题
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    setTheme(theme) {
        // 统一使用深色主题
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    toggleTheme() {
        // 深色主题不支持切换
        return 'dark';
    }

    getThemeLabel() {
        return '深邃夜色';
    }

    bindThemeEvents() {
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }
    }

    bindAuthEvents() {
        // Tab 切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // 登录表单
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        // 注册表单
        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register();
        });

        // 退出按钮（侧边栏）
        const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
        if (sidebarLogoutBtn) {
            sidebarLogoutBtn.addEventListener('click', () => this.logout());
        }

        // 历史按钮
        const historyBtn = document.getElementById('history-btn');
        if (historyBtn) {
            historyBtn.addEventListener('click', () => {
                window.location.hash = '#/history';
            });
        }

        // Twitter 登录按钮
        const twitterLoginBtn = document.getElementById('twitter-login-btn');
        if (twitterLoginBtn) {
            twitterLoginBtn.addEventListener('click', () => this.twitterLogin());
        }
    }

    // Twitter 登录
    async twitterLogin() {
        const btn = document.getElementById('twitter-login-btn');
        if (btn.disabled) return;

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 正在跳转...';

        try {
            const res = await fetch('/api/twitter/login');
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || '获取授权链接失败');
            }

            // 跳转到 Twitter 授权页面
            window.location.href = data.authUrl;
        } catch (err) {
            this.showToast(err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = '<svg class="x-logo" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> 使用 X 登录';
        }
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tab;
            btn.classList.toggle('bg-white', isActive);
            btn.classList.toggle('shadow-sm', isActive);
            btn.classList.toggle('text-slate-900', isActive);
            btn.classList.toggle('text-slate-500', !isActive);
        });
        document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
        document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    }

    showAuthPage() {
        document.getElementById('auth-page').classList.remove('hidden');
        const mainApp = document.getElementById('main-app');
        if (mainApp) mainApp.classList.add('hidden');
        // 恢复 body overflow
        document.body.style.overflow = 'hidden';
    }

    showGeneratorPage() {
        document.getElementById('auth-page').classList.add('hidden');
        const mainApp = document.getElementById('main-app');
        if (mainApp) mainApp.classList.remove('hidden');
        // 允许页面滚动
        document.body.style.overflow = 'auto';
        // 渲染工具和个人页面
        this.renderToolsPage();
        this.renderProfilePage();
    }

    initGenerator() {
        // 初始化工作流组件
        window.workflowComponent = new WorkflowComponent('workflow-container');
        window.workflowComponent.render();

        // 确保 postGenerator 使用最新的 token
        if (window.postGenerator) {
            window.postGenerator.token = this.token;
        }

        // 初始化生成器
        window.postGenerator.init();
    }

    async login() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');
        const submitBtn = document.querySelector('#login-form button[type="submit"]');

        if (submitBtn.disabled) return;
        submitBtn.disabled = true;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!res.ok) {
                errorEl.textContent = data.error;
                return;
            }

            this.token = data.token;
            this.username = data.username;
            localStorage.setItem('token', data.token);
            localStorage.setItem('username', data.username);

            // 更新 postGenerator 的 token
            if (window.postGenerator) {
                window.postGenerator.token = data.token;
            }

            this.showGeneratorPage();
            this.initGenerator();
        } catch (err) {
            errorEl.textContent = '登录失败，请重试';
        } finally {
            submitBtn.disabled = false;
        }
    }

    async register() {
        const invitationCode = document.getElementById('register-invitation-code').value;
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const errorEl = document.getElementById('register-error');
        const submitBtn = document.querySelector('#register-form button[type="submit"]');

        if (submitBtn.disabled) return;
        submitBtn.disabled = true;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, invitationCode })
            });

            const data = await res.json();

            if (!res.ok) {
                errorEl.textContent = data.error;
                return;
            }

            this.token = data.token;
            this.username = data.username;
            localStorage.setItem('token', data.token);
            localStorage.setItem('username', data.username);

            // 更新 postGenerator 的 token
            if (window.postGenerator) {
                window.postGenerator.token = data.token;
            }

            this.showGeneratorPage();
            this.initGenerator();
        } catch (err) {
            errorEl.textContent = '注册失败，请重试';
        } finally {
            submitBtn.disabled = false;
        }
    }

    logout() {
        this.token = null;
        this.username = null;
        localStorage.removeItem('token');
        localStorage.removeItem('username');

        // 重置生成器状态
        if (window.generatorState) {
            window.generatorState.reset();
        }

        // 清除 hash
        window.location.hash = '';

        this.showAuthPage();
    }

    // 导航事件绑定
    bindNavEvents() {
        // 侧边栏导航
        document.querySelectorAll('.sidebar-item[data-nav]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(item.dataset.nav);
            });
        });

        // 底部导航
        document.querySelectorAll('.bottom-nav-item[data-nav]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(item.dataset.nav);
            });
        });
    }

    // 导航切换
    navigateTo(page) {
        if (this.currentNav === page) return;
        this.currentNav = page;

        // 更新侧边栏激活状态 - 使用内联样式确保覆盖
        document.querySelectorAll('.sidebar-item[data-nav]').forEach(item => {
            const isActive = item.dataset.nav === page;
            // 设置背景和文字颜色
            item.style.background = isActive ? 'rgba(15, 23, 42, 0.05)' : 'transparent';
            item.style.color = isActive ? '#0f172a' : '#64748b';
            item.style.fontWeight = isActive ? '500' : '400';
            item.style.boxShadow = isActive ? '0 1px 2px 0 rgb(0 0 0 / 0.05)' : 'none';
            // 更新图标颜色
            const icon = item.querySelector('.material-icons-outlined');
            if (icon) {
                icon.style.color = isActive ? '#ea580c' : '#94a3b8';
            }
        });

        // 更新底部导航激活状态
        document.querySelectorAll('.bottom-nav-item[data-nav]').forEach(item => {
            const isActive = item.dataset.nav === page;
            item.style.color = isActive ? '#0f172a' : '#64748b';
            // 更新图标颜色
            const icon = item.querySelector('.material-icons-outlined');
            if (icon) {
                icon.style.color = isActive ? '#ea580c' : '#64748b';
            }
            // 更新文字样式
            const label = item.querySelector('.text-xs');
            if (label) {
                label.style.fontWeight = isActive ? '500' : '400';
            }
        });

        // 切换页面
        document.querySelectorAll('.nav-page').forEach(p => {
            p.classList.add('hidden');
            p.classList.remove('active');
        });

        const targetPage = document.getElementById(`${page}-page`);
        if (targetPage) {
            targetPage.classList.remove('hidden');
            targetPage.classList.add('active');
        }

        // 切换到写作页面时，恢复显示标题和流程图，并跳转到首页
        if (page === 'writing') {
            const header = document.querySelector('.generator-header');
            const workflow = document.getElementById('workflow-container');
            if (header) header.style.display = '';
            if (workflow) workflow.style.display = '';
            // 如果当前在工具页面（如写作风格模仿器），跳转到首页
            const currentHash = window.location.hash;
            if (currentHash.includes('voice-mimicker')) {
                window.location.hash = '#/home';
            }
        }
    }

    // 渲染工具页面
    renderToolsPage() {
        const container = document.getElementById('tools-content');
        if (!container) return;

        container.innerHTML = `
            <div class="tool-card group relative overflow-hidden rounded-xl md:rounded-2xl bg-white/80 p-4 md:p-6 border border-slate-200/60 hover:border-purple-300 transition-all duration-300 hover:shadow-xl md:hover:-translate-y-1 cursor-pointer active:scale-[0.98]" data-tool="voice-mimicker">
                <div class="absolute inset-0 bg-gradient-to-br from-purple-50/0 to-purple-100/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="absolute top-0 right-0 p-2 md:p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="material-icons-outlined text-purple-400">arrow_forward</span>
                </div>
                <div class="flex items-center md:block">
                    <div class="relative z-10 mb-0 md:mb-4 mr-3 md:mr-0 w-10 h-10 md:w-12 md:h-12 flex-shrink-0 flex items-center justify-center rounded-lg md:rounded-xl bg-purple-50 text-purple-500"><span class="material-icons-outlined text-xl md:text-2xl">theater_comedy</span></div>
                    <div class="flex-1 min-w-0 relative z-10">
                        <h4 class="font-display text-lg md:text-xl text-slate-900 mb-1 md:mb-3">写作风格模仿器</h4>
                        <p class="text-xs md:text-sm text-slate-500 leading-relaxed line-clamp-2 md:line-clamp-none">分析推主写作风格，生成模仿 Prompt</p>
                    </div>
                </div>
            </div>
        `;

        // 绑定工具卡片点击事件
        container.querySelectorAll('.tool-card').forEach(card => {
            card.addEventListener('click', () => {
                const tool = card.dataset.tool;
                if (tool === 'voice-mimicker') {
                    // 先激活 writing 页面（因为 generator-content 在其中）
                    // 但不更新导航状态（导航状态由 renderPage 处理）
                    document.querySelectorAll('.nav-page').forEach(p => {
                        p.classList.add('hidden');
                        p.classList.remove('active');
                    });
                    const writingPage = document.getElementById('writing-page');
                    writingPage.classList.remove('hidden');
                    writingPage.classList.add('active');
                    // 跳转到写作风格模仿器
                    window.location.hash = '#/voice-mimicker';
                }
            });
        });
    }

    // 渲染个人页面
    renderProfilePage() {
        const container = document.getElementById('profile-content');
        if (!container) return;

        const username = this.username || '用户';
        const initial = username.charAt(0).toUpperCase();

        container.innerHTML = `
            <div class="space-y-4 md:space-y-6">
                <!-- 用户信息卡片 -->
                <div class="flex items-center space-x-3 md:space-x-4 p-4 md:p-6 glass-panel bg-white/60 rounded-xl md:rounded-2xl">
                    <div class="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center text-white text-xl md:text-2xl font-display shadow-lg shadow-orange-500/20 flex-shrink-0">${initial}</div>
                    <div class="min-w-0">
                        <h3 class="font-display text-lg md:text-xl text-slate-900 truncate">${username}</h3>
                        <p class="text-slate-500 text-xs md:text-sm font-light">X 爆款帖生成器用户</p>
                    </div>
                </div>

                <!-- Token 使用统计卡片 -->
                <div class="glass-panel bg-white/60 rounded-xl md:rounded-2xl overflow-hidden">
                    <div class="flex items-center justify-between p-3 md:p-4 border-b border-slate-100">
                        <div class="flex items-center space-x-2">
                            <span class="material-icons-outlined text-amber-500 text-xl md:text-2xl">analytics</span>
                            <h4 class="font-display text-base md:text-lg text-slate-900">使用统计</h4>
                        </div>
                        <select id="stats-period-select" class="text-xs md:text-sm border border-slate-200 rounded-lg px-2 md:px-3 py-1 md:py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500">
                            <option value="day">今日</option>
                            <option value="week">本周</option>
                            <option value="month" selected>本月</option>
                        </select>
                    </div>
                    <div id="stats-content" class="p-3 md:p-4">
                        <div class="flex items-center justify-center py-6 md:py-8">
                            <div class="animate-spin rounded-full h-6 w-6 border-2 border-amber-500 border-t-transparent"></div>
                        </div>
                    </div>
                </div>

                <!-- 设置菜单 -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between p-3 md:p-4 glass-panel bg-white/60 rounded-xl">
                        <div class="flex items-center space-x-2 md:space-x-3">
                            <span class="material-icons-outlined text-slate-500 text-xl">palette</span>
                            <span class="text-slate-900 text-sm md:text-base">主题风格</span>
                        </div>
                        <span class="text-slate-500 text-xs md:text-sm">${this.getThemeLabel()}</span>
                    </div>
                    <button class="w-full flex items-center space-x-2 md:space-x-3 p-3 md:p-4 glass-panel bg-white/60 rounded-xl text-red-600 hover:bg-red-50 transition-all duration-200 active:scale-[0.98]" id="profile-logout-btn">
                        <span class="material-icons-outlined text-xl">logout</span>
                        <span class="text-sm md:text-base">退出登录</span>
                    </button>
                </div>
            </div>
        `;

        // 绑定事件
        document.getElementById('profile-logout-btn')?.addEventListener('click', () => {
            this.logout();
        });

        // 绑定统计周期切换
        document.getElementById('stats-period-select')?.addEventListener('change', (e) => {
            this.loadUserStats(e.target.value);
        });

        // 加载统计数据
        this.loadUserStats('month');
    }

    // 加载用户统计数据
    async loadUserStats(period = 'month') {
        const container = document.getElementById('stats-content');
        if (!container) return;

        // 显示加载状态
        container.innerHTML = `
            <div class="flex items-center justify-center py-8">
                <div class="animate-spin rounded-full h-6 w-6 border-2 border-amber-500 border-t-transparent"></div>
            </div>
        `;

        try {
            const res = await fetch(`/api/stats/my?period=${period}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!res.ok) {
                throw new Error('获取统计数据失败');
            }

            const stats = await res.json();
            this.renderUserStats(stats);
        } catch (err) {
            container.innerHTML = `
                <div class="text-center py-8 text-slate-500">
                    <span class="material-icons-outlined text-3xl mb-2">error_outline</span>
                    <p class="text-sm">${err.message}</p>
                </div>
            `;
        }
    }

    // 渲染用户统计数据
    renderUserStats(stats) {
        const container = document.getElementById('stats-content');
        if (!container) return;

        const { summary, byWorkflowStep, bySkill } = stats;

        // 格式化数字
        const formatTokens = (num) => {
            const n = num || 0;
            if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return n.toString();
        };

        const formatCost = (cost) => {
            return '$' + parseFloat(cost || 0).toFixed(4);
        };

        container.innerHTML = `
            <!-- 总览统计 -->
            <div class="grid grid-cols-2 gap-2 md:gap-3 mb-3 md:mb-4">
                <div class="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg md:rounded-xl p-3 md:p-4 text-center">
                    <p class="text-xl md:text-2xl font-display text-amber-600">${formatTokens((summary.totalInputTokens || 0) + (summary.totalOutputTokens || 0))}</p>
                    <p class="text-[10px] md:text-xs text-slate-500 mt-0.5 md:mt-1">总 Tokens</p>
                </div>
                <div class="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-lg md:rounded-xl p-3 md:p-4 text-center">
                    <p class="text-xl md:text-2xl font-display text-emerald-600">${formatCost(summary.totalCost)}</p>
                    <p class="text-[10px] md:text-xs text-slate-500 mt-0.5 md:mt-1">总花费</p>
                </div>
                <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg md:rounded-xl p-3 md:p-4 text-center">
                    <p class="text-xl md:text-2xl font-display text-blue-600">${summary.totalCalls || 0}</p>
                    <p class="text-[10px] md:text-xs text-slate-500 mt-0.5 md:mt-1">调用次数</p>
                </div>
                <div class="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg md:rounded-xl p-3 md:p-4 text-center">
                    <p class="text-xl md:text-2xl font-display text-purple-600">${summary.taskCount || 0}</p>
                    <p class="text-[10px] md:text-xs text-slate-500 mt-0.5 md:mt-1">任务数</p>
                </div>
            </div>

            <!-- 按步骤统计 -->
            ${byWorkflowStep && byWorkflowStep.length > 0 ? `
            <div class="mb-3 md:mb-4">
                <h5 class="text-xs md:text-sm font-medium text-slate-700 mb-2 flex items-center">
                    <span class="material-icons-outlined text-sm md:text-base mr-1">account_tree</span>
                    按工作流步骤
                </h5>
                <div class="space-y-1.5 md:space-y-2">
                    ${byWorkflowStep.map(step => `
                        <div class="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                            <span class="text-xs md:text-sm text-slate-600">${this.getStepLabel(step.workflow_step)}</span>
                            <div class="text-right flex items-center space-x-1 md:space-x-2">
                                <span class="text-xs md:text-sm font-medium text-slate-900">${formatCost(step.cost_usd)}</span>
                                <span class="text-[10px] md:text-xs text-slate-400">${formatTokens(step.total_tokens)}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <!-- 按 Skill 统计 -->
            ${bySkill && bySkill.length > 0 ? `
            <div>
                <h5 class="text-xs md:text-sm font-medium text-slate-700 mb-2 flex items-center">
                    <span class="material-icons-outlined text-sm md:text-base mr-1">extension</span>
                    按 Skill
                </h5>
                <div class="space-y-1.5 md:space-y-2">
                    ${bySkill.slice(0, 5).map(skill => `
                        <div class="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                            <span class="text-xs md:text-sm text-slate-600 truncate max-w-[100px] md:max-w-[120px]" title="${skill.skill_id}">${this.getSkillLabel(skill.skill_id)}</span>
                            <div class="text-right flex items-center space-x-1 md:space-x-2">
                                <span class="text-xs md:text-sm font-medium text-slate-900">${formatCost(skill.cost)}</span>
                                <span class="text-[10px] md:text-xs text-slate-400">${skill.calls}次</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            ${(!byWorkflowStep || byWorkflowStep.length === 0) && (!bySkill || bySkill.length === 0) ? `
            <div class="text-center py-4 text-slate-400">
                <span class="material-icons-outlined text-xl md:text-2xl mb-1">insert_chart_outlined</span>
                <p class="text-xs md:text-sm">暂无使用记录</p>
            </div>
            ` : ''}
        `;
    }

    // 获取步骤标签
    getStepLabel(step) {
        const labels = {
            'trends': '热点获取',
            'content': '内容生成',
            'optimize': '爆款优化',
            'image': '图片生成'
        };
        return labels[step] || step;
    }

    // 获取 Skill 标签
    getSkillLabel(skillId) {
        if (!skillId) return '未知';
        // 提取最后一个 / 后的部分
        const parts = skillId.split('/');
        const name = parts[parts.length - 1];
        // 移除 .ts 后缀
        return name.replace(/\.ts$/, '');
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});

// 防止 iOS Safari 双击缩放
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - (window.lastTouchEnd || 0) < 300) {
        e.preventDefault();
    }
    window.lastTouchEnd = now;
}, { passive: false });

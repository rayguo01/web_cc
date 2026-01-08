class App {
    constructor() {
        this.token = localStorage.getItem('token');
        this.username = localStorage.getItem('username');
        this.currentSessionId = null;
        this.ws = null;
        this.sessions = [];
        this.isMobile = window.innerWidth <= 768;
        this.sidebarOpen = false;

        this.init();
    }

    init() {
        this.bindEvents();
        this.handleResize();

        if (this.token) {
            this.showChatPage();
            this.connectWebSocket();
            this.loadSessions();
        } else {
            this.showAuthPage();
        }
    }

    bindEvents() {
        // 认证页面事件
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register();
        });

        // 聊天页面事件
        document.getElementById('new-chat-btn').addEventListener('click', () => {
            this.newChat();
            this.closeSidebar();
        });

        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());

        // 移动端事件
        const menuBtn = document.getElementById('menu-btn');
        const mobileNewChatBtn = document.getElementById('mobile-new-chat-btn');
        const sidebarOverlay = document.getElementById('sidebar-overlay');

        if (menuBtn) {
            menuBtn.addEventListener('click', () => this.toggleSidebar());
        }

        if (mobileNewChatBtn) {
            mobileNewChatBtn.addEventListener('click', () => this.newChat());
        }

        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', () => this.closeSidebar());
        }

        // 输入框事件
        const input = document.getElementById('message-input');
        input.addEventListener('keydown', (e) => {
            // 桌面端：Enter 发送，Shift+Enter 换行
            // 移动端：始终换行，使用发送按钮发送
            if (e.key === 'Enter' && !e.shiftKey && !this.isMobile) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // 自动调整输入框高度
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            const maxHeight = this.isMobile ? 120 : 200;
            input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
        });

        // 监听窗口大小变化
        window.addEventListener('resize', () => this.handleResize());

        // 监听键盘弹出（移动端）
        if ('visualViewport' in window) {
            window.visualViewport.addEventListener('resize', () => {
                this.handleViewportResize();
            });
        }

        // 触摸滑动手势（打开侧边栏）
        this.setupSwipeGesture();
    }

    setupSwipeGesture() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let isSwiping = false;

        const chatPage = document.getElementById('chat-page');
        if (!chatPage) return;

        chatPage.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isSwiping = touchStartX < 30; // 从左边缘开始
        }, { passive: true });

        chatPage.addEventListener('touchmove', (e) => {
            if (!isSwiping) return;
            touchEndX = e.touches[0].clientX;
            const touchEndY = e.touches[0].clientY;

            // 检查是否为水平滑动
            const deltaX = touchEndX - touchStartX;
            const deltaY = Math.abs(touchEndY - touchStartY);

            if (deltaX > 50 && deltaY < 50 && !this.sidebarOpen) {
                this.openSidebar();
                isSwiping = false;
            }
        }, { passive: true });

        // 侧边栏内的滑动关闭
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
            }, { passive: true });

            sidebar.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].clientX;
                const deltaX = touchStartX - touchEndX;
                if (deltaX > 50 && this.sidebarOpen) {
                    this.closeSidebar();
                }
            }, { passive: true });
        }
    }

    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;

        // 从移动端切换到桌面端时，关闭侧边栏状态
        if (wasMobile && !this.isMobile) {
            this.closeSidebar();
        }
    }

    handleViewportResize() {
        // 键盘弹出时调整布局
        if (this.isMobile) {
            const inputArea = document.querySelector('.input-area');
            if (inputArea) {
                // 使用 visual viewport 来适配键盘
                const viewport = window.visualViewport;
                if (viewport) {
                    const offsetBottom = window.innerHeight - viewport.height - viewport.offsetTop;
                    inputArea.style.paddingBottom = `calc(12px + ${offsetBottom}px + env(safe-area-inset-bottom, 0px))`;
                }
            }
        }
    }

    toggleSidebar() {
        if (this.sidebarOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }

    openSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const menuBtn = document.getElementById('menu-btn');

        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
        if (menuBtn) menuBtn.classList.add('active');

        this.sidebarOpen = true;
        document.body.style.overflow = 'hidden';
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const menuBtn = document.getElementById('menu-btn');

        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        if (menuBtn) menuBtn.classList.remove('active');

        this.sidebarOpen = false;
        document.body.style.overflow = '';
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
        document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    }

    showAuthPage() {
        document.getElementById('auth-page').classList.remove('hidden');
        document.getElementById('chat-page').classList.add('hidden');
    }

    showChatPage() {
        document.getElementById('auth-page').classList.add('hidden');
        document.getElementById('chat-page').classList.remove('hidden');
        document.getElementById('current-user').textContent = this.username;
    }

    async login() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');
        const submitBtn = document.querySelector('#login-form button[type="submit"]');

        // 防止重复提交
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

            this.showChatPage();
            this.connectWebSocket();
            this.loadSessions();
        } catch (err) {
            errorEl.textContent = '登录失败，请重试';
        } finally {
            submitBtn.disabled = false;
        }
    }

    async register() {
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const errorEl = document.getElementById('register-error');
        const submitBtn = document.querySelector('#register-form button[type="submit"]');

        // 防止重复提交
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;

        try {
            const res = await fetch('/api/auth/register', {
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

            this.showChatPage();
            this.connectWebSocket();
            this.loadSessions();
        } catch (err) {
            errorEl.textContent = '注册失败，请重试';
        } finally {
            submitBtn.disabled = false;
        }
    }

    logout() {
        this.token = null;
        this.username = null;
        this.currentSessionId = null;
        localStorage.removeItem('token');
        localStorage.removeItem('username');

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.closeSidebar();
        this.showAuthPage();
        document.getElementById('messages').innerHTML = '';
        document.getElementById('session-list').innerHTML = '';
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}?token=${this.token}`);

        this.ws.onopen = () => {
            console.log('WebSocket 已连接');
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };

        this.ws.onclose = () => {
            console.log('WebSocket 断开');
            // 尝试重连
            setTimeout(() => {
                if (this.token) {
                    this.connectWebSocket();
                }
            }, 3000);
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket 错误:', err);
        };
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'session_created':
                this.currentSessionId = data.sessionId;
                this.loadSessions();
                break;

            case 'start':
                this.addMessage('assistant', '', true);
                break;

            case 'stream':
                this.appendToLastMessage(data.content);
                break;

            case 'done':
                this.finishStreaming();
                document.getElementById('send-btn').disabled = false;
                break;

            case 'error':
                this.finishStreaming();
                this.addMessage('assistant', '错误: ' + data.message);
                document.getElementById('send-btn').disabled = false;
                break;
        }
    }

    async loadSessions() {
        try {
            const res = await fetch('/api/sessions', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!res.ok) {
                if (res.status === 401) {
                    this.logout();
                }
                return;
            }

            this.sessions = await res.json();
            this.renderSessions();
        } catch (err) {
            console.error('加载会话失败:', err);
        }
    }

    renderSessions() {
        const list = document.getElementById('session-list');
        list.innerHTML = '';

        this.sessions.forEach(session => {
            const item = document.createElement('div');
            item.className = 'session-item' + (session.id === this.currentSessionId ? ' active' : '');
            item.innerHTML = `
                <span class="session-title">${this.escapeHtml(session.title)}</span>
                <button class="session-delete" data-id="${session.id}" aria-label="删除会话">×</button>
            `;

            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('session-delete')) {
                    this.selectSession(session.id);
                    // 移动端选择会话后关闭侧边栏
                    if (this.isMobile) {
                        this.closeSidebar();
                    }
                }
            });

            item.querySelector('.session-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSession(session.id);
            });

            list.appendChild(item);
        });
    }

    async selectSession(sessionId) {
        this.currentSessionId = sessionId;
        this.renderSessions();

        try {
            const res = await fetch(`/api/sessions/${sessionId}/messages`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!res.ok) return;

            const messages = await res.json();
            const container = document.getElementById('messages');
            container.innerHTML = '';

            messages.forEach(msg => {
                this.addMessage(msg.role, msg.content);
            });
        } catch (err) {
            console.error('加载消息失败:', err);
        }
    }

    async deleteSession(sessionId) {
        if (!confirm('确定删除这个对话？')) return;

        try {
            const res = await fetch(`/api/sessions/${sessionId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (res.ok) {
                if (this.currentSessionId === sessionId) {
                    this.currentSessionId = null;
                    document.getElementById('messages').innerHTML = '';
                }
                this.loadSessions();
            }
        } catch (err) {
            console.error('删除会话失败:', err);
        }
    }

    newChat() {
        this.currentSessionId = null;
        document.getElementById('messages').innerHTML = '';
        this.renderSessions();

        // 聚焦输入框
        const input = document.getElementById('message-input');
        if (input && !this.isMobile) {
            input.focus();
        }
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (!content || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // 显示用户消息
        this.addMessage('user', content);

        // 发送到服务器
        this.ws.send(JSON.stringify({
            type: 'message',
            sessionId: this.currentSessionId,
            content: content
        }));

        // 清空输入框
        input.value = '';
        input.style.height = 'auto';

        // 禁用发送按钮
        document.getElementById('send-btn').disabled = true;

        // 移动端收起键盘
        if (this.isMobile) {
            input.blur();
        }
    }

    addMessage(role, content, streaming = false) {
        const container = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = `message ${role}` + (streaming ? ' streaming' : '');
        div.innerHTML = this.formatContent(content);
        container.appendChild(div);

        // 平滑滚动到底部
        requestAnimationFrame(() => {
            container.scrollTo({
                top: container.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    appendToLastMessage(content) {
        const messages = document.querySelectorAll('.message.assistant');
        const last = messages[messages.length - 1];
        if (last) {
            const currentText = last.dataset.rawContent || '';
            const newText = currentText + content;
            last.dataset.rawContent = newText;
            last.innerHTML = this.formatContent(newText);

            const container = document.getElementById('messages');
            // 使用 requestAnimationFrame 优化滚动性能
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        }
    }

    finishStreaming() {
        document.querySelectorAll('.message.streaming').forEach(el => {
            el.classList.remove('streaming');
        });
    }

    formatContent(content) {
        // 简单的代码块处理
        return this.escapeHtml(content)
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

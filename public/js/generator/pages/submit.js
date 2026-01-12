/**
 * 提交页面 - 最终预览和发布到 X
 */
class SubmitPage {
    constructor(generator, params) {
        this.generator = generator;
        this.state = window.generatorState;
        this.twitterStatus = { connected: false };
        this.isPublishing = false;
    }

    async render(container) {
        const task = this.state.task;
        const finalContent = task?.optimize_data?.optimizedVersion || task?.content_data?.versionC || '';
        const imagePath = task?.image_data?.imagePath;
        const topic = task?.trends_data?.selectedTopic;

        // 先渲染基础结构
        container.innerHTML = `
            <div class="submit-page">
                <div class="page-title">
                    <span>📤</span> 提交到 X
                </div>

                <div class="submit-info">
                    <div class="submit-info-item">
                        <strong>话题来源：</strong>
                        ${task?.trends_data?.source === 'x-trends' ? 'X(Twitter) 趋势' : 'TopHub 热榜'}
                    </div>
                    <div class="submit-info-item">
                        <strong>选题：</strong>
                        ${topic?.title || topic?.topic || '未知'}
                    </div>
                    ${task?.optimize_data?.viralScore ? `
                        <div class="submit-info-item">
                            <strong>爆款评分：</strong>
                            <span style="color: #10b981; font-weight: bold;">${task.optimize_data.viralScore}/100</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Twitter 连接状态 -->
                <div class="twitter-section" id="twitter-section">
                    <div class="twitter-status loading">
                        <span class="twitter-icon">𝕏</span>
                        <span>正在检查连接状态...</span>
                    </div>
                </div>

                <div class="final-preview">
                    <div class="final-content" id="final-content">${this.escapeHtml(finalContent)}</div>
                    <div class="char-count">${finalContent.length} 字符</div>

                    ${imagePath ? `
                        <div class="final-image">
                            <img src="${imagePath}" alt="配图" />
                        </div>
                    ` : ''}
                </div>

                <div class="submit-actions" style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-secondary" id="copy-btn">
                        📋 复制内容
                    </button>
                    ${imagePath ? `
                        <button class="btn btn-secondary" id="download-btn" style="margin-left: 12px;">
                            ⬇️ 下载图片
                        </button>
                    ` : ''}
                </div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            ← 返回编辑
                        </button>
                        <button class="btn btn-danger" id="abandon-btn">
                            放弃任务
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-primary" id="complete-btn">
                            ✅ 完成并保存到历史
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);

        // 异步加载 Twitter 状态
        await this.loadTwitterStatus();
    }

    async loadTwitterStatus() {
        const section = document.getElementById('twitter-section');
        if (!section) return;

        try {
            this.twitterStatus = await this.generator.getTwitterStatus();
            this.renderTwitterSection(section);
        } catch (error) {
            console.error('加载 Twitter 状态失败:', error);
            section.innerHTML = `
                <div class="twitter-status error">
                    <span class="twitter-icon">𝕏</span>
                    <span>无法获取连接状态</span>
                </div>
            `;
        }
    }

    renderTwitterSection(section) {
        const task = this.state.task;
        const finalContent = task?.optimize_data?.optimizedVersion || task?.content_data?.versionC || '';

        if (this.twitterStatus.connected) {
            section.innerHTML = `
                <div class="twitter-status connected">
                    <span class="twitter-icon">𝕏</span>
                    <span class="status-text">
                        已连接 <strong>@${this.twitterStatus.username}</strong>
                    </span>
                    <button class="btn btn-sm btn-secondary" id="disconnect-twitter-btn">
                        断开连接
                    </button>
                </div>
                <div class="twitter-publish">
                    <button class="btn btn-twitter" id="publish-twitter-btn">
                        <span class="twitter-icon">𝕏</span> 发布到 X
                    </button>
                </div>
            `;

            // 绑定 Twitter 按钮事件
            section.querySelector('#disconnect-twitter-btn')?.addEventListener('click', () => this.handleDisconnect());
            section.querySelector('#publish-twitter-btn')?.addEventListener('click', () => this.handlePublish());
        } else {
            section.innerHTML = `
                <div class="twitter-status disconnected">
                    <span class="twitter-icon">𝕏</span>
                    <span class="status-text">未连接 Twitter 账号</span>
                    <button class="btn btn-twitter" id="connect-twitter-btn">
                        连接 Twitter
                    </button>
                </div>
                <div class="twitter-hint">
                    连接后可直接将内容发布到 X 平台
                </div>
            `;

            section.querySelector('#connect-twitter-btn')?.addEventListener('click', () => this.handleConnect());
        }
    }

    async handleConnect() {
        try {
            const authUrl = await this.generator.getTwitterAuthUrl();
            // 在新窗口打开授权页面
            window.open(authUrl, '_blank', 'width=600,height=700');
            this.generator.showToast('请在新窗口完成 Twitter 授权', 'info');

            // 轮询检查连接状态
            this.pollTwitterStatus();
        } catch (error) {
            console.error('获取授权链接失败:', error);
        }
    }

    async pollTwitterStatus() {
        let attempts = 0;
        const maxAttempts = 60; // 最多等待 2 分钟

        const poll = async () => {
            attempts++;
            const status = await this.generator.getTwitterStatus();

            if (status.connected) {
                this.twitterStatus = status;
                this.renderTwitterSection(document.getElementById('twitter-section'));
                this.generator.showToast(`已连接 @${status.username}`, 'success');
                return;
            }

            if (attempts < maxAttempts) {
                setTimeout(poll, 2000);
            }
        };

        setTimeout(poll, 3000);
    }

    async handleDisconnect() {
        const confirmed = await this.generator.showConfirm('确定要断开 Twitter 连接吗？');
        if (!confirmed) return;

        const success = await this.generator.disconnectTwitter();
        if (success) {
            this.twitterStatus = { connected: false };
            this.renderTwitterSection(document.getElementById('twitter-section'));
        }
    }

    async handlePublish() {
        if (this.isPublishing) return;

        const task = this.state.task;
        const finalContent = task?.optimize_data?.optimizedVersion || task?.content_data?.versionC || '';

        const confirmed = await this.generator.showConfirm(
            `确定要发布到 X 吗？\n\n内容预览：\n${finalContent.substring(0, 100)}${finalContent.length > 100 ? '...' : ''}`
        );
        if (!confirmed) return;

        this.isPublishing = true;
        const btn = document.getElementById('publish-twitter-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 发布中...';
        }

        try {
            const result = await this.generator.postTweet(finalContent);
            this.generator.showToast('发布成功！', 'success');

            // 显示成功状态
            const section = document.getElementById('twitter-section');
            if (section) {
                const publishDiv = section.querySelector('.twitter-publish');
                if (publishDiv) {
                    publishDiv.innerHTML = `
                        <div class="twitter-success">
                            ✅ 已成功发布到 X
                            <a href="https://twitter.com/i/web/status/${result.tweetId}" target="_blank" class="view-tweet-link">
                                查看推文 →
                            </a>
                        </div>
                    `;
                }
            }
        } catch (error) {
            this.generator.showToast('发布失败: ' + error.message, 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="twitter-icon">𝕏</span> 发布到 X';
            }
        } finally {
            this.isPublishing = false;
        }
    }

    bindEvents(container) {
        // 返回按钮
        container.querySelector('#back-btn').addEventListener('click', async () => {
            const task = this.state.task;
            const prevStep = task?.image_data?.skipped ? 'optimize' : 'image';
            try {
                await this.generator.updateTask('goBack', { toStep: prevStep });
                this.generator.navigate(prevStep);
            } catch (error) {
                console.error('回退失败:', error);
            }
        });

        // 放弃任务
        container.querySelector('#abandon-btn').addEventListener('click', () => {
            this.generator.abandonTask();
        });

        // 复制内容
        container.querySelector('#copy-btn').addEventListener('click', () => {
            const content = document.getElementById('final-content').textContent;
            navigator.clipboard.writeText(content).then(() => {
                this.generator.showToast('内容已复制到剪贴板', 'success');
            }).catch(() => {
                this.generator.showToast('复制失败', 'error');
            });
        });

        // 下载图片
        const downloadBtn = container.querySelector('#download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const task = this.state.task;
                const imagePath = task?.image_data?.imagePath;
                if (imagePath) {
                    const link = document.createElement('a');
                    link.href = imagePath;
                    link.download = `x-post-${Date.now()}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            });
        }

        // 完成任务
        container.querySelector('#complete-btn').addEventListener('click', async () => {
            try {
                await this.generator.updateTask('complete');
                this.generator.showToast('帖子已保存到历史记录', 'success');
                this.state.reset();
                this.generator.navigate('home');
            } catch (error) {
                this.generator.showToast(`保存失败: ${error.message}`, 'error');
            }
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy() {
        // 清理
    }
}

// 导出
window.SubmitPage = SubmitPage;

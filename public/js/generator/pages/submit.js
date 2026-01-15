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
                <div class="page-header">
                    <div class="page-title">
                        <span class="material-icons-outlined" style="color: #f97316;">publish</span> 提交到 X
                    </div>
                    <p class="page-subtitle">确认内容和图片后，发布到 X 平台；你可以复制内容和图片自己手动发布，也可以连接推特账号自动一键发布</p>
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

                <div class="final-preview">
                    <div class="final-content" id="final-content">${this.escapeHtml(finalContent)}</div>
                    <div class="char-count">${finalContent.length} 字符</div>

                    ${imagePath ? `
                        <div class="final-image">
                            <img src="${imagePath}" alt="配图" />
                        </div>
                    ` : ''}
                </div>

                <div class="submit-actions">
                    <button class="btn btn-primary" id="copy-btn">
                        <span class="material-icons-outlined">content_copy</span> 复制内容
                    </button>
                    ${imagePath ? `
                        <button class="btn btn-primary" id="download-btn">
                            <span class="material-icons-outlined">download</span> 下载图片
                        </button>
                    ` : ''}
                    <button class="btn btn-twitter" id="twitter-btn" disabled>
                        <span class="twitter-icon">𝕏</span> <span class="btn-text">检查连接中...</span>
                    </button>
                </div>

                <!-- Twitter 连接状态提示 -->
                <div class="twitter-status-bar" id="twitter-status-bar">
                    <span class="status-loading">正在检查 Twitter 连接状态...</span>
                </div>

                <!-- 发布成功提示 -->
                <div class="twitter-success-bar" id="twitter-success-bar"></div>

                <div class="page-actions">
                    <div class="action-left">
                        <button class="btn btn-secondary" id="back-btn">
                            <span class="material-icons-outlined">arrow_back</span> <span class="btn-text-full">返回编辑</span>
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-primary" id="home-btn">
                            <span class="material-icons-outlined">home</span> <span class="btn-text-full">返回首页</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents(container);

        // 异步加载 Twitter 状态
        await this.loadTwitterStatus();

        // 自动保存到历史（进入提交页即完成流程）
        await this.autoSaveToHistory();
    }

    /**
     * 自动保存到历史记录
     * 进入提交页面即视为流程完成，自动保存
     */
    async autoSaveToHistory() {
        try {
            await this.generator.updateTask('complete');
            console.log('内容已自动保存到历史记录');
        } catch (error) {
            console.error('自动保存失败:', error);
        }
    }

    async loadTwitterStatus() {
        const statusBar = document.getElementById('twitter-status-bar');
        const twitterBtn = document.getElementById('twitter-btn');

        try {
            this.twitterStatus = await this.generator.getTwitterStatus();
            this.updateTwitterUI();
        } catch (error) {
            console.error('加载 Twitter 状态失败:', error);
            if (statusBar) {
                statusBar.innerHTML = `<span class="status-error">无法获取 Twitter 连接状态</span>`;
            }
            if (twitterBtn) {
                twitterBtn.disabled = false;
                twitterBtn.querySelector('.btn-text').textContent = '连接并发布到 X';
            }
        }
    }

    updateTwitterUI() {
        const statusBar = document.getElementById('twitter-status-bar');
        const twitterBtn = document.getElementById('twitter-btn');

        if (!statusBar || !twitterBtn) return;

        if (this.twitterStatus.connected) {
            statusBar.innerHTML = `
                <span class="status-connected">
                    <span class="twitter-icon" style="font-size: 14px;">𝕏</span>
                    已连接 <strong>@${this.twitterStatus.username}</strong>
                    <button class="btn btn-link btn-sm" id="disconnect-twitter-btn" style="margin-left: 8px; padding: 2px 8px;">
                        断开
                    </button>
                </span>
            `;
            twitterBtn.disabled = false;
            twitterBtn.querySelector('.btn-text').textContent = '发布到 X';

            // 绑定断开连接按钮
            statusBar.querySelector('#disconnect-twitter-btn')?.addEventListener('click', () => this.handleDisconnect());
        } else {
            statusBar.innerHTML = `
                <span class="status-disconnected">
                    <span class="twitter-icon" style="font-size: 14px;">𝕏</span>
                    未连接 Twitter 账号，点击按钮连接后发布
                </span>
            `;
            twitterBtn.disabled = false;
            twitterBtn.querySelector('.btn-text').textContent = '连接并发布到 X';
        }
    }

    async handleTwitterBtn() {
        if (this.isPublishing) return;

        if (this.twitterStatus.connected) {
            // 已连接，直接发布
            await this.handlePublish();
        } else {
            // 未连接，先连接
            await this.handleConnect();
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
            this.generator.showToast('获取授权链接失败: ' + error.message, 'error');
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
                this.updateTwitterUI();
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
            this.updateTwitterUI();
        }
    }

    async handlePublish() {
        if (this.isPublishing) return;

        const task = this.state.task;
        const finalContent = task?.optimize_data?.optimizedVersion || task?.content_data?.versionC || '';
        const imagePath = task?.image_data?.imagePath;

        const hasImage = imagePath && !task?.image_data?.skipped;
        const confirmMsg = hasImage
            ? `确定要发布到 X 吗？（含配图）\n\n内容预览：\n${finalContent.substring(0, 100)}${finalContent.length > 100 ? '...' : ''}`
            : `确定要发布到 X 吗？\n\n内容预览：\n${finalContent.substring(0, 100)}${finalContent.length > 100 ? '...' : ''}`;

        const confirmed = await this.generator.showConfirm(confirmMsg);
        if (!confirmed) return;

        this.isPublishing = true;
        const btn = document.getElementById('twitter-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 发布中...';
        }

        try {
            let mediaIds = [];

            // 如果有图片，先上传
            if (hasImage) {
                if (btn) {
                    btn.innerHTML = '<span class="spinner"></span> 上传图片...';
                }
                const mediaId = await this.generator.uploadMedia(imagePath);
                if (mediaId) {
                    mediaIds.push(mediaId);
                }
            }

            // 发布推文
            if (btn) {
                btn.innerHTML = '<span class="spinner"></span> 发布中...';
            }
            const result = await this.generator.postTweet(finalContent, mediaIds);
            this.generator.showToast('发布成功！', 'success');

            // 显示成功状态
            const successBar = document.getElementById('twitter-success-bar');
            if (successBar) {
                successBar.style.display = 'block';
                successBar.innerHTML = `
                    <span class="twitter-success">
                        <span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle; color: #10b981;">check_circle</span>
                        已成功发布到 X
                        <a href="https://twitter.com/i/web/status/${result.tweetId}" target="_blank" class="view-tweet-link" style="margin-left: 8px;">
                            查看推文 →
                        </a>
                    </span>
                `;
            }

            // 更新按钮状态
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="material-icons-outlined" style="font-size: 18px; vertical-align: middle;">check</span> 已发布';
                btn.classList.remove('btn-twitter');
                btn.classList.add('btn-success');
            }
        } catch (error) {
            this.generator.showToast('发布失败: ' + error.message, 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="twitter-icon">𝕏</span> <span class="btn-text">发布到 X</span>';
            }
        } finally {
            this.isPublishing = false;
        }
    }

    bindEvents(container) {
        // 返回按钮（回退到前一步继续编辑）
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

        // Twitter 按钮（连接并发布 或 发布）
        container.querySelector('#twitter-btn').addEventListener('click', () => this.handleTwitterBtn());

        // 返回首页（任务已自动保存，直接返回）
        container.querySelector('#home-btn').addEventListener('click', () => {
            this.state.reset();
            this.generator.navigate('home');
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

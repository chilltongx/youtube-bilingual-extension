# 静态 Blog 发布适配器（默认关闭）

确认人物、文字校对、拆分与 HTML 预览可独立使用。发布助手是面向以下静态结构的示例：

- `blog/index.html` 和 `blog/{linux,stoic,chill}/index.html` 含 `<ul class="post-list">`；空列表用 `.empty-state`。
- 文章在 `blog/posts/<slug>/index.html`，同时维护 RSS、sitemap。
- 本地源项目使用 `content/posts/*.md`、`templates/posts/*.html` 与 `public/assets/`。

**没有连接任何作者服务器，默认不执行 SSH。** 若要接入自己的网站：

1. 先审阅 `native/blog_host.py`、`native/blog_remote.py`，备份自己的网站。
2. 把 `blog-publication.js`、`native/blog_remote.py` 中的 `https://example.com`、`/srv/www/example.com`、`/srv/backups/podcast-blog` 改成自己的值；检查健康校验中的域名也一致。
3. 在忽略的 `native/config.local.json` 设置 `site_root`、`ssh_target`、`ssh_identity`、`node`/`ssh` 路径；确认 SSH 主机密钥。**不要关闭 StrictHostKeyChecking。**
4. 最后显式设置 `publish_enabled: true`，重新注册本机助手。
5. 使用页面“检查发布连接”，先在自己的测试站点验证，再接入生产。

模板会对预览快照做哈希校验、读取并合并现有列表、备份目标文件、原子写入、逐 URL 验证内容哈希；失败时只回滚本次写入。算法有隔离测试，但并不意味着适配任意站点。不同博客结构请编写自己的发布适配器。

不要把 SSH 私钥、本地配置、真实音频或未确认的文字稿提交到 GitHub。

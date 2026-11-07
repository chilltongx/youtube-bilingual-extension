# ChillTong · YouTube Bilingual

A Chrome extension for English/Chinese YouTube subtitles, local review transcripts, speaker identification and reviewed HTML exports.

一个自带 API 的 YouTube 双语字幕插件：边看英文视频，边积累可复习、可校对的文字稿。

## 功能

- 保留英文字幕，在上方显示中文；优先预译未来约 45 秒，按视频时间同步。
- 播放器底栏「译」与 CC 联动，「稿」打开复习页。
- 中文字幕自动跟随英文字号；背景透明，字幕区域较亮时自动添加细字影。
- 自动积累中英文和时间戳，支持人物标注、筛选、逐段校对、多人发言拆分。
- 可选本地音频说话人分组，之后由用户确认真实姓名。
- 人物确认后生成黑金 HTML 预览；提供默认关闭的个人静态 Blog 发布适配器。

## 快速开始

1. 下载或克隆此仓库。
2. Chrome 打开 `chrome://extensions`，开启开发者模式，选择「加载已解压的扩展程序」，选中仓库根目录。
3. 点插件图标 → 设置，填写 **Responses API Base URL、模型名称和自己的 API Key**，允许访问该 API 站点，再点「测试翻译」。
4. 刷新 YouTube，开启英语 CC（人工或自动字幕）。点「译」也可以控制字幕开关。

前端是原生 JavaScript，**无需 npm install、构建或后端服务**即可使用翻译和文字稿功能。要求 Chrome 114+。没有英文字幕的视频暂不支持音频实时转录。

接口必须兼容 `POST /v1/responses`，支持 `stream: true`、`store: false` 和文本输出事件。**Chat Completions-only 接口不支持**。仓库不提供免费 API 服务或预置密钥。默认不发送 reasoning/service_tier 参数；如服务商支持，可在 `core.js` 的 DEFAULTS 中启用 `reasoningEffort` 与 `priority`。

## 文字稿与本地处理

点击「稿」查看累计片段。记录包含提前翻译的内容，不能等同于已完整观看或完整转录。使用「授权文字稿目录」选择你自己的保存文件夹，导出 Markdown/JSON。

自动区分人物需要**原始音频文件**，不会自动下载 YouTube 音频，也不会从面孔或声音推断真实姓名。识别结果是匿名分组，音乐、重叠发言和相似声音可能导致错误；人工标注会保留。

本地音频识别与本机文件导出助手是可选项，见 [本地助手安装](docs/NATIVE.md)。只需要字幕翻译时，不必安装 Python、FFmpeg 或模型。

## Blog 流水线

「确认人物与发布 Blog」提供代表片段、试听/时间链接、姓名确认、文本校对、HTML 预览。未确认的片段不能进入发布快照。当前仓库的远程发布适配器**默认禁用**，它是特定静态站点结构的示例，不是适用于所有博客的一键部署器；见 [发布适配说明](docs/PUBLISHING.md)。

## 隐私与权限

- API Key 只存于 `chrome.storage.local`，访问限制为受信任扩展上下文，不向 YouTube 内容脚本返回，也不使用 Chrome 账号同步。它不是加密保险库。
- 英文字幕会发给你在设置中指定的 API 服务；供应商的收费和数据策略由你选择。
- 文字稿保存在当前浏览器扩展的 IndexedDB；卸载或清理扩展数据可能删除未导出的记录。
- 本地说话人识别不上传音频，浏览器分块发送给本机 Python 进程。模型和依赖首次安装需要联网。
- 自动字影仅在本机读取缩小的视频帧；不上传或保存截图，不申请屏幕录制权限。无法读取视频像素时保持无阴影。
- 默认站点权限只有 YouTube；其他 HTTPS API 站点在保存设置时逐个申请。

## 测试

Node.js 22+、Python 3.9+：

```sh
npm test
python3 tests/blog_publish_test.py
```

可选浏览器回归测试（模拟 API，不使用真实 Key）：

```sh
python3 -m venv .venv-test
.venv-test/bin/pip install playwright
.venv-test/bin/playwright install chromium
CHROME_PATH=/absolute/path/to/chromium .venv-test/bin/python tests/browser_test.py
.venv-test/bin/python tests/contrast_test.py
```

测试覆盖字幕缓存、快进、CC 联动、明暗字影、人物标注持久化、HTML 转义、发布快照失效、保留旧文章和发布回滚。浏览器测试的发布调用是模拟的，不会写入任何生产网站。

## 限制

首次翻译和跳到未缓存位置仍有 API 延迟；预译不是零延迟保证。YouTube DOM/字幕接口变化、DRM 或跨域视频限制会影响字幕获取和亮度采样。自动说话人分组不是身份认证；同一字幕包含多位说话人时需要人工拆分。处理/发布内容前请确认你有相应权利。

## 开源与贡献

MIT License，欢迎 Issue / PR。请勿提交 API Key、真实文字稿、音频、浏览器配置或本地发布配置。

这是从自用版本整理出的独立开源发行版。自用部署环境与个人网站凭据未包含在仓库中。

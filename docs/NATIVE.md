# 可选本地助手

核心翻译和浏览器目录导出不需要本机助手。自动注册脚本支持 macOS、Linux；Windows 尚未提供注册程序。

1. 安装 Python 3.9+、FFmpeg（确保 `ffmpeg` 在 PATH，或在配置中填写绝对路径）。
2. 在 `chrome://extensions` 复制当前加载的扩展 ID。
3. 运行 `python3 native/setup_diarization.py` 安装固定版本运行库并下载模型。这会下载数百 MB 依赖/权重，可能需要几分钟。
4. 运行 `python3 native/install.py YOUR_EXTENSION_ID` 注册助手。
5. 如需调整路径，参照 `native/config.local.example.json` 编辑 `native/config.local.json`（此文件被 Git 忽略）。

在「稿」中选择与视频对应的原始音频，自动估计人数或指定人数，再点击识别。最多 160 MB、2 小时。裁掉开头的音频需填写起始时间偏移；中间删改或变速的音频无法通过单一偏移对齐。

语音分组用 sherpa-onnx + pyannote segmentation + WeSpeaker VoxCeleb，输出匿名编号，需人工校对。模型权重不包含在仓库，下载时校验 SHA-256。

“同时生成逐字稿”为可选的 AI剪口播适配器：需自行取得兼容模块，在配置中设置 `aijian_module`。模块须提供 `transcribe(audio, model_name, language, device, compute_type, progress_callback=None)`（支持 16 kHz mono float32 数组）、`words_from_segments`、`add_gaps`。仓库不附带该外部 skill 的代码或凭据；未配置时保留纯声音分组即可。

模型与依赖各自有独立许可证，见 [THIRD_PARTY.md](../THIRD_PARTY.md)。如果重新克隆目录导致扩展 ID 变化，重新运行注册命令；请勿在不同扩展之间共享同一个 ID。

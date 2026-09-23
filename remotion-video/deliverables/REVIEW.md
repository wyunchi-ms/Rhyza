# Rhyza 宣传视频 · Review 交接

分支：`codex/rhyza-promo-review`。

## 已完成

- 06:20 Remotion 视频工程，11 个章节、26 个实机镜头槽位。
- 叙事重点为“线性聊天难以承接发散思考”，串联 Explain / Ask、List / Node View、标记筛选、Markdown Outline 和 Knowledge。
- 28 段 Azure 中文女声“晓晓” MP3、06:20 整轨 MP3 / WAV、分段压缩包。
- 68 条按逐句音频实测时长同步的字幕；时间轴、类型、音频解码、静音、峰值与字幕一致性检查通过。
- 媒体通过 Git LFS 保存；代码、脚本、字幕和 JSON 清单使用普通 Git。仅约 60 MB 的最终媒体纳入版本控制，未包含 node_modules、TTS 缓存或凭据。

## 在另一台 Windows 电脑 review

安装 Git LFS 后，在已有仓库内执行：

```powershell
git fetch origin
git switch codex/rhyza-promo-review
git lfs install --local
git lfs pull
cd remotion-video
npm ci
npm run check
npm run check:audio
npm run studio
```

打开终端打印的地址，通常为 `http://localhost:3100/Rhyza-Walkthrough`。

重点看片头定位、List View 路径压缩的解释、旁白语气，以及各镜头为操作留出的时间。`Rhyza-Clean` 不显示导演提示，但仍保留缺失录屏标记。整轨和分段也可不启动工程直接试听，见 [AUDIO.md](AUDIO.md)。

LFS 媒体不要只从网页的源代码 ZIP 中获取；请用 `git lfs pull` 获取实际文件。参考：[GitHub LFS 协作说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/collaboration-with-git-large-file-storage)。

## 录屏尝试与当前限制

已验证 Windows 应用控制可用，工程自带 FFmpeg 支持 `gdigrab` 定向捕获窗口；新增了 `scripts/record-window.ps1`，只录标题为 `Rhyza` 的唯一窗口，不捕获整个桌面，不覆盖已有 take。

但本次尚未得到可用实机录屏：

1. 启动真实桌面版 `npm run electron:dev` 时，编译报缺少 `@azure/identity`。
2. 尝试按现有锁文件执行根目录 `npm ci`，npm 返回 `ETARGET`：找不到锁定的 `@azure/msal-browser@5.22.0`；因此桌面应用未成功启动。
3. 没有修改应用源码或根目录锁文件来绕过此问题。根目录依赖安装仍需解决；失败的安装可能留下不完整的 `node_modules`。独立的 `remotion-video` 依赖和预览不受此问题影响。

**当前实机素材为 0/26，所有缺失镜头均明确标记为待录制。没有用静态截图或模拟数据冒充实机操作，也没有渲染最终 MP4。**

解决桌面版依赖、确认窗口内没有私人会话或凭据后，可在 `remotion-video` 目录运行：

```powershell
./scripts/record-window.ps1 -Take views-take-01 -Seconds 40
```

该脚本尚未完成端到端录制验证。原始文件写入 `.cache/recordings/`；检查隐私、动作和画质后，将剪好的镜头按 `SCRIPT.md` 的文件名放入 `public/recordings/`。不要把原始桌面或未审查的窗口素材提交到远程仓库。

后续录屏应优先补：Explain / Ask 后继续阅读、Node / List 切换及路径压缩、标记与筛选、Outline 跳转折叠、知识链接悬停与点击。`npm run check:media` 目前会因缺少录屏而失败，这是已知待办。

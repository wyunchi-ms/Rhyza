# Rhyza 实机介绍 · Remotion 工程

6 分 20 秒，1920×1080，30fps。11 个章节、26 段实机镜头，录屏段落合计 336 秒（88.4%）。已合成 Azure 中文女声配音，包含 28 段 MP3 和对齐时间线的完整音轨；尚未录制实机素材或渲染 MP4。

## 打开

先在仓库根目录拉取 LFS 媒体，再进入此目录启动预览：

```powershell
git lfs install --local
git lfs pull
cd remotion-video
npm ci
npm run studio
```

打开终端打印的本地地址（默认 http://localhost:3100）。

- `Rhyza-Walkthrough`：完整导演预览，带录制提示。
- `Rhyza-Clean`：关闭导演提示；缺失素材仍明确显示“待录制”。
- `Chapters`：11 个单章预览，字幕和旁白自动偏移到该章节。

片头、片尾和章节标题有可编辑动画。中间使用实际录屏槽位；当前用仓库真实截图做淡色参考底图，画面明确标记尚未录制。中文女声旁白已通过 Git LFS 提交，可直接在预览中播放。拉取后先执行 `npm run check:audio`，避免将 LFS 指针文件误当音频。

## 给录制者的文件

- [完整分镜与操作脚本](deliverables/SCRIPT.md)：每个镜头的时间、点击操作、输入问题、旁白及文件名。
- [旁白稿](deliverables/NARRATION.txt)：带时间段的中文配音稿。
- [字幕](deliverables/CAPTIONS.srt)：按逐句合成音频的实测时长对齐。
- [配音清单](deliverables/AUDIO.md)：28 段 MP3、完整音轨和每段的放置时间。
- [Review 交接说明](deliverables/REVIEW.md)：完成情况、录屏尝试结果与待补内容。

片头先讲清出发点：线性聊天难以承接发散思考。Rhyza 希望让多个方向自由展开、保留探索路径，并随时回到主线。阅读不中断、两种视图和筛选都是对这一核心体验的支撑，片尾再回到这个主张。

以公开 Rhyza 仓库的演示副本为主线：源码问答 → Explain / Ask 后继续阅读 → List / Node 两种视图 → 标记与筛选已完成支线 → Markdown 目录和折叠 → 结论沉淀 → 下划线知识链接的悬停与点击 → 简短代码修改和设置。已删除知识事务审核与变更历史的演示。

List View 的重点用实机切换和叠加示意说明：同一会话内连续的 A → B → C 合成一个列表项，D、E、F 分叉继续独立显示，正文仍保留所有问答。筛选按叶节点状态选择可见路径；隐藏已完成的末端支线，不删除记录，也不强行隐藏未完成路径上的共同祖先。

## 接入素材

1. 按脚本录制 26 段视频，按 `src/data/media.json` 指定的文件名放到 `public/recordings/`。Studio 会检测文件并替换占位。
2. `trimBefore` 的单位是**合成帧**，此工程为 30fps：`60` 表示跳过前 2 秒；`playbackRate` 默认 `1`。录屏原声默认静音，不自动循环。素材长度需要覆盖裁切和变速后的片段时长。
3. 完整旁白已保存为 `public/audio/narration.wav`，另有 `narration.mp3`。支持在 Composition props 中改成其他 `public` 相对路径。单章预览会自动跳过之前的配音。
4. `src/data/captions.json` 已按逐句音频时长同步。重新录制或替换旁白时，校准毫秒时间并执行 `npm run script` 导出 SRT 和文稿。

配音、配音压缩包、参考截图及后续放入 `public/recordings/` 的 MP4 使用 Git LFS；字幕与元数据仍使用普通 Git。原始录制、TTS 缓存与依赖不提交。参考截图复制自 `docs/images/`，只用于占位；其中知识库截图使用的是仓库原有的虚构演示数据。

## 重新合成中文女声

使用已登录的 Azure PowerShell，在此目录执行：

```powershell
./scripts/synthesize-azure.ps1 -ResourceGroupName 'chatgpt' -AccountName 'tts-chatgpt'
npm run script
npm run check:audio
```

采用 `zh-CN-XiaoxiaoNeural`（晓晓）、`chat` 语气，输出 48 kHz 单声道、192 kbps MP3。可加 `-Only '00-intro'` 单独试听一个镜头；单段模式不重建整轨和全局字幕。正式更新时再运行不带 `-Only` 的命令。

通过 Azure REST 接口逐句合成后拼接，字幕按实测时长对齐。为紧凑镜头最多允许 1.25 倍保音高加速，超出会中止，要求调整文案或时长。各句按 SSML 哈希缓存到 `.cache/azure-tts/`，重跑不重复请求已完成的音频。密钥仅留在 PowerShell 内存中，不写入文件；首次合成或改动文案会产生 Azure TTS 用量。

## 改脚本与时长

`src/data/storyboard.json` 管理镜头动作、问题和旁白；`src/data/captions.json` 管理屏幕字幕。两者是独立编辑的数据，改旁白时也要同步字幕文本和时间。

`src/Walkthrough.tsx` 使用显式的 Remotion Sequence，各章在 `src/scenes/` 单独维护。改变时长时同步对应场景 Sequence、主时间轴、Root 中的 Composition 时长、storyboard 和字幕。这样 Studio 可以直接识别每一段镜头，检查脚本也会发现时间漂移。

```powershell
npm run script
npm run check
npm run check:audio
npm run check:media
```

`check` 检查类型、镜头顺序、时间轴和字幕边界，允许素材暂缺。`check:media` 另外要求全部录屏和默认配音存在，不分析实际媒体时长，也不替代试听和画面检查。当前阶段该检查会明确报告缺失素材。

`check:audio` 实际解码 28 段 MP3，检查编码规格、时长、静音和采样峰值，以及全局字幕与音轨放置时间的一致性。

没有运行视频渲染，也没有配置自动渲染流程。

实现遵循 [Remotion 视频嵌入文档](https://www.remotion.dev/docs/media/video)；所有 Remotion 包固定为同一版本。

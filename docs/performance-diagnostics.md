# 性能诊断

[文档首页](README.md) · [开发指南](development-guide.md)

输入卡顿排查：重新构建并启动 Electron（`npm run build` 后 `npm run electron:start`，或 `npm run electron:dev`），分别尝试普通输入、中文输入法、粘贴长文本、`@` / `/` 菜单，以及 Agent 输出期间输入。复现后保持窗口打开至少 10 秒，再运行 `npm run diagnostics:analyze`。日志自动写入 `~/.pi-graph/diagnostics/performance-YYYY-MM-DD.jsonl`；也可以用 `npm run diagnostics:analyze -- <日志路径>` 分析指定文件。

输入打点只保存固定类别、计数和耗时，不保存文字、按键或剪贴板内容。所有时间单位均为毫秒；汇总包含次数、平均值、最大值和超过 16 / 50 / 100ms 的次数（旧日志没有阈值计数）。

| 打点                                                                        | 排查方向                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `composer-keydown-queue`、`composer-input-{text,ime,paste}-queue`           | 浏览器事件创建到处理开始的等待时间，可能受主线程阻塞影响；不是硬件按键延迟。                                         |
| `composer-input-*-handler`、`composer-update-draft`                         | 输入事件处理、文本组合和状态更新调用。                                                                               |
| `composer-parse-references`、`composer-strip-references`                    | 引用解析和显示文本提取。                                                                                             |
| `composer-reference-items`、`composer-menu-filter`、`composer-menu-trigger` | 候选数据构建、搜索和触发匹配。                                                                                       |
| `composer-textarea-layout`、`composer-menu-scroll`                          | 输入框自适应高度及候选项滚动造成的同步布局。                                                                         |
| `composer-input-*-to-commit`                                                | 输入处理开始至输入框 layout effect（含 React 更新和上述布局）；不包含事件排队。                                      |
| `composer-input-*-after-frame`                                              | 事件创建至更新提交后的 rAF + timer 回调，近似一次绘制机会；不是精确绘制时间或 INP。隐藏窗口时取消待采样数据。        |
| `composer-render-commit`、`chat-render-commit`                              | 组件函数开始到 layout effect 的墙钟时间，用于比较输入框与聊天面板的更新成本；不是 React Profiler 的纯渲染 CPU 时间。 |
| `composer-skills-request`                                                   | 打开候选菜单时技能加载的异步等待时间，不等同于 UI 阻塞时间。                                                         |
| `chat-turn-render-commit`、`chat-markdown-render-commit`                    | 单条消息及 Markdown 的渲染提交耗时；纯输入不应触发历史消息渲染，单条回复更新应只更新相应消息。                       |
| `state-persist-serialize-dispatch`                                          | 持久化数据序列化及同步派发耗时，不包含异步保存往返。纯界面状态变化会在序列化前跳过。                                 |

分析脚本列出最慢的 10 个输入采样窗口，并展示同一窗口的聊天重渲染、流式更新、持久化耗时及长任务。各阶段会重叠，不能相加；同一 10 秒窗口出现的操作仅表示相关性，不能单凭它认定因果。输入类别来自浏览器 InputEvent；中文输入法的最终提交在部分系统上可能归入 text。`sample-dropped` 表示诊断队列达到上限后丢弃了样本。诊断只在内存聚合，沿用每 10 秒批量写入，避免每次按键发送 IPC 或写日志。

## 输入回归验证

`npm run test:chat-performance` 使用临时数据和隐藏 Electron 窗口验证输入隔离、增量消息渲染、草稿发送及保存去重，不访问真实会话。

## Archify 日志

Archify 日志默认写入同一 JSONL，只包含源内容哈希、大小、图类型、拓扑数量、耗时、CLI 退出码和诊断码，不保存完整 Diagram JSON 或生成的 HTML。需要在开发终端实时查看时，先设置 `RHYZA_ARCHIFY_DEBUG=1` 再启动 Electron。

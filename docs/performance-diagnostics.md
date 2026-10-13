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
| `state-persist-serialize-dispatch`                                          | 持久化同步派发耗时，不包含异步保存往返；桌面 JSON 序列化已移至 Worker，浏览器仍在本线程。纯界面状态变化会在派发前跳过。 |
| `node-create-state`、`node-fork-plan/state`、`node-clone-plan/state`           | 新建、分支及复制节点的同步计算和状态更新（含持久化派发），不包含后续 React 渲染。                                     |
| `node-create-after-frame`                                                  | 新建空节点开始到 rAF + timer 的近似绘制机会；包含状态更新和后续渲染，隐藏窗口时取消采样，不是精确绘制耗时。           |
| `node-fork-debug-snapshot`                                                  | 分支调试快照的同步构建成本，与节点状态更新分开统计。                                                                 |
| `conversation-history-resolve`、`conversation-graph-project`、`conversation-tree-project`、`conversation-graph-layout` | 历史别名解析、图/树投影和 Dagre 布局；这些阶段会重叠，不能相加。                             |

分析脚本列出最慢的 10 个输入采样窗口，并展示同一窗口的聊天重渲染、流式更新、持久化耗时及长任务。各阶段会重叠，不能相加；同一 10 秒窗口出现的操作仅表示相关性，不能单凭它认定因果。输入类别来自浏览器 InputEvent；中文输入法的最终提交在部分系统上可能归入 text。`sample-dropped` 表示诊断队列达到上限后丢弃了样本。诊断只在内存聚合，沿用每 10 秒批量写入，避免每次按键发送 IPC 或写日志。

## 新节点与 Agent / MCP 初始化

更新后需要重新启动 Electron 主进程；只刷新页面不会加载 Main 的新打点。复现“新建节点 → 首次发送”，恢复后保持窗口打开至少 10 秒，再运行 `npm run diagnostics:analyze`。日志仍写入同一 JSONL；新增 `agent-stage` 带有进程 ID、每次请求独立的 `traceId`、阶段配对的 `spanId`，主聊天还带有前端 session / turn ID。

主聊天按阶段记录模型运行时及选择、MCP 配置刷新、旧会话释放、工作目录/Worktree、设置、MCP runtime、资源加载、Pi 历史恢复、AgentSession 创建及 extension 绑定。`model-request`、`wire-request`、`first-output`（含思考输出）、`first-text` 区分初始化、请求准备和首段输出等待。标题与知识提取用独立的 `title` / `extraction` trace，避免并行辅助任务的初始化被误归到主聊天。

MCP 单独记录 transport 启动，以及 `initialize`、`tools/list`、`resources/list`、`resources/templates/list` 的请求往返。只记录匿名 server 序号，不记录地址、命令、参数、工具内容或认证材料；连接关闭或发送失败会结束相应阶段并标记失败。

`durationMs` 是墙钟时间，包含异步等待；`syncDispatchMs` 只测调用动作到返回值 / Promise 的同步派发部分，**不是整个异步阶段的 CPU 或阻塞时间**。异步函数在后续 continuation 中仍可能同步阻塞，应结合阶段时间线、Main 的 event-loop delay 和 Renderer 的 long task / heartbeat 判断。分析脚本展示分阶段汇总、最慢请求时间线及未结束阶段；嵌套阶段不能相加，未结束也可能只是仍在等待或日志尚未写完。

**交互约束**：MCP 连接或发现慢只能让相关对话等待，不能阻塞窗口、节点切换或输入。Agent、Pi 资源和 MCP 等后台服务现已运行在独立 Node Worker，不只是将同步工作包装为 Promise。Main 打点通过现有异步写入队列落盘，不等待日志写入；不逐 token 写日志。

Worker 的 `agent-stage` 与 `worker-sample` 带有 `thread: "backend"`、`threadId`；`main-sample` 单独反映 Electron Main。分析脚本分别显示 Main 和 Worker 的 event-loop delay。资源阶段很长、Worker 延迟很大但 Main/Renderer 正常，说明是后台等待，不是窗口卡死；仍需结合 Renderer long task 判断 UI 自身的渲染及 IPC 复制成本。Worker RSS 是整个进程的共享数值，heap 和 event-loop delay 属于该线程。

## 输入回归验证

`npm run test:chat-performance` 使用临时数据和隐藏 Electron 窗口验证输入隔离、增量消息渲染、草稿发送及保存去重，不访问真实会话。

先运行 `npm run electron:compile`，再运行 `node --import tsx --test tests/backend-worker.test.ts tests/session-filter-persistence.test.ts` 和 `node --test tests/backend-worker-ui.test.cjs`。这些测试使用离线 Provider、OS 临时目录和人为同步阻塞的 Pi extension，测量父线程 heartbeat 与真实 Electron 窗口交互；同时检查 Worker 失败传播、RPC、状态隔离和 Renderer 不再执行桌面 JSON 读写。

## Archify 日志

Archify 日志默认写入同一 JSONL，只包含源内容哈希、大小、图类型、拓扑数量、耗时、CLI 退出码和诊断码，不保存完整 Diagram JSON 或生成的 HTML。需要在开发终端实时查看时，先设置 `RHYZA_ARCHIFY_DEBUG=1` 再启动 Electron。

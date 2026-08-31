# Rhyza 产品记忆与设计原则

> 这份文档记录 Rhyza 在多轮设计、实现和调试中已经确认的产品语义、交互约束和视觉原则。
> 它不是某个页面的临时实现说明；如果新需求与这里冲突，应先明确更新这份文档，再改代码。

## 1. 产品定位

Rhyza 是一个本地优先的 AI knowledge workspace：用户通过树状会话探索问题，稳定的信息沉淀为 Workspace 级的 Entity、Relation 和 Diagram。对话是工作流入口，知识库是可检索、可编辑、可回溯的长期结果。

当前产品基线是 Electron 桌面应用。曾经试验过 Tauri + Node sidecar，但因为体积、运行时和打包复杂度没有作为当前产品方案；除非重新评估，否则不要把 Tauri 假设写进新的架构或用户文档。

## 2. 团队记忆：核心数据和语义

### 2.1 Session、Turn 与分支

- 一个 Session 是一次连续的工作上下文；Turn 是其中一次用户输入及其 Agent 输出。
- 从历史 Turn 继续时，要保留原路径，同时把新问题挂在“被引用/被继续的 Turn 的子节点”上，而不是挂到当前视图节点或根节点。
- 节点状态必须反映真实生命周期：待处理、进行中、正常完成、异常退出和暂不处理不能混为一谈。
- 如果 Agent 进程在流式输出期间被杀、窗口关闭或 IPC 中断，不能把节点永久留在“进行中”。启动恢复扫描时，应依据持久化事件和进程结果区分正常结束与异常结束，并允许用户重新执行、删除或修改该节点。

### 2.2 引用（quote）是上下文，不是装饰

- 用户在回答文本中选中词或一段文字后执行操作，发送的新消息必须保留引用上下文。
- 用户气泡中应清楚显示被选中的原文，再显示用户输入；不能只显示 “what's this” 或 “explain” 而让人猜引用对象。
- 右键菜单中的 `Ask about this` 允许用户输入问题；`Explain` 是固定发送 `explain` 的快捷项。两者都使用同一套引用展示和分支挂载语义。
- 引用完成后，若提取到了稳定的新概念，应创建或更新 Entity，并把引用所在的 Turn 作为来源；仅仅提到一个词不应机械地产生 Entity。

### 2.3 选择和菜单

- 选中文本后，点击页面其他位置会取消选中状态，同时关闭浮动菜单。菜单不能在选区消失后继续悬浮。
- 菜单的视觉、阴影、圆角、间距和键盘行为应与树状节点的右键菜单一致；同一产品不应出现两套明显不同的菜单语言。
- 菜单项要有明确的 hover、focus 和 disabled 状态；不要用只有颜色变化的隐晦反馈。

### 2.4 Knowledge 的写入边界

- Entity 表示稳定、可复用的概念；Relation 表示有证据支持的实体间关系；Diagram 表示结构或流程的可视化。
- 自动抽取要保守：优先复用已有对象，避免为每个术语创建实体。用户明确引用、编辑或接受变更时，才提高写入意愿。
- Diagram 与 Entity/Relation 的连接要可见、可编辑、可删除；删除应是软删除或可恢复操作。
- 空集合、搜索无结果、未选中对象和加载失败是不同状态，文案不能互相替代。

## 3. Diagram 记忆与渲染契约

### 3.1 双渲染器

- Settings 中有两个明确选项：Archify 和 Mermaid。
- Archify 是默认模式：模型生成 `archify` fenced JSON，Electron 主进程负责规范化、严格校验和交付，Renderer 只接收沙箱化的 HTML artifact。
- Mermaid 是快速模式：保留原始 Mermaid 流程。
- Archify 失败时必须自动从同一拓扑生成 Mermaid fallback；无论是通用 `nodes/edges`、`lanes/events` 还是严格校验失败，都不能出现空白图或 “No valid diagram fallback is available”。
- fallback 转换器是 Rhyza 自己的确定性代码，不是 Archify 提供的库。转换应优先保留节点、边和标签，无法表达的高级布局可以降级为普通 `flowchart`。

### 3.2 Archify 集成边界

- Archify 以 vendored skill/runtime 的形式位于 `resources/skills/archify`，不是前端 npm library，也不是 Git submodule。
- 生成链路是：Harness 约束模型输出 → Main 标准化/校验 → Archify CLI 生成自包含 HTML/SVG → 沙箱 iframe 展示。
- Rhyza 的主题、预览密度、隐藏重复控件和 iframe 高度属于宿主层定制，集中放在 `src/shared/archify-viewer.ts` 等集成代码中。
- 不要直接修改 vendor 的模板、schema、renderer 或 CLI 来实现 Rhyza 专属 UI。升级 Archify 时只需重新核对稳定 selector、height handshake 和 schema；若 selector 改变，应改宿主 overlay 和测试。
- 每次 vendor 升级都要记录版本、tag、commit 和 schema 版本，并运行 Archify smoke test。升级流程见 [Archify integration and upgrades](archify-integration.md)。

### 3.3 预览和演示是两种密度

预览卡片的任务是快速确认内容，不是展示完整编辑器。因此默认预览应保持紧凑：

- 左上角不显示 `Interactive Diagram Archive` 等重复品牌前缀；标题尽量单行显示。
- 状态点必须保持正圆，不能因缩放或宽高规则变成椭圆。
- Archify 的明暗色、背景、边框和文字必须跟随 App 主题；App 提供浅色/深色切换，不能只改宿主页面而遗漏 iframe。
- 默认使用经典 preset；预览不放路径、地图、透镜、演示专用信息卡或重复的接入层/核心基础设施卡片。
- 展开后进入演示/大屏模式，再显示完整导航、地图、透镜和补充卡片。
- 导出保留 PNG、JPEG、WebP、SVG 等图像/矢量格式；分享卡、复制分享卡、复制图表等重复动作不放在默认导出菜单中。导出入口应与展开按钮协调放置，不能遮住图表。
- iframe 高度必须由完整 artifact 的 intrinsic height 决定，外层 frame、column 和内容高度一致，禁止嵌套滚动；标题不能被内部滚动条卷走。

## 4. 视觉和交互原则

### 4.1 一致、克制、可读

- 采用经典、克制的工作台风格：中性表面、清晰边界、少量青绿色强调色；不要为单个组件引入孤立的视觉语言。
- 图标统一使用 Lucide/SVG，不使用 emoji 代替功能图标。
- 可点击元素始终有 pointer cursor、hover 和 focus-visible 反馈；hover 不应通过缩放造成布局跳动。
- 文本颜色要满足可读性：正文不能依赖浅灰，暗色模式也要保证边框、禁用态和 placeholder 仍可辨识。
- 动画只用于状态转换或加载反馈，通常控制在 150–300ms，并尊重 `prefers-reduced-motion`。

### 4.2 明暗主题是完整主题，不是背景开关

- 浅色和深色需要同时审核：页面、侧栏、弹窗、菜单、输入框、滚动区域、Diagram iframe 和底部 composer 都必须落在同一套中性颜色阶上。
- 主题选择器使用真正的圆形 radio，选中态通过边框和内圆点表达，不依赖浏览器默认外观，以避免 Chromium/平台差异造成方块或变形。
- 主题切换后不应丢失当前路由、草稿、选区或正在查看的对象。

### 4.3 响应式和空间

- 重点断点至少验证 375px、768px、1024px 和桌面宽度。
- 窄屏下侧栏不能继续挤压主内容；应作为覆盖式抽屉打开，并有遮罩和清晰的关闭方式。主内容在侧栏关闭时占满宽度。
- 任何固定/浮动控件都不能覆盖标题、输入框或图表内容，也不能制造不必要的水平滚动。
- 空状态要占据剩余空间并提供下一步；搜索无结果要说明搜索词，空集合要说明如何产生第一条数据。

### 4.4 状态必须诚实且可恢复

- 加载中、正常完成、异常退出、fallback、禁用和无权限是不同状态，使用不同的图标、文字和可执行动作表达。
- 禁用按钮不仅要变灰，还应通过 tooltip/title 或辅助文本说明原因，例如实体少于两个时不能重建关系。
- 任何超时或进程退出都要进入可恢复流程：记录阶段、保留错误摘要、允许重试或清理，不要让 UI 永久等待。
- Renderer 不显示模型生成的任意 HTML；所有可执行内容必须经过 Main 校验并在沙箱 iframe 中运行。

## 5. 可观测性和性能记忆

- 卡顿调查优先使用结构化日志，而不是猜测。UI、Main 操作、IPC、Archify 阶段都记录开始/结束、耗时、状态、错误码和相关对象 ID/哈希。
- 默认日志不要保存完整用户文本、完整 Diagram JSON、生成 HTML、凭据或 token；需要调试时通过显式 debug 开关增加细节。
- 性能日志写入 `~/.pi-graph/diagnostics/performance-YYYY-MM-DD.jsonl`，使用 `npm run diagnostics:analyze` 汇总慢操作和热力图数据。
- 监控重点包括：首次渲染、Diagram 标准化/校验/交付、iframe height handshake、长任务、IPC 超时、Agent 进程退出和重复重渲染。
- 修复卡顿时先确认是否存在重复 effect、无限 resize/scroll 反馈、未清理 listener、隐藏菜单未卸载或 iframe 与外层互相调整高度。

## 6. 以后改动的检查清单

### 交互改动

- [ ] 是否保留了引用文本和正确的 Turn 父子关系？
- [ ] 点击外部、Esc、滚动和窗口尺寸变化后，浮动菜单/选区是否按预期关闭？
- [ ] 新菜单项是否复用了现有菜单样式、键盘行为和无障碍语义？
- [ ] 异常退出后是否还能重试、删除或修改？

### Knowledge 改动

- [ ] 空集合、搜索无结果、未选择和加载失败是否有不同文案？
- [ ] Entity/Relation/Diagram 是否避免重复创建，并保留来源和可恢复操作？
- [ ] 只有满足前置条件时按钮才可用，禁用原因是否可见？

### Diagram 改动

- [ ] Archify 严格失败是否仍能从拓扑生成 Mermaid？
- [ ] 是否同时检查 Archify 和 Mermaid 两种设置？
- [ ] 是否在浅色/深色、预览/大屏、375px/桌面宽度下检查 iframe 高度和滚动？
- [ ] 是否只改宿主 overlay，而不是把 Rhyza 定制写进 vendor runtime？
- [ ] 导出是否只保留用户真正需要的格式，且入口不遮挡图表？

### 发布前验证

```powershell
npm run typecheck
npm test
npm run smoke:archify
npm run diagnostics:analyze
npm run build
```

## 7. 冲突处理原则

当新需求与这份记忆冲突时，按以下顺序处理：

1. 先确认是否改变了产品语义（例如分支归属、引用来源、fallback 保证）。这类变化需要更新数据/状态设计，而不是只改 CSS。
2. 再确认是否只是宿主呈现偏好（例如标题、卡片、导出入口）。优先使用组件参数或宿主 overlay，避免修改第三方 runtime。
3. 最后补充回归检查，尤其是主题、窄屏、异常退出和 Archify fallback；没有验证的视觉修复不算完成。


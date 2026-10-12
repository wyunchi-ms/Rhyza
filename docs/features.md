# Rhyza 功能与限制

[项目首页](../README.md) · [使用指南](user-guide.md) · [开发指南](development-guide.md)

本文档描述当前仓库中可用的产品能力及边界。状态定义：

- **Available**：主流程已实现，可在当前 Windows MVP 使用。
- **Partial**：已有可用实现，但存在明确缺口或回退路径。
- **Planned**：只有设计或占位，不应在产品介绍中写成已完成。

## 功能矩阵

| 领域         | Feature                 | 状态      | 当前行为与边界                                                                |
| ------------ | ----------------------- | --------- | ----------------------------------------------------------------------------- |
| Conversation | 树状 Session/Turn       | Available | 从历史 Turn 继续会创建分支并保留原路径                                        |
| Conversation | 引用选区提问            | Available | 保存引用原文，并将新分支挂到引用 Turn                                         |
| Conversation | 列表/节点视图           | Available | 左侧面板可切换树列表与 Session Graph                                          |
| Conversation | 路径汇总                | Available | 列表和 Node view 共用高亮多选；去重汇总根到终点的用户/Agent 正文，生成可继续聊天的节点，来源由汇合点连线并标注在卡片内 |
| Conversation | 节点状态与恢复          | Available | 区分 queued、retrieving、running、complete、error 等活动状态                  |
| Conversation | 全局 Chat 搜索          | Available | `Ctrl+Shift+F`                                                                 |
| Conversation | 图片输入                | Available | Composer 可附加图片，由所选 Provider/模型决定是否支持；Azure OpenAI 当前仅支持文本                                   |
| Conversation | 并发调度                | Available | 全局 1–10；同一 Conversation 严格有序                                         |
| Conversation | Token/费用展示          | Partial   | 展示 Provider 返回的 usage；字段完整性取决于 Provider                         |
| Agent        | Codex Provider          | Available | 通过官方 `codex app-server` 复用 Codex Desktop/CLI 登录与模型目录             |
| Agent        | Claude Code Provider    | Available | 调用本机 Claude Code CLI；用户单独安装并通过 CLI 登录                         |
| Agent        | GitHub Copilot Provider | Available | 通过 Pi SDK Device Flow/OAuth 连接                                            |
| Agent        | Azure OpenAI Provider   | Available | Azure CLI 登录；保存公共云资源与 Responses-compatible deployment，支持流式文本和工具；Azure 单独计费 |
| Agent        | 动态模型目录            | Partial   | Copilot/Codex 可刷新目录；Claude Code 支持别名；Azure OpenAI 使用保存的 deployment，无自动能力发现 |
| Agent        | GitHub Enterprise 域名  | Planned   | 当前认证流程固定使用 `github.com`                                             |
| Sources      | 本地目录索引            | Available | 代码/文本文件清单、Git revision 和状态持久化                                  |
| Sources      | 索引排除配置            | Available | 每个资料源多选排除目录与自定义规则，保存到 Catalog 后立即重新索引              |
| Sources      | 文本搜索与片段读取      | Available | 确定性 keyword/path ranking；读取有路径和长度边界                             |
| Sources      | Embedding/向量检索      | Planned   | `indexed` 目前不表示语义向量索引                                              |
| Sources      | Reindex/Delete source   | Available | 支持刷新扫描和确认删除；仅移除当前 Workspace 注册，保留文件及历史对话/知识      |
| Knowledge    | Entity/Relation/Diagram | Available | Workspace 级存储、来源、版本和链接                                            |
| Knowledge    | 自动提取                | Available | 每轮后按策略生成或提交知识变更                                                |
| Knowledge    | Proposed ChangeSet      | Available | Suggest 模式可接受或拒绝变更                                                  |
| Knowledge    | 编辑、软删除与历史      | Available | Entity/Diagram 可维护，Change 页面保留审计                                    |
| Knowledge    | 全局关系重建            | Available | 至少两个 Entity 时调用当前模型重建 Relation                                   |
| Knowledge    | Hybrid 写入策略         | Partial   | 当前与 Automatic 行为相同                                                     |
| Knowledge    | Confidence threshold    | Partial   | 设置可持久化，尚未接入提取过滤                                                |
| Diagram      | Mermaid                 | Available | 默认 Diagram 源与渲染路径                                                     |
| Diagram      | 通用 HTML Preview       | Available | 自包含 HTML 经 Main 校验后保存快照并在沙箱 iframe 展示                        |
| Diagram      | Archify 交互图表        | Available | 作为可选 Pi extension 安装，不内置到宿主                                      |
| Workspace    | 按路径隔离状态          | Available | 规范化 Workspace Path 映射独立 state/source 文件                              |
| Workspace    | 历史列表切换            | Available | Workspace 页展示最近工作区，历史全局持久化；添加目录时才打开系统选择器          |
| Workspace    | Git Worktree 隔离       | Partial   | 可写 Session 会尝试创建；失败时回退原 Workspace                               |
| Workspace    | Diff 与 patch 导出      | Available | Changes 页读取当前 Session 绑定目录                                           |
| Settings     | Light/Dark              | Available | App 与 HTML/Diagram 预览同步主题                                              |
| Settings     | 无障碍设置              | Available | 减少动画、高对比度、字体缩放                                                  |
| Extension    | Pi package 管理         | Available | 支持 npm、Git 和本地来源；界面面向 GitHub Copilot，Claude Code 不加载 Pi 插件 |
| Distribution | Windows 安装包/签名     | Planned   | 当前只支持源码开发运行                                                        |
| Distribution | macOS/Linux 验证        | Planned   | 尚未完成平台验证                                                              |

## 1. Conversation workspace

### 分支上下文

Rhyza 的基本单位是 Session 和 Turn。用户从历史回答继续时，新 Session 记录父 Session 和 `forkedFromTurnId`，Agent 只接收当前根到叶路径中相关的 Transcript。这样既保留历史，又避免把其他分支机械拼入上下文。

选区提问会把引用内容展示在用户消息中，并将其作为明确问题上下文。固定 Explain 和自定义 Ask about this 共享同一分支语义。提交后保留当前阅读路径和滚动位置，不自动切换到新节点或滚动到新消息；回答生成后也不会抢走阅读视角。

### 运行状态

请求依次经过 queue、Source/Knowledge retrieval、Agent generation 和完成/失败阶段。应用会保存活动状态，异常不应伪装成成功。不同 Conversation 可并发，同一 Conversation 始终顺序执行。

### 路径汇总

在 Chats 列表或 Node view 中按住 `Ctrl`（macOS 可用 `⌘`）点击节点，再点击其他节点并选择 **Summary**，即可汇总一条或多条路径；也可从节点右键菜单执行 **Summarize path** 预选路径。可在顶部高亮的提示词输入框填写可选指令，指定摘要重点；普通浏览模式不会显示节点选择框。两种视图共用明显的已选高亮，不显示勾选框或单独的已选路径列表；列表中的连续轮次以末轮为默认终点，从图切回列表时保留更早轮次的实际选择并高亮对应行。折叠或筛选隐藏的选择仍计入汇总，并提示隐藏数量；取消模式可清空选择。汇总进行中隐藏顶部选择面板，在对话区域提供取消操作，新节点立即出现在图与对话中。

汇总只输入保存的用户消息（含引用原文）及 Agent 面向用户的回复正文，不输入 thinking、tool、子 Agent 内部消息、原始模型请求或图片。共享历史按原始消息身份去重，不合并无关路径中的相同文字；未完成或中断的回答需要先完成。

汇总使用当前 Provider/模型，可选提示词在每一层分块与合并时传入；超长内容按上下文预算分块并递归合并，不会静默截断路径。Pi 模型使用目录/配置中的上下文及输出预算；Claude Code 无模型目录，使用保守的 32k 请求预算，并在空的临时目录以 `--bare`、空 setting sources 和独立 system prompt 执行，需 CLI 支持这些选项。无对应 tokenizer 时采用 UTF-8 字节数的保守 token 估算。失败、超时、取消、应用关闭和输出截断会移除进行中节点；应用运行期间选择保留供重试。每次片段请求最多等待 120 秒，最多 12 层合并。单次输入最多 32 MB 文本。

结果是独立 Session 内的一对用户/Agent 消息和来源快照。Node view 中普通路径与来源路径共用曲线及选中态渐变，来源路径经隐藏汇合点以虚线连接到摘要；选中摘要时来源节点显示紫色虚线高亮，卡片内也标注来源。用户消息气泡以可点击的引用形式列出来源，删除的来源显示为不可用；引用连线不是 `parentId` 父子关系，列表中摘要单独出现一次。后续聊天只继承摘要与新增对话，不重放原始路径。原历史不移动、不删除，来源后续修改不会改变摘要，删除来源不级联删除摘要。成功费用记录于摘要回答，失败/取消的已知费用记录于来源 Session，均只累计一次。生成阶段不运行工具、不自动写入 Knowledge，Pi 汇总 Session 同样禁用后台 prompt-cache warming。

### 导航

- Chats 列表展示层级、标题、状态和 usage；
- Node view 以图形节点预览 Conversation Round；
- 全局搜索查找所有 Chat；
- Chats 顶部可按叶节点的标记状态多选筛选，保留命中叶节点的祖先路径；列表和 Node view 共用筛选条件，不切换当前阅读中的会话；条件按 Workspace 保存，切回工作区或重启应用时恢复上次选择；
- Explain 节点标题显示所引用内容的简短预览，已有的普通 `explain` 标题同样适用，手动改过的标题保留；
- 宽屏阅读 Markdown 回答时，中间区域左侧显示当前聚焦回答的标题目录，可跳转并高亮当前章节；空间不足时先收窄正文，达到最小宽度或回答没有标题时不显示目录；
- Markdown 标题支持逐节折叠，目录跳转和页面内查找会展开目标章节，折叠不会重置嵌入式 HTML 预览；
- 选择节点后，当前对话定位到对应 Turn。

## 2. Sources

Source Catalog 按 Workspace 隔离。扫描只建立受支持文本文件的相对路径清单，并记录 Git revision（若适用）。搜索时按 query 拆分关键词，结合路径权重和文本命中排序；Agent 只能读取已索引 Source 中的相对路径片段。

扫描与旧清单加载共享排除策略：默认过滤内部调试数据、依赖、构建产物及缓存，读取 Source 范围内的根级和嵌套 `.gitignore`，并支持根级 `.rhyzaignore` 覆盖 Git 规则。默认目录排除不可被反向规则解除。旧清单剔除忽略项后同步文件数，搜索与 Agent 读取不会绕过清单。具体目录、优先级及示例见[使用指南](user-guide.md#35-添加和搜索-sources)。

安全与资源边界：

- 不跟随符号链接；
- 禁止绝对路径和 `..` 离开 Source；
- 单次读取最多 200 行、32 KB；
- 单文件扫描上限 2 MB；
- 单 Source 最多 50,000 个文件。

## 3. Knowledge

Rhyza 将稳定概念沉淀为 Entity，用 Relation 表达有证据的连接，用 Diagram 表达结构或流程。知识是 Workspace 级长期结果，不属于某一条 Chat 的临时摘要。

写入模式：

| 模式            | 行为                                           |
| --------------- | ---------------------------------------------- |
| Suggest changes | 提取结果先显示；接受后提交，拒绝恢复变更前内容 |
| Automatic       | 直接提交提取结果                               |
| Hybrid          | 当前等同 Automatic                             |
| Read only       | Agent 可读取，自动提取不写入                   |

当前 Confidence threshold 仅是持久化设置。任何依赖阈值过滤的体验都应视为 Planned，直到 Finalizer 接入该值。

## 4. Diagram 与扩展

Mermaid 是持久化 Diagram 的基础格式。可选 Pi package 可以通过通用 `html-preview` fenced declaration 返回自包含 HTML artifact；Main Process 负责解析路径、校验真实文件边界、限制大小并保存快照，Renderer 只在受限 iframe 中运行。

Archify 是独立的可选 Pi extension，不是前端依赖或宿主内置渲染器。安装、工具和交付契约见 [Archify extension](../extensions/pi-archify/README.md)，通用宿主协议见 [HTML Preview 协议](html-previews.md)。

## 5. Workspace、Worktree 与 Changes

Workspace Path 是所有本地状态的隔离键。Git Workspace 中，可写 Session 首次运行时会尝试基于当前 `HEAD` 创建 detached Worktree。若 Git 命令失败，会明确回退到原 Workspace；这保证聊天仍可运行，但不再具备修改隔离。

回退后的权限有 Provider 差异：Copilot 的内置修改工具和 Claude Code 的可写工具要求成功隔离；Codex App Server 根据请求的可写标记选择 sandbox，不以隔离成功为前提。Pi 扩展可以当前用户权限执行代码，不能用 Worktree 状态推断它们的权限。

Changes 页提供：

- Knowledge ChangeSet 历史；
- 当前 Session 的 Git status；
- binary-safe Git diff；
- patch 导出。

## 6. 非目标与近期限制

Pi SDK 已升级到 1.0.0，但升级不等于启用新版全部能力。通用 MCP、工具按需发现、自动模型路由、统一图片生成、细粒度上下文管理、Prompt cache 保活、原生 PowerShell 工具和分类模型均为 **Planned**；具体接入范围见 [Pi SDK 待办](TODO-pi-sdk.md)。当前缓存状态展示和自动上下文压缩继续保留，主动缓存保活明确关闭。

当前 MVP 不承诺：

- 云端同步、多人协作或团队权限；
- Source Embedding、向量数据库或语义检索；
- 自动清理/合并 Git Worktree；
- 安装包、签名、自动更新；
- GitHub Enterprise 自定义域名；
- macOS/Linux 兼容性；
- Hybrid 模式的按来源/置信度拆分策略。

产品语义发生变化时，同步更新 [产品记忆与设计原则](product-memory-and-design-principles.md)；实现状态变化时先更新本文档。

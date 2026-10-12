# Rhyza 使用指南

本指南面向从源码运行当前 Windows MVP 的用户。功能范围和已知限制请同时参考 [Feature 文档](features.md)。

[项目首页](../README.md) · [文档导航](README.md) · [开发指南](development-guide.md)

第一次使用按“安装 → 选目录 → 连 Provider → 发起对话”完成配置即可。Pi 插件和知识策略可以稍后调整。

## 1. 安装与启动

### 环境要求

- Windows 10/11
- Node.js `22.19+`
- npm
- Git 2.x
- 可访问所选 AI Provider 和 npm registry 的网络

检查版本：

```powershell
node --version
npm --version
git --version
```

安装并启动桌面应用：

```powershell
git clone https://github.com/wyunchi-ms/Rhyza.git
cd Rhyza
npm ci
npm run electron:dev
```

`npm run electron:dev` 会编译 Electron Main Process 和 preload，在 `127.0.0.1:5175` 启动 Vite，然后打开 Electron。

> 不要用 `npm run dev` 测试真实聊天。它只启动 Renderer 页面，没有 Electron IPC、文件系统、Provider 和本地持久化能力。

## 2. 首次配置

### 2.1 选择 Workspace

进入 **Workspace → Current workspace → Choose workspace**，先查看最近使用的工作区列表。点击历史目录即可切换，当前工作区会单独标记；点击 **Add workspace** 才打开系统目录选择器，可选择已有目录或新建文件夹。之后可通过同一页的 **Change workspace** 切换，并独立添加待索引的资料源。

历史记录按最近使用顺序保存在全局设置中，重启或切换工作区不会丢失。升级时会从已有 Workspace 状态索引补回旧目录；目录被移动或删除后，切换会显示错误并保留当前工作区。

Workspace 同时决定：

- Agent 默认读取和修改文件的位置；
- Session、Knowledge、Sources、设置和布局使用哪一份本地状态；
- Git Session 是否可以创建隔离 Worktree；
- **Changes** 页面读取哪一个 Session 的 Diff。

切换 Workspace 会加载另一套状态。若重启后数据“消失”，先确认选择了同一个绝对路径。

### 2.2 连接 AI Provider

进入 **Settings → AI Provider**：

Settings 导航按「AI 与工作流」（AI Provider、Pi Plugins、Knowledge policy）和「应用偏好」（Language、Appearance、Accessibility）分组；打开设置时首先显示 AI Provider，搜索只显示匹配的分类。

1. 在 **Provider** 下拉菜单中选择 GitHub Copilot、Codex、Claude Code 或 Azure OpenAI。
2. 按下面对应的步骤完成登录，再检查界面上的连接状态。
3. 在 **Default Model** 中选择模型，或保留 **Use provider default**。

切换 Provider 会重置模型选择。聊天、分支标题和知识提取使用所选 Provider；模型权限、额度和计费由服务提供方管理。

#### GitHub Copilot

1. 点击 **Sign In**，复制出现的 Device Code。
2. 点击 **Open sign-in**，在浏览器完成 GitHub 授权。
3. 返回 Rhyza，等待连接成功，再选择模型。

需要具有 Copilot 权限的 GitHub 账号。Pi SDK 已随项目安装，无需 Pi CLI、Copilot CLI 或 VS Code 扩展，也无需在 `.env` 填写 Token。已有 Pi 登录通常可通过 `~/.pi/agent/auth.json` 复用；VS Code 或 GitHub CLI 的登录不保证能复用。当前界面仅支持 `github.com`。

#### Codex

安装 Codex Desktop 或 Codex CLI 后，选择 **Codex → Sign In**。Rhyza 通过官方 `codex app-server` 检测同一用户的 Codex 登录，已有账号时直接复用，否则显示浏览器授权链接；模型目录也从 App Server 获取。

Codex 管理自己的凭据与 Token 刷新。普通 ChatGPT 聊天登录不等于 Codex 授权，Rhyza 不读取聊天 Cookie。若找不到可执行文件，可在启动前设置 `RHYZA_CODEX_EXECUTABLE` 为 Codex 可执行文件的绝对路径。配置目录由 Codex 管理，通常为 `~/.codex`（可由 `CODEX_HOME` 改写）。

**Sign Out 会调用 Codex App Server 退出登录，可能影响使用同一配置目录的其他客户端。**

#### Claude Code

单独安装 Claude Code CLI，在终端完成登录：

```powershell
claude auth login
claude auth status
```

重启 Rhyza，选择 **Claude Code → Check connection**。Rhyza 调用本机 `claude --print` 的结构化流式接口；凭据和退出登录由 Claude Code CLI 管理，不通过 Pi 登录。

没有模型列表时可保留 Provider 默认值，或在 **Custom model ID or CLI alias** 输入 CLI 支持的别名或模型 ID。安装路径未被识别时，在启动前设置 `RHYZA_CLAUDE_PATH` 为可执行文件绝对路径。当前适配器要求 CLI 支持 `auth status --json`、`--input-format stream-json`、`--include-partial-messages`、`--permission-mode dontAsk` 和 `--effort`。

Windows 上可写工作流需要 Git for Windows 提供的 Git Bash；必要时设置 `CLAUDE_CODE_GIT_BASH_PATH`。Claude Code 的 Worktree 不是操作系统沙箱，可写会话的 Bash 以当前用户权限执行。图片请使用 PNG、JPEG、GIF 或 WebP，Claude Code 不接受 BMP。

#### Azure OpenAI

先安装 Azure CLI，准备 Azure OpenAI v1 Responses-compatible deployment，并确保登录账号对资源具有 **Cognitive Services OpenAI User** 或等效权限。在终端执行：

```powershell
az login
az account set --subscription "<your-subscription-id>"
```

选择资源所在的订阅，而不是其他可访问的订阅。然后在 **Settings → AI Provider → Azure OpenAI** 填写：

- **Azure endpoint**：例如 `https://your-resource.openai.azure.com`。也支持 `https://your-resource.cognitiveservices.azure.com`，两者均可带 `/openai/v1/` 后缀；仅支持 HTTPS 公共云资源 endpoint。
- **Deployment name**：Azure 中已创建的 deployment 名称，例如 `your-deployment`，不是任意模型别名。
- **Subscription ID**：资源所在订阅的 ID。

点击 **Save configuration** 后再 **Check sign-in**（已就绪时显示 **Refresh status**）。状态就绪表示 Azure CLI Token 可获取，不代表 deployment 权限已验证；实际访问、配额和网络错误在首次请求时显示。登录、Token 刷新和退出由 Azure CLI 管理，Rhyza 不保存 Azure 凭据。

默认模型固定为保存的 deployment；聊天、分支标题和知识提取共用这一配置。当前支持流式文本和工具，不支持图片输入或 reasoning 控制。直接使用 Azure 模型的费用由 Azure 单独计费，不消耗 Copilot 套餐额度。

**Advanced** 中的 **Context budget** 默认 `32768`，**Response token limit** 默认 `4096`。它们是本地操作限制，不是自动发现的模型能力；请按 deployment 的实际限制设置。两者必须为整数，范围分别为 `1024–2000000` 和 `16–200000`，且 Response token limit 不能大于 Context budget。非秘密配置保存在 `~/.pi-graph/azure-openai.json`，点击保存才生效；保存后的 endpoint 统一以 `/openai/v1` 结尾。若聊天、标题生成或知识提取正在进行，请等待响应完成后重试保存；未保存的输入会保留。若本地配置无法读取，可点击 **Retry loading**，或直接重新填写资源信息并点击 **Save configuration** 替换配置。

#### Provider 使用差异

| 项目               | 当前行为                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| 登录状态           | Check connection 检查本地配置；实际模型权限、额度和网络错误在请求时显示                             |
| Pi 插件            | 设置界面只面向 GitHub Copilot 提供支持；Claude Code 不加载 Pi 插件，不应假定 Codex 具有相同工具行为 |
| Sources            | Copilot 可调用 Source 搜索/读取工具；Claude Code 使用请求前检索到的相关片段                         |
| Claude Code 上下文 | 每次请求从当前分支的可见文本和图片构建输入，不跨请求重放 CLI 内部工具历史                           |
| Thinking level     | 请求的档位由 Provider 映射；不保证每个 Provider 或模型都有相同效果                                  |
| 用量               | 只展示可获得的字段；费用为 0 不代表服务免费，请以 Provider 账单为准                                 |

请求面板中的输入快照不一定是 Provider 内部每次模型调用的原始 HTTP payload；不要将其理解为完整网络抓包。

### 2.3 可选：安装 Pi 插件

进入 **Settings → Pi Plugins (GitHub Copilot only)**。该入口面向 GitHub Copilot 工作流。支持：

- `npm:` package；
- `git:` package；
- HTTPS/SSH Git URL；
- 本地绝对路径；
- **Install from local folder…** 目录选择器。

Pi package 以当前用户权限执行代码，Skill 也会影响 Agent 行为，只安装已审查和信任的来源。安装或移除后，Rhyza 会重建 Agent Session，下一条消息使用新的插件集合。

如需交互式图表，可安装仓库中的 `extensions\pi-archify`，详情见 [Archify extension](../extensions/pi-archify/README.md)。

本地安装引用原目录，不复制源文件；Remove 只取消配置，不删除本地目录。代码修改后重启应用。已保存的 HTML 快照在卸载扩展后仍可查看。

## 3. 日常工作流

### 3.1 创建对话

1. 回到 Workspace。
2. 点击左侧 Chats 标题旁的 **New chat**。
3. 输入问题，也可以附加图片。
4. Rhyza 会先检索相关 Sources 和 Workspace Knowledge，再把当前分支的对话上下文交给 Agent。

同一对话中的请求保持顺序；不同对话可并发执行。并发上限在 **Settings → Knowledge policy → Concurrent questions** 中设置。

### 3.2 从历史回答分支

在回答中选中文字后，可围绕选区继续提问。新问题会：

- 保留引用原文；
- 从引用所在的历史 Turn 创建分支；
- 继承该位置之前的相关路径，而不是携带所有无关分支；
- 保留原路径，方便随时返回。

使用 **Ask about this** 或 **Explain** 后，当前阅读路径和滚动位置保持不变。新问题照常提交并生成回答，但不会自动跳到新节点或消息；需要查看时，再主动选择对应节点。

左侧 Chats 显示会话树和 Token 用量。使用 **Node view** 可切换到图形化节点视图。节点支持重命名、删除、折叠和状态管理；运行中的节点会显示真实活动状态。

Chats 顶部的筛选按钮支持按叶节点标记状态多选：**Unmarked**、**To explore**、**In progress**、**Completed** 和 **On hold**。匹配任一所选状态的叶节点及其祖先路径会保留；非叶节点自身的状态不决定是否命中。选择 **All statuses** 或清空选择即可恢复全部节点。筛选在列表和 Node view 间同步，不改变当前对话或 Total 用量统计。每个 Workspace 独立保存筛选条件，切换回来或重新打开应用时自动恢复；新工作区默认显示所有状态，清空筛选后也会记住。

**Explain** 节点显示为 `Explain: 引用内容摘要`，便于区分不同的解释问题。已有节点也会根据保存的引用补全显示，无需重新提问；自定义标题不会被覆盖。

<!-- GIF TODO: docs/images/branch-and-resume.gif，脚本见 images/README.md。 -->

### 路径汇总：将多个讨论压缩为新对话

1. 在 Chats 列表或 **Node view** 中按住 `Ctrl` 点击节点（macOS 可用 `⌘`）进入多选模式；平时点击节点仍是打开对话。进入后点击节点可选择或取消，选中节点只用高亮标识，不显示勾选框或列表轮次计数；选择不会切换当前对话。点击 **Cancel** 或按 `Esc` 退出。
2. 在顶部填写可选的汇总提示词以指定重点，选完点击 **Summary（汇总）**。每个终点都包含从根开始的整条路径，公共历史自动去重；不同根的对话也可一同汇总。列表折叠的连续轮次默认选到最后一轮；切换视图不会更改已选终点。被折叠或筛选隐藏的节点仍计入顶部已选数量，取消模式会清空所有选择。
3. 汇总开始后新节点立即出现在图与对话中，顶部选择面板随即隐藏；对话中的等待区域提供取消操作，汇总完成前不能继续输入。失败或取消会移除进行中节点，并保留选择供重试；未完成/中断的来源回答需先完成。
4. 完成后即可在新对话继续提问；摘要也可从列表或图重新打开。Node view 在摘要卡片内显示来源路径，不用交叉连线模拟父子关系；列表只展示一个摘要节点。

单节点可右键 **Summarize path（汇总路径）** 进入预选该路径的合并模式，再填写提示词并确认汇总。只汇总用户消息、引用原文和 Agent 给用户的正文，不包括思考、工具和子 Agent 内部消息，也不自动读取图片或工具产物。超长路径分块后逐层合并，不丢弃较早历史。

摘要是生成时的快照，Node view 用带箭头的虚线将来源经共享汇合点连到摘要；摘要的用户消息中可点击来源引用返回原路径。继续聊天只携带摘要和后续消息，不重新载入来源历史；来源被删除时，摘要仍可用并标记缺失来源。汇总使用当前配置的模型并产生相应费用，不自动写入知识库。

### 3.3 搜索和返回历史工作

- 使用 `Ctrl+Shift+F` 搜索所有 Chat；使用 `Ctrl+F` 在当前对话中查找。
- 点击会话树节点可恢复对应分支；Rhyza 会定位到相关 Turn。

### 3.4 使用 Knowledge

进入 **Knowledge**：

- **Entities**：查看稳定概念、别名、类型、摘要、来源和版本；可编辑或软删除。
- **Diagrams**：搜索并查看 Mermaid Diagram，以及与 Entity/Relation 的连接。
- **Rebuild relations**：当至少有两个 Entity 时，让当前模型重新评估关系并重连 Diagram。
- **History**：查看知识对象的变更记录。

知识提取默认应保持保守。看到 Proposed ChangeSet 时，检查来源和内容后再接受或拒绝。删除使用可恢复的软删除语义。

### 3.5 添加和搜索 Sources

进入 **Workspace → Sources → Add sources**，可选择一个或多个本地目录。点击 Sources 子区块标题行右侧的加号图标（悬停提示为 **Add sources**），空列表和已有资料源时位置一致。Source 可以位于 Workspace 内，也可以完全独立。

当前支持常见代码和文本格式：

```text
.c .cc .cpp .cs .css .go .h .html .java .js .json .jsx .kt
.md .mjs .py .rs .sh .sql .swift .toml .ts .tsx .txt .xml
.yaml .yml
```

扫描规则：

- 默认排除版本控制、依赖、构建与缓存目录：`.git`、`.hg`、`.svn`、`node_modules`、`dist`、`dist-electron`、`build`、`bin`、`obj`、`target`、`.next`、`.nuxt`、`.output`、`.cache`、`.turbo`、`.gradle`、`.venv`、`venv`、`__pycache__`、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`.tox`、`.nox`、`coverage`、`.nyc_output`；
- 排除 Rhyza 内部数据目录 `.rhyza-debug`、`.pi-graph`，包括嵌套目录中的同名目录；
- 遵循 Source 根目录与子目录中的 `.gitignore`，即使该资料目录不是 Git 仓库也生效；匹配的已跟踪文件同样排除。不读取 Source 之外的父级、用户级 Git ignore 或 `.git\info\exclude`；
- 支持 Source 根目录的 `.rhyzaignore`，使用 Git ignore 语法（通配符、目录、注释及 `!` 反向规则）。它优先于 `.gitignore`，但不能解除上述默认目录排除；不忽略整个隐藏目录集合，`.github`、`.agents` 等仍可索引；
- 跳过符号链接；
- 单文件上限 2 MB；
- 每个 Source 最多记录 50,000 个文本文件。

`indexed` 仅表示文件清单建立完成，不会解析 PDF、Word、图片等非支持格式。Pi 路径提供 `search_sources` 和 `read_source`；Claude Code 使用请求前检索到的片段。当前没有 Embedding 或向量检索。

点击资料源行中的 **Indexing settings**，可多选 **Exclude directories**：勾选不需要索引的根级子目录，其余目录照常按默认规则扫描。默认目录及 ignore 文件已排除的目录会标记为 **Automatically excluded**，不能在此界面启用。**Additional exclusion rules** 可逐行填写路径或通配符，用于排除指定文件或更深层的目录；本界面只接受排除规则，不混入 Include 或 `!` 反向规则。

点击 **Save and reindex** 后立即重建清单、更新文件数并清空旧搜索结果。设置只用于当前资料源，保存在对应 Workspace 的 Source Catalog 中，不修改资料目录的文件，也不影响其他资料源。关闭或取消不保存草稿；保存失败保留草稿并显示错误。清空自定义排除项并保存，可恢复符合默认规则的文件。

例如，在资料目录根部添加 `.rhyzaignore`，可以排除该目录的临时资料：

```gitignore
scratch/
exports/
*.generated.json
```

修改 ignore 规则后点击该资料源的重新索引按钮。已有索引首次加载时也会按当前规则剔除忽略项并更新文件数，搜索与 Agent 读取使用同一过滤后的清单；解除忽略后需重新索引才能重新加入文件。Ignore 规则文件需为不超过 2 MB 的普通文件；读取失败、符号链接、非普通文件或超限会明确报错。

文件内容变化后，建议重新索引；与旧 revision 关联的知识来源可能显示为 stale。

点击资料源行中的 **Delete source** 会先弹出确认窗口，明确说明：只从当前 Workspace 移除资料源，**不会删除磁盘上的目录或文件**，已有对话和知识也会保留。确认后删除该资料源的注册、索引清单和排除配置，并停止将其用于资料源搜索和读取；其他 Workspace 的注册不受影响。取消不会改动任何数据，删除失败会显示错误并保留列表项。之后可重新添加同一目录，但会创建新的注册，原来的索引设置不会自动恢复。

### 3.6 查看代码和知识变更

进入 **Changes**：

- **Knowledge**：查看知识 ChangeSet 和审计记录；
- **Code**：查看当前 Session 绑定目录的 Git status 和 diff；
- **Export patch**：将当前 Session 的变更导出为 patch。

Git Workspace 中的可写 Session 会尝试创建独立 Worktree。创建失败时会回退到原 Workspace，因此执行高风险操作前应检查 Code 页首行显示的实际路径以及 `Isolated worktree`/`Workspace` 标记。

Copilot 的内置修改工具和 Claude Code 的可写工具仅在成功隔离后开放。Codex App Server 按请求的可写标记选择 `workspace-write` 或 `read-only`，不能把 Worktree 失败理解为所有 Provider 都会自动只读。Pi 扩展也有自己的执行能力；Worktree 不等于插件沙箱。

### 3.7 阅读长回答

宽屏下，Markdown 回答左侧靠近中间区域左边缘会显示 **In this answer** 目录，内容随当前聚焦的 Assistant 回答切换。点击目录可跳到对应标题，正在阅读的章节会高亮。空间变窄时正文会适度收窄以保留目录；达到正文最小宽度后目录自动隐藏。没有 Markdown 标题时不显示目录。Chats 列表和 Node view 分别记住拖动后的宽度；Node view 折叠再展开不会重置手动缩放。

点击回答标题旁的折叠按钮，可收起该标题下的正文和子章节，再次点击即可展开。目录仍保留折叠章节的条目，点击会展开所需的父章节；页面内查找也会展开匹配内容。折叠只隐藏内容，不卸载其中的交互式 HTML 预览。

## 4. 设置说明

### Appearance

- Light / Dark；
- Diagram 会跟随 App 主题。

### MCP servers

进入 **Settings → MCP servers → Add server**，选择 `stdio` 本地程序或 `Streamable HTTP` 端点。MCP 用于经 Pi 执行的 Copilot、Codex 和 Azure OpenAI 聊天；Claude Code 不使用这里的服务器。标题、路径汇总和知识提取不会因此获得 MCP 工具。

本地服务器填写一个可执行程序，参数填写 JSON 字符串数组，不把整条 shell 命令填入 Executable。相对 Working directory 从实际聊天目录（包括隔离 Worktree）解析。HTTP 只允许 HTTPS，或 loopback HTTP；不支持旧版 SSE。环境变量和 Header 使用 JSON 对象，可引用 `${ENVIRONMENT_VARIABLE}`；不支持 `!command` 获取凭据。已有字面量凭据显示为 `${RHYZA_STORED_SECRET}`，原样保存会保留原值；更改程序、参数、工作目录、URL 或 OAuth client 时，必须移除或重新输入隐藏凭据。

**Import MCP configuration** 接受带 `mcpServers` 的 JSON，每次选择一个服务器，检查表单后保存，不会直接启用整份导入文件。用户配置保存在 `~\.pi\agent\mcp.json`；项目配置保存在原 Workspace 的 `.pi\mcp.json`，不是生成的 Worktree。项目配置必须先经 **Trust project** 确认才会加载，同名项目服务器覆盖用户服务器。不要把凭据写进受版本控制的项目文件。**Revoke trust** 会断开项目连接并清除该 Workspace 的工具授权，保留聊天记录。

保存后查看连接状态；失败会显示错误，可用 **Reconnect** 重试。未提供 `Authorization` Header 的 HTTP 服务器可使用 **Sign in** 在浏览器完成 OAuth/PKCE，支持已注册 client、凭据持久化和刷新；**Cancel sign-in** 取消等待，**Sign out** 移除 OAuth 登录。OAuth 凭据由 Pi 在本地管理，不进入设置页。直接修改配置文件后，点击 **Refresh** 或发送下一轮聊天会重新加载配置，不热替换正在执行的请求。

在 **Tools & resources** 审核工具并保存：

| 设置 | 行为 |
| --- | --- |
| Blocked | 默认拒绝新工具；服务器的 read-only/destructive 标记只是提示，不能自动授权 |
| Approved read | 允许在只读聊天调用该精确工具；需自行确认其确实不会修改数据 |
| Approved write | 仅允许可写且成功隔离的聊天调用 |
| Discover on demand | 模型用 `tool_search` 查找并加载，不把全部工具声明放入每轮请求 |
| Always available | 小型、常用工具直接进入当前工具集 |
| Hidden | 不可调用；与 Blocked 的授权设置相互独立 |

授权按 Workspace、配置来源、服务器身份和原始工具名称保存，不支持通配授权。修改服务器身份会清空原授权，重新连接后需再次审核。按需加载的工具会随会话重启恢复；从历史回答创建分支时，只继承那个回答时的工具集，不继承父会话后来发现的工具。

展开 **Resources**，可列出资源或 URI templates，粘贴 `nextCursor` 继续下一页，再填写 URI 读取文本预览。预览最多 128 KiB（按 UTF-8 字节计算），超限明确报错；非文本资源没有文本预览。聊天中的资源工具需明确指定服务器。

本地 MCP 程序以当前 OS 账号运行，**不是沙箱**。授权为 read 不会强制约束服务器实际行为；Worktree 也不能隔离远程 API、数据库或其他外部副作用。只连接和授权已审核的服务器。此入口不启用 Codemode，也不直接加载 Pi 插件注册的 extension-only MCP 服务器；需把相同配置加入用户或项目配置后审核。

### Knowledge policy

- **Auto-extract Knowledge**：每轮完成后运行知识提取。
- **Suggest changes**：生成 Proposed ChangeSet；提取结果先以乐观方式显示，Accept 提交状态，Reject 恢复修改前内容。当前默认模式。
- **Automatic**：直接提交提取结果。
- **Hybrid**：当前行为与 Automatic 相同，细分策略尚未实现。
- **Read only**：可读取已有知识，但不自动写入。
- **Thinking level**：请求模型使用对应推理强度；不支持时由 Provider 降级或返回错误。
- **Concurrent questions**：全局并发上限为 1–10，同一 Conversation 仍按顺序执行。
- **Confidence threshold**：当前只保存 UI 设置，尚未用于 Finalizer 过滤。

### Accessibility

- Reduce motion；
- High contrast；
- Font scale（85%–135%）。

## 5. 本地数据

Windows 中的 `~` 表示当前用户目录，例如 `C:\Users\<username>`。

| 路径                                                   | 内容                                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `~\.pi-graph\settings.json`                            | 当前 Workspace Path 和最近使用的工作区历史             |
| `~\.pi-graph\workspaces.json`                          | Workspace Path 到状态文件的映射                        |
| `~\.pi-graph\workspaces\<hash>.json`                   | Session、Turn、Knowledge、设置和布局                   |
| `~\.pi-graph\sources\<hash>.json`                      | Source Catalog 和文件清单                              |
| `~\.pi-graph\worktrees\`                               | Rhyza 创建的 Git Worktree                              |
| `~\.pi-graph\provider-sessions\`                       | Provider 切换及上下文代次，不含登录凭据                |
| `~\.pi-graph\azure-openai.json`                         | Azure OpenAI 资源、deployment、订阅与 token 限制，不含凭据 |
| `~\.pi-graph\model-request-dumps\`                     | 请求快照，可能包含对话和检索到的代码，不应公开分享     |
| `~\.pi-graph\diagnostics\performance-YYYY-MM-DD.jsonl` | 结构化性能诊断                                         |
| `~\.pi\agent\auth.json`                                | Pi Provider 凭据                                       |
| `~\.pi\agent\settings.json`                            | Pi package 等共享配置                                  |
| `~\.pi\agent\mcp.json`                                 | 用户级 MCP 服务器配置，可能含字面量凭据                |
| `~\.pi\agent\mcp-auth.json`                            | SDK 管理的 MCP OAuth 凭据，不进入 Renderer             |
| `<Workspace>\.pi\mcp.json`                            | 项目 MCP 配置，必须显式信任                            |
| `~\.pi-graph\mcp\<hash>.json`                         | 按 Workspace 保存的项目信任及精确工具授权              |
| `~\.pi\agent\rhyza-sessions\`                          | Rhyza 的 Pi 会话记录                                   |
| `~\.pi\agent\models-store.json`                        | Pi 动态模型目录缓存                                    |
| `%USERPROFILE%\.codex`                                 | Codex Desktop/CLI 与 Rhyza 共享的 Codex 配置和登录状态 |

`.pi-graph` 和 `PiGraph` 是历史兼容的数据目录；代码和运行时接口统一使用 Rhyza 命名。不要手工移动兼容目录。

本地优先指状态存储方式。发起 AI 请求时，对话、图片和相关代码/文档片段会发送到所选 Provider。分享诊断信息前，应区分不含正文的性能统计与可能包含正文的请求快照。

## 6. 常见问题

### 端口 5175 被占用

```powershell
Get-NetTCPConnection -LocalPort 5175 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

确认 PID 属于旧的 Rhyza/Vite 进程后：

```powershell
Stop-Process -Id <OwningProcess>
```

Rhyza 使用 Electron single-instance lock。重复启动通常会聚焦现有窗口。

### Provider 已登录，但没有模型

先点击 **Refresh status** 并确认账号具备对应模型权限。GitHub Copilot 的组织账号可能受管理员策略限制。Claude Code 不提供此处的动态模型列表，可使用默认模型或填写支持的别名。

### ChatGPT Desktop 已登录，但 Codex 仍显示未连接

Rhyza 复用的是同一 Windows 用户下的 **Codex 登录状态**，不是普通聊天窗口的 Cookie。确认 Codex Desktop 或 Codex CLI 自身可用；Rhyza 会通过 App Server 的 `account/read` 检测共享状态，检测不到时才显示新的授权链接。

### 浏览器页面不能发送消息

浏览器中没有 Electron preload 和 IPC Bridge。使用 `npm run electron:dev`，不要只运行 `npm run dev`。

### Source 刚添加就显示 indexed

添加操作会等待目录扫描完成。小目录可能瞬间完成；`indexed` 不代表向量化。

### Electron 下载失败或很慢

确认 npm registry 和 Electron binary 下载地址可访问，并检查企业代理、防火墙或 VPN。依赖安装完成后无需安装全局 Electron。

### npm ci 报 E404，随后出现 SDK TS2307

先解决依赖下载失败，再启动应用。检查 `npm config get registry` 与代理设置；仓库的依赖 override 和 `.npmrc` 背景见[开发指南](development-guide.md#10-npm-代理源与依赖安装)。

### 重启后找不到会话

确认 **Workspace → Current workspace** 指向原来的绝对路径。不同 Workspace 使用独立状态文件，映射位于 `~/.pi-graph/workspaces.json`。

### 输入、粘贴或流式输出时卡顿

按[性能诊断](performance-diagnostics.md)复现并运行 `npm run diagnostics:analyze`，提供耗时摘要及复现步骤。

# Rhyza

> An AI-native workspace for connected knowledge work.
> Turn questions into working knowledge.

Rhyza 是一个本地优先的 Electron 桌面应用。它用树状会话保存不断分叉的问题路径，并把对话中值得复用的 Entity、Relation 和 Diagram 沉淀到 Workspace 级知识库中。

当前仓库是 mini hackathon MVP，主要面向 Windows 开发和验证。

## 当前能力

- 支持 GitHub Copilot（Pi SDK）、Codex（官方 TypeScript SDK）和 Claude Code（本机 CLI）。
- 从历史中间 Turn 继续，保留原路径和新分支，并生成分支标题。
- 为会话节点标记待处理、进行中、已完成或暂不处理。
- 将本地代码、文档和其他文本目录添加为 Sources，供 Agent 搜索和读取。
- 默认用 Mermaid 生成 Diagram；安装独立 Archify extension 后自动切换到交互式图表，保存 JSON 源与 Mermaid fallback。
- 保守提取稳定 Entity、Relation 和 Diagram，避免为每个术语创建知识对象。
- 在 Agent 回复中链接已有 Entity 和 Diagram，并在右侧面板显示详情。
- 查看、编辑、软删除和撤销知识变更。
- 为 Git Workspace 创建隔离 Worktree，并查看 Diff 或导出 patch。
- 按 Workspace Path 将会话、知识、Sources 和布局持久化到本地。

产品设计详见 [Rhyza Product Design v0.3](Rhyza_Product_Design_v0.3.docx)。

长期产品记忆、交互约束和 Diagram/UI 设计原则见 [Product memory and design principles](docs/product-memory-and-design-principles.md)。

## Provider 与安装要求

| 项目 | 是否需要 | 说明 |
| --- | --- | --- |
| Pi CLI | 不需要 | Pi SDK 已作为 npm 依赖包含在项目中。 |
| GitHub Copilot CLI | 不需要 | Rhyza 直接通过 Pi SDK 的 `github-copilot` Provider 登录。 |
| VS Code Copilot 扩展 | 不需要 | VS Code 的登录状态不保证能被 Rhyza 复用。 |
| GitHub Copilot 权限 | 需要 | 登录的 GitHub 账号必须具有可用的 Copilot 订阅或组织授权。 |
| Codex Desktop 或 Codex CLI | 选择 Codex 时需要 | Rhyza 通过官方 `codex app-server` 读取同一 Windows 用户的 Codex/ChatGPT 登录状态，并由 App Server 管理 Token 刷新。 |
| Claude Code CLI | 选择 Claude Code 时需要 | 用户自行安装并完成 `claude auth login`；Rhyza 调用本机 `claude --print`，不读取或复制 Claude 凭据。 |
| Git | 建议安装 | 克隆仓库需要 Git；Worktree 隔离、Diff 和 patch 功能也依赖 Git。 |

Rhyza 默认使用 Pi 的凭据目录 `~/.pi/agent`：

- 如果之前通过 Pi 登录过 GitHub Copilot，`~/.pi/agent/auth.json` 中的凭据通常可以直接复用。
- Rhyza 的 **Settings → Pi Plugins** 会读取同一目录中的 `settings.json`，因此也会显示用户原来通过 Pi 配置的 packages。
- 如果只在 VS Code、GitHub CLI 或其他 Copilot 客户端中登录过，Rhyza 可能仍会显示未登录；请在 Rhyza 的 **Settings → AI Provider** 中重新执行一次 Sign In。
- 不需要在 `.env` 中填写 Copilot Token 或 API Key。
- 当前 UI 默认使用 `github.com`。GitHub Enterprise 自定义域名的输入界面尚未开放。

Codex 与 Claude Code 的账户、订阅/API 计费和使用限制由各自服务提供方管理。Rhyza 不自动安装全局 CLI、不执行全局退出登录，也不会将凭据传给 Renderer。

## 环境要求

- Windows 10/11。macOS 和 Linux 尚未完成验证。
- Node.js `22.12+`，推荐使用当前 Node.js 22 LTS；也支持 `20.19+`。
- npm，随 Node.js 安装。
- Git 2.x，Git Workspace 和 Worktree 功能需要。
- 能访问所选 Provider（GitHub Copilot、OpenAI 或 Anthropic）及 npm registry 的网络环境。
- 本适配器使用 Claude Code 的 Bash 命令工具；Windows 上的可写工作流需要 Git for Windows 提供的 Git Bash，必要时设置 `CLAUDE_CODE_GIT_BASH_PATH`。

检查版本：

```powershell
node --version
npm --version
git --version
```

## 从源码安装

```powershell
git clone git@github.com:wyunchi-ms/Rhyza.git
cd Rhyza
npm ci
```

`npm ci` 会安装 React、Electron、Pi SDK、Codex SDK 及其对应平台 binary、Mermaid 等依赖。Claude Code 需单独安装。Archify 是可选扩展，不再随主程序自动加载或打包；本地构建和安装方式见下方 Diagram 模式。首次安装 Electron 时需要下载 Electron binary，耗时取决于网络环境。

如果使用 HTTPS：

```powershell
git clone https://github.com/wyunchi-ms/Rhyza.git
```

## 开发启动

运行完整桌面应用：

```powershell
npm run electron:dev
```

该命令会依次：

1. 编译 Electron Main Process 和 preload。
2. 在 `127.0.0.1:5174` 启动 Vite。
3. 等待 Vite 可访问后启动 Electron。
4. 让 Electron 加载 Vite 开发页面。

不要使用 `npm run dev` 测试真实聊天。它只启动浏览器中的 Renderer 页面；Provider、文件系统、Pi Agent 和本地持久化依赖 Electron IPC，浏览器中会显示 `Chat requires the Electron desktop runtime.`。

### 端口 5174 被占用

开发服务器使用固定端口和 `strictPort`。如果看到 `Port 5174 is already in use`，先关闭之前运行的 Rhyza/Vite 进程，再重新启动。

PowerShell 中可以定位占用进程：

```powershell
Get-NetTCPConnection -LocalPort 5174 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

确认 PID 属于旧的开发进程后再结束它：

```powershell
Stop-Process -Id <OwningProcess>
```

Rhyza 同时启用了 Electron single-instance lock。重复运行时，新进程会尝试聚焦现有窗口，而不是再打开一个完整实例。

## 构建并本地运行

```powershell
npm run build
npm run electron:start
```

`npm run build` 生成：

- `dist/`：Vite Renderer 产物。
- `dist-electron/`：Electron Main Process 和 preload 产物。

`electron:start` 依赖已经存在的 `dist/`，因此第一次运行前必须先执行 `npm run build`。仓库目前没有安装包制作或签名脚本。

## 首次配置

### 1. 选择 Workspace

进入 **Settings → Workspace → Choose Folder**，选择 Agent 当前工作的本地目录。

Workspace 有两个作用：

- 它是 Pi Agent 默认执行工具、读取和修改文件的当前目录。
- 它的规范化绝对路径是本地状态的隔离键。切换 Workspace 会加载另一套 Session、Knowledge、Sources 和布局。

对于 Git Workspace，可写 Session 会自动尝试使用独立 Worktree。非 Git 目录仍可聊天和读取文件，但不会获得 Git Worktree 隔离，Changes 页也无法提供正常的 Git Diff。

### 2. 选择并配置 AI Provider

进入 **Settings → AI Provider**，选择 Provider。切换 Provider 会清空旧模型选择，避免将一个 Provider 的模型 ID 发给另一个 Provider。聊天、分支标题、知识提取和关系重建均使用所选 Provider。

**GitHub Copilot**

1. 选择 **GitHub Copilot**，点击 **Sign In**。
2. 根据提示复制 Device Code。
3. 点击 **Open sign-in**，在系统浏览器中完成 GitHub 授权。
4. 返回 Rhyza，等待状态变为已配置。
5. 在 **Default Model** 中选择模型，或保留 Provider 默认值。

凭据由 Pi SDK 保存到 `~/.pi/agent/auth.json`，不会发送给 Renderer，也不应提交到 Git。

**Codex**

选择 **Codex** 并点击 **Sign In**。Rhyza 会先通过官方 [Codex App Server](https://developers.openai.com/codex/app-server/) 检查同一 Windows 用户下由 ChatGPT Desktop 或 Codex CLI 保存的 Codex 登录；检测到账号时直接复用，未检测到时才打开新的浏览器授权。Token 的存储和刷新由 Codex 负责，Rhyza 不读取 ChatGPT Cookie，也不复制原始 Token。登录完成后会加载该账号实际可用的模型目录。

**Claude Code**

按照 [Claude Code 安装文档](https://code.claude.com/docs/en/setup) 安装当前版本，然后运行：

```powershell
claude auth login
claude auth status
```

重启 Rhyza，选择 **Claude Code** 并点击 **Check connection**。应用直接运行本机 `claude --print` 的结构化流式接口，登录仍由该 CLI 管理；不导出订阅 OAuth 凭据供其他 SDK 使用。这与官方 Agent SDK 的第三方应用登录限制不同，遵循 [未修改 Claude Code binary 的使用条款](https://code.claude.com/docs/en/legal-and-compliance)。默认模型由 Claude Code 决定，也可输入 CLI 支持的别名或完整模型 ID，例如 `sonnet`、`opus`。

如果安装目录不在 `PATH`，可在启动应用前将 `RHYZA_CLAUDE_PATH` 设置为可执行文件的绝对路径。Windows 原生安装的 `~\.local\bin\claude.exe` 和 npm 全局安装的 CLI 都可识别。安装版本必须支持 `auth status --json`、`--input-format stream-json`、`--include-partial-messages`、`--permission-mode dontAsk` 和 `--effort`。

**Provider 行为差异**

- Codex / Claude Code 的每次请求从当前分支的可见文本与图片历史构建独立运行；切换 Provider、分叉和重启不会复用其他分支的隐藏会话。返回 Copilot 时会重建相应的 Pi 上下文。原生 CLI 的工具历史不跨请求重放。
- 两者支持流式回复、工具状态、知识上下文、标题和知识提取、HTML Preview、TODO、Worktree Diff 与 patch。Sources 会在请求前搜索并读取相关片段；Pi 的 `search_sources` / `read_source` 自定义工具和 Pi 插件不会加载到这两个 Provider，用户配置的 MCP 工具也不加载。
- 只有成功建立隔离 Git Worktree 的可写会话才开放修改/命令工具；其他目录保持只读。Codex 使用 `read-only` / `workspace-write` sandbox 和 `never` approval。Claude Code 使用明确的工具白名单和 `dontAsk`，不使用 bypass-permissions；只读会话不开放 Bash。**Claude Code 的 Worktree 隔离不是操作系统沙箱，可写会话中的 Bash 仍以当前用户权限执行，只应在可信项目中使用。**
- 默认模型和自定义模型交给所选 Provider 校验；不伪造固定模型目录。Thinking level 使用原生支持的 effort，`off` 在 Codex 映射为 `minimal`，在 Claude Code 映射为 `low`，不保证关闭原生推理。Claude Code 不接受 BMP 图片，请改用 PNG、JPEG、GIF 或 WebP。
- Codex / Claude Code 的请求面板保存的是 **Agent 输入快照与整轮用量**，不是 SDK/CLI 内部每次模型调用的原始 HTTP payload。不可用的缓存 TTL 和上下文窗口不会被估算；Codex 未报告的费用记为 0，不代表服务免费。
- Check connection 仅检查本地登录配置，实际模型权限、额度和网络错误会在请求中显示。要退出账号，请自行运行对应 CLI 的 logout 命令；Rhyza 不修改其他应用共享的登录状态。

### 3. 管理 Pi 插件

进入 **Settings → Pi Plugins** 可以查看、安装和移除 Pi packages。这些插件仅作用于 GitHub Copilot / Pi Provider，不会加载到 Codex 或 Claude Code。支持 `npm:`、`git:`、HTTPS/SSH Git URL 和本地绝对路径；操作直接使用内置 Pi SDK，不要求预先安装 Pi CLI。npm 或 Git 来源仍需要本机具备相应的 Node.js/npm 或 Git 环境。

Pi 会将本地插件来源保存为相对于 Agent 配置目录的路径，例如 `..\extensions\pi-archify`。这些已配置的来源可以直接点击 **Remove** 移除，即使目录已经不存在；移除本地插件只取消配置，不删除源文件。

Pi packages 中的扩展会以当前用户权限执行代码，skills 也会影响 Agent 行为，因此只应安装经过审查和信任的来源。安装或移除后，Rhyza 会重建当前 Agent 会话，使下一条消息使用新的插件集合。

### 4. 配置知识策略

进入 **Settings → Knowledge policy**：

- **Auto-extract Knowledge**：每轮回答完成后运行知识提取。
- **Suggest changes**：生成 Proposed ChangeSet。MVP 会先以乐观方式显示提取对象；Accept 提交状态，Reject 根据 ChangeSet 恢复修改前内容。当前默认模式。
- **Automatic**：直接提交提取结果。
- **Hybrid**：当前 MVP 与 Automatic 一样直接提交；按来源和置信度拆分自动/确认策略尚未实现。
- **Read only**：Agent 可以读取已有知识，但不会自动写入。
- **Thinking level**：控制模型推理强度；模型不支持某档位时可能由 Provider 降级或报错。
- **Confidence threshold**：当前只保存 UI 配置，尚未接入 Finalizer 的过滤逻辑。

### 5. 使用 Archify 图表扩展

Archify 是可选的 Pi 插件，独立提供绘图工具、skill、校验器和 HTML 渲染逻辑。宿主通过通用的 `html-preview` 协议展示结果，不需要专用渲染器注册或扩展构建步骤。安装和开发说明见 [Archify Pi extension](extensions/pi-archify/README.md)。

本地安装 Archify：

1. 打开 **Settings → Pi Plugins → Install from local folder…**，选择项目中的 `extensions\pi-archify` 目录；也可在 Package source 中输入它的绝对路径再点 Install。
2. 下一条消息使用扩展提供的绘图工具，生成可交互的 HTML 图表。

本地安装引用原目录，不复制或删除源文件，请保留该目录。扩展包可整体复制到其他位置再安装，无需另行安装 Archify 依赖。已有 HTML 图表以快照保存，卸载扩展后仍可查看。本地扩展代码修改后请重启应用；从旧目录迁移后，请移除旧配置并安装新目录。

### 6. 添加 Sources

进入 **Sources → Add sources**，可一次选择一个或多个本地目录。Source 可以位于 Workspace 内，也可以是完全独立的目录。

当前索引支持常见代码和文本格式，包括：

```text
.c .cc .cpp .cs .css .go .h .html .java .js .json .jsx .kt
.md .mjs .py .rs .sh .sql .swift .toml .ts .tsx .txt .xml
.yaml .yml
```

以下目录会被忽略：`.git`、`node_modules`、`dist`、`build`、`bin`、`obj`、`.next` 和 `.cache`。单个文件最大读取 2 MB，每个 Source 最多记录 50,000 个文本文件。

`indexed` 的含义是：目录扫描成功，支持的文本文件清单已经建立。它目前不表示生成了 Embedding 或向量索引。Agent 通过两个确定性工具使用这些内容：

- `search_sources`：在已索引 Source 的路径和文本行中查找命中。
- `read_source`：按 Source ID、相对路径和行范围读取受限片段。

刷新 Source 会重新扫描，但保持列表顺序不变。

## 本地数据和配置位置

Windows 中的 `~` 指当前用户目录，例如 `C:\Users\<username>`。

| 路径 | 内容 |
| --- | --- |
| `~/.pi-graph/workspaces.json` | Workspace Path 到状态文件的映射。 |
| `~/.pi-graph/workspaces/<hash>.json` | Session、Turn、Entity、Relation、Diagram、ChangeSet、设置和布局。 |
| `~/.pi-graph/sources/<hash>.json` | 对应 Workspace 的 Source Catalog 和文件清单。 |
| `~/.pi-graph/worktrees/` | Rhyza 创建的 Git Worktree。 |
| `~/.pi-graph/provider-sessions/` | Provider 切换和 Copilot 上下文代次，不包含登录凭据。 |
| `~/.pi-graph/model-request-dumps/` | 本地请求快照，可能包含对话和检索到的代码；不要公开分享。 |
| `~/.pi-graph/diagnostics/performance-YYYY-MM-DD.jsonl` | UI、主进程操作和 Archify 分阶段结构化诊断日志。 |
| `~/.pi/agent/auth.json` | Pi Provider 凭据，包括 GitHub Copilot OAuth Token。 |
| `~/.pi/agent/models-store.json` | Pi 动态模型目录缓存。 |
| `$CODEX_HOME/sessions/`（默认 `~/.codex/sessions/`） | Codex runtime 自己保存的原生运行记录；Rhyza 不将其作为分支历史重放。 |

`.pi-graph`、`PiGraph` 用户数据目录和代码中的 `knowbranch` 是当前为了兼容旧数据而保留的内部名称。应用及 npm 包名称已改为 Rhyza；不要仅为改名手工移动这些兼容目录，否则可能造成 Workspace 映射和状态文件不一致。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run electron:dev` | 启动 Vite 和 Electron 开发环境。 |
| `npm run dev` | 只启动 Renderer；不能运行真实 Agent。 |
| `npm run electron:compile` | 编译 Electron Main Process 和 preload。 |
| `npm run build` | 类型检查、构建 Renderer，并编译 Electron。 |
| `npm run electron:start` | 使用已有 `dist/` 启动生产模式 Electron。 |
| `npm run typecheck` | 运行 TypeScript 类型检查。 |
| `npm run smoke:ipc` | 验证 IPC payload 和安全边界。 |
| `npm run smoke:mvp` | 验证核心知识与分支状态逻辑。 |
| `npm run smoke:state-store` | 验证 Workspace 状态隔离、迁移和防串档逻辑。 |
| `npm run smoke:archify` | 用官方示例验证 Archify showcase 交付和 Mermaid fallback。 |
| `npm run diagnostics:analyze` | 汇总 UI 卡顿热力图、慢操作和最近的 Archify 渲染/降级阶段。 |
| `npm run electron:smoke` | 构建并运行 Electron 端到端烟雾检查。 |

提交前建议运行：

```powershell
npm run typecheck
npm run smoke:ipc
npm run smoke:mvp
npm run smoke:state-store
npm run electron:smoke
```

Archify 日志默认写入上述 JSONL，只包含源内容哈希、大小、图类型、拓扑数量、耗时、CLI 退出码和诊断码，不保存完整 Diagram JSON 或生成的 HTML。需要在开发终端实时查看时，先设置 `RHYZA_ARCHIFY_DEBUG=1` 再启动 Electron。

## 目录结构

```text
src/                    React Renderer、页面、组件和 Zustand Store
src/shared/             Main/Renderer 共用 IPC 类型与校验
electron/main/          Electron Main、Pi SDK、Sources、持久化和 Worktree
electron/preload.*      contextBridge 白名单 API
resources/skills/archify/ 构建可选扩展所需的 Archify 上游资源
src/extensions/archify/  独立扩展的提示词和渲染逻辑
dist-extensions/archify/ 可从本地安装的生成扩展包
scripts/                Smoke tests 和迁移工具
demo-video/             Hackathon Demo 脚本、素材和成片
```

## 常见问题

### 本地 Copilot 已登录，为什么 Rhyza 仍显示未登录？

不同客户端可能使用不同凭据存储。Rhyza 只会自动读取 Pi 的 `~/.pi/agent/auth.json`。请在 Rhyza Settings 中执行 Sign In；不需要先安装 Copilot CLI。

### 登录完成后没有模型

确认账号具有 Copilot 权限，然后退出并重新登录或重启应用。部分组织需要管理员允许对应模型；如果某模型不可用，请先在组织策略或 Copilot 支持的客户端中启用它。

### 重启后看不到之前的数据

先确认 Settings 中选择的是同一个 Workspace 绝对路径。Rhyza 按规范化 Workspace Path 隔离状态；不同目录会加载不同的 state file。映射可以在 `~/.pi-graph/workspaces.json` 中检查。

### Source 为什么刚添加就显示 indexed？

添加操作会等待本地目录扫描完成后返回；目录较小时可能很快完成。`indexed` 只表示受支持文本文件的清单已建立，不代表向量化、Embedding 或语义索引已经完成。

### 为什么浏览器页面不能发送消息？

浏览器没有 Electron preload 和 IPC Bridge。请使用 `npm run electron:dev`，不要只使用 `npm run dev`。

### Electron binary 下载失败或很慢

确认 npm registry 和 Electron 下载地址可访问，并检查企业代理、防火墙或 VPN 配置。依赖安装完成后无需单独安装全局 Electron。

## 第三方许可

可选 Archify 扩展使用的 runtime 来自 [tt-a1i/archify](https://github.com/tt-a1i/archify)，使用 MIT License。完整版权说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `resources/skills/archify/LICENSE`。

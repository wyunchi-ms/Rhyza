# Rhyza 使用指南

本指南面向从源码运行当前 Windows MVP 的用户。功能范围和已知限制请同时参考 [Feature 文档](features.md)。

[项目首页](../README.md) · [文档导航](README.md) · [开发指南](development-guide.md)

第一次使用按“安装 → 选目录 → 连 Provider → 发起对话”完成配置即可。Pi 插件和知识策略可以稍后调整。

## 1. 安装与启动

### 环境要求

- Windows 10/11
- Node.js `22.12+`；也支持 `20.19+`
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

进入 **Settings → Workspace → Choose Folder**，选择 Agent 要工作的目录。

Workspace 同时决定：

- Agent 默认读取和修改文件的位置；
- Session、Knowledge、Sources、设置和布局使用哪一份本地状态；
- Git Session 是否可以创建隔离 Worktree；
- **Changes** 页面读取哪一个 Session 的 Diff。

切换 Workspace 会加载另一套状态。若重启后数据“消失”，先确认选择了同一个绝对路径。

### 2.2 连接 AI Provider

进入 **Settings → AI Provider**：

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

左侧 Chats 显示会话树和 Token 用量。使用 **Node view** 可切换到图形化节点视图。节点支持重命名、删除、折叠和状态管理；运行中的节点会显示真实活动状态。

<!-- GIF TODO: docs/images/branch-and-resume.gif，脚本见 images/README.md。 -->

### 3.3 搜索和返回历史工作

- 使用左侧搜索按钮或 `Ctrl+Shift+F` 搜索所有 Chat。
- 在当前对话中使用页面内查找定位 Turn。
- 点击会话树节点可恢复对应分支；Rhyza 会定位到相关 Turn。

### 3.4 使用 Knowledge

进入 **Knowledge**：

- **Entities**：查看稳定概念、别名、类型、摘要、来源和版本；可编辑或软删除。
- **Diagrams**：搜索并查看 Mermaid Diagram，以及与 Entity/Relation 的连接。
- **Rebuild relations**：当至少有两个 Entity 时，让当前模型重新评估关系并重连 Diagram。
- **History**：查看知识对象的变更记录。

知识提取默认应保持保守。看到 Proposed ChangeSet 时，检查来源和内容后再接受或拒绝。删除使用可恢复的软删除语义。

### 3.5 添加和搜索 Sources

进入 **Sources → Add sources**，可选择一个或多个本地目录。Source 可以位于 Workspace 内，也可以完全独立。

当前支持常见代码和文本格式：

```text
.c .cc .cpp .cs .css .go .h .html .java .js .json .jsx .kt
.md .mjs .py .rs .sh .sql .swift .toml .ts .tsx .txt .xml
.yaml .yml
```

扫描规则：

- 忽略 `.git`、`node_modules`、`dist`、`build`、`bin`、`obj`、`.next`、`.cache`；
- 跳过符号链接；
- 单文件上限 2 MB；
- 每个 Source 最多记录 50,000 个文本文件。

`indexed` 仅表示文件清单建立完成。Pi 路径提供 `search_sources` 和 `read_source`；Claude Code 使用请求前检索到的片段。当前没有 Embedding 或向量检索。

Source 可重新扫描或归档。文件内容变化后，建议 Reindex；与旧 revision 关联的知识来源可能显示为 stale。

### 3.6 查看代码和知识变更

进入 **Changes**：

- **Knowledge**：查看知识 ChangeSet 和审计记录；
- **Code**：查看当前 Session 绑定目录的 Git status 和 diff；
- **Export patch**：将当前 Session 的变更导出为 patch。

Git Workspace 中的可写 Session 会尝试创建独立 Worktree。创建失败时会回退到原 Workspace，因此执行高风险操作前应检查 Code 页首行显示的实际路径以及 `Isolated worktree`/`Workspace` 标记。

Copilot 的内置修改工具和 Claude Code 的可写工具仅在成功隔离后开放。Codex App Server 按请求的可写标记选择 `workspace-write` 或 `read-only`，不能把 Worktree 失败理解为所有 Provider 都会自动只读。Pi 扩展也有自己的执行能力；Worktree 不等于插件沙箱。

## 4. 设置说明

### Appearance

- Light / Dark；
- Diagram 会跟随 App 主题。

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

确认 **Settings → Workspace** 指向原来的绝对路径。不同 Workspace 使用独立状态文件，映射位于 `~/.pi-graph/workspaces.json`。

### 输入、粘贴或流式输出时卡顿

按[性能诊断](performance-diagnostics.md)复现并运行 `npm run diagnostics:analyze`，提供耗时摘要及复现步骤。

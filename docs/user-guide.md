# Rhyza 使用指南

本指南面向从源码运行当前 Windows MVP 的用户。功能范围和已知限制请同时参考 [Feature 文档](features.md)。

## 1. 安装与启动

### 环境要求

- Windows 10/11
- Node.js `22.12+`，推荐 Node.js 22 LTS；也支持 `20.19+`
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

1. 在 Codex、Claude Code 或 GitHub Copilot 旁点击 **Connect**。
2. Codex 会先检测当前 Windows 用户的 Codex Desktop/CLI 登录；已有登录时直接复用，否则显示浏览器授权链接。GitHub Copilot 会显示 Device Code。
3. 等待 Provider 显示为 Connected。
4. 在 **Default Provider** 中选择新消息默认使用的 Provider。
5. 在 **Default Model** 中选择模型，或保留 Provider 默认值。

三个 Provider 可以同时保持连接。Codex 通过官方 `codex app-server` 使用 `%USERPROFILE%\.codex`，Token 的读取和刷新都由 Codex 负责，Rhyza 不复制 ChatGPT Desktop Cookie 或原始 Token。Claude Code 和 GitHub Copilot 继续通过 Pi SDK 使用 `~/.pi/agent/auth.json`。

使用 Codex Provider 时需要本机已有 Codex Desktop 或 Codex CLI；Pi CLI、Claude Code CLI 和 GitHub Copilot CLI 不是前置依赖。普通 ChatGPT 聊天登录不一定包含 Codex 授权，Rhyza 的 Connect 会在共享状态不可用时提供新的授权链接。

### 2.3 可选：安装 Pi 插件

进入 **Settings → Pi Plugins**。支持：

- `npm:` package；
- `git:` package；
- HTTPS/SSH Git URL；
- 本地绝对路径；
- **Install from local folder…** 目录选择器。

Pi package 以当前用户权限执行代码，Skill 也会影响 Agent 行为，只安装已审查和信任的来源。安装或移除后，Rhyza 会重建 Agent Session，下一条消息使用新的插件集合。

如需交互式图表，可安装仓库中的 `extensions\pi-archify`，详情见 [Archify extension](../extensions/pi-archify/README.md)。

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

`indexed` 仅表示文件清单建立完成。Agent 使用 `search_sources` 进行文本命中检索，并通过 `read_source` 读取受限片段；当前没有 Embedding 或向量检索。

Source 可重新扫描或归档。文件内容变化后，建议 Reindex；与旧 revision 关联的知识来源可能显示为 stale。

### 3.6 查看代码和知识变更

进入 **Changes**：

- **Knowledge**：查看知识 ChangeSet 和审计记录；
- **Code**：查看当前 Session 绑定目录的 Git status 和 diff；
- **Export patch**：将当前 Session 的变更导出为 patch。

Git Workspace 中的可写 Session 会尝试创建独立 Worktree。创建失败时会回退到原 Workspace，因此执行高风险操作前应检查 Code 页首行显示的实际路径以及 `Isolated worktree`/`Workspace` 标记。

## 4. 设置说明

### Appearance

- Light / Dark；
- Diagram 会跟随 App 主题。

### Knowledge policy

- **Auto-extract Knowledge**：每轮完成后运行知识提取。
- **Suggest changes**：生成 Proposed ChangeSet；当前默认模式。
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

| 路径 | 内容 |
| --- | --- |
| `~\.pi-graph\workspaces.json` | Workspace Path 到状态文件的映射 |
| `~\.pi-graph\workspaces\<hash>.json` | Session、Turn、Knowledge、设置和布局 |
| `~\.pi-graph\sources\<hash>.json` | Source Catalog 和文件清单 |
| `~\.pi-graph\worktrees\` | Rhyza 创建的 Git Worktree |
| `~\.pi-graph\diagnostics\performance-YYYY-MM-DD.jsonl` | 结构化性能诊断 |
| `~\.pi\agent\auth.json` | Pi Provider 凭据 |
| `~\.pi\agent\models-store.json` | Pi 动态模型目录缓存 |
| `%USERPROFILE%\.codex` | Codex Desktop/CLI 与 Rhyza 共享的 Codex 配置和登录状态 |

`.pi-graph`、`PiGraph` 用户数据目录和代码中的 `knowbranch` 是兼容旧数据的内部名称。不要仅为改名手工移动这些目录。

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

确认账号具备对应订阅和模型权限，再 Sign Out/Connect 或重启应用。GitHub Copilot 的组织账号还可能受管理员模型策略限制。

### ChatGPT Desktop 已登录，但 Codex 仍显示未连接

Rhyza 复用的是同一 Windows 用户下的 **Codex 登录状态**，不是普通聊天窗口的 Cookie。确认 Codex Desktop 或 Codex CLI 自身可用；Rhyza 会通过 App Server 的 `account/read` 检测共享状态，检测不到时才显示新的授权链接。

### 浏览器页面不能发送消息

浏览器中没有 Electron preload 和 IPC Bridge。使用 `npm run electron:dev`，不要只运行 `npm run dev`。

### Source 刚添加就显示 indexed

添加操作会等待目录扫描完成。小目录可能瞬间完成；`indexed` 不代表向量化。

### Electron 下载失败或很慢

确认 npm registry 和 Electron binary 下载地址可访问，并检查企业代理、防火墙或 VPN。依赖安装完成后无需安装全局 Electron。

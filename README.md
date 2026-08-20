# Rhyza

> An AI-native workspace for connected knowledge work.

Rhyza 是一个本地优先的 Tauri 桌面应用。React UI 运行在系统 WebView 中；Node sidecar 运行 Pi Agent、Workspace、Sources 和本地状态服务。对话可从历史节点分叉，并将可复用的 Entity、Relation 与 Mermaid Diagram 沉淀到 Workspace 级知识库。

## 当前能力

- 基于 Pi SDK 运行 Agent，通过 GitHub Copilot OAuth/Device Flow 登录。
- 从历史 Turn 继续并保留原路径，支持为分支生成标题。
- 为节点标记待处理、进行中、已完成或已中断状态。
- 添加本地代码、文档等目录作为 Sources，供 Agent 搜索和读取。
- 提取、编辑、归档和恢复 Entity、Relation 与 Mermaid Diagram。
- 为 Git Workspace 创建隔离 Worktree，并查看 Diff 或导出 patch。
- 按 Workspace 路径隔离保存会话、知识、Sources 和布局。

## 环境要求

- Windows 10/11（macOS 与 Linux 打包需要在对应平台或 CI runner 构建）。
- Node.js 22 LTS 或更高版本。
- Rust stable MSVC toolchain。
- Visual Studio Build Tools，并勾选“使用 C++ 的桌面开发”。
- Microsoft Edge WebView2 Runtime（Windows 10/11 通常已自带）。
- Git 2.x，用于 Worktree、Diff 和 patch 功能。

## 从源码运行

```powershell
git clone https://github.com/wyunchi-ms/Rhyza.git
cd Rhyza
git switch codex/tauri-node-sidecar
npm ci
npm run tauri:dev
```

`tauri:dev` 会编译 Node sidecar、启动 Vite，并打开 Tauri 原生窗口。不要只运行 `npm run dev`；浏览器页面没有桌面 bridge，不能调用 Pi Agent 或本地文件系统。

如果 Node 不在 PATH，可在同一个 PowerShell 会话中指定：

```powershell
$env:RHYZA_NODE_BINARY = (Get-Command node).Source
npm run tauri:dev
```

## Windows 打包

```powershell
npm run tauri:build:windows
```

生成的 NSIS 安装程序在：

```text
src-tauri\target\release\bundle\nsis\
```

当前原型的安装包用于验证 Tauri 打包流程，仍要求运行环境提供 Node.js。正式分发前需要将 Node sidecar 封装为每个平台的独立二进制并通过 Tauri `externalBin` 一起分发。

## 首次配置

1. 打开 **Settings → Workspace → Choose Folder**，选择 Agent 工作目录。
2. 在 **Settings → AI Provider** 中点击 **Sign In**，完成 GitHub Copilot Device Flow。
3. 在 **Sources** 中添加代码或文档目录；Agent 可用 `search_sources` 与 `read_source` 检索它们。

Pi 凭据保存在 `~/.pi/agent/auth.json`，不会写入仓库。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run tauri:dev` | 启动完整 Tauri + Node sidecar 开发环境。 |
| `npm run tauri:build:windows` | 生成 Windows NSIS `.exe` 安装程序。 |
| `npm run build` | 进行前端类型检查并生成 Vite 前端资源。 |
| `npm run sidecar:compile` | 编译 Node sidecar 至 `dist-sidecar/`。 |
| `npm run typecheck` | 运行 TypeScript 类型检查。 |
| `npm run smoke:mvp` | 验证核心知识、Source 与分支状态逻辑。 |
| `npm run diagnostics:analyze` | 分析已有性能诊断日志。 |

产品设计详见 [Rhyza Product Design v0.3](Rhyza_Product_Design_v0.3.docx)。

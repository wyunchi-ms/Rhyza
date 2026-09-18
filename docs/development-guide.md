# Rhyza 开发指南

本指南说明当前 Electron MVP 的开发环境、架构边界、命令和验证方式。产品语义约束见 [产品记忆与设计原则](product-memory-and-design-principles.md)。

## 1. 技术栈

- Electron 44（Main Process + sandboxed Renderer）
- React 19、React Router、Zustand
- TypeScript 7
- Vite 8、Tailwind CSS 4
- Pi SDK (`@earendil-works/pi-*`)
- Mermaid、React Flow
- Node test runner + `tsx`

## 2. 本地环境

```powershell
git clone https://github.com/wyunchi-ms/Rhyza.git
cd Rhyza
npm ci
npm run electron:dev
```

推荐 Node.js 22 LTS。`npm ci` 会安装 Electron、Pi SDK 和前端依赖，并运行 `postinstall` 修补 Pi cache metadata。

开发服务固定使用 `127.0.0.1:5175` 和 `strictPort`。Main Process 会等待该地址可访问后加载 Renderer；Electron 使用 single-instance lock。

## 3. 架构

```text
React Renderer
  pages/components/hooks/store
          │
          │ window.knowbranch (contextBridge)
          ▼
Electron preload
          │ validated IPC payloads
          ▼
Electron Main
  ├─ PiService           Agent、Provider、模型、Session lineage
  ├─ CodexAppServer      官方 App Server 进程、共享认证与 Codex 流式响应
  ├─ PiPluginService     Pi package 安装与移除
  ├─ SourceService       本地文本扫描、搜索与受限读取
  ├─ AppStateStore       按 Workspace 持久化 Zustand state
  ├─ WorktreeService     Session Worktree、status、diff
  └─ HtmlPreviewService  HTML artifact 校验与快照
          │
          ├─ ~/.pi/agent
          ├─ %USERPROFILE%/.codex
          └─ ~/.pi-graph
```

### Renderer

`src/App.tsx` 使用 HashRouter，主页面包括：

- `/`：Workspace/Chat；
- `/knowledge`：Entity 和 Diagram；
- `/sources`：Source Catalog 与搜索；
- `/changes`：Knowledge/Code 变更；
- `/settings`：Provider、Plugin、Workspace、Knowledge policy 和无障碍设置。

Zustand Store 管理 Session、Turn、Knowledge、Settings 和布局。持久化适配器通过 preload 调用 Main，不应直接从 Renderer 使用 Node 文件系统。

### Preload 与 IPC

`electron/preload.cjs` 只通过 `contextBridge` 暴露白名单 API。共享 channel、请求/响应类型和运行时校验位于 `src/shared/ipc.ts`。

新增 IPC 时必须：

1. 在共享层声明 channel 和类型；
2. 为不可信 Renderer payload 提供校验函数；
3. 在 Main 注册 handler，并验证 sender；
4. 只在 preload 暴露最小 API；
5. 更新 IPC smoke/test。

### Pi Agent

`electron/main/pi-service.ts` 负责：

- Provider 登录/退出和模型目录；
- 前端 Session 到 Pi Session 的 lineage；
- 当前分支 Transcript 和 Knowledge context；
- Source 工具、图片输入、流式事件和 usage；
- HTML Preview artifact 收集；
- 可写 Session 的 Worktree 解析。

Claude Code、GitHub Copilot 的 credentials 和 package settings 使用 Pi 默认 Agent 目录 `~\.pi\agent`。Codex 由 `electron/main/codex-app-server.ts` 启动官方 `codex app-server`，通过 `account/read` 和 `model/list` 使用当前 Windows 用户的 `%USERPROFILE%\.codex`；Rhyza 不读取或导出原始 Token。不得把任何 Token 传入 Renderer、日志或仓库。

### Sources

`SourceService` 按 Workspace 保存 Catalog。索引是受限文本文件清单，不是向量数据库。搜索读取磁盘中的当前内容，并用共享 ranking 逻辑排序；`read_source` 只允许清单内相对路径和有限行范围。

### 状态持久化

`AppStateStore` 将 Zustand envelope 写入 `~\.pi-graph\workspaces\<hash>.json`：

- Workspace Path 先规范化，再作为隔离键；
- Windows 比较路径时不区分大小写；
- state 最大 50 MB；
- 覆盖前保存 `.backup`；
- 拒绝用空状态覆盖已有非空状态；
- Diagram 必须包含可持久化的 Mermaid source。

Source Catalog、Worktree 和 diagnostics 使用同一 `~\.pi-graph` 根目录下的独立子目录。

### HTML Preview

HTML Preview 是扩展无关协议。Main 校验 artifact 的真实路径、扩展名、大小和 Workspace 边界，保存 full/compact snapshot；Renderer 在 opaque-origin sandbox iframe 中展示，不向文档暴露 Electron bridge。完整契约见 [HTML Preview 协议](html-previews.md)。

## 4. 目录结构

```text
src/                         React Renderer
src/components/              Workspace、Chat、Tree、Diagram 等组件
src/pages/                   路由页面
src/hooks/                   IPC bridge、导航和事件流
src/store/                   Zustand state 与持久化
src/shared/                  Main/Renderer 共享类型、校验和纯逻辑
src/utils/                   Transcript、Knowledge、性能等纯逻辑
electron/main/               Electron Main services 与 IPC handlers
electron/preload.cjs         contextBridge 白名单
extensions/pi-archify/       可选 Archify Pi extension
resources/branding/          App icon
scripts/                     Smoke、诊断、迁移和格式化脚本
tests/                       Node/TypeScript tests
docs/                        用户、功能、开发和专题文档
demo-video/                  独立 HyperFrames 演示视频工程
```

`demo-video` 是独立子项目，修改前必须遵守其中的 `AGENTS.md` 和 `CLAUDE.md`。

## 5. 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run electron:dev` | 编译 Main/preload，并行启动 Vite 和 Electron |
| `npm run dev` | 只启动 Renderer；不能运行真实 Agent |
| `npm run electron:compile` | 编译 Electron Main，并复制 preload |
| `npm run build` | TypeScript、Vite 和 Electron 完整构建 |
| `npm run electron:start` | 重新编译 Main/preload，并加载已有 `dist` |
| `npm run typecheck` | Renderer TypeScript 类型检查 |
| `npm test` | 编译测试配置并运行 `tests/*.test.ts` |
| `npm run test:html-preview` | 运行 Chromium/DOM HTML Preview 回归 |
| `npm run smoke:ipc` | IPC payload 和边界 smoke |
| `npm run smoke:branch-usage` | 分支 usage 聚合 smoke |
| `npm run smoke:knowledge-reconciliation` | Knowledge reconciliation smoke |
| `npm run smoke:mvp` | 核心知识与分支逻辑 smoke |
| `npm run smoke:state-store` | Workspace 状态隔离与迁移 smoke |
| `npm run diagnostics:analyze` | 汇总结构化性能诊断 |
| `npm run electron:smoke` | 完整构建并运行 Electron smoke |
| `npm run format -- <paths>` | 用仓库固定 Prettier 格式化指定源文件 |
| `npm run format:check` | 检查当前修改/暂存/未跟踪源文件格式 |

`electron:start` 需要已有 Renderer `dist\index.html`。首次生产模式运行前先执行：

```powershell
npm run build
npm run electron:start
```

## 6. 验证策略

优先运行覆盖改动的最小命令，再执行更大范围验证。

常见改动：

```powershell
npm run typecheck
npm test
npm run smoke:ipc
```

状态与持久化：

```powershell
npm run smoke:state-store
npm run smoke:mvp
```

HTML Preview：

```powershell
node --import tsx --test tests\html-preview.test.ts
npm run test:html-preview
```

完整桌面路径：

```powershell
npm run electron:smoke
```

修改源文件后，按仓库约定先格式化显式路径，并在结束前运行：

```powershell
npm run format:check
```

纯 Markdown 修改不需要 TypeScript/build 验证；仍应检查链接、命令和 Markdown 格式。

## 7. 安全与可靠性边界

- BrowserWindow 启用 `contextIsolation`、禁用 `nodeIntegration`、启用 sandbox。
- Main 只接受来自主 Renderer 的 IPC，并校验 payload。
- 外部导航和新窗口默认拒绝；认证链接由受控 `openExternal` 打开。
- HTML Preview 必须位于实际 Session Workspace 内，且经过 realpath、类型和大小检查。
- Source read 不允许绝对路径、`..` 或未索引文件。
- 日志默认不保存完整用户文本、Diagram JSON、HTML、凭据或 Token。
- 不得把 Pi package 描述为沙箱插件；它可以当前用户权限执行代码。

## 8. 可观测性

结构化性能日志写入：

```text
~\.pi-graph\diagnostics\performance-YYYY-MM-DD.jsonl
```

分析：

```powershell
npm run diagnostics:analyze
```

需要在开发终端查看额外诊断时，设置对应显式 debug 环境变量后，在同一个 PowerShell 进程启动 Electron。不要在日志中添加完整 Prompt、凭据或生成 artifact。

## 9. 提交前检查

1. 行为与 [Feature 文档](features.md) 描述一致。
2. 产品语义没有违反 [设计原则](product-memory-and-design-principles.md)。
3. 新 IPC 有类型、校验、sender guard 和测试。
4. 新持久化字段有旧数据迁移/默认值。
5. Light/Dark、窄屏、异常和空状态均有明确行为。
6. 相关最小测试、`npm run format:check` 通过。

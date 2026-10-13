# 架构与数据流

[文档地图](README.md) · [开发流程](development.md) · [组件接口](component-api.md)

![Rhyza 运行时边界](diagrams/rhyza-runtime.png)

[图表规格](diagrams/rhyza-runtime.architecture.json)可用于在本地用 Archify 重新生成交互图。图中只展示主边界；完整服务及存储路径见[开发指南详解](development-guide.md#3-架构)。

## 模块职责

| 边界 | 入口 | 职责 |
| --- | --- | --- |
| Renderer | `src/App.tsx`、`src/pages/`、`src/store/` | HashRouter、页面、会话/知识 UI 和状态；不直接访问 Node 文件系统 |
| Preload | `electron/preload.cjs` | 向沙箱 Renderer 暴露白名单 `window.rhyza` |
| 共享契约 | `src/shared/ipc.ts` | IPC channel、参数类型和运行时校验 |
| Main | `electron/main/index.ts`、`backend-service.ts` | 窗口、系统对话框、浏览器授权、sender/payload 校验及异步 RPC 转发 |
| Backend Worker | `electron/main/backend-worker.ts` | 独立 Node worker thread；Agent/Pi/MCP、插件及技能加载、Source、Settings 和 AppState 服务 |
| 可选扩展 | `extensions/pi-archify/` | 独立 Pi package，通过通用 HTML Preview 协议交付图表 |

## 两条关键路径

**请求路径**：Renderer 经 `window.rhyza` 调用 preload 暴露的方法；Main 验证 payload 与 sender 后，经带请求 ID 的双向 RPC 交给 Backend Worker 的 AgentService/PiService 或其他服务执行，再转发事件和结果更新 Store。Provider 认证材料不进入 Renderer。SDK 扫描、extension 导入和初始化即使同步耗时，也只占用 Worker；MCP 等待不能阻塞窗口或输入。Worker 故障拒绝待处理请求，不回退到 Main 执行。

**持久化路径**：桌面 Store 经异步 IPC 传递结构化 state envelope，由 Worker 执行 JSON 序列化、解析、校验、旧数据恢复及 AppStateStore 文件读写；不使用同步加载 IPC。按规范化 Workspace 路径隔离状态，并保留保存去重、合并及路径 stamp 校验；浏览器预览仍使用 localStorage。当前目录与工作区历史由 Worker 的 SettingsStore 全局保存到 `~\.pi-graph\settings.json`，不放进某个 Workspace 的 state。Source Catalog、Worktree 和诊断文件使用独立的本地存储路径。读 Source 必须满足清单、相对路径及范围约束。

所有后台服务共享一个 Worker，以维持会话、MCP transport 与 Source 缓存的一致性。某个同步任务可能延后其他后台响应，但不占用 Main 的事件循环。退出时等待 Agent/MCP 清理及已接收的保存，超过 5 秒显式记录失败并终止 Worker。React 渲染、图布局和 IPC 结构化复制仍有前台成本；线程隔离不代表这些成本为零。

修改 IPC 时按[开发指南详解的核对清单](development-guide.md#preload-与-ipc)同步共享契约、preload、Main、调用方和测试；修改页面只改变 Renderer，不得绕过 bridge。

## MCP 边界

`PiService` 为主聊天显式加载 SDK MCP 与 Tool Search extensions；辅助标题、摘要和提取会话保留原工具边界。`McpService` 管理独立的设置会话和各聊天的连接、SDK OAuth 命令、连接事件与资源预览，不调用私有 SDK 模块。设置会话只加载宿主的两个 extensions，不加载项目或用户插件。

`McpConfigStore` 合并用户和显式信任的项目配置，按原 Workspace 保存信任与精确工具授权；聊天程序的相对 cwd 则解析到实际 Session Workspace / Worktree。服务器身份指纹约束授权与每次调用，write 工具额外要求可写、隔离成功。服务器 annotations 不授予权限；资源访问也检查当前服务器身份。未配置的 extension-only 服务器不连接，避免绕开宿主审核。

配置变更或信任撤销关闭相关 transport 并增加 Workspace revision。下一次聊天恢复原持久化 Pi Session，重新连接并恢复仍可见的工具；设置刷新和下一轮请求会检测外部配置文件修改。`rhyza.mcp-loadout` 按前端 Assistant turn 保存加载状态，新分支只复制选定父 turn 的快照。OAuth 凭据由 SDK 保存，Renderer 只收到状态、授权 URL 和隐藏了凭据的编辑草稿。MCP 程序及远程服务并非沙箱，Worktree 不隔离外部副作用。

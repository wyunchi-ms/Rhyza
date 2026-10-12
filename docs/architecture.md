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
| Main | `electron/main/` | 验证调用来源、路由 Provider、访问本地文件及持久化 |
| 可选扩展 | `extensions/pi-archify/` | 独立 Pi package，通过通用 HTML Preview 协议交付图表 |

## 两条关键路径

**请求路径**：Renderer 经 `window.rhyza` 调用 preload 暴露的方法；Main 验证 payload 与 sender 后，由 AgentService/PiService 或其他服务执行，再通过事件和结果更新 Store。Provider 认证材料不进入 Renderer。

**持久化路径**：Store 经 preload 请求 Main 的 AppStateStore；按规范化 Workspace 路径隔离状态。当前目录与工作区历史由 SettingsStore 全局保存到 `~\.pi-graph\settings.json`，不放进某个 Workspace 的 state。Source Catalog、Worktree 和诊断文件使用独立的本地存储路径。读 Source 必须满足清单、相对路径及范围约束。

修改 IPC 时按[开发指南详解的核对清单](development-guide.md#preload-与-ipc)同步共享契约、preload、Main、调用方和测试；修改页面只改变 Renderer，不得绕过 bridge。

## MCP 边界

`PiService` 为主聊天显式加载 SDK MCP 与 Tool Search extensions；辅助标题、摘要和提取会话保留原工具边界。`McpService` 管理独立的设置会话和各聊天的连接、SDK OAuth 命令、连接事件与资源预览，不调用私有 SDK 模块。设置会话只加载宿主的两个 extensions，不加载项目或用户插件。

`McpConfigStore` 合并用户和显式信任的项目配置，按原 Workspace 保存信任与精确工具授权；聊天程序的相对 cwd 则解析到实际 Session Workspace / Worktree。服务器身份指纹约束授权与每次调用，write 工具额外要求可写、隔离成功。服务器 annotations 不授予权限；资源访问也检查当前服务器身份。未配置的 extension-only 服务器不连接，避免绕开宿主审核。

配置变更或信任撤销关闭相关 transport 并增加 Workspace revision。下一次聊天恢复原持久化 Pi Session，重新连接并恢复仍可见的工具；设置刷新和下一轮请求会检测外部配置文件修改。`rhyza.mcp-loadout` 按前端 Assistant turn 保存加载状态，新分支只复制选定父 turn 的快照。OAuth 凭据由 SDK 保存，Renderer 只收到状态、授权 URL 和隐藏了凭据的编辑草稿。MCP 程序及远程服务并非沙箱，Worktree 不隔离外部副作用。

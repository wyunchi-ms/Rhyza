# 组件与接口契约

[文档地图](README.md) · [架构](architecture.md) · [开发与验证](development.md)

本页只记录需要跨组件或跨进程维护的契约，不复述组件实现，也不把内部 React props 当作对外稳定 API。

## 共享选择器

`src/components/Select.tsx` 保留原生 select 的受控值与 change 事件，实际交互入口为可被 label 关联的按钮。`className` 应用于按钮，`style` 应用于外层；带 `field` 的选择器通过 `src/components/overlays.css` 将外层设为全宽块级网格，并使用表单输入的字号与内边距。页面专用设置样式仍可覆盖尺寸；显式外层宽度（如历史筛选的 160px）保持有效，不带 `field` 的检查器选择器保持紧凑。标签样式不得把 `.ui-select` 当作说明文字，浮层与键盘契约不随表单布局改变。

## 设置页组件

`src/pages/Settings.tsx` 负责选择当前分区、Store 更新和 Provider 操作；工作区选择只在 `src/pages/Sources.tsx`。`src/pages/settings/SettingsNavigation.tsx` 负责返回入口、搜索框和分区按钮。`SettingsNavigation` 接收 `query`、`selectedSection`、`visibleCategories`，以及 `onQueryChange` / `onSelect` 回调。分类 ID 与分区标题的 `id` 必须一一对应；搜索只保留匹配分类，点击分类不修改 `HashRouter` 路由。右侧只显示当前分区，并在切换时回到内容顶部。

设置页整体在 `src/components/Layout.tsx` 中与工作区侧边栏互斥展示；布局和窄屏规则在 `src/pages/settings-page.css`。变更分类时同步维护分类定义、标题、搜索词、隐藏条件及 `tests/ui-refinement.test.cjs` 的交互检查。

## Renderer 与 Main

Renderer 只通过 `window.rhyza` 访问桌面能力。类型、channel 与参数校验的来源是 `src/shared/ipc.ts`，preload 白名单在 `electron/preload.cjs`；不能直接从页面导入 Main service。`src/hooks/useRhyzaBridge.ts` 封装运行时检测和 Provider 连接状态，Main 的 handler 必须验证 sender。

扩展生成的 HTML 不走私有 Renderer registry：经通用 [HTML Preview 协议](html-previews.md)校验路径和快照，再显示在沙箱 iframe。可选 Archify 扩展的 tool/schema 归其自身目录管理。

新增 bridge 方法的完整顺序和安全约束见[开发指南详解](development-guide.md#preload-与-ipc)；功能对用户的承诺以[功能矩阵](features.md)为准。

### 工作区状态与后台执行

`appStateLoad()` 必须 `await`；桌面返回已在 Backend Worker 解析的 `WorkspaceStateEnvelope | null`，不使用 `sendSync`。共享类型保留 JSON 字符串兼容旧测试/适配器，正常桌面加载不在 Renderer 解析 JSON。`appStateSave({ workspacePath, value })` 传递 `{ state, version?, workspacePath }` 的结构化 envelope，由 Worker 序列化后执行原有路径 stamp、大小及防空覆盖校验；字符串仅作为兼容输入。

Store 在异步 hydration 期间保留 richer-state 保护，等待过程中若 persistence scope 改变，拒绝旧 hydration 并跳过其待保存数据，不能覆盖新 Workspace。加载或保存错误明确记录；工作区选择等待状态加载成功后才关闭，失败保留选择窗口。

Main 只持有 `BackendService` facade；不要在 Main 导入 SDK 或直接构造 Agent/MCP/Source/Settings/AppState 服务。Worker RPC 使用有限 handler 表、请求 ID、明确错误与事件转发；浏览器授权回调由 Main 再校验 URL 并执行 `shell.openExternal`。Path summary 的进度按 `requestId` 路由，不跨线程传函数。

### MCP 配置与操作

`McpSettings` 只在选中 `mcp-heading` 时挂载，通过 `mcpList()` 读取当前 Workspace 的连接状态和配置错误；不在访问其他设置分区时启动 MCP。`mcpEdit({ scope, name })` 返回编辑草稿，env、Header 和 OAuth client secret 的字面量用 `${RHYZA_STORED_SECRET}` 替代；原始凭据及 OAuth token 不进入 Renderer。保存失败保留草稿，背景状态刷新不清除操作错误。

服务器卡片的图标操作直接显示在同一行并右对齐，保留至少 8px 间距。登录／退出登录共用一个按钮；`authenticated` 只报告 SDK AuthProvider 实际供给 OAuth token 的布尔状态，不能从 connected 推断，也不把 token 传给 Renderer。needs-auth 清除该可用认证状态，使用共享 warning 色和本地化说明，保留可展开的原始诊断；其他错误继续通过 alert 明确显示。未连接时工具资源入口不可用，needs-auth 时重连不可用，但编辑和删除仍可操作。

编辑表单和工具资源检查器使用原生模态 dialog，保留草稿及弹窗内错误；滚动时标题和关闭按钮保持可见，错误滚动到标题下方。Escape 关闭并恢复原按钮焦点，保存／读取期间禁止关闭。常规操作使用图标，必须同时提供本地化 title 和 aria-label；服务器操作的 aria-label 包含目标名称。高风险确认弹窗保留文字按钮，不通过图标直接确认。

`mcpSave({ scope, name, config, policy })` 的 config 由 `src/shared/mcp.ts` 校验，接受 stdio / HTTP、direct / deferred / hidden exposure 和逐工具覆盖；`policy.tools` 只接受原始工具名称及 blocked / read / write。Main 将隐藏占位符绑定到原字段及原目的地，服务器身份变更会撤销原授权。`mcpRemove({ scope, name })` 只删除配置与当前 Workspace 的授权，不删除聊天。`mcpTrust({ trusted })` 作用于当前 Workspace；信任、撤销和删除使用原生模态 dialog，提交期间禁止重复确认和关闭，失败保留窗口。

`mcpAction({ scope, name, action })` 支持 reconnect / login / logout / cancel-login，通过 SDK 的公开 `/mcp` command 执行；登录事件包含浏览器 URL，取消作用于当前登录目标。`mcpResources({ scope, name, action, cursor?, uri? })` 支持 list / templates / read，返回至多 128 KiB 的文本或资源 JSON，读取超限及无效配置会拒绝。`onMcpEvent()` 返回取消订阅函数；changed 事件触发节流刷新，auth 事件更新浏览器登录入口。

共享声明在 `src/shared/ipc.ts`，校验与 MCP 数据类型在 `src/shared/mcp.ts`。两个 preload（`.ts` 与实际发货的 `.cjs`）必须同步白名单；所有 Main handler 校验 sender，并从 SettingsStore 取得当前 Workspace，不接受 Renderer 任意指定目录。

历史工具集恢复必须等待 SDK 实际注册工具，再将可见工具加入当前声明集；收到 `tools/list` 不代表注册已完成，资源元数据发现仍可能进行中。等待沿用至多 10 秒的启动边界，不重新激活 hidden 或已从服务器撤回的工具。

### 工作区选择

`WorkspacePicker` 使用原生模态 `dialog` 提供焦点约束、Escape 关闭及关闭后焦点恢复。`workspaceHistory()` 返回全局最近使用列表（`path`、`lastUsedAt`）；`switchWorkspace({ path })` 只接受历史中的目录并验证其仍存在；`selectWorkspace()` 仅由 **Add workspace** 调用系统选择器。取消目录选择不重载当前状态。成功切换后，Sources 同步 persistence scope、加载该目录状态并清空旧搜索结果；目录校验失败在列表内显示，原工作区不变。

### 资料源索引设置

`SourceIndexSettings` 从资料源行打开，用排除目录多选及额外模式配置索引，不提供混合的 Include/Exclude 模式。`sourceIndexingGet({ id })` 返回根级目录、自动排除状态和已保存配置；`sourceIndexingSave({ id, excludedDirectories, excludePatterns })` 返回重新索引后的 `SourceInfo`。目录必须是单个根级名称，模式不能包含控制字符或 `!` 反向规则；配置仅作用于当前 Source Catalog 项。成功保存后 Sources 更新行状态/文件数并清空旧搜索结果。加载失败可重试，保存失败保留草稿，保存期间禁止重复操作与关闭。

### 删除资料源

`SourceRemovalDialog` 使用原生模态 `dialog`，显示目标目录并说明仅移除当前 Workspace 注册，不删除文件、历史对话或知识。确认后调用 `sourceRemove({ id })`，Main 验证 sender 与 ID，在 Catalog 持久化成功后才移除缓存项并返回 `{ ok: true }`；不存在的 ID 或保存失败会报错。Renderer 的 `removeSource(id)` 只移除资料源列表项，保留历史引用，同时清空旧搜索结果。失败保持窗口与列表项，提交期间禁止重复点击或关闭，取消关闭后恢复焦点。

页面加载用 `syncSources(sourceList())` 将 Main Catalog 作为完整权威列表，避免 Renderer 的旧持久化注册在删除后复活；增量新增和重新索引继续用 `upsertSources`。两种同步都保留 revision 变更时标记知识引用 stale 的行为。

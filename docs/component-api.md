# 组件与接口契约

[文档地图](README.md) · [架构](architecture.md) · [开发与验证](development.md)

本页只记录需要跨组件或跨进程维护的契约，不复述组件实现，也不把内部 React props 当作对外稳定 API。

## 设置页组件

`src/pages/Settings.tsx` 负责选择当前分区、Store 更新和 Provider 操作；工作区选择只在 `src/pages/Sources.tsx`。`src/pages/settings/SettingsNavigation.tsx` 负责返回入口、搜索框和分区按钮。`SettingsNavigation` 接收 `query`、`selectedSection`、`visibleCategories`，以及 `onQueryChange` / `onSelect` 回调。分类 ID 与分区标题的 `id` 必须一一对应；搜索只保留匹配分类，点击分类不修改 `HashRouter` 路由。右侧只显示当前分区，并在切换时回到内容顶部。

设置页整体在 `src/components/Layout.tsx` 中与工作区侧边栏互斥展示；布局和窄屏规则在 `src/pages/settings-page.css`。变更分类时同步维护分类定义、标题、搜索词、隐藏条件及 `tests/ui-refinement.test.cjs` 的交互检查。

## Renderer 与 Main

Renderer 只通过 `window.rhyza` 访问桌面能力。类型、channel 与参数校验的来源是 `src/shared/ipc.ts`，preload 白名单在 `electron/preload.cjs`；不能直接从页面导入 Main service。`src/hooks/useRhyzaBridge.ts` 封装运行时检测和 Provider 连接状态，Main 的 handler 必须验证 sender。

扩展生成的 HTML 不走私有 Renderer registry：经通用 [HTML Preview 协议](html-previews.md)校验路径和快照，再显示在沙箱 iframe。可选 Archify 扩展的 tool/schema 归其自身目录管理。

新增 bridge 方法的完整顺序和安全约束见[开发指南详解](development-guide.md#preload-与-ipc)；功能对用户的承诺以[功能矩阵](features.md)为准。

### 工作区选择

`WorkspacePicker` 使用原生模态 `dialog` 提供焦点约束、Escape 关闭及关闭后焦点恢复。`workspaceHistory()` 返回全局最近使用列表（`path`、`lastUsedAt`）；`switchWorkspace({ path })` 只接受历史中的目录并验证其仍存在；`selectWorkspace()` 仅由 **Add workspace** 调用系统选择器。取消目录选择不重载当前状态。成功切换后，Sources 同步 persistence scope、加载该目录状态并清空旧搜索结果；目录校验失败在列表内显示，原工作区不变。

### 资料源索引设置

`SourceIndexSettings` 从资料源行打开，用排除目录多选及额外模式配置索引，不提供混合的 Include/Exclude 模式。`sourceIndexingGet({ id })` 返回根级目录、自动排除状态和已保存配置；`sourceIndexingSave({ id, excludedDirectories, excludePatterns })` 返回重新索引后的 `SourceInfo`。目录必须是单个根级名称，模式不能包含控制字符或 `!` 反向规则；配置仅作用于当前 Source Catalog 项。成功保存后 Sources 更新行状态/文件数并清空旧搜索结果。加载失败可重试，保存失败保留草稿，保存期间禁止重复操作与关闭。

### 删除资料源

`SourceRemovalDialog` 使用原生模态 `dialog`，显示目标目录并说明仅移除当前 Workspace 注册，不删除文件、历史对话或知识。确认后调用 `sourceRemove({ id })`，Main 验证 sender 与 ID，在 Catalog 持久化成功后才移除缓存项并返回 `{ ok: true }`；不存在的 ID 或保存失败会报错。Renderer 的 `removeSource(id)` 只移除资料源列表项，保留历史引用，同时清空旧搜索结果。失败保持窗口与列表项，提交期间禁止重复点击或关闭，取消关闭后恢复焦点。

页面加载用 `syncSources(sourceList())` 将 Main Catalog 作为完整权威列表，避免 Renderer 的旧持久化注册在删除后复活；增量新增和重新索引继续用 `upsertSources`。两种同步都保留 revision 变更时标记知识引用 stale 的行为。

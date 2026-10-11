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

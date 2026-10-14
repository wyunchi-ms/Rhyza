# 开发与验证

[文档地图](README.md) · [架构](architecture.md) · [开发指南详解](development-guide.md)

本页是日常开发入口。平台依赖、Provider 差异、存储与安全边界以[开发指南详解](development-guide.md)为准。

## 启动

使用 Node.js 22.19+、npm 和 Git。在仓库根目录运行：

```powershell
npm ci
npm run electron:dev
```

`npm run dev` 仅运行 Renderer，不能代替带 Main/preload 的桌面功能验证。生产模式先运行 `npm run build`，再运行 `npm run electron:start`。

## 修改代码

1. 先读 [AGENTS.md](../AGENTS.md) 与相关模块，再定位契约：[架构](architecture.md)说明跨进程边界，[组件接口](component-api.md)说明设置页及 bridge 的调用面。
2. 修改 Renderer 时保留路由、主题、焦点和窄屏行为；修改 IPC 时同步共享类型、校验、preload、Main 与调用方。
3. 修改源文件后运行 `npm run format -- <file paths>`，完成前运行 `npm run format:check`。只格式化本次修改的文件。
4. 根据影响选择最小验证：`npm run typecheck`、`npm test`、`npm run test:ui`、`npm run smoke:ipc`；完整构建用 `npm run build`。

各命令的作用、测试环境和安全边界详见[开发指南详解](development-guide.md#5-开发命令)。功能状态变化时更新[功能矩阵](features.md)与[使用指南](user-guide.md)。

工作区历史回归使用 `npm run test:workspace-history`，覆盖历史迁移、持久化、目录校验，以及隔离临时数据目录中的桌面选择列表、preload IPC 和状态切换。

资料源索引回归使用 `npm run test:source-indexing`，覆盖默认/ignore 规则、旧清单过滤、每源排除配置、保存并重新索引，以及确认删除、失败保留、Workspace 隔离与历史数据保留的桌面流程。

MCP 回归使用 `npm run test:mcp`，覆盖 stdio / HTTP、真实 OAuth/PKCE 与刷新/取消、工具发现和调用权限、外部配置变更与分支恢复，并编译 Main 后用真实 preload 检查服务器表单、导入、项目信任、权限/exposure、资源预览及错误保留。服务器、账号和 Workspace 都使用本地合成数据及 OS 临时目录，不联系真实 MCP 服务。

界面布局回归使用 `node --test tests/ui-refinement.test.cjs`，覆盖五个路由及设置分区；对实体、图表、关联和 MCP 编辑／权限表单测量标签上下位置、控件左边缘、宽度与高度，并检查历史筛选的紧凑宽度、浅深主题、中英文、窄窗口及选择器键盘／模态行为。数据为隔离的合成 Workspace，MCP 布局使用本地 bridge 替身，不启动外部服务器。

后台线程隔离回归先运行 `npm run electron:compile`，再运行 `node --import tsx --test tests/backend-worker.test.ts tests/session-filter-persistence.test.ts` 与 `node --test tests/backend-worker-ui.test.cjs`。测试通过离线 Pi extension 人为阻塞 Worker，检查 Main heartbeat、真实窗口交互、错误传播及工作区异步持久化；不重启或访问用户正在使用的 Rhyza 实例。

工作区待办回归使用 `node --import tsx --test tests/todo-service.test.ts tests/agent-service.test.ts`，覆盖逐项写回、格式保留、冲突、路径边界和 Session 目录绑定；随后运行 `npm run electron:compile` 与 `node --test tests/todo-ui.test.cjs`，通过真实 preload 和后台 RPC 验证点击、键盘、保存状态、错误保留及重载持久化。测试只修改 OS 临时目录中的合成清单。

工作区可写权限回归使用 `node --import tsx --test tests/worktree-service.test.ts tests/agent-service.test.ts tests/pi-sdk-upgrade.test.ts tests/mcp.test.ts`，覆盖非 Git 目录跳过 Worktree、实际 TODO 读取/编辑、只读请求、Git 隔离失败、目录切换及宿主 MCP 写入授权。Git 仓库与文件均在 OS 临时目录中构造，不修改用户的真实工作区。

Markdown 代码块预览回归使用 `node --test --test-concurrency=1 tests/markdown-block-rendering.test.cjs tests/answer-outline.test.cjs tests/html-preview-rendering.test.cjs`，覆盖任务列表、嵌套代码、HTML 过滤、悬停/键盘复制原文、失败重试、主题/语言及既有目录与 iframe 状态。剪贴板由测试替身记录，不覆盖系统剪贴板。

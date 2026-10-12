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

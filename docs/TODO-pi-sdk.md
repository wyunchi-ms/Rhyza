# Pi SDK 1.0 接入 TODO

[功能与限制](features.md) · [开发指南](development-guide.md)

基础 SDK 已升级到 1.0.0。以下八项中，MCP 和工具按需发现已完成，其余六项仍待接入；升级依赖不代表启用全部能力。保留现有 Provider、分支、工具权限、缓存状态展示和自动压缩行为，不引入 Pi Durable 或自动启用 Codemode。

- [x] 通用 MCP 接入：显式注册 SDK MCP extension；用户级与受信任项目级配置、stdio / Streamable HTTP、OAuth/PKCE、刷新与取消、连接状态/错误/重连及资源读取均已接入。Settings 提供增删改、导入、信任和精确工具授权；write 仍要求可写且隔离。验证入口：`npm run test:mcp`。
- [x] 工具按需发现：Tool Search 与 direct / deferred / hidden exposure 已接入，主会话使用 defaultTools / excludeTools 保留内置权限而不阻止动态发现。加载状态按 Assistant turn 持久化，恢复会话及历史分支只继承对应快照；常用工具可直接调用，工具调用与错误沿用聊天展示。不启用 Codemode，不批量注入全部工具声明。
- [ ] 自动模型路由：接入实验性 Virtual Models，提供 Auto 选择；分别记录用户选择与实际模型、thinking level、费用和上下文上限。定义工具续轮、重试、压缩及跨分支的路由策略，避免不必要的缓存失效。
- [ ] 统一图片生成：使用统一 ModelRuntime 的 image model 目录、认证与 generateImages；定义调用入口、图片持久化、预览、下载、错误和费用统计。现有图片输入不等于出图；不得把 base64 图片写入普通文本上下文或日志。
- [ ] 更精细的上下文管理：接入 append-only context edits、按模型压缩预算及请求 / 收尾生命周期钩子；保留原始历史、阅读位置和分支语义，区分“模型可见上下文”与“用户可见历史”，并明确展示压缩及恢复失败。
- [ ] Prompt cache 保活：提供明确开关和成本提示，接入 cache warming 事件、后台请求统计、费用及状态展示，覆盖长工具调用、空闲、取消和关闭行为。目前所有宿主 Pi 会话通过固定的 settings reader 关闭保活（普通 applyOverrides 对此项无效），不修改用户全局设置。
- [ ] 原生 PowerShell 工具：在 Windows 显式启用 powershell，确定与 bash 的选择策略；沿用可写会话及隔离条件，覆盖超时、取消、退出码、输出截断、路径和工具 UI，不扩大只读会话权限。
- [ ] 分类模型：接入 classifier 目录、认证及 classify 的 choice / score / bool 契约，明确置信度与费用来源。按需用于相关性、知识候选或路由；与现有知识置信度阈值联动时需单独定义产品规则，失败不得静默变成成功结果。

通用验收要求：实现时同步更新功能状态、IPC 校验、持久化和相关测试。只有主流程与错误路径完成后，才将对应条目标记为已完成。

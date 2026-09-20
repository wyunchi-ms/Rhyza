# 参与 Rhyza

欢迎通过问题反馈、文档、交互改进和代码贡献参与 Rhyza。项目目前以 Windows 源码运行的 MVP 为主；开始之前，先阅读[项目介绍](README.md)和[功能与限制](docs/features.md)，了解现有行为。

## 报告问题

在 [Issues](https://github.com/wyunchi-ms/Rhyza/issues) 中提供：

- 期望行为、实际行为，以及最短复现步骤。
- Windows、Node.js 版本和使用的 Provider。
- 出现问题的界面、相关报错；如果是回归，可补充最后正常的版本或提交。
- 不含账号、密钥、私人会话或代码的截图/日志摘要。

输入卡顿问题可附上[性能诊断摘要](docs/performance-diagnostics.md)。`model-request-dumps` 可能包含正文，不要直接上传整个目录。

## 开始开发

将仓库 fork 到自己的账号后克隆，或在已有工作副本中创建分支。环境要求与架构详见[开发指南](docs/development-guide.md)。

```powershell
npm ci
npm run electron:dev
```

真实聊天和本地文件能力在 Electron 窗口验证。`npm run dev` 只适合前端布局开发。

## 修改与验证

保持一次变更解决一个清晰的问题。代码使用仓库固定版本的 Prettier；修改源文件后先格式化具体路径：

```powershell
npm run format -- src/components/SessionGraph.tsx
```

按改动选择验证方式：

| 改动                       | 验证                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| 文档                       | 检查本地链接、锚点、命令与 UI 文案；预览 Markdown                        |
| Renderer / 共享 TypeScript | `npm run typecheck`，相关单元测试                                        |
| Electron Main / preload    | `npm run electron:compile`，相关单元测试；IPC 变更加 `npm run smoke:ipc` |
| 分支、知识或持久化         | `npm run smoke:mvp`、`npm run smoke:state-store`，按需补充分支相关测试   |
| 聊天输入与渲染性能         | `npm run test:chat-performance`                                          |
| HTML Preview               | `npm run test:html-preview`                                              |
| 桌面交互                   | 在 Electron 中检查实际流程；需要集成检查时运行 `npm run electron:smoke`  |

`npm test` 运行 `tests/*.test.ts`；其他专项检查见[开发命令](docs/development-guide.md#5-开发命令)。纯文档修改无需运行应用构建。

提交前运行：

```powershell
npm run format:check
```

详细目录与代码约定见 [AGENTS.md](AGENTS.md)。`.sisyphus/` 和 `.sisphus/` 是保留目录，不存放本次修改或临时文件。

## 提交 Pull Request

说明解决的问题、改动后的行为和实际运行的验证。涉及 UI 时附上演示数据截图；涉及存储时说明旧数据如何兼容。不要把未运行的检查写成已通过。

功能发生变化时同步更新[功能与限制](docs/features.md)和[使用指南](docs/user-guide.md)。README 只保留产品定位、主要能力与快速开始；技术细节放到对应指南。

截图素材规范见[媒体说明](docs/images/README.md)。第三方代码保留原许可与版权说明，并更新 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

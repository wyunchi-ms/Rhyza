# Rhyza 文档

本目录按“产品介绍、使用、功能范围、开发、专题协议”分层维护。根目录 [README](../README.md) 只负责解释 Rhyza 是什么、解决什么问题以及如何快速开始，不承载完整操作或实现细节。

## 阅读路径

| 目标                       | 从这里开始                             | 继续阅读                                                      |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| 第一次使用 Rhyza           | [使用指南](user-guide.md)              | [Feature 文档](features.md)                                   |
| 判断某项能力是否已实现     | [Feature 文档](features.md)            | 对应专题文档                                                  |
| 搭建开发环境或修改代码     | [开发指南](development-guide.md)       | [产品记忆与设计原则](product-memory-and-design-principles.md) |
| 提交问题或 Pull Request    | [贡献指南](../CONTRIBUTING.md)         | [开发验证](development-guide.md#6-验证策略)                   |
| 排查输入或渲染卡顿         | [性能诊断](performance-diagnostics.md) | [开发指南](development-guide.md)                              |
| 开发 HTML Preview/图表扩展 | [HTML Preview 协议](html-previews.md)  | [Archify extension](../extensions/pi-archify/README.md)       |
| 更新 README 截图或动图     | [媒体素材说明](images/README.md)       | 根目录 [README](../README.md)                                 |

## 文档职责

- `user-guide.md`：用户能看到、能执行的流程，包含故障排查。
- `features.md`：功能状态、产品边界和已知限制；不要把规划中的能力写成已完成。
- `development-guide.md`：架构、代码目录、命令、数据与安全边界。
- `performance-diagnostics.md`：输入延迟采样、性能日志和诊断结果解释。
- `product-memory-and-design-principles.md`：长期产品语义和设计约束，不替代用户手册。
- `html-previews.md`：通用 HTML Preview 技术契约。
- `images/README.md`：媒体文件命名、拍摄脚本和隐私要求。

## 维护约定

1. UI 路径使用 **Page → Section → Action** 表示，并与界面英文文案保持一致。
2. 命令以仓库 `package.json` 为准；删除或重命名 script 时同步更新开发指南。
3. 功能状态变化时先更新 `features.md`，再按需更新 README 和使用指南。
4. 截图只使用演示 Workspace，不出现真实账号、Token、私有仓库、本地用户名或绝对路径。
5. 演示数据截图标明来源；图片链接只指向已提交文件。待补素材在媒体说明中记录，不用占位图冒充产品界面。

## 产品设计材料

[Rhyza Product Design v0.3](../Rhyza_Product_Design_v0.3.docx) 保留产品设计背景。判断当前能力时，以[功能与限制](features.md)及代码为准，设计稿不等于已实现功能。

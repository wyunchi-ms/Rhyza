# 项目概览

[项目首页](../README.md) · [文档地图](README.md) · [架构](architecture.md)

Rhyza 是本地优先的 Electron AI 桌面工作台。用户从任意历史回答分叉继续探索，将可复用的概念、关系和 Mermaid 图表保存到当前 Workspace；Sources 提供受限的本地文本搜索，Changes 展示知识及代码变更。

## 当前范围

- 运行环境：以 Windows 10/11 的源码运行和验证为主；尚无正式安装包。首次配置与故障排查见[使用指南](user-guide.md)。
- Provider：GitHub Copilot、Codex、Claude Code 和 Azure OpenAI；不同 Provider 的认证、模型和工具能力并不相同。
- 数据：会话和知识按 Workspace 路径隔离保存在本机；向模型提问时，相关内容会发送给所选 Provider。
- 图表：Mermaid 是可持久化的基础格式；Archify 是可选 Pi 扩展，不是宿主的必选依赖。

功能是否可用及其限制以[功能矩阵](features.md)为准；本页不替代功能状态表。

## 从哪里继续

| 读者想做什么 | 文档 |
| --- | --- |
| 使用产品 | [user-guide.md](user-guide.md) |
| 理解视觉与交互约束 | [DESIGN.md](DESIGN.md) |
| 理解模块和数据流 | [architecture.md](architecture.md) |
| 运行、修改和验证 | [development.md](development.md) |
| 修改组件或 bridge 接口 | [component-api.md](component-api.md) |
| 了解未完成的工作 | [TODO.md](TODO.md) |

![项目文档职责图](diagrams/docs-map.png)

[图表规格](diagrams/docs-map.architecture.json)可用于在本地用 Archify 重新生成交互图。

# 文档媒体素材清单

README 使用本目录中已提交的 PNG。截图直接渲染当前 React 界面，使用虚构的订单服务演示数据，不是概念设计图，也不代表一次真实模型调用。

## 已有素材

| 文件                                             | 内容                             | 尺寸     |
| ------------------------------------------------ | -------------------------------- | -------- |
| [workspace-overview.png](workspace-overview.png) | 会话列表、回答、知识引用与输入框 | 1440×960 |
| [knowledge-library.png](knowledge-library.png)   | Entity 列表、详情与关系          | 1440×960 |

本次素材通过隐藏 Electron 窗口加载当前 Renderer，在隔离临时 profile 中注入演示 Session、Turn、Entity 和 Relation；没有加载应用 Main/preload、真实 Provider、用户登录或真实 Workspace。聊天页因此显示运行时不可用提示。这些截图展示浏览与知识界面，不用于证明 Agent 执行成功。

后续更新时沿用下面的演示场景；涉及真实 Agent 行为的动图应在完整桌面应用中录制。

## 待补素材

| 文件名                    | 类型         | 内容                                               | 建议尺寸          |
| ------------------------- | ------------ | -------------------------------------------------- | ----------------- |
| `branch-and-resume.gif`   | 动图         | 从历史回答选区提问、创建分支、标记状态、切回原分支 | 1440×900，8–12 秒 |
| `sources-and-changes.png` | Feature 截图 | Sources 搜索结果，或 Changes 的隔离 Worktree Diff  | 1440×900          |
| `provider-settings.png`   | 配置截图     | 三个 Provider 的连接状态和默认模型；隐藏账号信息   | 1200×900          |

## 拍摄脚本

### `workspace-overview.png`

1. 使用专门的演示 Workspace，不使用真实仓库。
2. 准备一个根问题和两个分支，至少包含 complete、running/pending 两种状态。
3. 在回答中保留已有 Entity 引用，展示对话与知识的连接。
4. 将窗口设为约 1440×900，确认标题、Token usage 和输入框完整可见。

README 替换语法：

```markdown
![Rhyza workspace：树状会话、当前对话和知识预览](docs/images/workspace-overview.png)
```

### `branch-and-resume.gif`

1. 从一个历史回答选中稳定概念。
2. 点击 `Ask about this` 并输入一个简短问题。
3. 展示新分支挂在对应 Turn 下。
4. 将节点标为待处理或完成。
5. 点击原分支，展示上下文仍然保留。

README 替换语法：

```markdown
![从历史回答创建分支并返回继续](docs/images/branch-and-resume.gif)
```

## 隐私与质量检查

- 隐藏 Windows 用户名、本地绝对路径、私有仓库名和组织名。
- 不出现 OAuth Device Code、Token、邮箱、头像或浏览器认证页面。
- 不使用真实客户资料、Prompt 或 Source 内容。
- 使用 Light theme 作为 README 主图；如需表现主题，再单独补 Dark theme 图。
- 截图保持 1× 或 2× 整数缩放，不拉伸。
- GIF 不录制长时间等待；可剪掉模型响应等待，但不要伪造产品行为。
- 优先使用 GIF 或 WebP；若文件明显过大，改为 MP4 并在 GitHub 支持的展示位置引用。

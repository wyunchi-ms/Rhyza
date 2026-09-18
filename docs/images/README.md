# 文档媒体素材清单

当前环境不能可靠地操作 Electron 窗口并生成不含私人数据的真实截图，因此 README 暂时使用文字占位，而不是伪造产品界面或提交断裂图片链接。补图时按下列文件名保存，README 中的 `SCREENSHOT TODO` / `GIF TODO` 注释可直接替换为标准 Markdown 图片。

## 待补素材

| 文件名 | 类型 | 内容 | 建议尺寸 |
| --- | --- | --- | --- |
| `workspace-overview.png` | 主截图 | 左侧会话树、中央对话、知识预览；展示 2–3 个分支和不同状态 | 1600×1000 或 1440×900 |
| `branch-and-resume.gif` | 动图 | 从历史回答选区提问、创建分支、标记状态、切回原分支 | 1440×900，8–12 秒 |
| `knowledge-library.png` | Feature 截图 | Entities/Diagrams 切换、来源和关系 | 1440×900 |
| `sources-and-changes.png` | Feature 截图 | Sources 搜索结果，或 Changes 的隔离 Worktree Diff | 1440×900 |
| `provider-settings.png` | 配置截图 | 三个 Provider 的连接状态和默认模型；隐藏账号信息 | 1200×900 |

## 拍摄脚本

### `workspace-overview.png`

1. 使用专门的演示 Workspace，不使用真实仓库。
2. 准备一个根问题和两个分支，至少包含 complete、running/pending 两种状态。
3. 打开 Knowledge preview，让主界面同时体现 Conversation 与长期知识。
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

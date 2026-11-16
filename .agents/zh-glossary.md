# 简体中文术语表

汉化时以本表为准；遇到新词先按本表风格确定，再回填到这里。术语表本身不是产品文档，`docs/` 已删除，故放在 `.agents/`。

## 总则

- 只翻浏览器界面文案；agent 读到的文本（导出反馈、`--help`、工具描述、技能文件、question-block 标记）保持英文原样。
- 代码标识符、对象 key、data-testid、URL、路径、文件名不翻。
- 中文句子用全角标点：，。：；！？（）“”、
- 中英文/数字混排时，汉字与拉丁字母或数字之间留一个半角空格（如 `3 条标注`、`发送给 agent`），纯中文之间不留；`${}` 模板按中文语序整句重写。
- 同一屏内同一概念只用一个译法；遇到表里没有的词，先查“保留英文清单”。

## 通用动作

| 英文 | 中文 |
|---|---|
| Approve | 通过 |
| Reject | 拒绝 |
| Request changes | 要求修改 |
| Send / Send Feedback | 发送 / 发送反馈 |
| Save | 保存 |
| Cancel | 取消 |
| Close | 关闭 |
| Delete | 删除 |
| Edit | 编辑 |
| Copy | 复制 |
| Retry | 重试 |
| Done | 完成 |
| Settings | 设置 |
| Search | 搜索 |
| Update | 更新 |
| Install | 安装 |
| Learn more | 了解更多 |
| Try it | 试一试 |

## 计划评审

| 英文 | 中文 |
|---|---|
| Plan | 计划 |
| Plan review | 计划评审 |
| Annotation / Annotate | 标注 |
| Comment | 评论 |
| Version | 版本 |
| Reference images | 参考图片（界面文案；导出标记 `## Reference Images` 不翻） |
| Question block | 问题块 |
| Answer | 回答 |
| Feedback | 反馈 |
| Export | 导出 |

## 代码评审

| 英文 | 中文 |
|---|---|
| Code review | 代码评审 |
| Review | 评审 |
| Guided Review | 引导式评审 |
| Guide | 指南 |
| Change / Changes | 更改 |
| File | 文件 |
| Line | 行 |
| Hunk | 代码片段 |
| Pull request (UI 文案) | PR（标题等正式名称保留原文） |

## Inbox

| 英文 | 中文 |
|---|---|
| Inbox（单独出现） | 收件箱 |
| Plannotator Inbox（产品名） | 保留英文 |
| Thread | 会话 |
| Session | 会话（内部概念；与 Thread 同屏时按语境区分） |
| Reply | 回复 |
| Compose / Composer | 撰写 / 撰写框 |
| Draft | 草稿 |
| Send now | 立即发送 |
| Delivered | 已送达 |
| Delivering / Sending | 发送中 |
| Queued | 已排队 |
| Archive / Archived | 归档 / 已归档 |
| Pin / Unpin | 置顶 / 取消置顶 |
| Star / Starred | 星标 / 已星标 |
| Tag | 标签 |
| Project | 项目 |
| Board | 看板 |
| Card | 卡片 |
| Workspace | 工作区 |
| Machine | 计算机 |
| Device | 设备 |
| Linked machines | 已关联的计算机 |
| Cloud agent | 云端 agent |
| Routine | 例程 |
| Notification | 通知 |
| First run | 首次运行 |
| Ask this session | 询问此会话 |
| Looks good | 看起来不错 |
| Agent | agent（保留英文，小写） |

## 设置与设备

| 英文 | 中文 |
|---|---|
| Appearance | 外观 |
| Theme | 主题 |
| Light / Dark / System | 浅色 / 深色 / 跟随系统 |
| Language | 语言 |
| Keyboard shortcuts | 键盘快捷键 |
| Prompts | 提示词 |
| Account | 账户 |
| Usage | 用量 |
| Update available | 有可用更新 |
| Check for updates | 检查更新 |
| Enabled / Disabled | 已启用 / 已停用 |

## 保留英文（不翻）

Plannotator、Claude Code、OpenCode、Pi、GitHub、GitLab、Tailscale、Diff、PR、MCP、commit、hook、agent、URL、JSON、API、CLI。

- question-block 的解析标记一律不翻：`Recommended:`、`Stakes:`、`Holds up:`。
- 导出与 agent 解析用文本一律不翻：`'Plan Feedback'`、`Feedback on:`、`'## Page:'`、`'## Reference Images'`、`'Answers to your questions'`。
- 指南内容、计划正文、agent 消息、diff、PR 数据、release notes 等“内容”不翻。

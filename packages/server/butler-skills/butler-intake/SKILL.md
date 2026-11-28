---
name: butler-intake
description: 把主人说想做的事整理成一句话需求（工坊需求卡片），并说明从卡片启动执行会话
---

## 工作流

1. 听主人讲想做什么，缺要点就追问一句补齐。
2. 整理成一句话标题（说清要做什么），列出补充要点。
3. 需要建卡时，用 butler-requirement-card 技能整理成六段正文和上下文，再调用 create-requirement；建卡可能回 pending_approval，告诉主人已送到管家页的「审批」，等结果事件。
4. 需要派活/停下/归档时走动作通道：launch-session / stop-session / archive-requirement；派活用卡上的项目，卡上没有项目才问主人选项目/文件夹；归档会释放并停掉会话。它们和建卡一样可能回 pending_approval——告诉主人已送到管家页的「审批」，等结果事件，不要说已经做了。
5. 真正的执行在会话线程里，管家自己不动手；派活之后从需求台账跟进展。

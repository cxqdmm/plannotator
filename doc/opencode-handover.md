# opencode 对接优化 · 交接文档

> 需求：req_01M83533QKG0KJE5MXXDT4AKWS「优化 工坊 对接 opencode 场景」
> 写于 2026-11-23 晚。作者：Claude Code（会话 04156a62）。
> 状态：**已完成并归档**（2026-11-24，主人确认）。主线最终态：2514a1742 + 交接文档 +
> 已解决线程拒绝回复（a15d4a889）+ toast 提示（ea30cab43）+ 安装文档 MCP 警告（424e3e529）
> + 收件人列表过滤无主会话（5ce12a147）+ 唤醒扫描全量化（2695489f7，主人所写）。
> 实验实现（自动唤醒/注入/聚合轮询）在备份分支 backup/2026-11-23-opencode-wake，
> 未来的唤醒相关工作以本文档为设计基础、以主人批准为前提。
> 讨论全过程：Inbox 线程「工坊对话流回复报错」（msg_01M83EPT96VNBD65MZWCEQHEPA）。

## 一、主人想做的事（初衷，待主人确认表述）

在工坊（收件箱）里对 opencode 会话发消息，要像和 Claude Code 对话一样自然：

1. 手动启动的 opencode 会话（哪怕静置了一小时、插件已被宿主卸载）**可以选中、可以送达**；
2. 发送后**自动送达**——不需要人去 opencode 终端里做任何事；
3. 会话收到的话**像聊天一样**出现在对话里（原话注入，不是转发通知的样板）；
4. 状态如实显示（已送达 / 正在自动唤醒送达），归属正确（OpenCode · 会话 id）；
5. **一切改动以修改项目为准**，不走命令行临时手段。

> ⚠️ 2026-11-23 的教训：第 2、3 条的体验设计（谁触发、多快、注入的样子）主人未认可，
> 实现后已全部回滚。重启动手前，先按本档「五、待对齐」与主人确认，出设计稿批准后再写代码。

## 二、今天验证过的技术事实（都是实测，可信）

| # | 事实 | 出处 |
|---|---|---|
| 1 | opencode 宿主会**空闲约 1 小时卸载插件 generation**，其持有的全部会话轮询器一起停；收件箱 30 秒收不到轮询即把会话读成「已结束」 | 现场实测 + 上游 reload 测试记录 |
| 2 | `opencode2 run --standalone --session <id> "<原话>"` 在**会话自己的目录**里执行，能把原话作为回合注入该会话并复活插件（回合制，run 结束进程退出） | 实测（ses_df9b，backend-skill 目录） |
| 3 | 会话的真实目录在 opencode 自己的 v2 库里：`~/.local/share/opencode/opencode.db` 的 `session_v2` 表（id/directory/title/time_updated），只读查询即可枚举「最近活跃的会话」 | 实测（服务端只读查询成功，To 列表合并验证通过） |
| 4 | 工具调用的作者归属由 shim 环境变量 `PLANNOTATOR_SESSION_TAG` 决定；后台服务的旧 env（如 `claude-code:f1ce850e…`）会污染归属——注入时必须显式写 `PLANNOTATOR_SESSION_TAG=opencode:<session>` 并删除 `CLAUDE_CODE_SESSION_ID`/`PLANNOTATOR_SESSION_PROJECT` | 实测（错误标签现场 + 修复验证） |
| 5 | 投递结算：带收件人（wakes=true）的话**只认 delivered 回执**（`store.recordDelivery`），agent 的工具阅读不算——不结算就永远显示「未送达」并反复触发唤醒 | 现场实测（11:23/11:30 死循环） |
| 6 | `run --session` 在**错误的目录**里找不到会话，按「会话不存在就新建」开一个新空会话——目录错 = 伤害（产生垃圾回合 + 永远送不到） | 实测（7 次失败 run） |
| 7 | 前端文案改动必须跑完整构建链（review → hook → opencode）并重启服务，浏览器强刷——否则看不到 | 实测（19:30 截图旧文案事故） |
| 8 | 上游 main（0.29.x 之后）的 opencode 对接方式与 fork **完全一致**（composeTarget 逐字相同、同为轮询注册、同样没有服务端唤醒）——这些限制是上游固有的 | 逐字对比（composeTarget/sessionsModel/唤醒架构） |

## 三、主线上现成的参考模式（同一代码库内，直接可抄）

- `packages/server/inbox-codex-wake.ts` — Codex 唤醒：**claim → 注入原话 → delivered 回执 → 失败让回**，与 opencode 场景几乎同构（今天已抄过一遍，实测可用）
- `packages/server/inbox-t3-wake.ts` — T3 Code 唤醒：四级投递 owner 设计（mod → 本机 CLI → MCP grant → 等待说明），owner 优先级思路可参考
- `packages/server/inbox-antigravity-wake.ts` — Antigravity 唤醒：服务端自持会话的探测/重试节奏
- `packages/shared/inbox/store.ts` `pendingRepliesFor` — 一次遍历取某宿主全部排队话
- `packages/server/inbox-stream.ts` `openCodeSessionDirectory` / `openCodeRecentSessions` — v2 库只读查询（回滚前实现，备份分支有）

## 四、备份分支（完整实验实现，可 cherry-pick 可参考）

`backup/2026-11-23-opencode-wake`（10 个提交，未推远端）：

| 提交 | 内容 | 备注 |
|---|---|---|
| `152279b22` | 对话流发送修复（学会话详情同款锚点规则） | **主人早期验证过有效**，最值得第一个捡回 |
| `31e0f398d` | 已结束会话静默确认加说明 | 独立小修 |
| `6b536902e`/`f1b63362a` | 聚合轮询步骤 1-2（服务端聚合路径 + 插件聚合耳朵，灰度开关） | 设计完整、测试全绿，未灰度即回滚 |
| `67a63d97b` | 自动唤醒：跑对目录/失败退避/事件驱动 nudge | 方向正确、参数待调 |
| `f80ef8d26` | 归属修正（标签 + --standalone） | 归属实测已修好 |
| `4ae2b68b0` | 人的发送绕过唤醒冷却 | 回应「发送时自动唤醒」 |
| `4d4b8af7a` | 注入原话并结算送达 | 痛点的正面解 |
| `f7b1b7838` | 排队/未送达文案说真话 + 凑窗 10s | 需随注入模式复核 |

服务端只读查询函数（`openCodeSessionDirectory` / `openCodeRecentSessions`）在这个分支的
`packages/server/inbox-stream.ts` 里，主线还没有。

## 四点五、实验残留与已知未关闭的洞（2026-11-24 记）

1. **幽灵会话**：唤醒 run 里 agent 走 Code Mode 调收件箱工具时，若 shim 没带上会话身份，
   shim 会自造一个 `ses_…` id 且 host=null（如 ses_01M85JQK，在 D2C 测试线程里留下 2 条
   回复）——这种幽灵**永远收不到任何消息**，却会成为线程的「最后 agent 撰写者」，让回复
   框/收件人列表瞄上它（显示为「某个 agent · 未唤醒」）。清理待做：数据层删除/改归属 +
   picker 过滤 host=null 会话。**根因未完全关闭**：--standalone + run env 写了
   PLANNOTATOR_SESSION_TAG 后，独立服务器孵化的 shim 仍未拿到标签（09:29 的幽灵发生在
   修复之后）——**已查实（2026-11-24 env 实锤）**：`opencode2 run --standalone` 孵化的收件箱 shim，
其 env 是 Nov-17 后台服务的 shell（带 claude-code:f1ce850e 标签），CLI 上写的标签传不到
它——MCP shim 的孵化经过后台服务（或等价机制），属 opencode 服务架构，plannotator 侧
改 env 无法到达。候选修法：去掉 opencode.json 的 mcp.plannotator-inbox 配置（与插件工
具重复、正是无身份 shim 来源，移除后 Code Mode 绑定插件工具自带归属）；或重启后台服
务清旧 env（治标）。
2. 7 次错误目录 run 未产生垃圾会话（已核实，v2 库只有真实会话）。

## 五、待对齐的决策
## 五、待对齐的决策（下一轮动手前必须问主人）

1. **触发**：人发消息后多久起唤醒？（上一版：20 秒凑窗 + 失败退避；主人未表态具体数值）
2. **注入样子**：轻形式（一行来源标注 + 原话）还是完整 wake 文本（带回复路由指令）？短话/长件是否分治？
3. **agent 的回复去哪**：留在 opencode 会话对话里（轻注入的自然结果），还是要求路由回报箱线程（需保留指令块）？
4. **枚举范围**：To 列表/侧栏列多久内的 opencode 会话？（上一版：200 个、24h 活跃窗）
5. **状态文案**：排队/唤醒中/已送达的措辞（上一版草稿见 f7b1b7838）。

## 六、上一轮的教训（写给下一个执行者）

1. **先设计、主人批准、再动代码**——2026-11-23 的 10 个提交因方向未对齐被整体回滚。
2. 每改一次前端/核心文案，立即跑构建链并重启服务——主人浏览器跑旧 bundle 会以为什么都没变。
3. 服务器重启清空内存会话注册表——一切判据避免依赖内存（用磁盘 claim/宽限期/v2 库）。
4. 分析结论要用实测钉死再汇报——今天多次改口消耗了主人的信任。
5. 主人的痛点描述是最高的需求输入：「未送达还在」「像转发不像对话」「选不到会话」——每一条都要正面回应，不要绕。

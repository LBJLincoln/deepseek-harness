# improvement/ — 从已认证会话到训练与评估记录

[English](README.md) | 中文

改进 seam 把 harness 已经记录的内容变成训练器与评估器消费的内容。环境以完成标准词汇声明带可执行检查的任务；运行器把一个环境作为一个全新会话运行、为其盖章、作为验证者执行检查，并且只在有证书时才完成 goal；fleet 把环境 × 模型 × 重复的 cell 计划通过运行器运行并折叠出排行榜；轨迹把已持久化的会话折叠为聊天格式记录，其奖励由证书决定，并依据 stamp 扣留留出环境；记分员把同样的日志折叠为会话事实与记分板，因此每个数字都可仅凭日志重新算出；一场实验冻结一份计划，在配对的 cell 上运行两个 arm（实验分支），并连同置信区间与判定一起报告 delta；班次驱动器让 fleet 按节拍无人值守地运行，把每个班次记入它自己的会话日志，因此重启只会恢复那些从未开始过的 cell；程序台账把一份客户交付物分解为部门目标，每个目标各有自己的工作树与会话，并且只在合并后 head 的证书之上发布；而观测台把这些折叠作为页面发布，它扣留配置的区与留出划分、对扣留的内容计数，并在其最新会话过旧时以陈旧提示取代全部数字。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`environments/`](environments/README.md) | 环境注册表：带验证器的任务，留出或可用于训练；`environment/run` stamp 词汇 | `ctx.environments` |
| [`environment-runner/`](environment-runner/README.md) | 环境运行器：一个环境作为一个经验证的会话，运行器即验证者 | `ctx.environmentRuns` |
| [`fleet/`](fleet/README.md) | Fleet 运行：环境 × 模型 × 重复的 cell 计划，保留每个结果，按路由与环境给出排行榜 | `ctx.fleet` |
| [`trajectories/`](trajectories/README.md) | 轨迹导出：会话导出为带奖励、来源信息与环境 stamp 的 `dsh-trajectory/1` JSONL | `ctx.trajectories` |
| [`scorekeeper/`](scorekeeper/README.md) | 会话事实：`sessionFacts` 投影单元、由日志推导的记分板（含按环境的 pass@k），以及事实的 JSONL 导出 | `ctx.scorekeeper` |
| [`experiments/`](experiments/README.md) | 实验：在 fleet cell 上对两个 arm 做被冻结的配对比较，带 bootstrap 区间与 promote/reject/inconclusive 判定 | `ctx.experiments` |
| [`shifts/`](shifts/README.md) | 班次：在 fleet 计划之上按节拍、带花费窗口的循环，其台账存放在它自己的会话日志中，被中断的班次凭台账与运行 stamp 恢复 | `ctx.shifts` |
| [`program/`](program/README.md) | 程序：一份交付物被分解为部门目标，每个目标各有自己的 git 工作树、会话、预设与配额，在合并后的 head 上整合，并凭其证书发布 | `ctx.programs` |
| [`observatory/`](observatory/README.md) | 公开页面：对全部持久化会话的扣留式、感知陈旧的折叠，渲染为一个自包含的 HTML 页面与一份 JSON 文档 | `ctx.observatory` |

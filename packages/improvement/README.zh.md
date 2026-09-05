# improvement/ — 从已认证会话到训练与评估记录

[English](README.md) | 中文

改进 seam 把 harness 已经记录的内容变成训练器与评估器消费的内容。环境以完成标准词汇声明带可执行检查的任务；运行器把一个环境作为一个全新会话运行、为其盖章、作为验证者执行检查，并且只在有证书时才完成 goal；fleet 把环境 × 模型 × 重复的 cell 计划通过运行器运行并折叠出排行榜；轨迹把已持久化的会话折叠为聊天格式记录，其奖励由证书决定，并依据 stamp 扣留留出环境；记分员把同样的日志折叠为会话事实与记分板，因此每个数字都可仅凭日志重新算出。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`environments/`](environments/README.md) | 环境注册表：带验证器的任务，留出或可用于训练；`environment/run` stamp 词汇 | `ctx.environments` |
| [`environment-runner/`](environment-runner/README.md) | 环境运行器：一个环境作为一个经验证的会话，运行器即验证者 | `ctx.environmentRuns` |
| [`fleet/`](fleet/README.md) | Fleet 运行：环境 × 模型 × 重复的 cell 计划，保留每个结果，按路由与环境给出排行榜 | `ctx.fleet` |
| [`trajectories/`](trajectories/README.md) | 轨迹导出：会话导出为带奖励、来源信息与环境 stamp 的 `dsh-trajectory/1` JSONL | `ctx.trajectories` |
| [`scorekeeper/`](scorekeeper/README.md) | 会话事实：`sessionFacts` 投影单元、由日志推导的记分板（含按环境的 pass@k），以及事实的 JSONL 导出 | `ctx.scorekeeper` |

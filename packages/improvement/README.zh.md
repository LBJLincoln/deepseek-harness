# improvement/ — 从已认证会话到训练与评估记录

[English](README.md) | 中文

改进 seam 把 harness 已经记录的内容变成训练器与评估器消费的内容。环境以完成标准词汇声明带可执行检查的任务；运行器把一个环境作为一个全新会话运行、为其盖章、作为验证者执行检查，并且只在有证书时才完成 goal；轨迹把已持久化的会话折叠为聊天格式记录，其奖励由证书决定，并依据 stamp 扣留留出环境。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`environments/`](environments/README.md) | 环境注册表：带验证器的任务，留出或可用于训练；`environment/run` stamp 词汇 | `ctx.environments` |
| [`environment-runner/`](environment-runner/README.md) | 环境运行器：一个环境作为一个经验证的会话，运行器即验证者 | `ctx.environmentRuns` |
| [`trajectories/`](trajectories/README.md) | 轨迹导出：会话导出为带奖励、来源信息与环境 stamp 的 `dsh-trajectory/1` JSONL | `ctx.trajectories` |

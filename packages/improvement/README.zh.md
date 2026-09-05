# improvement/ — 从已认证会话到训练与评估记录

[English](README.md) | 中文

改进 seam 把 harness 已经记录的内容变成训练器与评估器消费的内容。环境以完成标准词汇声明带可执行检查的任务；轨迹把已持久化的会话折叠为聊天格式记录，其奖励由证书决定。两个包都不执行任务，也不调用模型。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`environments/`](environments/README.md) | 环境注册表：带验证器的任务，留出或可用于训练 | `ctx.environments` |
| [`trajectories/`](trajectories/README.md) | 轨迹导出：会话导出为带奖励与来源信息的 `dsh-trajectory/1` JSONL | `ctx.trajectories` |

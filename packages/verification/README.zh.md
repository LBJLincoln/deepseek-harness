# verification/ — 可执行完成标准

[English](README.md) | 中文

面向 agent（智能体）会话 goal 的持久完成标准，与使用它们的验证者、编排者和策略消费方相互独立。被标准度量的 goal 依据完整通过运行产生的证书完成，而不是依据自我报告；标准状态是所属会话日志的一部分。检查所执行的内容归验证者所有，屏障决定实现者会话不得读取哪些目录；每个开放路径的能力都在它开放路径之处执行该决定。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`verification/`](verification/README.md) | 完成标准状态、证书与指令 | `ctx.completionStandards` |
| [`read-barrier/`](read-barrier/README.md) | 验证者所有的目录树、按运行预留，以及按会话作出的拒绝判定 | `ctx.readBarrier` |
| [`judge/`](judge/README.md) | 评审一次已记录尝试并记录裁决的无血缘判官会话 | `ctx.judge` |
| [`command-verification/`](command-verification/README.md) | 面向人的 `/verification` 证据台账 | — |

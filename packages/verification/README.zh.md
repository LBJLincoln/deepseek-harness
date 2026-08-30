# verification/ — 可执行完成标准

[English](README.md) | 中文

面向 agent（智能体）会话 goal 的持久完成标准，与使用它们的验证者、编排者和策略消费方相互独立。被标准度量的 goal 依据完整通过运行产生的证书完成，而不是依据自我报告；标准状态是所属会话日志的一部分。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`verification/`](verification/README.md) | 完成标准状态、证书与指令 | `ctx.completionStandards` |

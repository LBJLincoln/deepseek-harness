# governance/ —— 可归属的决定与转录所处的条款

[English](README.md) | 中文

治理插件把客户审计员需要的事实放进会话日志本身，重放即可复现它们，并持有据其行事的导出路径。签署记录一次具名的人类决定——它关闭哪类转变、部署方声称由谁签署、所签产物的摘要，以及指向签署者当时所见之物的指针——于是需要签名的五类转变（规格冻结、放宽安全或合规检查、评审接受、发布、训练数据释出）留下的是消费方可折叠的记录，而不是调用方作出的声称。数据使用条款在创建时钉定单个会话的转录所处的合同——客户、协议、用途、驻留地、保留期、脱敏配置——此后可以收窄但永远不能拓宽，于是为交付而记录的转录不会在事后变成训练材料。curator 正是这些条款成为屏障之处：它是那条在没有脱敏配置时拒绝运行、扣留条款不接纳本次导出用途的每一个会话、在记录到达 sink 之前对其脱敏、并留下一份对所考虑的每个会话都有交代的 manifest 的导出路径。这里的任何东西都不做认证，也都不进入模型请求；设计理由由[可归属决定的 Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md)与 [curator Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-curator.md)负责。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`signoff/`](signoff/README.md) | 签署：每次签署的转变一条 `signoff/recorded`，指名主体、产物摘要与当时所见的证据 | `ctx.signoffs` |
| [`data-use/`](data-use/README.md) | 数据使用条款：会话启动时依据部署方默认条款钉定的 `dataUse/terms`，可收窄但永不拓宽 | `ctx.dataUse` |
| [`curator/`](curator/README.md) | 策展导出：强制的脱敏配置、按条款把守的会话、逐记录的 `curation` 块，以及每次导出一份 `ExportManifest` | `ctx.curator` |

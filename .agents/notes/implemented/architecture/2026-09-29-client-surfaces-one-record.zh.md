# Agent Note: 客户界面读取同一份记录：中止原因、结论规则、只在账本中留下的班次，以及发布的快照中不含操作员会话

Status: implemented

[English](2026-09-29-client-surfaces-one-record.md) | 中文

## Problem

一次面向客户的就绪审查发现，简报、执行摘要、README 与 `/ops` 彼此矛盾，也与 `pnpm run enterprise:report` 和 `pnpm run enterprise:verdicts` 矛盾。简报原样粘贴每条中止账本行的 `reason`，于是三份带 `/tmp` 路径的 `pnpm install` 失败日志填满了它的第一节。它把被后续推送取消的 Branch CI 运行读作失败，于是 `T-0020` 与 `T-0021` 显示为红，而 `T-0012`、`T-0019` 与 `T-0007` 显示为最终变绿，与结论规则正好相反。摘要把每个没有失败检查的中止都标为审阅驳回，并说调度器的周期没有交付任何工单，而它的关键数字说交付了两张。在 22:07Z 容器重置中丢失的班次 `201448-94fd` 没有记录，但监督者追加了它的两条账本行；简报忽略了它们，把它的周期报为未知。审计追踪控制项说账本从未被改写，这与提交 `dae1babd0` 矛盾。README 载有 07:07 UTC 手工维护的数字。`/ops` 把操作员自己的 Claude Code 会话连同标题、命令与 token 作为企业 agent 发布，并把每条账本行都算作交付物。

## Decision

- 失败工单的原因是其 `reason` 的第一个分句，已知的引擎分句改写为读者能懂的说法（`the workspace install failed before any model ran`、`the session budget ran out`、`rejected by review`、`abandoned in the container reset`）；其余内容留在简报引用的账本行中。摘要用这个原因为每次中止标注，中英文皆然。
- `ShipmentCi.verdict` 按结论规则回答一个已交付提交：在确切提交上通过或失败的最新运行，否则是包含它且通过或失败的最早运行；被取消的运行没有结论。简报、其单元表与摘要都显示这个结论；被取消的包含运行读作 `cancelled before a verdict`。
- 一条工单账本行，若其班次既没有记录也没有启动行，就代表它的班次，开始时间是其 `HHMMSS-xxxx` 编号所示的 UTC 时间，取不晚于其第一条账本行的最近一次；当时正在运行的周期认领它。
- 简报第一节统计没有任何人员或监督者步骤就交付的工单，把每个调度周期各列一行，并以引入审计与审阅控制项的提交为它们注明日期。
- README 中英文对不再载有任何数字；它链接到会重新生成的界面。
- `enterprise-ops.ts` 只在本地运行时收集操作员自己的 agent（`operatorAgents`）；`--push` 与 `--fixture` 从不收集。吞吐量卡片按类别统计账本条目，审阅驳回按窗口内的账本行计数。在两个班次中中止的工单，只有在某个部门运行并留下报告时才为中。指挥台去掉数据源同时列出其已提交记录的运行的临时副本，因此默认的代码安全运行是其事件流确有事件的那一个。

## Consequences

执行摘要、简报与指挥台在每个周期都按这些规则重新生成。读者在不同界面之间比较的数字，各自只来自一次计算。

## Verification

`scripts/enterprise-briefing.spec.ts` 覆盖推断出的班次与中止原因；`scripts/enterprise-ops.spec.ts` 覆盖没有部门运行的重复中止；`apps/command-deck/tests/feed.spec.ts` 覆盖运行列表，`apps/command-deck/tests/ops.spec.ts` 覆盖窗口内的驳回。

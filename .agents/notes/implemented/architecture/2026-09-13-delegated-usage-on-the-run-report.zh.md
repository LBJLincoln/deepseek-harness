# Agent Note：运行报告上的被委派用量

Status: implemented

[English](2026-09-13-delegated-usage-on-the-run-report.md) | 中文

## Problem

一份运行报告的 `usage` 是 cell 会话自身 assistant 消息的总和，而被委派的运行没有这样的消息：它的每次尝试都是一次子运行，每个子进程的花费记录在 cell 的 `environment/delegation` 事件上，作为 `reportedUsage`（进程外子进程）或 `usage`（本进程为其求和的进程内子进程），并作为 `usage/foreign` 计入 cell 的预算。报告却让 `usage` 缺席，于是报告的每个消费者都把被委派的 arm 读成什么都没花：fleet 的排行榜行为它求和出零个 token，实验的 `spend` 与 token delta 只度量 harness 原生的那一个 arm，而 2026-09-08 丢弃臂的离线折叠不得不用一个临时脚本从委派事件中取得候选臂的花费，而不是从它所折叠的报告中取得。cell 的预算早已计入这些 token；只有报告没有。

## Decision

运行器把会话 assistant 消息报告的用量与每次委派计入 cell 的用量求和成一个 `usage`：子进程后端公布了 `reportedUsage` 时取它，否则取进程内子进程自身求和的 `usage`，这正是 `recordForeignSpend` 写下的那笔费用。一次运行要么自己驱动轮次，要么委派它们，绝不两者兼有，因此这个总和永远不会把一个 token 按两种视角计两次。没有任何消息也没有任何子进程报告用量时，`usage` 仍然缺席，后端不公布用量的子进程就是这种情形；那个 cell 只受墙上时间上限约束，运行器 README 已经如此说明。报告类型、运行器 README 与实验 README 中关于被委派花费的限制条目都如此陈述；fleet 与实验的求和无需改动，因为它们本来就从每个有报告的 cell 读取 `usage`。

## Alternatives considered

- **增加第二个字段 `foreignUsage`，让 `usage` 保持原生。** 拒绝：每个跨 arm 求和花费的消费者都得把两个字段相加并决定它们的优先级，而这正是运行器在计入预算时已经做出的决定；一个字段一个已记载的含义，让 fleet 与实验保持不变。
- **改为在 fleet 与实验中读取委派事件。** 拒绝：二者折叠的是报告而不是会话日志，报告是运行器对该次运行花费的陈述；一个必须从日志重新推导报告字段的消费者，会让这个字段成为谎言。
- **保持报告不变并记载那个临时脚本。** 拒绝：`data/proving-ground/` 中每个被委派 arm 的记录花费都是在 harness 之外算出来的，而这正是本仓库的运行所要避免的。

## Consequences

fleet 的行、实验的 spend 与 token delta 现在包含被委派的 cell，因此 route arm 与被委派 arm 的比较，比较的是一份 harness 日志的计数与一个产品公布的计数，实验 README 如此说明。本次改动之前写出的记录中，被委派 cell 的报告没有 `usage`，并按原样留存；会话日志保有委派事件，之后的折叠可以重新计算它们。运行器的包测试断言了一对进程内子进程的求和用量，以及一个上报了用量的进程外子进程与一个没有上报的子进程并置时的用量。

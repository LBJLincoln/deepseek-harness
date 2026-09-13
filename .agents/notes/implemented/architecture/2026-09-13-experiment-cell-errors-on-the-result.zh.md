# Agent Note：实验结果上的 cell 错误

Status: implemented

[English](2026-09-13-experiment-cell-errors-on-the-result.md) | 中文

## Problem

一场实验的结果以每个 cell 上的 `unpaired` 陈述有多少次重复未能配对，却从不说明原因。fleet 把一个没有产出报告的 cell 保留为一个 `FleetCellError`（运行器抛出的代码与消息，或 fleet 为一个从未启动的 cell 记下的自身代码），并在只供观察的 `fleet/cell` 事件上宣布它，但实验服务把两份 fleet 报告折叠成的结果丢掉了每一个错误，而基准驱动器只写出那份结果。2026-09-08，路由假设的丢弃臂把整个候选臂输给了一个叠加层没有组合进来的 subagent provider：存下来的结果读作 `inconclusive`，`seedsPaired: 0`，十六次重复 `unpaired`，却没有十六次 `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` 拒绝的任何痕迹，于是原因是靠手工重跑一个 cell 找回来的。如今在任何 cell 运行之前就拒绝不可用 provider 的预检（[说明](../../proposed/architecture/2026-09-08-implementer-preflight-and-include-patch-gate.md)）关闭的是这一个原因，而不是这一类：一个运行中途抛出的 cell、一条被熔断器停止调度的路由，或一个在计划的 token 上限处未被启动的 cell，仍然不会在结果上留下任何印记。

## Decision

`ExperimentResult`携带 `errors`：两个 arm 中任一方保留为错误的每一个 cell，baseline arm 在先，每个 arm 按其 fleet 的 cell 顺序，形如 `{ arm, environment, repetition, code?, message }`。折叠原样复制 fleet 的 `FleetCellError`，不做任何解读；每一项对应其环境的 cell 上计入 `unpaired` 的一次重复，并带着原因。该字段在类型上是必填的，所有 cell 都产出报告的实验携带 `[]`，因此一份存下来的结果自身是完整的，读者永远不必判断缺失的字段意味着没有错误还是写入者较旧。各 cell 的比率、花费、区间与裁决不变，只读取裁决与 arm 的观测台不受影响。按发布前的立场，本次改动之前写出的结果缺少该字段，并按原样留存在 `data/proving-ground/` 之下；没有任何东西把存下来的结果读回该类型。

## Alternatives considered

- **把两份 `FleetRunReport` 持久化在结果旁边。** 拒绝：这些报告重复了会话已经持有的每个 cell 的 stamp、尝试与用量，而结果是对会话的折叠。会话说不出的，是一次重复为何根本没有会话，而这正是结果欠读者的那一件事。
- **让驱动器订阅 `fleet/cell` 并写自己的错误日志。** 拒绝：每个驱动器与之后的每个消费者都要重复一遍，而实验服务在折叠时已经握有两份报告。关于结果的事实属于结果。
- **在第一个 cell 错误处让实验失败。** 拒绝：因熔断器或运行中途抛出而失去一个 cell 的 arm 仍然能配对其余的 cell，配对统计在存在的配对上依然成立。现在错误说明的是失去了什么，而不是丢弃已经测得的东西。

## Consequences

一份存下来的结果以 fleet 的代码与消息点名每一次未配对重复的原因，代价是结果行上每个出错的 cell 多出一项，相对会话而言很小。手工构造结果的消费者（例如观测台的测试）提供 `errors: []`。fleet 的 `fleet/cell` 事件与运行器的错误代码仍是这些事实的来源；该字段把它们复制到实验留下的持久记录上。

## Testing

包测试覆盖一个不带代码被拒绝的 cell、一个 fleet 以 `FLEET_TOKEN_CEILING_REACHED` 及其消息拒绝的 cell，以及一场没有任何配对的实验，其结果在十六次未配对重复旁列出八个错误，每个 arm 四个。

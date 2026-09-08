# @deepseek-ai/dsh-fleet

[English](README.md) | 中文

Fleet 运行：harness 能力计划的确定性主干。一个计划指定环境、模型路由与重复次数；fleet 把每个环境 × 模型 × 重复的 cell 各自在全新工作区里通过环境运行器运行，按计划顺序保留每个 cell 的报告或失败，并折叠出一张排行榜，每个模型路由与环境一行。行绝不会跨隔离级别或跨留出划分求平均；两者始终是消费者据以分区的列。[四目标工作流 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) 承载设计理由。

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
- id: environment-runner
  name: '@deepseek-ai/dsh-environment-runner'
  config:
    isolation: none
- id: fleet
  name: '@deepseek-ai/dsh-fleet'
  config:
    maxConcurrent: 4
    routeBreaker:
      consecutiveErrors: 3
    workspaceRetention: remove-certified
```

| 字段 | 含义 |
|---|---|
| `maxConcurrent`（默认 `1`） | 同时在途的 cell 数；每个 cell 都是自己的会话与工作区目录，因此该上界是对 agent 与检查进程的预算，而非正确性条件。 |
| `routeBreaker.consecutiveErrors`（可选） | 一个计划内同一条模型路由连续多少个错误 cell 之后，fleet 停止为该路由排程。缺省时无论失败多少次都继续排程该路由，供应商故障会因此耗掉整个计划。 |
| `workspaceRetention`（必填） | `keep`、`remove-certified` 或 `remove-all`：每个 cell 的结果被记录之后，其 `cell-*` 目录的去向。记录是会话日志而非检出目录，因此长期运行的部署要声明为便于检查而保留多少检出内容。 |

该服务需要 `environments`、`environmentRuns` 与 `agentDefaultModel`。`resolveConfig(config)` 是导出的默认值解析步骤。

## Service contract

`ctx.fleet.run(plan)` 接受 `environments`（按给定顺序的 `{ ids }`，或按注册顺序对注册表解析的 `{ filter }`）、每个 cell **第一次**尝试所运行的 `models`（空列表运行组合中来自 `agentDefaultModel` 的默认路由）、可选的、每次尝试一个档位的 `ladder`、可选的、运行每个 cell 的 `implementer`、正整数 `repetitions`、可选的精确 `cells` 选择、一个已存在的绝对路径 `workspaceRoot`、可选的 `group`、可选的 `district`、可选的 `policyVersion`、可选的基准 `seed`、可选的正整数 `tokenCeiling` 与可选的 `signal`。它在运行任何 cell 之前以 `FleetError` 拒绝：`repetitions` 或 `tokenCeiling` 非正或非整数、`seed` 不是安全的非负整数、没有任何档位的 `ladder`、注册表中没有的 id，或者为空、或点名了该计划并不枚举的 cell 的 `cells` 选择，均为 `FLEET_INVALID_PLAN`；环境选择不匹配任何环境为 `FLEET_EMPTY_PLAN`。

## Policy version and the base seed

`policyVersion` 点名该计划的路由所服务的检查点或策略；每个 cell 的运行 stamp 都原样携带它，因此 fold 可以按它给测得的难度建键。`seed` 是该计划的**基准**种子，每个 cell 以 `seed + repetition` 运行，因此同一个重复序号在该计划的每条路由和每个环境上都意味着同一个种子——这正是让配对设计比较同类的原因。基准值只在计划边界校验一次，因为这个算术是 fleet 做的：运行器会拒绝的基准值不该表现为每个 cell 各自失败。种子记录的是一次运行请求了什么，绝不是提供方拿它做了什么；[运行器 README](../environment-runner/README.md#sampling-and-what-a-replay-reproduces) 拥有 replay 能与不能复现什么。

cell 以环境为主序、其次模型、再次从 `0` 起的重复序号枚举，并通过 `ctx.environmentRuns.run` 运行，同时在途至多 `maxConcurrent` 个。点名了 `cells` 的计划只运行这些 cell，且仍按计划顺序，因此恢复一个只跑了一半的计划的驱动器能保住每个 cell 的环境、路由与重复序号，而不必把它们改写成一个重复序号又从零开始的更小计划。`fleetCellKey(cell)` 是消费方为 cell 建立索引所用的身份，无论是在它自己维护的台账里，还是对照会话日志中已有的运行 stamp。每个 cell 在 `workspaceRoot` 下获得一个全新的 `cell-*` 目录，并把计划的 `group`（或铸造的 `fleet-<uuid>`）、其重复序号与计划的 `district` 带入运行 stamp，因此该批次的每个会话都在自己的日志中被持久地归组。每个 cell 工作区在 `workspaceRoot` 下都与其他工作区并列，与驱动器写在那里的任何东西为邻，因此 runner 在一次运行期间拒绝每个 cell 访问自己工作区之上的一切（[`dsh-environment-runner`](../environment-runner/README.md)）。运行抛出的 cell 保留为 `{ cell, error }`，错误带有 harness 错误码时一并保留；fleet 运行本身绝不因某一个 cell 而失败。

有两种情况在 cell 启动之前拒绝它，因此每个计划都为每个 cell 保留一行，runs 与 errors 两列也保持诚实。一条模型路由连续产生 `routeBreaker.consecutiveErrors` 个错误结果之后，它余下的 cell 被记录为 `FLEET_ROUTE_BREAKER_OPEN` 错误，消息点名该路由与该计数；有报告的 cell 会重置该路由的计数，且熔断器按计划生效。已在手的报告的输入加输出 token 之和越过 `tokenCeiling` 之后，每个尚未启动的 cell 被记录为 `FLEET_TOKEN_CEILING_REACHED` 错误，而已经在途的 cell 照常完成。被拒绝的 cell 不铸造工作区，也既不折叠进熔断器也不折叠进 spend。

`ladder` 被原样转发给每个 cell，因此一个计划就是一条阶梯：每个 cell 的第 `i` 次尝试运行在 `ladder[i - 1].model` 上，该档位未命名模型时则运行在该 cell 自己的路由上，而阶梯的长度就是每个 cell 的尝试上界。档位数上限属于运行器的配置，因此超过它的阶梯让每个 cell 失败而非让计划失败；只有完全没有档位的阶梯在这里被拒绝一次，因为那是任何 cell 都无法完成的算术。[运行器 README](../environment-runner/README.md#the-attempt-ladder) 拥有一个档位意味着什么，以及每种实现者如何切换路由。

`implementer` 被原样转发给每个 cell，因此一个计划就是一个实现者，由它折叠出来的行绝不混合两者：`{ kind: 'route' }`（默认）让每个 cell 跑在自己的模型路由上，而 `{ kind: 'subagent', provider, label? }` 把每个 cell 的每次尝试委派给那个已注册的 subagent provider。[运行器 README](../environment-runner/README.md#the-two-implementers) 拥有被委派的证书证明了什么，以及高于 `none` 的隔离声明会拒绝哪些 provider。

计划的实现者在任何 cell 被枚举之前、任何工作区被铸出之前，经由 `ctx.environmentRuns.checkImplementer` 针对计划点名的每一条路由接受检查——计划的第一级阶梯档位点名了模型时就是它，否则就是计划自身的每一条路由，这也正是运行器为每个 cell 盖章的东西。运行器的 `EnvironmentRunError` 原样向上传递，于是组合并不持有的 provider 拒掉的是整份计划，而不是它的每一个 cell：一份全是错误 cell 的计划会把整轮运行花光，只为产出一块没有任何东西跑过的排行榜。

报告携带 `group`、按计划顺序的每个 cell 结果、整次运行的 `spend`（`inputTokens` 与 `outputTokens`），以及 `leaderboard`：按模型路由与环境，给出环境 kind 与 `heldOut` 标志、运行所升级经过的 `ladder`、运行所声明的 `isolation` 与其被盖上的 `implementer`（该行全部 cell 在运行前失败时三者都缺省，且计划未命名阶梯时 ladder 同样缺省）、`runs`、`errors`、`certified`、`certificateRate`、`attemptsMean`，以及求和的 `inputTokens` 与 `outputTokens`。`leaderboardMarkdown(report)` 把同样的行渲染为一张供人阅读的 Markdown 表格；报告仍是记录，会话日志仍是权威。

工作区保留在 cell 的结果到手之后执行：`remove-certified` 删除运行已认证的 cell 的 `cell-*` 目录，`remove-all` 无论该 cell 是有报告还是失败都删除，`keep` 什么都不删除。

## `fleet/cell` 事件

在一个 cell 的结果被记录、其保留策略执行完毕之后，fleet 立即发出只供观察的 Cordis 事件 `fleet/cell`，携带计划的 `group`、存在时的 `district`、该 `cell`，以及 `reported`（带运行器的 `sessionId` 与 `certified` 标志）或 `error`（带失败的代码与消息）之一的 `outcome`。每个 cell 一个事件，按结算顺序——只有当 `maxConcurrent` 为 `1` 时它才等于计划顺序。监听器无法改变结果，其失败也被隔离，因此像[班次驱动器](../shifts/README.md)这样的观察方无需持有本报告即可写下自己的逐 cell 记录；[Cordis 目录](../../../docs/subsystems/improvement.md#cordis-surface)记录了该声明。

## Model Experience

None, as the fleet only schedules environment runs; the environment runner owns every model-visible effect of each cell, and nothing the fleet holds enters a model request.

#### KV Cache effect

None; the fleet neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **排行榜是一次 fleet 运行的折叠**——跨运行比较、跨变体的配对设计与置信区间要从会话日志读取 `environment/run` stamp 与证书；本包只折叠它刚刚产生的报告。
- **采样以重复次数为准**——带提前停止的分组采样、按 cell 的预算与重试策略在策略插件出现之前属于调用方。
- **上限与熔断器按计划生效**——两者都在每次 `run()` 调用时重新开始，因此跨多个计划的班次要自行折叠它跨计划的 spend 与路由健康度。
- **cell 错误只携带代码与消息**——抛出错误的栈与 cause 留在进程内，在运行之前就失败的 cell 不留下会话；已运行的 cell 在自己的会话日志中以 `verification/run` 事件记录每次尝试，跨运行的折叠从那里读取运行证据。

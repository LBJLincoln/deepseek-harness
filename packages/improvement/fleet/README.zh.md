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
```

| 字段 | 含义 |
|---|---|
| `maxConcurrent`（默认 `1`） | 同时在途的 cell 数；每个 cell 都是自己的会话与工作区目录，因此该上界是对 agent 与检查进程的预算，而非正确性条件。 |

该服务需要 `environments`、`environmentRuns` 与 `agentDefaultModel`。`resolveConfig(config)` 是导出的默认值解析步骤。

## Service contract

`ctx.fleet.run(plan)` 接受 `environments`（按给定顺序的 `{ ids }`，或按注册顺序对注册表解析的 `{ filter }`）、`models`（空列表运行组合中来自 `agentDefaultModel` 的默认路由）、正整数 `repetitions`、一个已存在的绝对路径 `workspaceRoot`、可选的 `group` 与可选的 `signal`。它在运行任何 cell 之前以 `FleetError` 拒绝：`repetitions` 非正或非整数、或注册表中没有的 id 为 `FLEET_INVALID_PLAN`，选择不匹配任何环境为 `FLEET_EMPTY_PLAN`。

cell 以环境为主序、其次模型、再次从 `0` 起的重复序号枚举，并通过 `ctx.environmentRuns.run` 运行，同时在途至多 `maxConcurrent` 个。每个 cell 在 `workspaceRoot` 下获得一个全新的 `cell-*` 目录，并把计划的 `group`（或铸造的 `fleet-<uuid>`）与其重复序号带入运行 stamp，因此该批次的每个会话都在自己的日志中被持久地归组。运行抛出的 cell 保留为 `{ cell, error }`，错误带有 harness 错误码时一并保留；fleet 运行本身绝不因某一个 cell 而失败。

报告携带 `group`、按计划顺序的每个 cell 结果，以及 `leaderboard`：按模型路由与环境，给出环境 kind 与 `heldOut` 标志、运行所声明的 `isolation`（该行全部 cell 在运行前失败时缺省）、`runs`、`errors`、`certified`、`certificateRate`、`attemptsMean`，以及求和的 `inputTokens` 与 `outputTokens`。`leaderboardMarkdown(report)` 把同样的行渲染为一张供人阅读的 Markdown 表格；报告仍是记录，会话日志仍是权威。

## Model Experience

None, as the fleet only schedules environment runs; the environment runner owns every model-visible effect of each cell, and nothing the fleet holds enters a model request.

#### KV Cache effect

None; the fleet neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **排行榜是一次 fleet 运行的折叠**——跨运行比较、跨变体的配对设计与置信区间要从会话日志读取 `environment/run` stamp 与证书；本包只折叠它刚刚产生的报告。
- **采样以重复次数为准**——带提前停止的分组采样、按 cell 的预算与重试策略在策略插件出现之前属于调用方。
- **工作区从不删除**——每个 `cell-*` 目录都留在 `workspaceRoot` 下供检查；想要干净根目录的调用方自行删除。
- **cell 错误只携带代码与消息**——抛出错误的栈与 cause 留在进程内，在运行之前就失败的 cell 不留下会话；已运行的 cell 在自己的会话日志中以 `verification/run` 事件记录每次尝试，跨运行的折叠从那里读取运行证据。

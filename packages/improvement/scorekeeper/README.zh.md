# @deepseek-ai/dsh-scorekeeper

[English](README.md) | 中文

把会话日志当作数据集。`sessionFacts` 投影单元把一个活动会话折叠为四组事实，`ctx.scorekeeper` 从已持久化日志折叠出同样的分组：每会话一条记录、一张按模型路由、环境、隔离级别与留出划分分组的记分板，以及一份 JSONL 导出。服务经会话持久化 seam 读取，不写任何会话事件。[记分员 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md) 承载设计理由。

## Config

```yaml
- id: persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: './.sessions'
- id: scorekeeper
  name: '@deepseek-ai/dsh-scorekeeper'
  config:
    passAtK: [1, 8]
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `passAtK` | `[1]` | 记分板估计 pass@k 时抽取的重复次数。会排序并去重；该行没有任何批次达到的 `k` 不出现在该行中。 |

服务需要一个会话持久化后端。只有在组合了投影注册表（`@deepseek-ai/dsh-session-projection`）时，它才注册 `sessionFacts` 投影单元。

## Service contract

`ctx.scorekeeper.facts(sessionId)` 通过 `ctx.sessionPersistence.inspect()` 读取一个已持久化会话并返回其 `SessionFactsRecord`；无法读取的会话，或 goal 与验证事件流有缺陷的会话，会被拒绝。

`ctx.scorekeeper.leaderboard({ sessions?, group?, heldOut? })` 折叠每个指定会话（`sessions` 缺省时为全部已持久化会话），并把已盖章的会话归入各行。无法读取或折叠的会话连同原因加入 `skipped`，折叠继续；日志中没有 `environment/run` stamp 的会话计入 `unstamped`，因为没有任何行能指名它的单元格；被 `group` 或 `heldOut` 条件拒绝的已盖章会话计入 `excluded`。

`ctx.scorekeeper.exportFacts({ sessions?, sink })` 为每个会话把 `JSON.stringify(record) + '\n'` 写入 `sink.write()`，并在最后一次写入之后或失败之后恰好关闭 sink 一次。该 sink 就是轨迹导出器的 `TrajectorySink`，因此 `@deepseek-ai/dsh-trajectories` 的 `jsonlFileSink(path)` 同时服务两种导出。

`foldSessionFacts(meta, events)` 是这三者背后的纯投影，连同投影单元驱动的增量 `applySessionFacts`、`foldScoreboard` 行折叠与 `unbiasedPassAtK` 一起导出，供测试与离线工具使用。

## Fact groups and their source events

每个字段都折叠自一个具名会话事件，没有任何推断。字段名在 TypeScript 中以及每一处导出中都使用 camelCase。

### Identity and provenance

| 字段 | 来源 |
|---|---|
| `sessionId`、`createdAt` | 已存储的会话头（仅 `facts()` 与 `exportFacts()`；投影值本身已由其会话定址） |
| `environment.environmentId`、`.environmentKind`、`.heldOut`、`.repetition`、`.group`、`.contentSha256`、`.provider`、`.model`、`.isolation` | `environment/run` stamp；未被运行器盖章的会话没有该字段 |
| `requestProvider`、`requestModel` | 最后一条 `request/header` 的 `config.provider` 与 `config.model` |

### Outcome

| 字段 | 来源 |
|---|---|
| `reward`、`rewardBasis` | 轨迹奖励折叠，读取 `goal/change` 与各 `verification/*` 事件 |
| `certified`、`certificateRevision` | 验证折叠中覆盖当前标准修订的证书 |
| `runsRecorded` | `verification/run` 事件，无论通过与否 |
| `attempts` | 最后一条 `verification/run` 的 `attempt`；每编写一个标准便从一重新开始 |
| `directives` | `verification/directive` 事件 |
| `relaxations` | 当前标准被放宽的检查（`verification/relaxation`） |
| `goalPhase`、`goalRoundsCap` | 当前 `goal/change` 快照 |
| `goalRoundsStarted` | 已准入的续跑轮次，来自读取 `goal/change` 与 goal 来源 `user/message` 的 goal 折叠 |
| `budgetBreachCap` | 最后一条 `budget/breach` 的 `cap` |

### Efficiency

| 字段 | 来源 |
|---|---|
| `turns`、`steps` | `turn/start` 与 `step/start` 事件 |
| `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens` | 每条 `assistant/message` 的 `usage`；同一步更早的 `assistant/chunk` 样本刻意不重复计入 |
| `wallMs` | 日志首末事件的时间 |

### Tool behavior

| 字段 | 来源 |
|---|---|
| `toolCalls`、`toolCallsByName` | `tool/call` 事件 |
| `toolErrors` | 模型可见块报告错误的 `tool/result` 事件 |
| `toolTimeouts` | 其中 `error.code` 为 `TOOL_TIMEOUT` 的（`@deepseek-ai/dsh-tool-call-timeout-policy`） |
| `toolAborts` | 其中 `error.code` 为 `ABORTED` 或 `ABORTED_BEFORE_DISPATCH` 的（`@deepseek-ai/dsh-tools`） |

## Scoreboard rows

一行是一个模型路由在一个环境、一个隔离级别、留出划分的一侧上的结果；任何一行都不会跨隔离级别或跨该划分求平均。`runs` 统计至少记录了一次 `verification/run` 的会话，`errors` 统计一次也没有记录的已盖章会话，因此没有产生运行就结束的单元格是一列而不是缺失的行。`certificateRate` 为 `certified / runs`，`attemptsMean` 为有运行的会话上 `runsRecorded` 的均值，二者在没有运行时都为 `0`；token 求和覆盖该行的每个会话，含出错的会话。

`stats` 从该行会话所属的重复批次估计难度：对每个含 `n` 个会话、其中 `c` 个取得证书的批次，pass@k 为无偏的 `1 - C(n - c, k) / C(n, k)`，该行的取值是在会话数不少于 `k` 的批次上求均值。stamp 不带 `group` 的会话不加入任何批次。

## Model Experience

无。记分员把已提交事件折叠为投影值并读取已持久化日志，不向任何模型请求添加内容。

#### KV Cache effect

无；该服务既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **投影值在每个事件上都变化**——`wallMs` 跨越整个日志，因此没有任何已提交事件会让 `sessionFacts` 状态引用保持不变，订阅的载体每个事件都会收到一次通知。
- **尚无来源事件的字段组**——[四目标工作流 note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) 指名的过程质量、评审打分、安全与监督、训练与数据在此不产出任何字段：`signoff/recorded`、组合清单、监督监视器、评审团以及策展方的同意与脱敏事件都尚不存在。
- **shell 退出码不可观测**——bash 结果的退出码位于工具自身的模型可见输出内，而非某个会话事件字段，因此 `shellNonzeroExits` 不是字段；这需要先有一个工具自有的结果事件。
- **成本不是字段**——定价位于 `@deepseek-ai/dsh-budget-policy` 的配置而非日志中，因此事实记录陈述 token 并指名被突破的上限，但从不给出欧元金额。
- **每会话一个标准**——结果分组读取会话的验证折叠，其中只有一个完成标准；度量多个 goal 的会话按生效中的标准评分。
- **各行不可跨舰队运行比较**——记分板只折叠过滤器选中的内容；配对设计、置信区间与跨运行比较属于四目标 note 指名的实验插件。

# @deepseek-ai/dsh-scorekeeper

[English](README.md) | 中文

把会话日志当作数据集。`sessionFacts` 投影单元把一个活动会话折叠为四组事实，`ctx.scorekeeper` 从已持久化日志折叠出同样的分组：每会话一条记录、一张按模型路由、环境、隔离级别、实现者、留出划分与区（district）分组的记分板，以及一份 JSONL 导出。服务经会话持久化 seam 读取，不写任何会话事件。[记分员 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md) 承载设计理由。

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

`ctx.scorekeeper.leaderboard({ sessions?, group?, heldOut? })` 折叠每个指定会话（`sessions` 缺省时为全部已持久化会话），并把已盖章的会话按模型路由、环境、隔离级别、实现者、留出划分与区归入各行。无法读取或折叠的会话连同原因加入 `skipped`，折叠继续；日志中没有 `environment/run` stamp 的会话计入 `unstamped`，因为没有任何行能指名它的单元格；被 `group` 或 `heldOut` 条件拒绝的已盖章会话计入 `excluded`。

`ctx.scorekeeper.exportFacts({ sessions?, sink })` 为每个会话把 `JSON.stringify(record) + '\n'` 写入 `sink.write()`，并在最后一次写入之后或失败之后恰好关闭 sink 一次。该 sink 就是轨迹导出器的 `TrajectorySink`，因此 `@deepseek-ai/dsh-trajectories` 的 `jsonlFileSink(path)` 同时服务两种导出。

`foldSessionFacts(meta, events)` 是这三者背后的纯投影，连同投影单元驱动的增量 `applySessionFacts`、`foldScoreboard` 行折叠与 `unbiasedPassAtK` 一起导出，供测试与离线工具使用。

## Fact groups and their source events

每个字段都折叠自一个具名会话事件，没有任何推断。字段名在 TypeScript 中以及每一处导出中都使用 camelCase。

### Identity and provenance

| 字段 | 来源 |
|---|---|
| `sessionId`、`createdAt` | 已存储的会话头（仅 `facts()` 与 `exportFacts()`；投影值本身已由其会话定址） |
| `environment.environmentId`、`.environmentKind`、`.heldOut`、`.repetition`、`.group`、`.district`、`.contentSha256`、`.provider`、`.model`、`.isolation`、`.implementer` | `environment/run` stamp；未被运行器盖章的会话没有该字段；不点名 `implementer` 的 stamp 折叠为 `route`，即由该运行自身模型路由实现 |
| `requestProvider`、`requestModel` | 最后一条 `request/header` 的 `config.provider` 与 `config.model` |
| `compositionSha256` | 最后一条 `composition/manifest`（`@deepseek-ai/dsh-components-manifest`）的 `compositionSha256`；日志中没有该事件的会话没有该字段 |

### Outcome

| 字段 | 来源 |
|---|---|
| `reward`、`rewardBasis` | 轨迹奖励折叠，读取 `goal/change` 与各 `verification/*` 事件 |
| `certified`、`certificateRevision`、`certificateExecutor` | 验证折叠中覆盖当前标准修订的证书，以及它所引运行的执行者 |
| `parity` | 最后一条 `verification/run` 的 `parity`；该次运行没有度量用例时不存在 |
| `tamper` | 最后一条 `verification/run` 的 `verdict`；会话一次运行也没有记录时为 `not-instrumented` |
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
| `pricedSteps` | `usage/priced` 事件（`@deepseek-ai/dsh-budget-policy`） |
| `costEur` | 这些事件所述 `costEur` 之和 |
| `pricingDigests` | 它们互不相同的 `pricingDigest` 取值，按首次出现的顺序 |

折叠不接受定价表：成本就是 `usage/priced` 记录自身携带的金额之和，因此部署对某条路由重新定价，无法改变一次已经跑完的会话花了多少。只有当每一条报告了 `usage` 的 `assistant/message` 都在同一 turn 与 step 上有一条 `usage/priced` 时，`costEur` 才出现，所以跑过未定价路由的会话根本不陈述成本，而不是只陈述其已定价步骤那份更低的成本；日志中没有任何携带 usage 的消息的会话，成本为 `0`。`pricingDigests` 有两个或更多，意味着该日志是在不止一个定价表版本下定价的，`costEur` 是跨表求和。

### Tool behavior

| 字段 | 来源 |
|---|---|
| `toolCalls`、`toolCallsByName` | `tool/call` 事件 |
| `toolErrors` | 模型可见块报告错误的 `tool/result` 事件 |
| `toolTimeouts` | 其中 `error.code` 为 `TOOL_TIMEOUT` 的（`@deepseek-ai/dsh-tool-call-timeout-policy`） |
| `toolAborts` | 其中 `error.code` 为 `ABORTED` 或 `ABORTED_BEFORE_DISPATCH` 的（`@deepseek-ai/dsh-tools`） |

## Scoreboard rows

一行是一个模型路由与一个实现者在一个环境、一个隔离级别、留出划分的一侧、一个区上的结果；任何一行都不会跨实现者、隔离级别、该划分或跨区求平均，因此同一环境上的外部 coding agent 与 harness 自身路由保持为两行，按区扣留的发布也是整行丢弃，而不是把它们混合。`runs` 统计至少记录了一次 `verification/run` 的会话，`errors` 统计一次也没有记录的已盖章会话，因此没有产生运行就结束的单元格是一列而不是缺失的行。`certificateRate` 为 `certified / runs`，`attemptsMean` 为有运行的会话上 `runsRecorded` 的均值，二者在没有运行时都为 `0`；token 求和覆盖该行的每个会话，含出错的会话。

另有三列陈述发布在这些比率之外所需要的东西。`tampered` 统计最后一次记录运行带 `tampered` 裁决的会话；一行的 `errors` 恰好就是它的未插桩会话，因为没有记录运行的会话没有裁决可读。`compositionSha256` 是该行每个会话都陈述的摘要，某个会话没有陈述或两者不一致时缺席，因此只覆盖一行中一部分的摘要绝不归因整行。`certificateExecutors` 按首次出现顺序保存该行已认证会话的去重 executor：没有认证任何东西的行为空，有两个或更多则表示该行的证书彼此不一致，任何单一 executor 都不得与其比率并列发布。

`certificateRate` 与 `parity` 是两列，并且始终是两列。证书度量——`certified`、`certificateRate` 以及建立在它之上的 `stats` 估计——说的是每个活动检查的每个用例都通过了。`parity` 是该行度量了用例的会话上 `weightPassed / weightTotal` 的均值，没有任何这样的会话的行没有它；无论一个会话被多少用例采样，它都只计一次。本包渲染的任何东西都不把二者合并成一个分数，也不跨它们排名：达到了标准大部分用例权重的行与取得证书的行，是关于这份工作的两个不同事实，做排名的消费方只读其中一列。[ProgramBench 的区分](../../../.agents/notes/proposed/architecture/2026-09-06-competitive-baselines.md)正是同一个。

`costEurPerCertified` 是该行取得证书的会话上 `costEur` 的均值，`pricingDigests` 是该行每个会话（含出错的与未取得证书的）互不相同的摘要。没有任何会话取得证书的行没有该均值；该行只要有一个取得证书的会话不陈述成本，也没有该均值——这样发布出去的每证书成本，绝不会把一个未定价的会话当作免费会话计入。

`stats` 从该行会话所属的重复批次估计难度：对每个含 `n` 个会话、其中 `c` 个取得证书的批次，pass@k 为无偏的 `1 - C(n - c, k) / C(n, k)`，该行的取值是在会话数不少于 `k` 的批次上求均值。stamp 不带 `group` 的会话不加入任何批次。

## Model Experience

无。记分员把已提交事件折叠为投影值并读取已持久化日志，不向任何模型请求添加内容。

#### KV Cache effect

无；该服务既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **投影值在每个事件上都变化**——`wallMs` 跨越整个日志，因此没有任何已提交事件会让 `sessionFacts` 状态引用保持不变，订阅的载体每个事件都会收到一次通知。
- **尚无来源事件的字段组**——[四目标工作流 note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) 指名的过程质量、评审打分、安全与监督、训练与数据在此不产出任何字段：`signoff/recorded`、监督监视器、评审团以及策展方的同意与脱敏事件都尚不存在。
- **shell 退出码不可观测**——bash 结果的退出码位于工具自身的模型可见输出内，而非某个会话事件字段，因此 `shellNonzeroExits` 不是字段；这需要先有一个工具自有的结果事件。
- **成本只覆盖已定价的路由**——部署的定价表未指名的路由不记录 `usage/priced`，因此触及这类路由的会话不陈述 `costEur`，包含它的每一行也不陈述 `costEurPerCertified`。要让每个会话都有成本，部署就要为自己运行的每条路由定价。
- **每会话一个标准**——结果分组读取会话的验证折叠，其中只有一个完成标准；度量多个 goal 的会话按生效中的标准评分。
- **各行不可跨舰队运行比较**——记分板只折叠过滤器选中的内容；配对设计、置信区间与跨运行比较属于四目标 note 指名的实验插件。

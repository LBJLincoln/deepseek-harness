# Agent Note: The scorekeeper

Status: proposed

[English](2026-09-05-scorekeeper.md) | 中文

## Problem

今天一次 fleet 运行报告的每个数字都只活在产生它的那个进程里。`@deepseek-ai/dsh-fleet` 从自己 `run()` 收集到的报告折叠出 `LeaderboardRow`，因此排行榜随进程一同消亡：重启、第二个批次，或者一周之后提出的问题，都没有任何东西可以折叠。[四目标工作流 note](2026-09-05-four-goal-workflows.md) 陈述的是相反的原则——日志就是数据集，每个指标都必须能从第一性原理重新算出——并指名了一个跨八个分组、共 180 个字段的记分板行 schema、一个 `SessionFacts` 投影，以及 W1 阶段 2 与 W3 阶段 2 都要读取的 `EnvironmentStats` 折叠。

原则与代码之间存在两处缺口。没有任何东西把会话日志折叠为按会话的事实，因此想要轮次、token、工具行为或尝试次数的消费方只能各自从原始事件重新推导。也没有任何东西度量难度：运行器已经为每个会话盖上环境、group 与 repetition，但没有折叠把一组重复变成 pass@k，于是套件计划没有可供筛选的实测难度，标定阶段也没有可读的内容。

180 字段的 schema 今天也无法构建。它的多数分组——过程质量、评审打分、安全与监督、训练与数据——所指名的字段其来源事件并不存在：`signoff/recorded`、组合清单、监督监视器的判定、评审团的打分、策展方的同意与脱敏记录。把它们作为可空列发布，会把空字段放进训练数据集，并诱使消费方把 `null` 读成一次测量。

## Proposal

在 `improvement/` 分组中加入 `@deepseek-ai/dsh-scorekeeper`（`ctx.scorekeeper`）：把会话日志变成行的那个折叠，别无其他。

**四个分组，每个字段都来自具名事件。** `SessionFacts` 发布身份与来源、结果、效率与工具行为。只有当今天已有会话事件承载时字段才存在：`environment/run` stamp 提供单元格身份，`request/header` 提供请求的路由，`goal/change` 与五个 `verification/*` 事件提供结果，`budget/breach` 提供停止会话的上限，`turn/start`、`step/start` 与 `assistant/message` 的用量提供效率，`tool/call` 与 `tool/result` 提供工具行为。note 的 schema 中其余四个分组在其生产者出现之前不发布任何内容，包 README 在 Known Limitations 中指名它们，使这种缺席成为被记录的缺口而非无声的缺口。字段名在 TypeScript 中以及每一处导出中都使用 camelCase，与 note 中 snake_case 的草稿不同。

**一个折叠，两副面孔。** `applySessionFacts` 是增量转移，`foldSessionFacts(meta, events)` 是整日志入口；`sessionFacts` 投影单元在 `ctx.inject` 下把前者注册到 `ctx.sessionProjections`，服务则在已持久化日志上运行后者。二者因此产生相同的值，活动载体与离线记分板不可能发生漂移。结果分组由已经拥有这些事件流的折叠决定——`foldTrajectoryReward`（为此从轨迹折叠中抽取）、`foldVerification` 与 `foldGoal`——因此记分板行报告的奖励与轨迹行报告的奖励一致，是构造使然而非评审使然。累加器保留 goal、验证与预算事件，并在其中任一到达时重新折叠；投影单元包裹严格折叠，使被拒绝的变更保持所服务的值不变，而不是撕裂读取侧。

**记分板只分组，从不求平均。** 一行是一个模型路由在一个环境、一个隔离级别、留出划分一侧上的结果，正是 fleet 排行榜已经遵守的划分。`runs` 统计至少记录了一次 `verification/run` 的会话，`errors` 统计一次也没有记录的已盖章会话，因此没有产生运行就结束的单元格是一列而非缺失的行——这回答了 note 中的幸存者偏差风险。没有 `environment/run` stamp 的会话不指名任何单元格，单独计数。

**`EnvironmentStats` 就是在运行器已经盖章的批次上求 pass@k。** 每个会话的 stamp 携带 `group` 与 `repetition`；共享同一 group 的会话构成一个批次，含 `n` 个样本、其中 `c` 个取得证书，该批次的 pass@k 是无偏的 `1 - C(n - c, k) / C(n, k)`，以乘积形式求值以免阶乘溢出。一行的估计值是在会话数不少于 `k` 的批次上求均值；小于 `k` 的批次不贡献，没有任何批次达到的 `k` 不出现在该行中。`k` 列表属于 `Config`，因为一个部署能负担多少次重复是部署的选择。

**不写任何内容。** 服务经会话持久化 seam 读取且不追加任何事件，因此组合它不会改变任何会话日志。`exportFacts` 通过轨迹导出器的 `TrajectorySink` 为每个会话写一行 JSON，因此已经为轨迹准备了 sink 的部署也就有了事实的 sink。

## Alternatives considered

**持久化一个记分板存储。** 在运行结束时写入一张持久的行表，可以在不重读日志的情况下回答查询。被拒绝，因为已存储的行是第二个真相来源，schema 变更会无声地使其失效；而且 note 的 P3 让日志成为数据集：重读是这一性质本身，不是它的代价。缓存应当位于同一折叠之后，且要等到确实测得需要时。

**把 note 的 180 个字段作为可空列发布。** 在没有生产者的地方以 `null` 发布每个已指名字段，可以让下游 schema 尽早稳定。被拒绝，因为训练或评估记录中的 `null` 与"测得的缺席"无法区分；而且 note 自身就声明：没有来源事件的指标不是字段。

**在 `dsh-fleet` 内部折叠记分板。** fleet 已经折叠排行榜，扩展它去读取已持久化日志便无需新包。被拒绝，因为 fleet 的排行榜是一次内存中运行的折叠、其行随进程消亡，而记分板必须能回答任何组合曾经持久化的每一个会话；同时保留两者，使二者之间的 e2e 比对成为真正的交叉核对而非同义反复。

**复制奖励规则。** 结果分组本可以重述轨迹折叠的奖励判定，而不是抽取 `foldTrajectoryReward`。被拒绝，因为"什么算已认证"存在两份副本，恰是排行榜无法承受的漂移；该抽取保持行为不变，且不变量伴随物会检查两个折叠在每张证书上仍然一致。

**snake_case 字段名。** note 草拟的是 `session_id`、`reward_outcome` 等。被拒绝，因为本仓库中其他每一种记录在 TypeScript 与线上都使用 camelCase，并排读取轨迹与事实的消费方不应在两者之间切换约定；需要 snake_case 的训练器可在自己的边界上改名。

## Acceptance criteria

- 当记分员与投影注册表一同组合时，`sessionFacts` 投影单元出现在 `ctx.sessionProjections.snapshot(session).values` 中；服务 fiber 被释放时消失；严格的 goal 或验证折叠拒绝某个变更时，所服务的值保持不变。
- 每个发布的字段都在包 README 中对照其折叠所依据的会话事件列表说明，且没有任何字段折叠自别处。
- `ctx.scorekeeper.leaderboard()` 在一次 fleet 运行的日志上，对每个单元格的 `runs`、`certified`、`certificateRate` 与 `attemptsMean` 都与该次 fleet 运行自身的内存排行榜一致，由 Loader 启动的示例（`examples/headless-agent/tests/fixtures/scoreboard`）证明。
- 已认证会话的 `ctx.scorekeeper.facts()` 携带 basis 为 `certificate` 的奖励 `1`、已记录的运行次数，以及非零的 token 与工具计数；`exportFacts` 为每个会话写一行并把 sink 恰好关闭一次。
- 没有记录任何 `verification/run` 的已盖章会话是其所在行的 `errors` 一列，没有 stamp 的会话计入 `unstamped` 而非被丢弃。
- 包不变量以 `verification/run` 事件的原始计数重算 `runsRecorded`、以奖励折叠的判定重算 `certified`、以 `environment/run` stamp 声明的隔离级别重算证书的隔离级别，并由一个无密钥测试证明最后一条关系会拒绝在另一隔离级别下取得的证书。

## Rollout

1. 本 note、该包、`sessionFacts` 投影单元、带 pass@k 的记分板、JSONL 导出，以及在 fleet-run 栈之上由 Loader 启动的示例。
2. 一旦预算策略读取 fleet 计划中的按单元格预算，就把它们呈现为事实：被突破的上限已经是字段，配置的限额还不是。
3. 生产者稍后到达的那些分组——带 `signoff/recorded` 与组合清单的过程质量、带监视器判定的安全与监督、带策展方同意与脱敏记录的训练与数据——各自随其生产者加入，绝不先于它。
4. 跨运行比较：配对设计、自助法置信区间与每张证书的成本属于[四目标工作流 note](2026-09-05-four-goal-workflows.md) 指名的实验插件，它读取这些行而非取代它们。

## Risks

在每个 goal 或验证事件上重新折叠已保留的这些事件，其代价与它们的数量成平方关系。一个会话每次尝试只记录少量此类事件，因此实际代价有界；记录了数千次验证变更的会话会为此付出代价，一旦出现这种情况，状态为纯 JSON 的增量严格折叠就是修法。

`sessionFacts` 的值在每个已提交事件上都会变化，因为 `wallMs` 跨越整个日志，所以订阅的载体是每事件收到一次通知，而不是每次有意义的变化收到一次。从投影中去掉 `wallMs` 可以恢复安静路径，但代价是失去 note 指名的一个字段；这里接受这种抖动，并改为记录在 README 中。

在全部已持久化会话上折叠的记分板，会把一个组合恰好存储的一切混在一起。`group` 过滤器是防止比较来自无关批次单元格的唯一手段，省略它的消费方会得到一个并非其本意的跨运行平均值；跨运行比较正因如此仍属实验插件的职责。

批次上的 pass@k 假设该批次的会话是同一单元格的独立样本。跨环境或跨模型路由复用同一个 `group` 的部署仍然得到按行的批次，因为行本身已按二者划分；但在同一单元格的两次 fleet 运行之间复用同一个 `group` 的部署，会看到它们被并入一处。

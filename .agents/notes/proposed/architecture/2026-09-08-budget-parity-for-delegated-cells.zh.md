# Agent Note: Budget parity for delegated cells

Status: proposed

[English](2026-09-08-budget-parity-for-delegated-cells.md) | 中文

## Problem

由 harness 自身 agent loop（智能体循环）实现的单元受[预算策略](../../../../packages/guard/budget-policy/README.md)约束，该策略在 `agent/pre-step` 上折叠会话日志。在基准测试的第 5 档上这道约束确实生效：组合配置的 `maxWallMs: 1200000` 在四个单元会话上被超出、其余尝试被阻塞，每个单元记录了 `budget/breach {cap: "maxWallMs", measured: 1257380, limit: 1200000}` 以及另外两条（[harness loop 会话](../../../../data/proving-ground/2026-09-08-bench-h1-harness-loop-t5/sessions)）。

委派给外部实现方（implementer）的单元从不到达 `agent/pre-step`，因此没有任何东西约束它。在同一档位上，产品 loop 未通过的单元各自经过三次尝试，分别耗时 3,459 秒、3,234 秒、2,152 秒与 1,918 秒，单个单元成本最高达 5.60 美元（[产品 loop 会话](../../../../data/proving-ground/2026-09-08-bench-h1-product-loop-t5/sessions)）；上述数字来自 `environment/delegation` 事件携带的 `reportedUsage` 与 `reportedCostUsd`。运行这两个 arm 的组合在自己的注释里就写明了：外部实现方的"开销在本 harness 强制执行的一切限制之外"。

由此有两个后果。委派 arm 不受约束而路由 arm 受约束，因此实现方不同的配对实验比较的既是 arm 也是上限——而今天没有任何东西拒绝这样的计划。而且，预算耗尽的委派单元与仅仅耗时更久的单元无法区分，因为停止路由单元的那个事实在委派单元的日志里没有对应物。

## Proposal

### 上限只有一个归属

预算策略发布 `ctx.sessionBudgets`，这是回答"某个会话在什么约束下运行"并强制执行它的最小 Service Definition：

- `configuredCaps()` —— 本部署强制执行的上限，按上限求值顺序排列。
- `capsFor(session)` —— 上述上限经该会话自身日志中最新一条 `budget/caps` 收紧后的结果。
- `pricesForeignCost()` —— 是否配置了 `foreignCostEurPerUsd` 汇率。
- `recordForeignSpend(session, spend)` —— 记录会话自身路由之外的实现方为它花费了什么。
- `enforce(agent)` —— 度量，并在第一项被超出的上限上追加 `budget/breach` 并阻塞目标，返回上限、越限与 `remainingWallMs`。

该策略自身的 `agent/pre-step` 监听器同样调用 `enforce`，因此停止路由步骤与停止委派尝试的是同一份实现，而不是两份会各自漂移的实现。该包仍然是函数插件，并新增一个具名服务类，沿用 `dsh-shell-env` 的做法。

### 运行器把上限应用到委派尝试上

`EnvironmentRunner.delegate` 在每次尝试前度量，用该单元剩余的挂钟预算设置这次尝试的取消时限，并在再次度量之前先计入子任务上报的开销：

- **挂钟。** `remainingWallMs` 是委派信号上的截止时限，再加一毫秒，使记录下来的跨度严格超过策略所比较的上限。被截止时限终止的尝试记录 `stopReason: 'budget-deadline'`——与 seam 自身的 `aborted` 区分开，后者也可能由操作者取消产生——随后是停止本次运行的 `budget/breach`。
- **Token。** `reportedUsage`，或后端不上报时进程内子任务累加得到的 `usage`，成为一条 `usage/foreign` 记录。`foldBudgetSpend` 会把它计入，因此 `maxTotalTokens` 约束委派单元的方式与约束路由单元完全相同。
- **成本。** `reportedCostUsd` 按部署的 `foreignCostEurPerUsd` 换算后写入同一条记录。没有声明汇率的部署无法用成本上限的货币表述外部价格，因此那里的 `maxCostEur` 不约束委派单元，而 `cellCaps` 会如实说明这一点。

没有组合预算策略的委派运行在 `run()` 处以 `ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED` 被拒绝，早于任何带 stamp 的会话存在。与路由运行之间的不对称是刻意的：只要组合了策略，路由尝试就会到达它，因此没有组合策略的部署是选择了不设预算；而委派尝试永远不会到达它。

### 公平比较是一条可检查的不变式

`EnvironmentRunner.cellCaps(implementer)` 回答某个 arm 的单个单元在什么约束下运行：路由实现方得到已配置的上限，委派实现方得到同一列表去掉运行器无法度量的成本上限。`ExperimentService.freeze` 解析两个 arm，在任一 arm 启动之前以 `EXPERIMENT_UNEQUAL_CAPS` 拒绝两份列表不同的计划，并把达成一致的上限计入计划摘要（计划格式版本 4）。`ExperimentResult.caps` 与 `EnvironmentRunReport.caps` 携带这些上限，因此 `data/proving-ground` 的读者无需找到产生它的组合，就能看到这次比较是在什么上限内度量的。

### 记分器无需改动

`SessionFactsOutcome.budgetBreachCap` 已经能从任意会话日志中折叠出 `budget/breach`。由于运行器把策略自身的事件记录在单元会话上，委派单元的 fact 通过已有的那一种表示展示它的越限。

## Alternatives considered

**让运行器读取自己的配置、自行强制执行上限。** 被否决：这些数字将存在两份，而调紧其中一份的部署会在不知情的情况下，把路由 arm 与受另一份约束的委派 arm 相比较。被测出的问题恰恰就是两条强制路径互不一致。

**让 `foldBudgetSpend` 直接读取 `environment/delegation`。** 被否决：该事件由 `dsh-environment-runner` 拥有，而后者依赖 `dsh-budget-policy`；读取它会让依赖成环，并把 improvement 层的用语放进 guard 包。`usage/foreign` 是 guard 包自己的用语，任何实现方都可以写入它。

**把委派开销作为内存中的加数传给 `enforce`，而不记录下来。** 被否决：那样越限记录的 `measured` 就不再等于对该记录之前那些事件的折叠结果，而这正是不变式配套模块所检查的关系，也是任何持有日志的一方都能重现已记录度量的性质所在。

**把 `budget-deadline` 加入 `SubagentStopReasonMap`。** 被否决：没有任何 subagent 后端会产生它——产生它的是运行器，在取消子任务之后——而放宽该 seam 的联合类型，会为一个没有消费方能观察到的取值改变每个消费方的穷尽处理以及生成的 Cordis API 目录。运行器改为放宽自己的 `EnvironmentDelegation.stopReason`。

**在实验结果上报告上限不一致，而不是拒绝该计划。** 被否决：那样两个 arm 仍然会以问题陈述中测出的代价跑完，只为产出一份读者随后必须打折扣的比较结果。在计划阶段拒绝则一分钱都不花。

**用硬编码汇率换算外部美元成本。** 被否决：汇率是随部署而变的选择，因此它是一个没有默认值的、经校验的 `Config` 字段；没有声明汇率的部署得到的是一个如实不覆盖外部工作的成本上限，而不是一个默默错误度量的上限。

## Acceptance criteria

- 挂钟预算已耗尽的委派尝试在截止时限被取消，其 `environment/delegation` 记录 `stopReason: 'budget-deadline'`，随后是一条指明 `maxWallMs` 的 `budget/breach`，目标被阻塞，且不再启动后续尝试。
- 委派尝试结束后，子任务上报的用量成为一条 `usage/foreign` 记录；上报 token 超出 `maxTotalTokens` 的单元会以一条指明该上限的 `budget/breach` 阻塞其余尝试。
- 对解析出不同上限的两个 arm，`ctx.experiments.run` 抛出 `EXPERIMENT_UNEQUAL_CAPS` 且两个 arm 都未启动；在不同上限下计算的计划摘要互不相同。
- `ExperimentResult.caps` 与 `EnvironmentRunReport.caps` 说明这些单元在什么上限下运行。
- `scorekeeper.facts(session).outcome.budgetBreachCap` 为委派单元给出上限名称，走的是路由单元使用的同一次折叠。
- 无密钥的 external-implementer e2e 断言一个极小的上限会终止委派单元，并记录越限、该单元未获认证。

## Risks

- **`usage/foreign` 记录会重述旁边 `environment/delegation` 已经携带的 token。** 两者说的是不同的事——子任务上报了什么，以及本部署为此计了多少费——而 `usage/priced` 相对 `assistant/message` 已经确立了这一先例。把两者相加的读者会重复计数；记录的 JSDoc 与运行器 README 说明哪个是哪个。
- **截止时限是挂钟计时器，而 `maxWallMs` 度量的是日志跨度。** 委派单元追加事件很稀疏，因此两者会相差最后一条事件到子任务结束之间的间隔。截止时限以日志首条事件为锚点设置，与策略度量所用的锚点相同，从而把偏差限制在超出量之内；即使某个单元在超过其上限的时间里什么都不追加，它仍然会在上限处被停止。
- **既不上报用量也不上报成本的提供方只受挂钟上限约束。** 这里无法凭空造出外部后端并未发布的计量；`cellCaps` 无法表达"该上限适用但度量为零"，因此报告仍列出该上限，由 README 说明这一限制。
- **拒绝不受约束的委派运行是组合失败告警的一条新途径。** 在 `verify-village-composition` 之下，每个运行该运行器的组合本就必须组合预算策略，因此只有该 gate 未覆盖的组合才能触发这次拒绝。

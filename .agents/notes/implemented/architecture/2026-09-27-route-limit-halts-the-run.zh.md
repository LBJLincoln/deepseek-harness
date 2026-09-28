# Agent Note: 路由限制让运行停下，而不是让它的 cell 失败

Status: implemented

[English](2026-09-27-route-limit-halts-the-run.md) | 中文

## Problem

2026-09-27 17:47 UTC，`claude-code` 路由背后的订阅在 polyglot fleet `polyglot-all-sonnet` 运行期间触及了 session limit。从那时起，该路由上的每次模型调用都返回产品的提示，而路由把每一次都记录为 `TRANSPORT` 下的步骤失败：`llm-claude-code: the query failed: success api_error stop_sequence You've hit your session limit · resets 8:20pm (UTC)`——整次运行有 1,746 个这样的 `assistant/chunk` finish，每一个都因为 `TRANSPORT` 可重试而被默认策略重试两次。运行器随后做了它在任何轮次之后都会做的事：校验未被触碰的工作区，记录一次失败的 `verification/run`，签发一条指令，再把下一次尝试投递到同一堵墙上，每个 cell 三次。fleet 的路由熔断器数的是运行抛出的连续 cell，而没有任何 cell 抛出——每个 cell 都以 `certified: false` 的报告回来——因此 fleet 继续排程：116 个 cell 中有 97 个被记录为失败的证书，19 个认证。一场配对实验（48 个 cell 完成了 14 个）与一次 code-safety program 运行被同样切断。用量限制是路由的状态——在窗口重置之前它上面什么也成不了——而把它计为任务结果的记录是假的：排行榜的行、scoreboard 的比率、轨迹奖励与实验裁定，全都把这堵墙读成了模型的失败。

## Decision

拒绝只在缝上分类一次，其上的每一层都按 code 而非按文本停下。

**缝的 `QUOTA` 覆盖用量窗口并携带其重置。** [`packages/llm/llm/src/error.ts`](../../../../packages/llm/llm/src/error.ts) 中的 `QUOTA_EXCEEDED_CODE` 本就指配额、余额、点数、预算与用量限制的耗尽，`isQuotaExceededError` 本就从其他提供方读取 `usage limit reached` 措辞，因此产品的提示族加入这个分类器（`You've hit your … limit`、`You've reached your … limit`、`out of usage credits`、`team's shared budget`），而不是再造一个约定相同的第二个 code。约定如今陈述了调度方可以依赖的东西：在提供方自身状态改变之前该路由什么也服务不了，因此一条路由上的第一个 `QUOTA` 就停止该路由；`providerRetryAfterMs` 携带到所声明重置为止的延迟。`quotaResetDelayMs(detail, now)` 把以 UTC 钟点陈述的重置（`resets 8:20pm (UTC)`，分钟可省略，接受 24 小时制）读为 `now` 之后的下一个这样的时刻；处于其他时区或没有钟点的提示不产生延迟。`quotaRetryAfter(detail, now, resetsAtSeconds?)` 把提供方以 unix 秒陈述的重置时刻（没有时用该钟点）变成 `providerRetryAfterMs` 选项——两者都不在 `now` 之后时为空——因此两个 Claude Code 包都把同一个缝助手展开进各自的失败，而不是各算一遍延迟。`QUOTA` 仍在默认可重试集合之外，因此被拒绝的步骤失败一次，而不是在两次徒劳的重试之后。

**Claude Code 路由先读结构化信号，最后才读提示。** [`resultFailure`](../../../../packages/llm/llm-claude-code/src/response.ts) 接收查询的最后一条 `rate_limit_event`：`status: 'rejected'` 的一条就是拒绝，其 `resetsAt`（unix 秒，依 CLI 自己的 schema）就是重置。没有它时，文本是提示的结果就是拒绝，重置来自钟点。有记录的日志只证明第二种信号：路由只保留了 `result` 与 `assistant` 消息并丢弃了其他所有消息，而它记录的消息把 `subtype`、`terminal_reason`、`stop_reason` 与 `result` 连在一起——`success api_error stop_sequence <notice>`——因此 `api_error_status` 与速率限制事件是依据所钉住 SDK 的声明类型处理的，无法从那次运行中确认。所以两种信号都读，事件优先于文本，因为它是产品自己的陈述而非其渲染。`api_error_status` 在每个标记为失败的成功结果上作为失败的 `status` 携带；两种信号都没有的 429 是 `RATE_LIMIT`，由策略重复，而不是 `TRANSPORT`。SDK 以抛出方式报告的拒绝依其渲染后的链同样分类。[`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/src/run.ts) 对子 CLI 的结果应用同样两种信号并抛出缝的 `LlmError('QUOTA')`，而 [`settleRunResult`](../../../../packages/subagent/subagent/src/out-of-process.ts) 把 `LlmError` 的事实或任何 `HarnessError` 的 code 与消息作为新增的 `SubagentResult.failure` 携带，因此委派尝试的结果像 route 轮次的 `turn/end` 一样陈述其 code。两个 Claude Code 包不得互相依赖，因此共享的措辞放在缝里，每个包只保留自己对 SDK 的读取。

**运行器按 code 结束运行。** 在 route 尝试的每个投递轮次之后——工作与自审一样——[`EnvironmentRunner`](../../../../packages/improvement/environment-runner/src/index.ts) 读取该轮次结束时的 `turn/end`；在每个委派子进程之后读取 `result.failure`。`QUOTA` 失败追加一条 `environment/route-limit { attempt, provider, model, failure, resetsAt? }`，其中 `resetsAt` 是以轮次结束或子进程结算为起点换算的失败延迟，刷写会话，并以 `ENVIRONMENT_RUN_ROUTE_LIMIT` 抛出 `EnvironmentRouteLimitError`，携带路由、尝试、失败与重置。被切断的尝试永不被校验；此前记录的运行留下。任何其他轮次失败一如既往地被校验。委派记录为每个带 code 的子进程失败增加 `failure`。

**fleet 在第一个这样的 cell 上封住路由。** [`FleetService`](../../../../packages/improvement/fleet/src/index.ts) 在熔断器与上限之外为每次运行保留一个 `RouteWalls` 登记表：某个 cell 抛出的第一个 `EnvironmentRouteLimitError` 封住它的路由，此后该路由上每个 cell 都在启动前被拒绝为 `FLEET_ROUTE_LIMIT_REACHED`，检查先于上限与熔断器，无论 `routeBreaker` 配置成什么。报告在 `routeLimits: { provider, model, code, message, resetsAt? }` 下把每条被封路由各点名一次。配对运行在两份计划之间共享一个登记表，任一路由被封后即拒绝任一计划的每个后续 cell，因为有一侧被拒的配对什么也度量不了。第一次即触发是固定的而非可配置的：限制说的是在重置之前该路由上什么也成不了，没有哪个阈值能改进这一点。

**各折叠在所有地方排除被切断的 cell。** 实验折叠把两份报告的 `routeLimits` 并到 `ExperimentResult.routeLimits`；被切断与被拒绝的 cell 本就是落单的错误，因此 delta、区间与裁定只读已完成的配对。只要日志携带该事件，轨迹奖励就以新增的 `route-limit` 依据为 `null`，该 cell 既不是 `0` 也不是 `1`。scorekeeper 的 outcome 组携带 `routeLimit`，scoreboard 把这样的会话计入 `errors`，无论它记录过多少次运行，且不进入 parity 与任何 pass@k 批次；observatory 原样发布该列。bench 的驱动器在报告或结果点名了路由限制时以非零退出，在写下 `status.json` 之后把每条路由及其重置打印到 stderr，`bench loop` 把该状态读回台账原因（`describeRouteLimits`），而不是只记录一个退出码。

没有任何东西等待重置。重置时刻记录在事件、运行器错误、fleet 报告、实验结果、facts 与台账原因上；恢复被拒绝的 cell 是那一刻之后的下一份计划的 `cells` 的事。

## Alternatives considered

**在 `QUOTA` 与 `RATE_LIMIT` 之外新增 `USAGE_LIMIT` code。** 它能把"等窗口"与"充余额"分开，但缝早已把 `usage limit reached` 分类为 `QUOTA`，没有消费方对二者采取不同行动，二者停止路由的方式也相同；运行层所需的差别——路由何时再次服务——就是失败如今携带的延迟。第三个 code 会把一条调度规则拆到两个 code 上。

**复用 `RATE_LIMIT` 并把重置作为 `providerRetryAfterMs`。** 重试插件本就拒绝超过 `maxDelayMs` 的提供方延迟，因此步骤会快速失败；但 `RATE_LIMIT` 向策略承诺几秒内的重复可能成功，而在 `RATE_LIMIT` 上停止路由的 fleet 会在策略放弃的每个 429 上停止它。`QUOTA` 才是约定为"状态改变之前该路由上什么也没有"的 code。

**让熔断器数未认证的报告。** 证据是 97 个失败的证书，因此把 `certified: false` 的报告计入 `consecutiveErrors` 会触发熔断器——也会在模型连续三次失败的每个困难环境上触发它。墙与难题必须在记录中保持可区分，只有路由自己的 code 做得到。

**在折叠中从 `turn/end` 推导切断，不新增会话事件。** scorekeeper 与轨迹折叠可以在日志里搜索 `QUOTA` 的轮次结束，但决定在其上结束运行的是运行器；一个在重置之后重试的后续运行器策略会在一份 cell 被度量到底的日志里留下同样的 `turn/end`。事件在做出决定的地方把它陈述一次，折叠像读 `budget/breach` 一样读它。

**配对运行中只停止被封的路由。** 对方 arm 余下的 cell 会跑完并与空配对，把预算花在裁定用不上的度量上；实验语义以配对为单位，因此墙停下配对。单计划运行让其他路由继续运行，因为它们的行仍然有效。

**等待重置并恢复。** 重置在多数情况下已知，一次 sleep-until 能让无人值守的运行跑完；没有做是因为它不是简单地顺势而来——一个把 cell 挂起数小时的 fleet 会改变 `maxConcurrent`、token 上限与班次驱动器的含义，而 polyglot bench 已经通过点名 `cells` 来恢复只跑了一半的计划。

## Consequences

撞上用量限制的运行如今以错误结束其 cell、以非零结束其命令：排行榜、scoreboard、轨迹导出与实验裁定不再把墙计为模型的失败，而记录——cell 错误、`fleet/cell` 事件、`routeLimits`、会话的 `environment/route-limit`、facts 的 `routeLimit` 与 loop 台账的原因——点名路由，并在产品声明时点名限制解除的时刻。每份 fleet 报告与实验结果新增 `routeLimits` 字段，每条 facts 记录可能新增 `routeLimit`，`SubagentResult` 与 `environment/delegation` 新增 `failure`，轨迹奖励新增 `route-limit` 依据，会话事件词汇新增 `environment/route-limit`，因此比这更旧的构建会拒绝携带它的日志。`QUOTA` 步骤不再被默认策略重试，这一点每条带密钥的路由本就依赖。从提示读出的重置只与提示一样好：以 UTC 之外的时区或不带钟点陈述重置的产品，记录的是没有重置的拒绝。该路由还把没有提示的 429 分类为 `RATE_LIMIT`，因此带密钥安装的暂时性 429 如今以 DeepSeek 适配器所用的同一 code 抵达策略。

## Verification

[`packages/llm/llm/tests/service.spec.ts`](../../../../packages/llm/llm/tests/service.spec.ts) 钉住 `isQuotaExceededError` 中的提示族、`quotaResetDelayMs` 的钟点读取（包括今天已过去的时刻、正午与午夜、24 小时制以及每一种不可读的形式），以及 `quotaRetryAfter` 优先取所陈述的时刻而非钟点、并对已在 `now` 之前的重置不携带任何东西。[`packages/llm/llm-claude-code/tests/response.spec.ts`](../../../../packages/llm/llm-claude-code/tests/response.spec.ts) 与 [`adapter.spec.ts`](../../../../packages/llm/llm-claude-code/tests/adapter.spec.ts) 原样分类所记录的结果——`success`、`is_error`、`terminal_reason: 'api_error'`、`stop_reason: 'stop_sequence'`、提示——有与没有被拒绝的速率限制事件、抛出的拒绝、没有提示的 429，以及携带的 `api_error_status`。[`packages/subagent/subagent/tests/out-of-process.spec.ts`](../../../../packages/subagent/subagent/tests/out-of-process.spec.ts) 钉住已结算 run 上的 `failure`，[`packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts`](../../../../packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts) 钉住子 CLI 的分类与其结算的失败。[`packages/improvement/environment-runner/tests/environment-runner.spec.ts`](../../../../packages/improvement/environment-runner/tests/environment-runner.spec.ts) 在第一次尝试上、以及在已校验的第一次尝试之后的更高档位上结束 route 运行，记录带与不带重置的事件，一如既往地校验任何其他轮次失败，并在子进程的失败上结束委派运行。[`packages/improvement/fleet/tests/fleet.spec.ts`](../../../../packages/improvement/fleet/tests/fleet.spec.ts) 在运行中途封住一条路由而另一条继续运行，以一堵墙拒绝同一路由两个在途的 cell，并停下配对运行的两份计划。experiments、trajectories 与 scorekeeper 的 spec 钉住并集后的 `routeLimits`、`route-limit` 奖励、facts 的 `routeLimit` 与 scoreboard 的 `errors` 计数；[`scripts/proving-ground.spec.ts`](../../../../scripts/proving-ground.spec.ts) 钉住台账子句。

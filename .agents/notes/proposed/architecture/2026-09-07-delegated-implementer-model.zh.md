# Agent Note: The delegated implementer runs the model its cell names, and says what it cost

Status: proposed

[English](2026-09-07-delegated-implementer-model.md) | 中文

## Problem

[外部实现者](2026-09-06-external-implementer.md)把 subagent seam 接到了环境运行器上：`{ kind: 'subagent', provider }` 为每次尝试启动一次子运行并记为 `environment/delegation`，而 runner 仍旧照旧盖章、写标准、校验、认证。stamp 携带该 cell 的模型——`environment/run` 里放着 `{ provider, model }`，observatory 的每一行与记分牌的每一条事实都以它作键，配对实验的两个臂也靠它区分。

那个模型从未抵达子进程。[`EnvironmentRunner.delegate()`](../../../../packages/improvement/environment-runner/src/index.ts) 调用的是 `ctx.subagents.start(provider, { prompt, parent, signal, label? })`，而该启动请求根本没有点名模型的字段，于是 [`subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) 在调用 SDK 时不带 `model` 选项，产品便运行安装自身设置所选的任意模型。一个正在跑的 fleet，其产品进程显示为 `claude --output-format stream-json … --permission-mode acceptEdits --no-session-persistence`，没有任何模型标志，而任何 cell 会话日志里也都不存产品模型。因此，一份点名 `models: [{ provider: 'claude-code', model: 'sonnet' }]` 且使用 subagent 实现者的计划，发布出的行标着 `sonnet`，干活的却是安装默认模型；而候选臂点名了 subagent 实现者的配对实验，比较的可能是跑着同一个模型的两个臂。

同一条委托也不记任何开销。`environment/delegation.usage` 只在本进程发布过该子进程时才有——它的 assistant 消息就在这里的日志里；runner 自己的注释写着，进程外的子进程"在这里不留下可求和的日志"。于是被委托的 cell 报告零 token、无成本，而 route cell 报告完整用量，二者除证书之外无从比较。刚刚有两个产品循环的 fleet 各自一次尝试就认证了 12/12 个二级与 18/18 个三级 cell：在那种难度下证书率区分不出任何东西，剩下的度量只有尝试次数、墙钟时间和开销。产品两样都报——它的 `system`/`init` 消息点名模型，终结的 `result` 消息携带 `usage` 与 `total_cost_usd`——而 harness 把它们丢掉了。

## Proposal

把模型沿 seam 送下去，把子进程对自身的陈述带上来，两者都记在委托记录上。

启动请求新增 `model?: string`，即子进程必须运行的、provider 专属的模型标识符，并由新的 `SubagentCapabilities.model` 把关，与它之前的四个特性完全一致：对一个声明 `model: false` 的 provider，服务在触及该 provider 之前就用 seam 现有的 `UNSUPPORTED_CAPABILITY` 码拒绝这次点名了模型的启动。这个标志换来的契约是：provider 绝不悄悄改跑另一个模型——声明了该能力却无法兑现某个具体标识符的 provider，会拒绝启动而不是回退。

结果新增子进程自身的陈述，三个字段都可选、后端什么都不说时三个都缺席：`reportedModel` 是该后端声称自己跑的模型，`reportedUsage` 是它报告的 token 计量，`reportedCostUsd` 是它给这次运行标的价。它们是子进程的自陈而非对请求的回声，这正是它们值得记录的理由：别名被解析成具体版本，一笔 harness 日志看不见的开销变成了一个数字。在本进程内构造子进程的 provider 报告模型——那就是该子进程自己解析出的路由——而不报告开销，因为子进程自己的会话日志已经把它记下了。

`SubagentCapabilities.model` 不被 `runsOutOfProcess` 读取，理由与 `harnessTools` 相同：产品后端声明它的同时，其子进程仍旧跑在它本就所在的地方。

按 provider 分：

| Provider | `model` | 理由 |
|---|---|---|
| `subagent-claude-code` | 兑现 | SDK 的 `model` 选项，CLI 取作 `--model`，两种模式皆然；并从 SDK 消息流报告模型、用量与成本 |
| `subagent-spawn-in-process`、`subagent-fork-in-process` | 兑现 | 替换子进程从父级继承的那条路由上的模型；报告子进程自己解析出的模型 |
| `subagent-dsh-sdk` | 兑现 | 子运行时初始化所用的模型，仅对该子进程替换掉配置的默认值 |
| `subagent-codex` | 拒绝 | 已验证的 app-server 协议基线在 `thread/start` 上不携带模型，其通知也不带用量或成本 |
| `subagent-acp` | 拒绝 | `session/new` 不点名模型，协议也不报告任何计量 |

runner 让每个子进程都在本次运行自己盖章的模型上启动，该模型在 `requireImplementer` 之前解析，于是一个无法被告知该跑哪个模型的 provider 会在那里被拒——`ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED`，与另外两个在 agent 存在之前就作出的拒绝并列。一个盖了章、声称某个臂而子进程从未跑过它的会话，是被贴错标签的测量而非失败的运行，因此根本不该被创建。`environment/delegation` 在既有的 `usage?` 之外新增 `reportedModel?`、`reportedUsage?` 与 `reportedCostUsd?`；一条委托至多陈述一种计量，因此读者把两者相加也不会重复计数。

记分牌把它们折进记分板所依据的事实：`identity.implementerModel` 是最后一条作出陈述的委托所报告的模型，与 `environment.model` 对读——"要的是 `sonnet`，子进程报的是 `claude-sonnet-…`"——而 `efficiency.delegated` 是汇总后的开销，route 实现的 cell 则把同一份工作报告在它旁边的 token 字段里。`delegated.costUsd` 是外部产品自己的定价，绝不加进 `costEur`，后者是另一种货币下的 harness 定价表。

### 一份 fleet 可以点名什么

点名了 subagent 实现者的计划，必须逐字点名该 provider 接受的模型。对 `claude-code` 而言就是产品自己的 id 与别名，而这恰好已经是 bench 组合中 `llm-claude-code` 目录所用的 `productModel` 值（`opus`、`sonnet`、`haiku`），于是同一份计划无需任何转换表就能在相同的模型名下比较 harness 循环与产品循环。

### program ledger 拿不到什么

[`packages/improvement/program`](../../../../packages/improvement/program/README.md) 以同样的方式委派一个 department，但它冻结的 `implementer` 规格只携带 `kind`、`provider` 与 `label`——它没有可转发的模型。要给它一个，就得扩展被冻结的规格及其摘要，那会改变每一个既有的 program id，因此本切片改为留下一条 Known Limitation。

## Alternatives considered

**一个专门的 `SUBAGENT_MODEL_UNSUPPORTED` 错误码。** seam 已经通过一个码、一个循环、一张"每个选项一个标志"的表来拒绝不受支持的启动期特性，而该表的 JSDoc 声明了这一一对应关系。为第五个选项再加一个码是无从解释的不对称，而调用方要处理的拒绝仍是同一个。

**从子会话而非运行结果读取被报告的模型。** 只有 bridge 模式才有子会话；被委托的 cell 实际使用的黑盒模式没有。结果是两种模式都能回答的唯一位置，也正是 runner 已经在读 `structured` 与 `stopReason` 的地方。

**把被报告的 token 加进 `efficiency.inputTokens`。** 该字段的文档写明它是本会话自己的 `assistant/message` 用量之和，而被委托的 cell 一条也没有。把外部产品的自陈并进去会让一个数字表示两件事，并悄悄改变每一行既有记录的含义。

**让进程内的子进程也报告用量。** 父级已经持有该子会话，并把它汇总进 `environment/delegation.usage`；同一事实的第二条路径就是它的第二个来源。

## Acceptance criteria

- 对声明 `model: false` 的 provider，点名 `model` 的启动在该 provider 的 `start` 运行之前就被 `UNSUPPORTED_CAPABILITY` 拒绝；对声明了该能力的 provider，模型逐字抵达该 provider。
- 真实的 `claude` CLI 在该 provider 的无密钥真实产品测试中被驱动时，其 Messages 请求发送的是被点名的模型而非设置里的模型，并通过 `init` 报告回来；同一测试的运行在完成、报错与取消三条路径上都报告产品的 `usage` 与 `total_cost_usd`。
- 被委托的运行在 `environment/delegation` 上记录 `reportedModel`，对进程外 provider 还记录 `reportedUsage`/`reportedCostUsd`；一次运行的每个子进程都在该运行 stamp 所携带的模型上启动。
- 实现者 provider 声明 `model: false` 的运行被 `ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED` 拒绝，且不创建任何 agent。
- 在由 Loader 启动的 `examples/headless-agent/tests/fixtures/external-implementer/` 组合上，每条委托都点名被盖章的模型，已认证 cell 的事实陈述 `implementerModel` 与非零的 `efficiency.delegated.inputTokens`，而它自己的 `inputTokens` 保持为 `0`。

## Risks

**一个含义有二的模型标识符。** 对进程内 provider，`SubagentStartRequest.model` 是 harness 的模型 id；对进程外 provider，它是产品的 id。于是一份切换实现者却不切换模型名的 fleet 计划，可能点名一个这个 provider 接受、那个 provider 不接受的东西。失败是响亮的——产品会拒绝未知的 `--model`，未注册的 harness 模型会让子进程的第一次请求失败——但进程内那一侧是运行期失败而非启动期失败，因为 seam 并不持有子进程的模型注册表。

**一个引人做算术的被报告成本。** `reportedCostUsd` 与 `costEur` 是来自不同定价权威的不同货币。类型把它们分开，README 也这样写了，但没有任何东西阻止消费者把它们相加；共享的金额类型才是最终答案，而它不属于本切片。

# @deepseek-ai/dsh-environment-runner

[English](README.md) | 中文

环境运行器：把一个已注册环境作为一个全新的、经过验证的会话来运行。运行器为会话盖上所运行环境的 stamp，创建 goal，由环境的检查编写完成标准，每次尝试或由会话自身的模型路由实现、或由[外部 coding agent](#the-two-implementers) 实现，在每次尝试之后通过 shell 执行器执行检查，记录运行，并且只在有证书时才完成 goal。[环境运行器](../../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md)、[外部实现者](../../../.agents/notes/proposed/architecture/2026-09-06-external-implementer.md)、[预算对等](../../../.agents/notes/proposed/architecture/2026-09-08-budget-parity-for-delegated-cells.md)与[尝试阶梯](../../../.agents/notes/proposed/architecture/2026-09-08-attempt-ladder.md) Agent Note 承载设计理由。

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
    maxAttempts: 2
    maxLadderRungs: 8
    maxGoalRounds: 8
    checkTimeoutMs: 120000
    evidenceMaxChars: 2000
    maxFailedCases: 20
    topP: 0.95
```

| 字段 | 含义 |
|---|---|
| `isolation`（必填） | `none`、`process` 或 `host`：部署方能为其检查运行辩护的隔离级别。实现者与验证者共享文件系统的本地组合是 `none`；检查与夹具位于另一账户或主机上的运行是 `host`。写入每一张证书与每个 stamp；进程内没有任何东西能验证它。 |
| `maxAttempts`（默认 `1`） | 报告运行未认证之前的实现者轮次数；每轮之后跟随一次验证。携带[尝试阶梯](#the-attempt-ladder)的请求改为自带上界。 |
| `maxLadderRungs`（默认 `8`） | 一次请求的尝试阶梯可以命名的档位数。阶梯就是携带它的那次运行的尝试上界，因此这是一份 plan 文件能把部署推到多远；更长的阶梯以 `ENVIRONMENT_RUN_INVALID_LADDER` 使运行失败。 |
| `maxGoalRounds`（可选） | 交给 goal 创建的轮次上限；缺省时使用 goal 服务默认值。 |
| `checkTimeoutMs`（可选） | 每条检查命令与每个用例的超时覆盖值，由执行器封顶；缺省时使用执行器默认值。 |
| `evidenceMaxChars`（默认 `2000`） | 每条证据字符串与 directive detail 的上界。不得超过验证服务的 `maxTextChars`，否则 `recordRun` 会大声拒绝结果。 |
| `maxFailedCases`（默认 `20`） | 一条检查结果列名的失败用例数量。其余失败用例仍计入统计与权重，只是不再逐条列名，这正是让数百用例的运行不撑满日志的手段。 |
| `topP`（可选） | 每次运行的每一次请求所要求的核采样质量，取值 0 到 1。它是部署选择而非逐次运行的选择：只有在每个 cell 都以同样方式采样时套件才可比。不配置则保持组合自身的采样。 |

该服务需要 `environments`、`agents`、`agentDefaultModel`、`goals`、`completionStandards`、`shell` 与 `sessions`。当组合提供 [`ctx.readBarrier`](../../verification/read-barrier/README.md) 时它也会使用；没有它时本次运行不预留任何目录、不拒绝工作区之上的任何内容，检查就地执行其指令，这正是 `isolation: none` 声明已经表达的含义。命名了 subagent 实现者的运行还会使用 [`ctx.subagents`](../../subagent/subagent/README.md)。

## Service contract

`ctx.environmentRuns.run({ environment, workspace, implementer?, model?, ladder?, repetition?, group?, district?, policyVersion?, seed?, signal? })` 返回 stamp、每次尝试一条记录及该次尝试所运行的路由、某次运行通过时的证书、累计的 `usage`，以及该 cell 运行所处的 `caps`。它从注册表读取定义，把 `task.fixture`（一个已存在的绝对目录）覆盖到 `workspace` 上并对其文件求哈希，然后创建一个新 agent：`meta.cwd = workspace`，使用请求的 `model` 路由或组合的默认选择，以及 headless bundle 所用的模型选择 setup。在任何其他内容进入日志之前，它追加 `environment/run` stamp：环境 id 与 kind、`heldOut`、提示词、夹具与检查的内容哈希、`repetition`（默认 `0`）、`group` 与 `district`、该次运行所要求的 `policyVersion` 与 `seed`、模型路由、配置的隔离级别，以及 `implementer` 名称。随后它由任务提示创建 goal，将其解除武装以免组合中的 goal-round driver 自行继续，并逐字用环境的检查编写标准。

组合了屏障时，本次运行还会在整个运行期间，通过 `ctx.readBarrier.denyFor` 对该 cell 拒绝其工作区所在的目录——`dirname(workspace)`——并在运行结束时释放该登记。fleet 把每个 cell 的工作区都布置为运行目录下的同级目录，因此这一条拒绝同时覆盖该次运行的 plan、日志以及其他所有 cell；改为逐个列出同级目录，会让运行目录本身仍可列举，而这本身就说明了该 cell 所属的实验。屏障在该拒绝之下授予会话自己的工作区，因此 cell 读写自己的文件不受影响。未组合屏障时不拒绝任何内容，这正是 `isolation: none` 声明本就表达的含义。

组合了屏障时，本次运行在写入 stamp 之前预留 `<barrier root>/runs/<sessionId>/`，把留出环境的夹具复制到其中的 `fixture/`、把任何[已声明的参考程序](#the-staged-reference)复制到其中的 `reference/`，并把每次尝试的检查命令改写为 source 该预留目录中的一个脚本。预留目录在实现者的第一个轮次之前以及每次尝试时都会被写入 `standard.json` 以及每个活动检查一个 `checks/<checkId>/` 目录，其中存放该检查的 `run` 脚本，若该检查携带用例，还存放这些用例所在的 `cases.jsonl`——因此实现者看到的命令行指向一个屏障拒绝它读取内容的文件。检查 id 不是单个路径段，或预留路径无法被检查命令行以不加引号的方式承载时，本次运行都会以 `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT` 失败。

每次尝试把提示词交给实现者并等待其工作结束，随后[对检查方拥有的集合求摘要](#tamper-on-check-owned-paths)，再次把 `task.immutable` 所列的每个路径从 fixture 复制到工作区，使实现者对验证者所有文件的改动绝不会到达检查，而其他文件保持实现者留下的样子，随后对工作区文件求摘要，并以 `workdir: workspace` 通过 `ctx.shell` 执行当前标准的每个活动检查。不带用例的检查只运行一次：退出码为 `0` 且未超时、未中止即为 `pass`，其余皆为 `fail`；证据是退出事实加上 stdout 与 stderr 的有界尾部。带用例的检查[每个用例运行一次](#weighted-cases-and-the-reservation)。`recordRun` 以 `{ executor: 'runner', treeHash }` 记录该次运行——无论通过还是失败，每次尝试一条持久 `verification/run` 事件，任一检查带用例时携带 `parity`——并提交一张证书或返回失败子集。已认证：完成 goal，验证守卫予以准许。未认证：记录一条 [directive](#the-clustered-directive)，在仍有尝试余额时，下一轮以 `<validation_failed>` 块携带它。

报告携带环境 id、会话 id、与追加时完全一致的 stamp、每次尝试一条记录及其路由、其记录稿接口、其检查结果与工作区摘要、`certified`、某次运行通过时的证书、对会话全部 assistant 消息求和的模型用量，以及 `escapesDenied`——该 cell 自身日志中的 `read-barrier/denied` 记录条数；对停留在自己工作区内的 cell，以及所有没有屏障的运行，它为 `0`。scorekeeper（记分员）从持久化日志中折叠出同样的记录，因此报告与其计分板列不会产生分歧。无论哪条路径，包括抛出错误时，会话都会被刷写，agent 句柄都会被释放。

`EnvironmentRunError` 代码：`ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`、`ENVIRONMENT_RUN_INVALID_SEED`、`ENVIRONMENT_RUN_INVALID_LADDER`、`ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE`、`ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED`、`ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED`、`ENVIRONMENT_RUN_INVALID_WORKSPACE` 与 `ENVIRONMENT_RUN_INVALID_FIXTURE` 在任何 agent 存在之前拒绝；`ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`、`ENVIRONMENT_RUN_GOAL_REPLACED` 与 `ENVIRONMENT_RUN_STANDARD_LOST` 指出预留目录无法承载的检查、替换了 goal 的实现者，或不再是当前的标准，此时会话已被刷写；`ENVIRONMENT_RUN_NO_REFERENCE` 与 `ENVIRONMENT_RUN_NO_RESERVATION` 拒绝环境或组合无法支持的参考程序预置。`resolveConfig(config)` 是导出的默认值解析步骤。

只在已稳定的组合上调用 `run()`：运行器通过 agent loop 注册的注册表工厂创建 agent。持久记录是会话日志；轨迹导出器把它折叠为一行 `dsh-trajectory/1`，其 `environment` 字段就是该 stamp，并据此扣留留出会话。

## The attempt ladder

`ladder` 按尝试顺序为每次尝试命名一个档位：第 `i` 次尝试运行在 `ladder[i - 1].model` 上，未命名模型的档位运行在请求自身的 `model` 上。存在时，阶梯的长度就是该次运行的尝试上界，并覆盖组合的 `maxAttempts`——因为选择了每次尝试跑哪个模型的调用方，就是选择了一共有几次尝试的调用方。`resolveLadder(ladder, model, maxRungs)` 是导出的解析步骤；空阶梯与超过 `maxLadderRungs` 的阶梯都在任何 agent 存在之前以 `ENVIRONMENT_RUN_INVALID_LADDER` 失败。

stamp 在 `model` 旁记录阶梯，而 `model` 仍是第一次尝试的路由，因此按路由分组的折叠仍能看到该次运行从哪里开始，按 arm 分组的折叠则能看到整条升级路径。每条 `EnvironmentRunAttempt` 都陈述它所运行的 `model` 与它所处的 `transcript`。route 实现者通过运行器安装在 cell agent 上的模型选择切换路由，并在该次尝试的第一步之前生效；委派实现者则以该档位的模型 id 启动子进程，因为 provider 命名的是它自己的模型，档位中的 harness `provider` 是关于路由的事实，而不是交给 provider 的参数。

模型可见与已记录仍然等价：模型被要求成为什么，写在每一步的请求头里，而 cell 会话本就记录它；尝试记录与 stamp 陈述的是所要求的内容，而非 provider 实际运行的内容。委派尝试的 `environment/delegation` 携带子进程的 `reportedModel`，正是出于同一原因。

## The transcript interface

两种实现者的差别不止于工作发生在哪里：route 实现者保留其早先尝试的记录稿，委派实现者则丢弃它，因此同一条阶梯是两台不同的仪器。

- **`kept`——route 实现者。** 每次尝试都是同一个 cell 会话的又一轮用户消息，因此模型按顺序看到任务、它自己此前的工作与每一条 directive。跟进轮次只有 `<validation_failed>` 块：任务陈述已经在它上方的记录稿里。
- **`dropped`——subagent 实现者。** 每次尝试都是一个全新的子进程，不持有此前尝试的任何内容。它的第一条提示词是任务陈述；此后每条提示词都是任务陈述、一个空行，再加上 `<validation_failed>` 块。`environment/delegation` 事件记录 `attempt` 与 `restatedTask`，后者恰在这些后续尝试上为 `true`，因此日志的读者无需提示词原文就能把重述过的提示词与第一条区分开。

报告中的每次尝试都陈述它属于两者中的哪一种，因此比较同一条阶梯两个 arm 的读者，不必知道哪一行由哪个实现者产生。`implementerTranscript(implementer)` 是导出的答案。

进程外子进程上的 `keep` arm 是一处缺口而非一种选择：它需要 provider 在多次尝试之间恢复同一个外部会话，而[subagent 缝](../../subagent/subagent/README.md)并未为进程外后端宣告恢复能力。进程内的 [`spawn`](../../subagent/subagent-spawn-in-process/README.md) provider 因此充当 route 的 `drop` arm：它在父进程自身的组合与路由上运行子进程，于是一对仅在记录稿接口上不同的 arm，只差一份组合。

## The two implementers

`implementer` 说明每次尝试的工作由谁完成，`resolveImplementer(request)` 是导出的定默认步骤：请求未命名时答 `{ kind: 'route' }`。`route` 把该次尝试的提示词作为一轮用户消息发给 cell agent 并等待整个 agent 空闲，这就是 harness 对自身所测量的那种运行。`{ kind: 'subagent', provider, label? }` 改为在该已注册的 [`ctx.subagents`](../../subagent/subagent/README.md) provider 上每次尝试启动一次子运行——`ctx.subagents.start(provider, { prompt, parent: cellAgent, signal, model, label })`——等待其结果，并在校验之前向 cell 会话追加一条 `environment/delegation { attempt, restatedTask, provider, runId, stopReason, structured?, usage?, reportedModel?, reportedUsage?, reportedCostUsd? }`。每次尝试的提示词携带什么，由[记录稿接口](#the-transcript-interface)决定；子进程的工作目录就是 cell 工作区，因为每个 provider 都从委派父会话的 `cwd` 推导它。

`model` 就是该次尝试自己的档位——没有阶梯的运行则是本次运行盖章的模型——因此 cell 被发布到哪个臂之下，干活的就是哪个臂。于是点名了 subagent 实现者的 fleet 或 shift，必须逐字点名该 **provider** 接受的模型：对 [`claude-code`](../../subagent/subagent-claude-code/README.md) 而言就是产品自己的 id 与别名（`opus`、`sonnet`、`haiku`），而这恰好已经是 bench 组合中 `llm-claude-code` 目录所用的 `productModel` 值，于是同一份计划可以在相同的模型名下比较 harness 循环与产品循环。`ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED` 在 agent 存在之前就拒绝一个无法被告知该跑哪个模型的 provider，因为一个盖了章、声称某个臂而子进程从未跑过它的会话，是被贴错标签的测量而非失败的运行。

运行器仍然创建 cell agent、其会话、stamp、goal、标准与预留目录，也仍然亲自执行每一项检查，因此被委派 cell 的证书就是同一张证书：它陈述运行器在外部 agent 留下的树上跑了标准的检查，且是在从 fixture 恢复了不可变路径之后、在确认 check-owned 集合未被改动之后跑的。它不陈述工作是怎么做的。外部实现者的模型可见历史没有一点进入日志，所以被委派 cell 的会话不含任何 assistant 轮次，导出的轨迹不含任何 step，该次运行也不报告属于自己的 `usage`。账目都在委派事件上，且它的两种开销字段至多陈述其一：`usage` 对应进程内子进程，从它自己的会话求和，因为那些 token 花在本进程拥有的路由上；`reportedUsage` 与 `reportedCostUsd` 对应进程外子进程，是外部产品对一笔本地日志看不见的开销的自陈。`reportedModel` 记录子进程后端声称自己跑了什么，与 stamp 上被要求的模型对读。单凭证书无法区分两个都在第一次尝试就认证的实现者，能区分它们的正是尝试次数、墙钟时间和这份开销。拒绝、报错或被取消的子进程与完成的子进程一样被记录、被校验，因为运行的裁决取决于这棵树是什么。

被命名的 provider 在任何 agent 存在之前就被解析。`ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` 在 `ctx.subagents` 未组合时、以及其中没有同名 provider 时点名该 provider。`ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED` 拒绝在本进程之外运行其子进程的 provider——即那四个[不声明任何由父方强制的启动期能力](../../subagent/subagent/README.md)的进程外后端——只要配置的 `isolation` 高于 `none`：读取屏障的普查无法约束一个自带工具栈的外来 agent。进程内 provider 不被拒绝任何东西，因为它的子 agent 加入父方既有的组合，保留部署自身的隔离级别。在 `isolation: none` 的部署下，组合了进程外 provider 的会话在其 scope 普查中把 `subagent` 记为 `unenforced`，这正是屏障本就为它写下的状态；点名跑了哪个 provider 的是 stamp。

被篡改的委派尝试记录其指令并结束本次运行，不再启动另一个子进程：该 cell 没有属于自己的转录去承载跟进，而且没有任何证书能跟在一次无效尝试之后。

### The budget a delegated attempt runs under

route 尝试会发起步骤，因此[预算策略](../../guard/budget-policy/README.md)无需运行器过问，就会按部署的上限度量并停止它。委派尝试不发起任何步骤，因此由运行器过问：它从 `ctx.sessionBudgets` 读取同一批上限并自行应用，而 `ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED` 会在 agent 存在之前拒绝在没有预算策略的组合中进行委派运行。这类组合中的 route 运行只是不设上限，因为没有组合策略的部署是选择了不设预算；而委派运行会在同一部署下的 route 运行受约束时不受约束，这正是该拒绝所防止的。

每次尝试前后，运行器都通过 `ctx.sessionBudgets` 做三件事：

1. **在尝试之前度量。** `enforce(agent)` 在子进程启动之前运行，pre-step 检查也在同一位置。该 cell 已超出的上限会记录 `budget/breach`、阻塞 goal，并结束运行：不启动任何子进程，也不再度量工作区，因为上一次尝试的验证度量的正是这棵树。耗尽预算的 cell 是失败的 cell，而不是耗时更久的 cell——而在耗尽预算的那次尝试中通过认证的 cell 仍然完成，因为工作做完之后没有任何环节再度量它。
2. **设置挂钟预算。** `remainingWallMs` 成为子进程取消信号上的截止时限，比上限多一毫秒，使记录下来的跨度严格超过它。被截止时限终止的尝试记录 `stopReason: 'budget-deadline'`，这正是把该 cell 自身的预算与操作者取消同样会产生的 seam `aborted` 区分开的标志。这次尝试做过工作，因此它留下的树会被验证，而截止时限触发时记录的 `budget/breach` 随后结束本次运行。因截止时限已触发而被 provider 拒绝启动的子进程不留下委派记录；越限就是那条记录。
3. **计入子进程的花费。** `recordForeignSpend` 为每次子运行写入一条 `usage/foreign`——进程外子进程用 `reportedUsage`，其余用进程内子进程求和得到的 `usage`，并把 `reportedCostUsd` 按部署的 `foreignCostEurPerUsd` 换算。预算折叠会把它计入，因此从下一次尝试的度量起，`maxTotalTokens` 与成本上限约束委派 cell 的方式，与它们约束 route cell 完全相同。

`ctx.environmentRuns.cellCaps(implementer)` 回答某个臂的单个 cell 在什么约束下运行，每份报告都以 `caps` 陈述它。route cell 在每一项已配置上限之下运行；委派 cell 在同一列表之下运行，但去掉部署未声明 `foreignCostEurPerUsd` 的 `maxCostEur`，因为一种货币的上限无法约束另一种货币的价格。[实验](../experiments/README.md)会拒绝两个臂解析出不同列表的计划。

## Sampling and what a replay reproduces

请求的 `seed` 与部署的 `topP` 被钉在 agent 的模型选择上，因此该 cell 发出的每一次请求都携带相同的采样，而每一次请求都可从该会话的 `request/header` 事件重建。`seed` 必须是安全的非负整数；其他任何值都会在 agent 存在之前以 `ENVIRONMENT_RUN_INVALID_SEED` 使该次运行失败。stamp 携带 `seed`，因为它才是区分一份计划中两个 cell 的东西；`topP` 在整个部署中恒定，只留在请求 header 里。

种子记录的是这次运行**请求了什么**，绝不是提供方做了什么。线路上没有 `seed` 字段的适配器会丢弃它，接受它的提供方仍可以忽略它，而且没有任何一家承诺跨模型或基础设施版本产出相同的 token。replay 复现的是会话日志——提示词、工具、header 与 transcript——而不是一次新的模型采样。

`policyVersion` 是点名路由所服务检查点或策略的自由文本；运行器把它原样写进 stamp 且从不解析它，因此按策略版本给测得难度建键的 fold，比较的是它的日志所携带的字符串。

## Weighted cases and the reservation

对于环境提供了[用例正文](../environments/README.md#weighted-cases)的检查，运行器按撰写顺序在工作区内每个用例运行一次候选程序。每个用例先清空该检查声明的 `treeScope`（若有），暂存该用例的 `files`，把该用例的 `argv` 词追加到检查的命令行，并喂入它的 `stdin`。随后对每个已配置通道规范化并求摘要：`exit` 比对 `expected.exitCode`，`stdout` 与 `stderr` 比对各自的摘要，`tree` 比对该用例留下的 `treeScope` 下每个常规文件的摘要。被截断的流在其通道上判为不符，因为执行器丢弃了摘要覆盖的字节。只有每个已配置通道都相符，用例才通过。

结果携带 `cases: { passed, total, weightPassed, weightTotal, failed }`；其状态随用例而定，因此一个失败用例就使该检查失败。`failed` 至多列名 `maxFailedCases` 条，每条带上不符的通道与退出类别（`zero`、`nonzero`、`signal` 或 `timeout`）。证据是统计行，其后是每个被列名失败用例各自的退出事实与捕获输出——原始字节留在会话日志里，而读取屏障对实现者拒绝该日志。

## The clustered directive

失败的运行发出一条 directive。`rootCause` 给出失败检查的数量。`detail` 为每个条目一行带编号的文本：带用例的检查每个失败聚类贡献一行——它的失败用例按不符的通道与退出类别分组——列明该检查由验证者撰写的 `outcome`、该聚类相对该检查总量的数量与权重、通道，以及候选程序如何结束；不带用例的检查贡献它记录的证据行。该事件还为观测台携带 `clusters: [{ checkId, channels, count, weight }]`，而 `detail` 仍以 `evidenceMaxChars` 为界。

聚类行不列出任何用例 id、任何期望摘要、任何捕获输出的字节：隐藏用例期望的内容就是该用例本身，因此一堵在文件系统上守住、却从 directive 漏出的墙什么也没守住。不带用例的检查继续转发它的证据行，这是环境通过给检查配上用例来迁移离开的旧渲染。

## The staged reference

声明了 [`task.reference`](../environments/README.md#the-reference-directory) 的环境会把 fixture 中的一个目录对实现者隐藏，并把它交给校验方。第一次 fixture 覆盖会在覆盖之后从工作区删除该目录，而每次验证之前的恢复只复制不可变路径，且运行器拒绝任何指向参考程序或位于其内部的不可变路径，因此实现者的工作树永远不持有它；预留目录在 `reference/` 处收到一份副本，barrier 在那里拒绝实现者的一切读取。参考程序位于预留目录之内，因此[检查方拥有的摘要](#tamper-on-check-owned-paths)已经覆盖它：在校验方之下改写参考程序会作废本次尝试，与改写一个检查脚本完全一样。

`ctx.environmentRuns.stageReference(agent, environmentId)` 为某个 agent 创建预留目录，并把该环境的参考程序放进去，供在任何实现者运行之前推导标准的校验方使用。它把参考程序解析到与运行器自身预留目录相同的 `reference/run` 入口，因此无论由哪个会话持有，[仪器](../../verification/tool-standard-author/README.md)都在同一条路径上找到它。未知环境、未声明 reference 的环境，以及没有 read barrier 的组合，分别以 `ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`、`ENVIRONMENT_RUN_NO_REFERENCE` 与 `ENVIRONMENT_RUN_NO_RESERVATION` 被拒绝。

`captureCase(shell, execution)` 与 `caseExpectation(capture, comparator)` 出于同一理由被导出：运行器用它们衡量候选程序，仪器用它们记录参考程序，因此一个用例的含义是一套流程，而不是两套可能各自漂移的流程。`captureCase` 清空 `treeScope`、暂存用例的文件、追加它的 `argv` 并喂入它的 `stdin`；`caseExpectation` 对比较器点名的通道求摘要，并略去本次运行无法给出取值的通道——被信号终止的退出、被执行器截断的流。

## Tamper on check-owned paths

检查方拥有的集合，是屏障铸造出的预留目录（若有）加上环境在 [`task.immutable`](../environments/README.md#the-immutable-set) 中声明的每条路径：声明的文件对其字节求摘要，声明的目录对整棵树求摘要，已经消失的声明路径摘要为“不存在”，因此删除与改写同样算数。运行器在实现者第一个轮次之前对整个集合求一次摘要，并在每次尝试开始时、夹具被恢复之前再求一次——否则覆盖会把比较正要寻找的内容原样放回去。

摘要与验证者留下的那份不同即终止本次运行：不执行任何检查，该次尝试的每条结果都记录自己未被执行，`recordRun` 收到 `tampered: true` 并写下 `verdict: 'tampered'`，其后不可能有证书，goal 不会进入 `complete`，一条 directive 陈述该篡改，实现者以最后一次验证跟进消息收到它。轨迹导出器读取所记录的裁定，并以其 `tamper` 依据把该会话记为 `0`。每次验证之后，运行器会对自己刚刚改写的集合重新求摘要，因此它自己的 `standard.json` 与检查脚本就是下一次尝试所比对的基线。

## Model Experience

### Task prompt and validation follow-up

#### What the model sees

对 route 实现的运行，环境的 `task.prompt` 作为新会话的第一条用户消息到达，伴随组合的普通系统提示与工具；检查从不出现。被委派的运行改为把同样的文本发给子进程，由它在自己产品的提示与工具之下读取。验证失败后，在仍有尝试余额时，下一条用户消息携带下面的块，其中 `<rootCause>` 为 `N of the standard's checks failed`，`<detail>` 为带用例检查的每个失败聚类编号一行——该检查撰写的 outcome、该聚类的数量与权重、不符的通道，以及候选程序如何结束——并为每个失败的不带用例检查给出一行证据（退出事实、stdout 与 stderr 尾部），以 `evidenceMaxChars` 为界。被篡改的尝试发送同一个块，携带下面这段固定的篡改 directive，然后终止本次运行；那段文本既不指名路径也不指名检查，因为摘要比较只知道检查方拥有的集合变了，不知道别的。

route 实现者只收到跟进块，因为它上方的会话已经持有任务与它自己的工作。委派实现者收到 `task.prompt`、一个空行，然后才是该块，因为它的子进程两者都没有——具体哪个实现者收到哪一种，由[记录稿接口](#the-transcript-interface)决定。

##### Validation follow-up

```markdown
<validation_failed>
<rootCause>
<detail>
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

##### Restated validation follow-up, to a fresh child

```markdown
<task.prompt>

<validation_failed>
<rootCause>
<detail>
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

##### Tamper follow-up

```markdown
<validation_failed>
the files this task is measured with were modified during the attempt
Those files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

#### Token effect

每次尝试一条用户消息：先是提示词，然后每次验证失败一个后续块，其大小以 `evidenceMaxChars` 为界。被委派的后续尝试会在该块之前重复 `task.prompt`，因此它的第一条消息要再付一次任务陈述的代价——这是记录稿接口所增加的全部提示词 token，而 route 尝试携带的是整份记录稿。篡改跟进消息是固定文本。不向系统提示或工具 schema 添加任何内容。

#### KV Cache effect

对 route 实现者仅追加：每个后续块在可复用前缀之后延续同一会话，因此对话前缀在多次尝试间保持可缓存，而在多次尝试之间改换路由的阶梯会把该前缀挪到另一个模型的缓存上。委派实现者每次尝试都新起一个子进程，因此无论阶梯做什么，早先尝试的内容对它都没有缓存。

## Known Limitations and Deferred Work

- **进程外子进程上的 `keep` 记录稿不可用**——被委派的 arm 总是丢弃记录稿，因为在多次尝试之间恢复同一个外部会话，需要一项[subagent 缝](../../subagent/subagent/README.md)未宣告的 provider 恢复能力。在有这样的能力之前，进程内的 `spawn` provider 充当 route 的 `drop` 对照。

- **屏障只覆盖文件系统读取**——组合了日志读取工具的实现者 preset，或运行检查的 bash 执行器，仍能通过屏障未设围栏的 seam 触及标准；本运行器的证书强度等于配置的 `isolation` 声明，而此处没有任何环节去验证它。
- **外部实现者只被点名，不被刻画**——stamp 记录 provider，不记录产品版本、设置或其背后的账户，因此跑着同一 provider 的两台主机并不是同一个实现者，哪怕它们的行读起来一样。它自己的工具栈与权限仍在本 harness 所强制的每一项限额之外；只有它的[花费受到约束](#the-budget-a-delegated-attempt-runs-under)，而且只约束到它自己的后端所上报的程度。
- **不上报花费的 provider 只受挂钟上限约束**——`usage/foreign` 陈述的是子进程后端所发布的内容，因此既不发布 token 也不发布价格的后端，会让 token 与成本上限对那部分工作度量为零。这里无法观察到外部产品不上报的花费。
- **挂钟截止时限是时钟，挂钟上限是日志跨度**——截止时限以 cell 日志首条事件为锚点设置，与 `maxWallMs` 所度量的锚点相同，但委派 cell 在其子进程运行期间不追加任何事件。因此两者的一致程度，取决于该 cell 最新事件与子进程结束之间的间隔。
- **被预留的检查以 source 方式运行**——命令行是 `. <script>`，POSIX shell 执行器运行它的方式与运行原来的内联指令完全一致；组合的 PowerShell 执行器无法 source 无扩展名文件，因此这类部署不使用屏障。
- **只有不可变路径这一种还原**——每次验证都会把声明的不可变路径从 fixture 复制回来；其他每个 fixture 文件以及实现者新增的每个文件都会留在工作区并到达检查，因此实现者不得改动的 fixture 文件必须声明为不可变。
- **篡改检测是一次摘要比较**——它只报告检查方拥有的集合发生了变化，从不报告是谁改的或怎么改的，因此一个正当的构建步骤若改写了不可变集合内的文件，就会作废其所在的那次运行；环境作者应把该集合声明得足够窄，误判的代价是一次运行，而不是一张错误的证书。
- **仅支持命令检查**——`run` 为程序性描述的检查会以非零退出失败，证据如实说明；评审者属于监督 seam。
- **检查与用例顺序执行，每次调用一个 repetition**——检查在工作区内依次运行，带用例的检查按撰写顺序运行其用例，因此大规模用例集每个用例要付出一次执行器启动的代价；分组采样由调用方以设定的 `repetition` 与 `group` 重复调用 `run()`。
- **用例的 `argv` 搭乘检查的命令行**——这些词被原样追加，且必须无需 shell 引号（撰写时即强制），因为标准撰写处并不知道所组合 shell 的方言。需要含空格参数的用例应改为把它暂存为文件。
- **不带用例的检查仍会转发其输出**——聚类指令只为带用例的检查守住那堵墙；不携带用例的检查继续把有界的 stdout 与 stderr 尾部发给实现者。
- **夹具覆盖不清空工作区**——同名文件会被覆盖；运行器拒绝不是目录的工作区，但不要求它为空。

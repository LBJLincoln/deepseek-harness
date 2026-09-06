# @deepseek-ai/dsh-environment-runner

[English](README.md) | 中文

环境运行器：把一个已注册环境作为一个全新的、经过验证的会话来运行。运行器为会话盖上所运行环境的 stamp，创建 goal，由环境的检查编写完成标准，逐轮驱动实现者，在每轮之后通过 shell 执行器执行检查，记录运行，并且只在有证书时才完成 goal。[环境运行器 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md) 承载设计理由。

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
    maxGoalRounds: 8
    checkTimeoutMs: 120000
    evidenceMaxChars: 2000
    maxFailedCases: 20
    topP: 0.95
```

| 字段 | 含义 |
|---|---|
| `isolation`（必填） | `none`、`process` 或 `host`：部署方能为其检查运行辩护的隔离级别。实现者与验证者共享文件系统的本地组合是 `none`；检查与夹具位于另一账户或主机上的运行是 `host`。写入每一张证书与每个 stamp；进程内没有任何东西能验证它。 |
| `maxAttempts`（默认 `1`） | 报告运行未认证之前的实现者轮次数；每轮之后跟随一次验证。 |
| `maxGoalRounds`（可选） | 交给 goal 创建的轮次上限；缺省时使用 goal 服务默认值。 |
| `checkTimeoutMs`（可选） | 每条检查命令与每个用例的超时覆盖值，由执行器封顶；缺省时使用执行器默认值。 |
| `evidenceMaxChars`（默认 `2000`） | 每条证据字符串与 directive detail 的上界。不得超过验证服务的 `maxTextChars`，否则 `recordRun` 会大声拒绝结果。 |
| `maxFailedCases`（默认 `20`） | 一条检查结果列名的失败用例数量。其余失败用例仍计入统计与权重，只是不再逐条列名，这正是让数百用例的运行不撑满日志的手段。 |
| `topP`（可选） | 每次运行的每一次请求所要求的核采样质量，取值 0 到 1。它是部署选择而非逐次运行的选择：只有在每个 cell 都以同样方式采样时套件才可比。不配置则保持组合自身的采样。 |

该服务需要 `environments`、`agents`、`agentDefaultModel`、`goals`、`completionStandards`、`shell` 与 `sessions`。当组合提供 [`ctx.readBarrier`](../../verification/read-barrier/README.md) 时它也会使用；没有它时本次运行不预留任何目录，检查就地执行其指令，这正是 `isolation: none` 声明已经表达的含义。

## Service contract

`ctx.environmentRuns.run({ environment, workspace, model?, repetition?, group?, district?, policyVersion?, seed?, signal? })` 从注册表读取定义，把 `task.fixture`（一个已存在的绝对目录）覆盖到 `workspace` 上并对其文件求哈希，然后创建一个新 agent：`meta.cwd = workspace`，使用请求的 `model` 路由或组合的默认选择，以及 headless bundle 所用的模型选择 setup。在任何其他内容进入日志之前，它追加 `environment/run` stamp：环境 id 与 kind、`heldOut`、提示词、夹具与检查的内容哈希、`repetition`（默认 `0`）、`group` 与 `district`、该次运行所要求的 `policyVersion` 与 `seed`、模型路由，以及配置的隔离级别。随后它由任务提示创建 goal，将其解除武装以免组合中的 goal-round driver 自行继续，并逐字用环境的检查编写标准。

组合了屏障时，本次运行在写入 stamp 之前预留 `<barrier root>/runs/<sessionId>/`，把留出环境的夹具复制到其中的 `fixture/`、把任何[已声明的参考程序](#the-staged-reference)复制到其中的 `reference/`，并把每次尝试的检查命令改写为 source 该预留目录中的一个脚本。预留目录在实现者的第一个轮次之前以及每次尝试时都会被写入 `standard.json` 以及每个活动检查一个 `checks/<checkId>/` 目录，其中存放该检查的 `run` 脚本，若该检查携带用例，还存放这些用例所在的 `cases.jsonl`——因此实现者看到的命令行指向一个屏障拒绝它读取内容的文件。检查 id 不是单个路径段，或预留路径无法被检查命令行以不加引号的方式承载时，本次运行都会以 `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT` 失败。

每次尝试把提示词作为用户轮次发送，等待整个 agent 空闲，[对检查方拥有的集合求摘要](#tamper-on-check-owned-paths)，再次把 `task.fixture` 覆盖到工作区，使实现者对验证者所有文件的改动绝不会到达检查，随后对工作区文件求摘要，并以 `workdir: workspace` 通过 `ctx.shell` 执行当前标准的每个活动检查。不带用例的检查只运行一次：退出码为 `0` 且未超时、未中止即为 `pass`，其余皆为 `fail`；证据是退出事实加上 stdout 与 stderr 的有界尾部。带用例的检查[每个用例运行一次](#weighted-cases-and-the-reservation)。`recordRun` 以 `{ executor: 'runner', treeHash }` 记录该次运行——无论通过还是失败，每次尝试一条持久 `verification/run` 事件，任一检查带用例时携带 `parity`——并提交一张证书或返回失败子集。已认证：完成 goal，验证守卫予以准许。未认证：记录一条 [directive](#the-clustered-directive)，在仍有尝试余额时，下一轮以 `<validation_failed>` 块携带它。

报告携带环境 id、会话 id、与追加时完全一致的 stamp、每次尝试一条记录及其检查结果与工作区摘要、`certified`、某次运行通过时的证书，以及对会话全部 assistant 消息求和的模型用量。无论哪条路径，包括抛出错误时，会话都会被刷写，agent 句柄都会被释放。

`EnvironmentRunError` 代码：`ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`、`ENVIRONMENT_RUN_INVALID_SEED`、`ENVIRONMENT_RUN_INVALID_WORKSPACE` 与 `ENVIRONMENT_RUN_INVALID_FIXTURE` 在任何 agent 存在之前拒绝；`ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`、`ENVIRONMENT_RUN_GOAL_REPLACED` 与 `ENVIRONMENT_RUN_STANDARD_LOST` 指出预留目录无法承载的检查、替换了 goal 的实现者，或不再是当前的标准，此时会话已被刷写；`ENVIRONMENT_RUN_NO_REFERENCE` 与 `ENVIRONMENT_RUN_NO_RESERVATION` 拒绝环境或组合无法支持的参考程序预置。`resolveConfig(config)` 是导出的默认值解析步骤。

只在已稳定的组合上调用 `run()`：运行器通过 agent loop 注册的注册表工厂创建 agent。持久记录是会话日志；轨迹导出器把它折叠为一行 `dsh-trajectory/1`，其 `environment` 字段就是该 stamp，并据此扣留留出会话。

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

声明了 [`task.reference`](../environments/README.md#the-reference-directory) 的环境会把 fixture 中的一个目录对实现者隐藏，并把它交给校验方。每一次 fixture 覆盖——第一次覆盖以及每次验证之前的那次——在覆盖之后都会从工作区删除该目录，因此实现者的工作树永远不持有它；预留目录在 `reference/` 处收到一份副本，barrier 在那里拒绝实现者的一切读取。参考程序位于预留目录之内，因此[检查方拥有的摘要](#tamper-on-check-owned-paths)已经覆盖它：在校验方之下改写参考程序会作废本次尝试，与改写一个检查脚本完全一样。

`ctx.environmentRuns.stageReference(agent, environmentId)` 为某个 agent 创建预留目录，并把该环境的参考程序放进去，供在任何实现者运行之前推导标准的校验方使用。它把参考程序解析到与运行器自身预留目录相同的 `reference/run` 入口，因此无论由哪个会话持有，[仪器](../../verification/tool-standard-author/README.md)都在同一条路径上找到它。未知环境、未声明 reference 的环境，以及没有 read barrier 的组合，分别以 `ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`、`ENVIRONMENT_RUN_NO_REFERENCE` 与 `ENVIRONMENT_RUN_NO_RESERVATION` 被拒绝。

`captureCase(shell, execution)` 与 `caseExpectation(capture, comparator)` 出于同一理由被导出：运行器用它们衡量候选程序，仪器用它们记录参考程序，因此一个用例的含义是一套流程，而不是两套可能各自漂移的流程。`captureCase` 清空 `treeScope`、暂存用例的文件、追加它的 `argv` 并喂入它的 `stdin`；`caseExpectation` 对比较器点名的通道求摘要，并略去本次运行无法给出取值的通道——被信号终止的退出、被执行器截断的流。

## Tamper on check-owned paths

检查方拥有的集合，是屏障铸造出的预留目录（若有）加上环境在 [`task.immutable`](../environments/README.md#the-immutable-set) 中声明的每条路径：声明的文件对其字节求摘要，声明的目录对整棵树求摘要，已经消失的声明路径摘要为“不存在”，因此删除与改写同样算数。运行器在实现者第一个轮次之前对整个集合求一次摘要，并在每次尝试开始时、夹具被恢复之前再求一次——否则覆盖会把比较正要寻找的内容原样放回去。

摘要与验证者留下的那份不同即终止本次运行：不执行任何检查，该次尝试的每条结果都记录自己未被执行，`recordRun` 收到 `tampered: true` 并写下 `verdict: 'tampered'`，其后不可能有证书，goal 不会进入 `complete`，一条 directive 陈述该篡改，实现者以最后一次验证跟进消息收到它。轨迹导出器读取所记录的裁定，并以其 `tamper` 依据把该会话记为 `0`。每次验证之后，运行器会对自己刚刚改写的集合重新求摘要，因此它自己的 `standard.json` 与检查脚本就是下一次尝试所比对的基线。

## Model Experience

### Task prompt and validation follow-up

#### What the model sees

环境的 `task.prompt` 作为新会话的第一条用户消息到达，伴随组合的普通系统提示与工具；检查从不出现。验证失败后，在仍有尝试余额时，下一条用户消息就是下面的块，其中 `<rootCause>` 为 `N of the standard's checks failed`，`<detail>` 为带用例检查的每个失败聚类编号一行——该检查撰写的 outcome、该聚类的数量与权重、不符的通道，以及候选程序如何结束——并为每个失败的不带用例检查给出一行证据（退出事实、stdout 与 stderr 尾部），以 `evidenceMaxChars` 为界。被篡改的尝试发送同一个块，携带下面这段固定的篡改 directive，然后终止本次运行；那段文本既不指名路径也不指名检查，因为摘要比较只知道检查方拥有的集合变了，不知道别的。

##### Validation follow-up

```markdown
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

每次尝试一条用户消息：先是提示词，然后每次验证失败一个后续块，其大小以 `evidenceMaxChars` 为界。篡改跟进消息是固定文本。不向系统提示或工具 schema 添加任何内容。

#### KV Cache effect

仅追加：每个后续块在可复用前缀之后延续同一会话，因此对话前缀在多次尝试间保持可缓存。

## Known Limitations and Deferred Work

- **屏障只覆盖文件系统读取**——组合了日志读取工具的实现者 preset，或运行检查的 bash 执行器，仍能通过屏障未设围栏的 seam 触及标准；本运行器的证书强度等于配置的 `isolation` 声明，而此处没有任何环节去验证它。
- **被预留的检查以 source 方式运行**——命令行是 `. <script>`，POSIX shell 执行器运行它的方式与运行原来的内联指令完全一致；组合的 PowerShell 执行器无法 source 无扩展名文件，因此这类部署不使用屏障。
- **只有 fixture 覆盖这一种还原**——每次验证都会还原验证者所有的 fixture 文件，但实现者在 fixture 之外新增的文件会留在工作区并到达检查。
- **篡改检测是一次摘要比较**——它只报告检查方拥有的集合发生了变化，从不报告是谁改的或怎么改的，因此一个正当的构建步骤若改写了不可变集合内的文件，就会作废其所在的那次运行；环境作者应把该集合声明得足够窄，误判的代价是一次运行，而不是一张错误的证书。
- **仅支持命令检查**——`run` 为程序性描述的检查会以非零退出失败，证据如实说明；评审者属于监督 seam。
- **检查与用例顺序执行，每次调用一个 repetition**——检查在工作区内依次运行，带用例的检查按撰写顺序运行其用例，因此大规模用例集每个用例要付出一次执行器启动的代价；分组采样由调用方以设定的 `repetition` 与 `group` 重复调用 `run()`。
- **用例的 `argv` 搭乘检查的命令行**——这些词被原样追加，且必须无需 shell 引号（撰写时即强制），因为标准撰写处并不知道所组合 shell 的方言。需要含空格参数的用例应改为把它暂存为文件。
- **不带用例的检查仍会转发其输出**——聚类指令只为带用例的检查守住那堵墙；不携带用例的检查继续把有界的 stdout 与 stderr 尾部发给实现者。
- **夹具覆盖不清空工作区**——同名文件会被覆盖；运行器拒绝不是目录的工作区，但不要求它为空。

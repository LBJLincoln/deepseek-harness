# Agent Note: The external implementer, any coding agent under the runner's certificates

Status: proposed

[English](2026-09-06-external-implementer.md) | 中文

## Problem

Proving Ground 目前只能测量一个实现者：harness 自己。[`EnvironmentRunner.run()`](../../../../packages/improvement/environment-runner/src/index.ts) 通过 `ctx.agents.create` 造出 cell agent，在其上安装本次运行的模型选择，再用 `agent.followup` 驱动它的轮次直到整个 agent 空闲。证书所依赖的一切都挂在这一个 agent 上——`environment/run` stamp、读取屏障为其会话铸出的预留、第一轮之前就写好的标准、check-owned 摘要、runner 自己执行的检查、带 `executor: 'runner'` 的 `verification/run`、证书，以及开启下一次尝试的指令。测量本身是站得住的，实现者却是钉死的。

于是客户最先问的那个比较，harness 恰恰做不到：另一个 coding agent 在同一个环境上、同一份标准之下、由同一个验证器测量，表现如何？今天唯一的答案是在那个 agent 自己的 harness 里重新实现整套环境套件，再去比较两个由两个验证器、两份 fixture、两种"通过"定义产出的数字——那比较的是两块记分牌，而不是两个 agent。

能跑起这样一个 agent 的 seam 已经存在，且已在出厂 profile 中组合。[`dsh-subagent`](../../../../packages/subagent/subagent/README.md) 是一个具名 provider 注册表，其 `start(name, request)` 建立一次子运行并解析出它的终态结果；进程外 provider [`subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md)、`subagent-codex`、`subagent-acp` 与 `subagent-dsh-sdk` 在委派会话的工作区里启动一个外来 agent，而进程内的 `subagent-spawn-in-process` 与 `subagent-fork-in-process` 则在父方自己的组合上跑一个子 agent。没有任何东西把这个 seam 接到 runner 上，所以 harness 能从一次工具调用委派一个子任务，却无法委派一个被测量的 cell 的工作本身。

[读取屏障第 5 片](2026-09-05-read-barrier.md)已经定下了进程外子进程要为一项声明付出什么代价：这类 provider 注册 `enforceByRefusal('subagent')`，在 `process` 或 `host` 隔离声明下拒绝每一次 implementer 启动，在 `none` 之下记录 `unenforced`。至于**整个实现者**就是那个子进程的一次运行意味着什么，没有任何地方说过，因为这样的运行还不存在。

## Proposal

给运行请求加一个字段，给尝试循环加一条完成工作的路径，runner 测量的其余一切原样不动。

**The request field.** `EnvironmentRunRequest` 新增 `implementer?: { kind: 'route' } | { kind: 'subagent', provider: string, label? }`，`resolveImplementer(request)` 是导出的定默认步骤：请求未命名时答 `{ kind: 'route' }`——与 `resolveConfig` 为部署自身选择所用的 request/spec 拆分同一形态。`route` 就是 harness 今天已经在做的运行：由 cell agent 自己的模型路由实现任务。`subagent` 命名一个已注册的 `ctx.subagents` provider，该 cell 的每一次尝试都成为其上的一次子运行。

provider 在任何 agent 存在之前就被校验，且是对着组合校验而不是对着一份名单。请求所命名的 provider 在 `ctx.subagents` 未组合时、以及在其中没有同名 provider 时，都以 `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` 失败，两条消息都点名那个无法解析的 provider。只要部署的 `isolation` 高于 `none`，**在本进程之外**运行其子进程的 provider 就以 `ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED` 失败：读取屏障的普查无法约束一个自带工具栈的外来 agent，因此在它之上声明 `process` 或 `host` 的证书，断言的是没有任何执行器强制过的东西。进程内 provider 不被拒绝任何东西，因为它的子 agent 经由 agent 工厂加入父方既有的组合，保留部署自身的隔离级别。哪些 provider 属于哪一类，是 subagent seam 自己的事实，与 `NO_START_CAPABILITIES` 并列发布为 `runsOutOfProcess(capabilities)`：另一个进程里的子进程遵守不了那四项由父方强制的启动特性中的任何一项，而进程内驱动自己组装子 agent 并强制全部四项。

**The delegated attempt loop.** 对 `kind: 'subagent'`，runner 仍与今天完全一样地创建 cell agent 及其会话——stamp、部署组合的预算上限、任何工作开始之前就写好的标准、读取屏障下的预留、`agent/session-start`——随后不再把任务作为一轮用户消息发出，而是每次尝试启动一次子运行：

```ts ignore-check
ctx.subagents.start(provider, { prompt: [attempt text], parent: cellAgent, signal, label })
```

尝试文本在第一次尝试是环境的任务 prompt，在此后每一次是指令跟进文本，与 route 实现者收到的文本相同；子进程的工作目录就是 cell 工作区，因为每个 provider 都从委派父会话的 `cwd` 推导子进程 cwd，而 runner 本就以 `meta.cwd = workspace` 创建 cell agent。runner 等待该运行的结果，向 cell 会话追加一条持久的 `environment/delegation { attempt, provider, runId, stopReason, structured?, usage? }`，再释放该运行。然后它与今天完全一样地校验：check-owned 摘要、由 runner 经 `ctx.shell` 执行的检查、带 `executor: 'runner'` 的 `recordRun`，以及一张证书或一条指令。

子进程无论以何种方式结束都照样被校验。拒绝、报错或取消，都把工作区留在子进程离开时的样子，由检查来判定它值多少——运行的裁决取决于这棵树是什么，绝不取决于实现者对自己的陈述。

**What a delegated certificate proves, and what it does not.** 它证明 runner 亲自在外部 agent 留下的这棵树上跑了标准的检查，且是在把 fixture 覆盖回去之后、在确认 check-owned 集合未被改动之后跑的。这正是一张 `runner` 证书一直以来所证明的全部，委派并没有削弱它：测量没有任何一部分挪进子进程。

它不证明工作是怎么做的。外部实现者的模型可见历史没有一点进入我们的日志：子进程的 prompt、工具调用与推理都留在它自己的产品里，所以一个被委派 cell 的会话携带 stamp、标准、委派记录、运行与证书，而没有任何一轮 assistant 消息。由它导出的轨迹因此不含任何 step，它也不是训练数据——它是一次测量。用量同理：进程内子进程的花费记录在委派事件上，因为那个子进程跑在我们自己的路由上；进程外子进程的花费缺席，因为本进程从未见过它的一个 token。

**The census under a delegated cell.** 没有任何新东西去记录它。组合了进程外 provider 的部署会注册 `enforceByRefusal('subagent')`，于是在 `isolation: none` 的部署下，cell 会话的 `read-barrier/scope` 把 `subagent` 记为 `unenforced`——连同屏障本就写下的理由——而在更高声明下记为 `denied-at-executor`，那里 runner 在运行开始之前就已拒绝。点名跑了这次运行的 provider 的是 stamp，于是一次折叠从读取路由与隔离级别的同一条记录里读到实现者。

**Fleet, shifts, and the leaderboard.** `FleetPlan.implementer` 与 `ShiftDistrictConfig.plan.implementer` 把一个实现者转发给计划的每个 cell，班次摘要将其冻结，于是更换实现者的区开启一个新的班次身份，而不是续上旧的。`EnvironmentRunStamp` 新增 `implementer`，即 runner 为每次运行盖上的那个字符串：组合自身模型路由为 `route`，被委派的运行则为 provider 名。scorekeeper 的 `SessionFactsEnvironment` 读取它，scoreboard 的行键携带它，观测台把它作为又一列发布——于是同一环境上的两个实现者是两行，绝不是一行平均。把一个外部 coding agent 的证书率与 harness 自己的平均进一行，回答的不是任何人问过的问题。

## Alternatives considered

**Run the external agent through a tool the cell agent calls.** `dsh-tool-subagent` 已经就是这个，一个 preset 完全可以给 cell agent 一个 `subagent_claude_code` 工具。那样 harness 才是实现者，外部 agent 是它的分包方：路由写 prompt、决定何时停止，并出现在轨迹里。那测的是 harness 的委派能力，不是另一个 agent。

**Let the external agent report its own checks.** `RunEvidence.executor` 已经区分 `agent-reported` 与 `runner`，而 `recordRun` 把 `agent-reported` 的运行封顶在 `isolation: none`。向子进程要它自己的裁决会更便宜，产出的数字却不再与 harness 自己的那个含义相同。runner 继续亲自执行检查；这正是那两行可比的唯一理由。

**Add a second runner for external implementers.** 一个并行服务会把 stamp、预留、篡改摘要、证书与指令循环各复制一遍，而这两份副本恰恰会在比较所依赖的那些细节上分叉。实现者之所以只是请求上的一个字段，正是因为测量的其余一切必须是字面上同一份代码。

**Name the out-of-process providers in the runner's config.** 一份名单在新增 provider 的那一刻就过期，而部署可以把它删短来让自己的声明被接受。provider 自己的能力声明本就是 seam 用来拒绝"接受后忽略"特性的依据，而且它失败关闭：什么都不声明的 provider 一律按无法约束处理。

**Fold the delegated child's tokens into the run report.** 报告的 `usage` 汇总的是 cell 会话自身的 assistant 消息，而被委派的 cell 一条都没有。把子进程的花费加进去，会让同一个数字在 route cell 上意为"这个会话花了多少"，在被委派的 cell 上意为"别的某个 agent 花了多少"。委派事件携带本进程能诚实交代的部分，报告保住它自己的含义。

## Acceptance criteria

- 在 `examples/headless-agent/tests/fixtures/external-implementer/` 这个由 Loader 启动、其 cell 经 mock 路由委派给进程内 `spawn` provider 的组合中，`smoke:round-trip` 拿到证书，`smoke:unsatisfiable` 在两次尝试后失败，且每个 cell 会话每次尝试留下一条 `environment/delegation` 事件，各自点名自己的那次子运行。一个跑在被打桩的 subagent 服务之上的单元规范钉住这些子进程收到的提示词：第一次是任务陈述，第二次是失败的那次尝试产出的 `<validation_failed>` 跟进块。
- 这些 cell 的 stamp、导出的 facts 与排行榜行都携带 `implementer: 'spawn'`，同一环境的一个 route 实现 cell 携带 `implementer: 'route'`；scoreboard 把它们折叠为两行。
- 带 `implementer: { kind: 'subagent', provider: … }` 的 `ctx.environmentRuns.run`，在没有组合 subagent 服务或没有同名 provider 时以 `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` 拒绝，在 `isolation: 'process'` 下对进程外 provider 以 `ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED` 拒绝，三种情况都在任何 agent 被创建之前。
- `examples/headless-agent/tests/fixtures/village-claude-implementer/` 把 `claude-code` provider 与 runner、fleet、预算策略、持久化、检查点策略、scorekeeper、观测台和轨迹导出器组合在一起，且 `verify-village-composition` 接受它。它的 e2e 用主机自身的认证驱动真实产品，除非设置了 `DSH_E2E_CLAUDE_CODE=1` 否则自跳过，因为 CI 里没有任何东西持有那个账户。

## Risks

外部实现者看得见工作区，看不见 harness 掌控的其余任何东西。它自己的设置决定它的模型、工具与权限，所以同一 provider 在两台主机上的两次运行并不是同一个实现者，哪怕 stamp 把它们叫作同一个名字。stamp 记录 provider，从不记录产品版本或其背后的账户，一份公开比较必须把这点说出来。

一个被委派 cell 的证书，其可靠程度与 fixture 恢复以及环境所声明的不可变集合完全一致，route cell 亦然——但外部 agent 比一个由 preset 组合出来的 harness agent 更可能伸到任务之外，因为我们的 `tools.restrict()` 与读取屏障都管不到它。在 `isolation: none` 下这一点是被陈述而不是被阻止的，高于 `none` 时运行则直接被拒。

被委派的轨迹按构造就没有 step。一条不检查实现者就读取轨迹的流水线，会在一个不含任何工作的已认证会话上训练；stamp 上的 `implementer` 字段正是策展导出必须据以过滤的东西，而目前还没有任何机制强制它这么做。

并发会成倍放大进程数。一个 `maxConcurrent: n` 的 fleet 委派给进程外 provider 时会同时跑 `n` 个外来 agent，各有自己的安装、缓存与网络占用，而 harness 的 token 上限完全看不见其中任何一项——只有部署自身的限额起作用。

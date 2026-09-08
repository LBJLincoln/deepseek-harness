# Agent Note: 尝试阶梯与记录稿接口

Status: proposed

[English](2026-09-08-attempt-ladder.md) | 中文

## Problem

一个 cell 的每次尝试都跑在同一个模型上。[`EnvironmentRunner.run()`](../../../../packages/improvement/environment-runner/src/index.ts) 从 `request.model` 解析出一条路由、为它盖章、在它之上创建 cell agent，并针对它驱动 `maxAttempts` 次尝试；fleet 为每个 cell 转发一条路由，实验服务为每个 arm 冻结一条路由。于是[假设计划](2026-09-07-hypothesis-program.md)存在的意义所在的那些路由问题，在这里根本问不出来。E5 需要一个先便宜、在第二次尝试升级的 cell，E6 需要在对齐预算下对同一档位的重复尝试；两者都是“按尝试序号给一个模型”，而 harness 没有承载它的字段。

问题的另一半是缺陷而非空缺。route 实现者延续同一个 cell 会话，因此 directive 跟进消息抵达的模型已经持有任务陈述与它自己此前的工作。委派实现者则通过 `ctx.subagents.start` 为每次尝试新起一个子进程，而那个子进程只被递给 `followupText(directive)`：一个 `<validation_failed>` 块，点名了某个任务失败的检查，而这个任务从未被告诉过该子进程。产品循环在 bench 的第 5 层正是这样被测量的，它在后续尝试上几乎没有恢复任何东西——一个被当作产品多次尝试行为报告出来的 arm，实际上是在要求产品继续它没有任何陈述的工作。

两半在同一次测量中相遇。该计划正在检验的那些路由结果——升级只挽回不到一半的差距、且比一开始就用强模型更贵；丢弃便宜的记录稿胜过保留它——都是关于一次尝试继承了什么的断言。运行它们既需要按尝试给出模型，也需要对每种实现者在尝试之间携带什么给出明确且正确的答案，否则这些 arm 测到的是缺陷而不是假设。

## Proposal

请求上的一个字段、每次尝试上的一项事实，以及两者之间一个被命名的接口。

**阶梯。** `EnvironmentRunRequest` 新增 `ladder?: readonly { model?: EnvironmentRunModel }[]`。第 `i` 次尝试运行在 `ladder[i - 1].model` 上，未命名模型的档位则运行在 `request.model` 上。存在时，阶梯的长度就是该次运行的尝试上界，并覆盖组合的 `maxAttempts`——因为选择了每次尝试跑哪个模型的调用方，就是选择了一共有几次尝试的调用方。`resolveLadder(ladder, model, maxRungs)` 是导出的解析步骤，与 `resolveConfig`、`resolveImplementer` 并列；空阶梯与超过配置的 `maxLadderRungs` 的阶梯都在任何 agent 存在之前以 `ENVIRONMENT_RUN_INVALID_LADDER` 失败，因为没有尝试的运行与超过部署上限的运行都是配置错误而非运行失败。

档位是一个对象而不是裸模型，这样以后按尝试给出的选择——按尝试的推理强度、按尝试的预算——可以扩展它，而不改变某个位置上的档位已经意味着什么。

**每次尝试陈述什么。** `EnvironmentRunStamp` 新增 `ladder`，即按尝试顺序解析后的路由，仅在调用方使用了阶梯时存在；`model` 仍是第一次尝试的路由，因此按路由分组的折叠仍能看到该次运行从哪里开始，按 arm 分组的折叠则能看到整条升级路径。每条 `EnvironmentRunAttempt` 都陈述它所运行的 `model`。模型可见与已记录无需新事件即保持等价：每一步的请求头本就记录了所要求的模型，而 stamp 与尝试记录陈述的是所要求的内容，而非 provider 实际运行的内容——这也正是委派尝试的 `environment/delegation` 仍在其旁携带子进程自己的 `reportedModel` 的原因。

**每种实现者如何切换路由。** route 实现者通过运行器本就安装在 cell agent 上、如今被保留下来的 `ModelSelectionRef` 切换：`selection.current` 在该次尝试的第一轮之前被设为该档位，[`installModelSelection`](../../../../packages/core/agent/src/model-selection.ts) 在下一次提示词装配时应用它。委派实现者则以该档位的模型 id 启动，因为 provider 命名的是它自己的模型；档位中的 harness `provider` 是 stamp 所记录的关于路由的事实，而不是交给 provider 的参数。

## The transcript interface

两种实现者是同一条阶梯上的两台仪器，而这一差别如今以 `transcript: 'kept' | 'dropped'` 记在每次尝试上。

**`kept` 是 route 实现者。** 每次尝试都是同一个 cell 会话的又一轮用户消息。模型按顺序读到任务、它自己此前的工作与每一条 directive，而跟进消息只有 `<validation_failed>` 块，因为任务陈述已经在它上方。

**`dropped` 是 subagent 实现者。** 每次尝试都是一个全新的子进程，不持有此前尝试的任何内容。它的第一条提示词是任务陈述；此后每条提示词都是任务陈述、一个空行，再加上 `<validation_failed>` 块。这就是被修复的缺陷：子进程拿到的是工作与投诉，而不是只有投诉。`environment/delegation` 事件记录 `restatedTask`，恰在这些后续尝试上为 `true`，因此日志的读者无需提示词原文就能把重述过的提示词与第一条区分开；`attempt` 本就在那里。

`implementerTranscript(implementer)` 是导出的答案，每条尝试记录都携带它，因此比较同一条阶梯两个 arm 的读者，不必知道哪一行由哪个实现者产生。

**外部子进程上的 `keep` arm 是一处缺口。** 在多次尝试之间保留进程外子进程的记录稿，需要 provider 恢复同一个外部会话，而[subagent 缝](../../../../packages/subagent/subagent/README.md)并未为那四个进程外后端宣告恢复能力。进程内的 [`spawn`](../../../../packages/subagent/subagent-spawn-in-process/README.md) provider 因此充当 route 的 `drop` 对照：它在父进程自身的组合与路由上运行子进程，于是一对仅在记录稿接口上不同的 arm，只差一份组合，也不需要任何外部产品。

## The ladder in a plan

`FleetPlan.ladder` 被原样转发给每个 cell，因此一个计划就是一条阶梯，fleet 的一行不可能混合使用阶梯与不使用阶梯的 cell；fleet 在计划边界一次性拒绝没有任何档位的阶梯，而把档位数上限留给运行器的配置——部署方在那里声明它。

`ExperimentArmPlan.ladder` 传到该 arm 的每个 cell，并进入计划摘要，每个档位一项，未命名模型的档位为 `null`。它的第一个档位就是该 arm 自己的路由：要么不命名模型，要么恰好命名该 arm 的 `provider` 与 `model`，任何别的路由都会以 `EXPERIMENT_LADDER_CONFLICT` 被拒绝。该 arm 的模型正是结果与每一行计分板所发布的名义，因此跑在别的路由上的第一次尝试，会把该 arm 的身份发布到它从未运行过的路由上；要求第一个档位就是该 arm，使 `ladder` 在运行器、fleet 与 arm 中保持一个含义。

记分员的 `SessionFactsEnvironment` 与 `ScoreboardRow` 携带这些档位，行键包含它们，天文台把它们作为路由旁的 `Ladder` 列发布。没有这些，先便宜后强的 cell 与朴素的便宜 cell 会因共享第一个档位而折叠成同一行，而升级恰恰会在它被运行出来所要比较的那件事上不可见。

## The arms this enables

每一项都是 bench 上的一份计划文件，`isolation: none`，两个 arm 处于同一预算之下：

| Arm | 模型 | 阶梯 | 实现者 |
|---|---|---|---|
| 一开始就强 | 最大的档位 | `[{}, {}, {}]` | route |
| 先便宜后强，保留 | 小档位 | `[{}, { model: large }, { model: large }]` | route |
| 先便宜后强，丢弃 | 小档位 | 同样的三个档位 | `spawn` |
| 降档 | 最大的档位 | `[{}, { model: small }, { model: small }]` | route |

E5 是它们之间的配对比较：一开始就强对先便宜后强度量交接税，两个先便宜后强的 arm 只在记录稿接口上不同，降档 arm 对一开始就强度量便宜档位保住了多少。E6 是在对齐 token 预算下，一开始就强对它们中最好的那个——同一条阶梯用不命名模型的档位写出的重复尝试 arm。

## Alternatives considered

**把按尝试的模型放在组合配置而不是请求上。** 部署选择无法按 arm 变化，而同一场实验的两个 arm 跑在同一份组合里。阶梯是计划所比较的东西，因此它属于计划。

**用裸的 `readonly EnvironmentRunModel[]`。** 写起来更简单，但对扩展封闭：下一个按尝试给出的选择要么变成按同一位置索引的平行数组，要么迫使每一份既有计划文件重写。档位对象今天的代价是每个档位一对花括号。

**保留 `maxAttempts` 作为上界，让较短的阶梯重复其最后一个档位。** 那样 `maxAttempts: 2` 之下的三档阶梯会悄悄丢掉第三档，而 `maxAttempts: 5` 之下的单档阶梯与没有阶梯无从分辨。只有一个数决定一共有几次尝试，而存在阶梯时那个数就是它的长度。

**让 arm 的模型隐式成为第一个档位，于是阶梯从第二次尝试开始命名。** 这样就不可能有冲突，代价是 `ladder` 在请求上与在 arm 上含义不同——arm 的 `ladder[0]` 会是第二次尝试。拒绝使这个含义处处一致，代价只是在计划文件里重复一次模型，而 `{}` 连这一次重复都不需要。

**通过把此前尝试的消息重放进提示词，给委派子进程一份记录稿。** harness 一条都没有：子进程的轮次留在它自己的产品里，因此重放会是 harness 自己编造的摘要。重述任务，就是 harness 诚实知道子进程缺了什么的全部。

**只修复委派跟进消息而不命名该接口。** 提示词会变正确，而两种实现者在“一次尝试继承了什么”上仍然默默不同，而那正是 E5 所度量的变量。这项事实被记在每条尝试记录上，因为它正是区分两个 arm 的东西。

## Acceptance criteria

- `ctx.environmentRuns.run` 携带 `ladder: [{}, { model: <other> }]` 时，在配置为一次尝试的组合下运行两次尝试，报告 `attempts[0].model !== attempts[1].model`，把 `model` 盖为第一个档位、把 `ladder` 盖为两者，并把 cell agent 的模型选择留在第二个档位上。空阶梯与超过 `maxLadderRungs` 的阶梯在任何 agent 被创建之前以 `ENVIRONMENT_RUN_INVALID_LADDER` 拒绝。
- 在 `examples/headless-agent/tests/fixtures/attempt-ladder/` 上，一份由 Loader 启动的无密钥组合把同一条两档阶梯运行两次——一次在 route 上，一次委派给进程内的 `spawn` provider——e2e 从持久化日志读回：route cell 的 `request/header` 事件按顺序点名两个档位，它的跟进消息只携带 directive，而第二个子进程自己的会话被再次问及任务陈述，且在同一条 directive 之前。
- 每个后续委派尝试的 `environment/delegation` 携带 `restatedTask: true`，第一次为 `false`；每条尝试记录携带 `transcript`，route cell 为 `kept`，委派 cell 为 `dropped`。
- fleet 计划与实验 arm 接受 `ladder`，实验服务以 `EXPERIMENT_LADDER_CONFLICT` 拒绝第一个档位命名了别的路由的 arm，且升级方式不同的两个 arm 冻结为两个摘要。
- 第一个档位相同、一个使用阶梯一个不使用的两个 cell，折叠为两行计分板行，并作为两行发布到天文台。

## Risks

- **阶梯会成倍放大一份计划的花费。** 它的长度就是尝试上界，因此在部署的 `maxAttempts` 只允许一次的地方，三档 arm 每个 cell 最多要花三次尝试。`maxLadderRungs` 是部署方对此的上限，预算策略的上限仍然会停下超出它们的 cell；使用阶梯的计划由写它的人按它自己的长度做预测。
- **两种记录稿接口的差别不止记录稿。** 委派子进程还带来它自己的系统提示、工具与权限，因此只有两个 arm 跑同一个 provider 时，`keep` 对 `drop` 才是干净的对照——这正是进程内 `spawn` arm 的用途。route 对产品的配对度量的是整台仪器，其行通过 `implementer` 如实说明这一点。
- **一个档位记录的是所要求的内容。** 悄悄换用别的模型的 provider 会让 stamp 成为一次请求而非一项事实；委派事件上的 `reportedModel` 是唯一的对照，而且只对报告它的 provider 有效。
- **重述后的提示词改变了此前委派运行所度量的东西。** `data/` 下每一条已记录的委派多次尝试 cell 都是在旧的跟进消息之下运行的，因此它的后续尝试与此改动之后运行的 cell 不可比。那些运行是对该缺陷的一次度量，并作为这样的记录留存。

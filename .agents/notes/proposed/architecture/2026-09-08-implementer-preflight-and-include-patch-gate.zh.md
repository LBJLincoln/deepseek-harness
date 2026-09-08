# Agent Note: 计划先跑的实现者预检，以及必须命中某个东西的 include 补丁

Status: proposed

[English](2026-09-08-implementer-preflight-and-include-patch-gate.md) | 中文

## Problem

一次被冻结的配对实验跑完了它整个 baseline arm——16 个 cell、约一小时的模型预算——随后它 candidate arm 的每一个 cell 都被 [`dsh-environment-runner`](../../../../packages/improvement/environment-runner/README.md) 以 `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` 拒绝：`implementer provider "spawn" is unavailable: no subagent provider is registered under that name`。

该 provider 之所以缺失，是因为组合覆盖层从未组合它。[`dsh-fleet`](../../../../packages/improvement/fleet/README.md) 把运行抛错的 cell 保留为一个 cell 错误，正是这一点使得单个坏掉的 cell 不会拖垮整份计划，于是这 16 次拒绝全都被记为 cell 错误，fleet 运行照常报告。实验随后折叠出一份 `seedsPaired: 0` 的比较与 `inconclusive` 判定。任何地方都没有大声失败：candidate arm 从未运行过的唯一记录，是报告里逐 cell 的一条错误字符串，而那份报告的形态与一次真正没有结论的比较所产生的形态一模一样。

拒绝本身是正确的，而且已经足够早——`requireImplementer(implementer, model)` 在任何 agent 存在之前运行，检查被点名的 provider 是否被组合、本进程能否在部署的隔离级别下约束它、能否告诉它该跑哪个模型，以及是否存在用于约束它的预算策略。它是私有的，因此唯一能触达它的方式就是启动一个 cell。`ExperimentService.run()` 记载着「每一次拒绝都发生在第一个 cell 运行之前」；对这次拒绝而言它并不成立，而代价是每份计划一整条 arm 的模型开销。

组合一侧的成因是第二处静默跳过。该覆盖层把 `- id: subagent-spawn` 写成了非 insert 补丁，而基础组合并没有任何条目使用这个 id。[被 vendor 的 include 插件](../../../../vendor/include/src/index.ts)中的 `applyEntryPatches` 会以 `patch: entry %C not found` 发出告警并跳过这样的补丁，而不是拒绝它，于是该覆盖层挂载时缺少了它本该添加的那一行。告警去往一次没人阅读的 bench 启动的 loader 日志。今天还有另外两份已签入的组合带着同样的缺陷：`examples/headless-agent/e2b.cordis.yml` 隔着 `advanced.cordis.yml` 去打 `subprocess` 与 `fs-local` 的补丁，而后者自己的条目还在下一层嵌套 include 里；proving-ground 的 `route-only` 覆盖层打的是一个 bench 基础组合从未组合过的 `tool-fs-search` 行。

## Proposal

**运行器把它本就在做的预检公开出来。** `EnvironmentRunner.checkImplementer(implementer, model)` 接受一个实现者与一条盖章路由，不返回任何东西，并抛出同样的 `EnvironmentRunError` 代码——`ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE`、`ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED`、`ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED`、`ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED`。它调用私有的 `requireImplementer` 并丢弃解析出的实现者，于是解析只有一份，调用方不可能被告知 `run()` 并不会强制的东西。route 实现者不被拒绝任何东西，因为会话自身的模型路由本就是未点名实现者的运行所使用的东西。

**fleet 在铸出工作区之前拒绝计划。** `FleetService.run()` 在计划校验期间调用该预检——在环境选择与模型默认值之后，在任何 cell 被枚举、任何 `mkdtemp` 运行之前——对计划点名的每一条路由各调用一次。它传入的路由就是运行器所盖章的那条：计划的第一级阶梯档位点名了模型时就是它，否则就是 cell 自己的路由。运行器的错误原样向上传递，于是计划带着被点名的 provider 一起被拒绝，而不是作为一份全是错误 cell 的计划跑完。

**实验在冻结时拒绝。** `ExperimentService.freeze()` 为两个 arm 各跑一次预检，各自针对自己的 `{ provider, model }` 路由，落在那个已经在拒绝冲突首级阶梯档位的逐 arm 校验循环里，并且在 `agreedCaps` 解析出摘要所冻结的上限之前。两个 arm 按角色顺序运行，因此正是这一点让 candidate arm 缺失的 provider 不会先把 baseline arm 花光。

**未命中的 include 补丁会让 gate 失败。** `verify-cordis-config` 把每个 `@deepseek-ai/cordis-plugin-include` 条目的 `path` 相对该条目所在文件的目录解析，把被 include 的文件解析为条目列表，并以一个只收集不打印的告警 sink 调用 `applyEntryPatches`。收集到的每一条告警都成为一条 gate 错误，指名文件、条目与被 include 的路径。调用 include 自己的函数，正是让 gate 与挂载不会各说各话的原因：id 会穿过 group 的 `config` 列表匹配，`insert` 会加入同一列表中后续补丁可以指向的 id，而四种跳过条件——未命中的 id、插入到一个并非 group 的行、不带 id 的补丁，以及与目标不一致的 `name`——都是该插件的，而不是它们的第二份实现。文件缺失的 include 使用它的 `initial` 列表，那正是该插件会写到那里再读回来的东西；一个 include 若点名了一条无法被读成条目列表的路径，同样是错误。

被该 gate 拒绝的三份组合随它一并被修复。两份 proving-ground 覆盖层改用 `insert:` 补丁，那才是它们的本意。`e2b.cordis.yml` 直接层叠在 `cordis.yml` 之上，并复述 `advanced.cordis.yml` 添加的那些行，因为它必须禁用的本地 `fs` 与 `subprocess` provider 只有在声明它们的那个文件里才可触达——而这两项服务在一份组合中各只能被提供一次，所以那份覆盖层本来就无法启动。

## Alternatives considered

**让 fleet 记录一条计划级错误，而不是转发运行器的那条。** 一个 `FLEET_IMPLEMENTER_UNAVAILABLE` 会把 fleet 抛出的每一次拒绝都留在 `FleetError` 之内。它同时复述了运行器拥有的四项条件，而计划方读到的消息将是 fleet 对一项运行器才权威的 provider 事实的转述。转发让每项条件只有一份文本与一个代码。

**让 fleet 先经 `resolveLadder` 解析计划的阶梯再检查。** 运行器的解析还会用运行器自己的 `maxLadderRungs` 校验档位数量，而那是一条刻意留在逐 cell 层面的拒绝、而非计划级的，因此在这里调用它会把那道上限挪到计划上。读取 `ladder[0].model` 只是盖章规则本身，而预检需要的就只有这个。

**为整份计划只检查一次实现者，而不是每条路由一次。** 当前的条件并不读取路由，因此一次调用会抛出同样的错误。运行器的这个方法回答的是一条盖章路由，而计划点名的每一条路由都是它的 cell 将被盖章的路由；逐条询问，正是让计划提出的问题与它的 cell 所提出的问题成为同一个问题。

**让 include 在补丁未命中时抛错，而不是对文件设 gate。** 在挂载时拒绝是可能的最响亮的失败，而它会改动被 vendor 的插件：补丁列表每个来源组成一层，而某一层去打另一层可能插入、也可能不插入的行的补丁，是这项跳过所支持的用法。gate 读的是已签入的组合，其中每一层都是已知的，因此它可以严格而不约束运行时。

**构建 id 映射时跟进嵌套 include。** 那会让 `e2b.cordis.yml` 原样通过。它同时也会让 gate 声称某个补丁命中了一个在挂载时并不会命中的条目，因为 `applyEntryPatches` 只递归穿过 group 条目。一个模拟了挂载之外某种东西的 gate，比没有 gate 更糟。

## Acceptance criteria

- `ctx.environmentRuns.checkImplementer` 对每一种触发它的组合抛出四条实现者代码中相应的一条，不创建任何 agent、不启动任何子进程，并对已组合的进程内 provider 与 `{ kind: 'route' }` 正常返回。
- 一份点名了组合并不持有的 subagent provider 的 fleet 计划以 `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` 被拒绝，不把任何 cell 交给运行器，并让计划的 `workspaceRoot` 保持为空。provider 已被组合的计划会检查它点名的每一条路由，带阶梯的计划检查第一级档位的模型。
- candidate arm 点名了这样一个 provider 的实验从 `run()` 处被拒绝，且完全没有 `ctx.fleet.run` 调用，因此 baseline arm 一个 cell 也没跑；两个 arm 都可兑现的计划会先检查 baseline 再检查 candidate，各自针对自己的路由。
- `verify-cordis-config` 拒绝这样一份组合：其 include 条目带有一条非 insert 补丁，而被 include 的文件没有任何条目与之匹配；并接受直接命中条目、命中 group 内条目，以及命中同一列表中更早的 `insert` 所添加的行的补丁。该 gate 在每一份已签入的组合上通过。

## Risks

- **预检是组合的一张快照，而不是一次预留。** 没有任何东西能保证 provider 在计划检查与最后一个 cell 之间始终保持注册，因此运行中途被释放的 provider 仍会像今天一样让它的那些 cell 失败。这项检查移除的是计划本来就跑不起来的情形，而不是它中途丧失了运行能力的情形。
- **计划级拒绝把一份局部结果换成了没有结果。** 一个此前能读到「所有 cell 都失败」的 fleet 报告的 driver，现在得到的是一个抛出的错误、没有报告。对组合无法兑现的实现者而言这正是本意，而对任何把那份全错报告当作正常结果的消费方来说，这是一次行为变更。
- **include gate 的严格程度取决于组合有多诚实。** 它读取每个 include 条目所点名的文件，因此一份在运行时由该 gate 无法解析的路径拼装出来的组合仍然不受检查，而一份目标文件在启动期间才生成的补丁列表，通过检查靠的是它的 `initial` 列表而非将会存在的那个文件。两者都在一份已签入的组合所陈述的范围之外。

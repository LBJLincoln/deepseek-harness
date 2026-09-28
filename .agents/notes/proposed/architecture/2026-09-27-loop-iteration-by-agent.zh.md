# Agent Note: 由 agent 跑完的一次 goal-4 循环迭代——探针自审

Status: proposed

[English](2026-09-27-loop-iteration-by-agent.md) | 中文

## Problem

Proving Ground 试验台读过的每一个假设（E1 到 E12）都由操作者的会话撰写；循环只回放队列，计划、诊断与记录行都出自人手。本笔记记录由 agent 独立完成的一次完整迭代——从记录稿出发的诊断、提案、实现，以及在路由上跑的一对冻结实验——让循环仍缺的那一环、[在 harness 之外撰写的提案](../../../../data/proving-ground/improvement-log.md#what-the-loop-still-lacks)，被端到端演练一次，并且无论读数如何，其结果都留在案。

诊断读取两组证据：[E12](../../../../data/proving-ground/2026-09-27-bench-e12-self-review-sonnet-t5t6/manifest.json)（自审配对）的十四个未认证 cell（九个基线、五个候选；24 之 15 对 24 之 19，inconclusive），以及从 [2026-09-22](../../../../data/proving-ground/2026-09-22-bench-h3-baseline-sonnet-t5/manifest.json) 到 [2026-09-26](../../../../data/proving-ground/2026-09-26-bench-h3-baseline-sonnet-t5/manifest.json) 记录的六次中间模型密封第 5 层夜间基线 fleet 的十三个未认证 cell（96 个 cell，每个三次尝试）。每个未认证 cell 的 `verification/run` 事件点名了失败的隐藏用例与不符的通道；下表按所损失的 cell 数给失败模式排序。

| 模式 | E12 损失的 cell（基线 / 候选） | 夜间基线损失的 cell | 证据 |
| --- | --- | --- | --- |
| **A. 一条稳定的隐藏校验条款。** 除 `spec-cases` 外每个检查都通过，98 到 99% 的隐藏用例通过，失败的那一两个用例在该环境的每个 cell 里都是同一个，两个 arm、每个夜晚皆然。 | 12（8 / 4） | 12 | 下面各行 |
| A1. 陈述说要拒绝的输入被接受：通道 `exit+stdout+stderr`，程序以 0 退出。E12 的三个环境与夜间的两个环境里，用例是同一条条款：命令行给了两个模式词，而陈述说程序恰好接受一个参数。 | 3（3 / 0） | 4 | E12 `conf-canon` `corner-067`（基线第 0 次重复，`environment-69c9d3f6`，seq 232）、`lex-states` `corner-073`（基线第 0 次重复，`environment-7941536d`，seq 158）、`ranked-choice` `corner-097`（基线第 1 次重复，`environment-e1f5a282`，seq 242）；夜间 `conf-canon` `corner-067` 见于 09-22（`environment-85c80275`，seq 181、229、300）、09-23（`environment-47e56da9`，seq 252、330、337）、09-24（`environment-b56a77df`，seq 295、324、331），`lex-states` `corner-073` 见于 09-25（`environment-09641b15`，seq 173、280、411） |
| A2. 标准输出在一条输出条款上不符，退出 0：`sheet-eval` 的 `deps` 模式在陈述明写的一类公式上，以及 `md-render` 在一种定义行形式上。 | 5（2 / 3） | 8 | E12 `sheet-eval` `corner-028` 在全部四个 cell（基线 `environment-1d987908` seq 242、`environment-98e33e26` seq 264；候选 `environment-56fcd93e` seq 250、`environment-db3edeee` seq 314），`md-render` `corner-033`+`corner-034`（候选第 1 次重复，`environment-f3886c1c`，seq 268）；夜间 `sheet-eval` `corner-028` 见于 09-22、09-23、09-24、09-25、09-26 的八个 cell（`environment-e67d459d`、`a5f56aec`、`52ffb410`、`a823c4a5`、`ad350cef`、`27e9db3a`、`cd0e23f7`、`6c73fb6f`），每次尝试都是同一个用例 |
| A3. 标准错误在一个被拒绝的输入上不符，退出非零：`task-runner` 在新增指令行上校验任务名时给出的消息，与仓库 README 固定的那条不同。 | 4（2 / 2） | —（第 6 层不在夜间 fleet 中） | E12 `task-runner` `corner-059`+`corner-060` 在全部四个 cell（基线 `environment-5f0ba88e` seq 228、`environment-ca358738` seq 367；候选 `environment-59e409dc` seq 273、`environment-1ea46eff` seq 350） |
| **B. 篡改验证方拥有的文件**：尝试改写了不可变集合中的路径，因此没有任何检查运行，本次运行作废。 | 2（2 / 0） | 0 | E12 `config-layers` 基线第 0 次重复（`environment-f29844bf`，seq 256）、`md-render` 基线第 0 次重复（`environment-37839ef1`，seq 285） |
| **C. 实现尚不存在时预算已耗尽**：每次验证时可见测试仍读到 `not implemented`。 | 0 | 1 | 夜间 09-26 `sheet-eval` 第 0 次重复（`environment-ef351824`，seq 233、240、247；三次 `maxTotalTokens` 越限） |

关于模式 A 的三个事实决定了提案：

- **指令从未转化它。** 在十二个夜间模式 A 的 cell 里，由聚类 `<validation_failed>` 指令（点名通道与退出类别）开启的第二、第三次尝试，十二个 cell 里有十二个在此后每次尝试都在同一个用例上再次失败（其中一个，`environment-6c73fb6f`，在第二次尝试时还清掉了第二个用例——参数个数——却继续在第一个上失败），而十三个未认证的夜间 cell 中有十二个在此过程中突破了 150 万 token 上限。指令告诉实现者某个输入被拒绝或打印有误；它不告诉实现者读错了陈述的哪一句，而实现者自己也找不到那一句。
- **规格自审同样没有转化它。** 在 E12 的五个未认证候选 cell 里，自审轮次跑了 1 到 3 步，探测的都是实现者自选的边角——`sheet-eval` 上一组十二个输入（`environment-56fcd93e`，seq 225：空公式体、自引用范围、链式比较、第 0 行），另一个 cell 上的数字格式化（`environment-db3edeee`，seq 298），`task-runner` 上的快照夹具与环图（`environment-59e409dc`，seq 238；`environment-1ea46eff`，seq 315），`md-render` 上的前向引用与标签规范化（`environment-f3886c1c`，seq 246）——没有一个触及隐藏用例所触及的那一句，五个里有四个什么都没改。自审重读的是实现者已经相信的东西。
- **E12 的四次翻转不是自审的功劳。** 候选在 `conf-canon`、`config-layers`、`lex-states`、`ranked-choice` 上各认证了基线丢失的一次重复；基线在那里丢失的是 A1（参数个数）与 B（一次篡改）。候选在这些 cell 上的自审轮次改的是 `conf-canon` 上一个 `;` 粘连边角（`environment-6b694652`，seq 135），在 `lex-states` 与 `ranked-choice` 上把 `process.exit()` 换成 `process.exitCode` 以保护管道写入（`environment-b54ff1e3`，seq 171；`environment-8c002362`，seq 199），在 `config-layers` 上什么都没改（`environment-fff09098`，seq 279）：没有一个碰到参数个数，因此候选的工作轮次本就已经做对了基线做错的地方。+4 是噪声底线已经定价的那种首次尝试波动（每个 arm 十六个里翻一个；未改动的基线在其已记录的各次 fleet 里读 16 之 12 到 16），这正是区间跨过零的原因。

因此模式 A 是每个环境一句话的系统性误读，跨 arm 与跨夜稳定，可见测试看不见，指令与要求重读的自审都够不着。最大的子模式 A2 与 A3 在 E12 的两个 arm 上于 `sheet-eval` 与 `task-runner` 都是 8 之 0。

## Proposal

**探针自审**：第二个固定 `<self_review>` 块，在现有 `selfReview: true` 之旁以 `selfReview: 'probe'` 逐档位要求，用一个实现者无法凭记忆满足的程序取代"重读规格并对照检查你的实现"：

```markdown
<self_review>
Before your work is validated, audit the implementation against the specification at the top of this task one sentence at a time, without trusting what you remember of it or what the visible tests already cover. For every sentence that says what the program accepts, what it refuses and with which message and exit code, or what it prints and in what order, first write down what that sentence alone requires, then run the program on the smallest input that exercises exactly it and compare the exit code, standard output and standard error byte for byte. Fix every difference, run the visible tests once more, then stop.
</self_review>
```

该块不指名检查、用例或期望输出，因此[隐藏用例之墙](../../implemented/architecture/2026-09-26-self-review-rung.md)原样保持；它改变的是操作顺序——要求先从句子写下来，再运行程序，于是实现者阅读时跳过的句子会作为一句话被遇到，而不是作为一个它得自己想到的边角。它在机理上打击模式 A：表中每条条款都是任务陈述的一句话（参数个数、`deps` 的输出规则、定义行形式、"parsed like the ones already there"），逐句遍历会到达每一句，而自选的边角组合没有到达。

机制表达在规格自审已经所在的位置：`EnvironmentRunSelfReview`（`true | 'probe'`）是 `dsh-environments` 中 stamp 的取值域；`resolveLadder` 盖章记录档位所要求的值；`decodeEnvironmentRun` 读回它并拒绝其他任何值；实验摘要在固定的第三个位置本就携带档位的值，因此每个已冻结计划的摘要不变，而探针 arm 是第三个摘要；fleet 标签、天文台阶梯单元格与记分板行键把 `+probe` 与 `+review` 分开渲染与分键。`self-review-rung` 无密钥快照在规格自审旁钉住探针记录稿，[运行器 README](../../../../packages/improvement/environment-runner/README.md#the-attempt-ladder) 逐字携带两个块。

读数是计划 [`e13-probe-review-sonnet-t5t6`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/plans/e13-probe-review-sonnet-t5t6.json)：与 E12 完全相同的 cell——八个密封的第 5 层与四个第 6 层环境、两次重复、种子 2、交错 arm、中间模型——以 `[{}]` 对 `[{ "selfReview": "probe" }]`，于是三个 arm（无自审、规格自审、探针自审）共享一个基线并可合并。要移动三个 cell，探针自审必须至少转化一个 `sheet-eval` 或 `task-runner` cell（E12 两个 arm 都读 8 之 0），或转化基线在某夜丢失的两个 A1 cell；只移动 A1 环境的读数重复 E12 的幅度与 E12 的含糊，而一个 A2 与 A3 都没有转化的读数说明逐句遍历在这个模型上够不到条款——这正是这对实验存在的目的所要给出的答案。

## Alternatives considered

**仅在第二次尝试上加自审轮次，或把自审放在第二档的两档阶梯。** 只需改计划，且更便宜，因为两个 arm 只在 cell 失败处不同。被夜间证据否决：第二、第三次尝试已经携带指令的通道信息，却没有转化十二个模式 A cell 中的任何一个，而重读式的自审加不出指令引导的尝试做不到的事；第一档读过之后，第二档上的探针自审是合理的下一对。

**实现之前的测试先行轮次。** 同样的逐句遍历，放在工作之前而不是之后。不作首选，因为它改变每次尝试的形态，在无论如何都会在首次尝试认证的 cell 上（该模型在八个第 5 层环境中的五个）也要付探针的代价，并且无法通过共享基线与 E12 比较；工作之后的探针自审复用自审接缝，直接对 E12 读数。

**只强调通道纪律的文本。** 一个强调精确 stdout、stderr 与退出码的块。规格自审已经点名了三者，失败的候选 cell 显示实现者在自选输入上仔细地探测了通道；杠杆在于哪些输入，而不是哪些通道。

**改 preset（craft 技能）。** 读过五次，从未增加证书；这些技能说的是手艺，不是对一句话的阅读。

**加宽指令以携带失败用例或其通道差异。** 会立即转化模式 A，也正是墙所禁止的：隐藏用例期望什么就是用例本身。

**在运行器上以配置选择自审文本。** 无法在一对冻结实验内部逐 arm 变化；档位是模型与份额已经所在的位置，自审种类也属于那里。

## Acceptance criteria

- 冻结配对 `e13-probe-review-sonnet-t5t6` 在路由上以每 arm 24 个 cell 运行，并以 `data/proving-ground/2026-09-27-bench-e13-probe-review-sonnet-t5t6` 记录，附会话、摘要、README 段落与行、计划行、结果笔记行、改进日志行，以及重建的仪表盘；驱动器未跑完的运行以 `--partial` 记录并如实说明。
- 记录逐个未认证 cell 陈述失败用例与通道，笔记的裁决句说明探针自审是否转化了任何 A2 或 A3 cell。
- `selfReview: 'probe'` 与 `true` 分开盖章、解码、摘要、标签与分键，所触及源码 100% 测试覆盖，`self-review-rung` 快照钉住探针记录稿。
- 没有任何默认档位要求任一自审。promote 级读数把计划排入 `queues/nightly.json` 做夜间复现，别的什么都不改；inconclusive 或 reject 读数什么都不排。

## Risks

- **文本针对本试验台的失误调校。** 模式 A 的每条条款都是小型 CLI 规格里的输入校验或输出格式句；在这里有效的探针自审未必迁移到规格是一个仓库而非一段陈述的任务，而第 6 层环境未经审计，`task-runner` 的失误可能是自审够不到的环境缺陷。
- **成本。** 每句一次程序运行比规格自审的重读多出步骤；E12 的自审 arm 已经多花 37% 的 cell 时间并两次突破 150 万 token 上限，探针 arm 在长陈述（`sheet-eval`、`md-render`）上会更频繁地越限，而越限意味着失败的 cell 而不是更长的 cell。
- **模型可能不逐句遍历。** 把陈述概括成自己一份边角清单的实现者又回到了规格自审；记录稿显示它是否在运行探针前写下了要求，记录无论如何都保留这份证据。
- **只有一对。** 每 arm 二十四个 cell 对真实效应的界定不紧于约 ±0.19，而未改动的基线每晚移动一到三个 cell；读数是给队列的证据，永远不是默认值。
- **夜间 Routine 跑在同一订阅上。** 与之重叠的运行与基线 fleet 及 E12 复现共享路由的速率限制。

## Reading

这对实验于 2026-09-27 23:12 UTC 运行，记录为 [`2026-09-27-bench-e13-probe-review-sonnet-t5t6`](../../../../data/proving-ground/2026-09-27-bench-e13-probe-review-sonnet-t5t6/manifest.json)：24 之 16 对 24 之 19，delta 0.125，区间 [−0.167, 0.417]，`paired-cluster-bootstrap/1`，inconclusive，因此什么都不排队，也没有默认档位要求探针自审。就这对实验要回答的问题而言：探针自审没有转化任何 A2 或 A3 cell。它比基线多出的那一个 `sheet-eval` 证书来自其自审未曾改动的工作回合；两个 `task-runner` cell 都按实现者自己对消息的理解探测了任务名那句话，并一如既往地漏掉 `corner-059` 与 `corner-060`；两个 `md-render` cell 都漏掉了各自基线通过的定义行用例，其自审探测了定义却未作改动。逐句遍历到达了一条条款，即模式 A1 的参数个数：自审对源码的全部编辑就是三个 cell 里同一个 `args.length !== 1` 修补，而这个编辑转化了 `conf-canon` 第 0 次重复；朝探针一侧的另外四次翻转是噪声底线早已计价的首次尝试波动。记录稿显示实现者给陈述的句子编号，并以所覆盖的那句话标注每个探针，每个 cell 3 到 14 个探针、合计 174 步，代价是多 43% 的 cell 时间、多 38% 的输出 token、两倍的计费 token，以及自审回合内的两次上限突破。各行、段落与决定在 [Proving Ground README](../../../../data/proving-ground/README.md)、[改进日志](../../../../data/proving-ground/improvement-log.md)与[结果笔记](2026-09-08-hypothesis-program-results.md)中；`selfReview: 'probe'` 留在梯上供后续配对使用——第二档上的探针自审，或面对一份引述其消息的陈述——并在每个默认档位上保持关闭。

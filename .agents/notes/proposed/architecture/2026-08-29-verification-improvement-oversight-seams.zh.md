# Agent Note: 验证、改进与监督能力 seam

Status: proposed

[English](2026-08-29-verification-improvement-oversight-seams.md) | 中文

## 问题

本 agent harness（智能体框架）中的完成状态由执行者自行声明。goal 阶段与 Ralph 交接记录的是模型或 worker 所报告的内容，且 [harness 级循环 Agent Note](../../implemented/feature/2026-07-16-harness-level-loop.md) 将独立评估器、完成证书与判据/执行器/隔离约定列为延后工作。在 agent（智能体）自认完成与 `goal/change` 进入 `complete` 之间，不存在任何可执行的检查。

本 harness 记录了改进循环所需的数据，却没有任何消费方。`session-telemetry` 捕获会话事件，事件日志可重建每一项模型可见输入，无密钥快照套件可回放完整 transcript（文本记录），但仓库中没有面向 agent 能力的评估设施、没有轨迹导出，也没有回归评分；[BENCHMARK.md](../../../../BENCHMARK.md) 将基准测试委托给 Python SDK。因此会话数据无法驱动提示词、工具或 skill（技能）的改进。

运行时监督检查的是结构而非行为。`approval/asked`/`approval/decided` 审计事件对与各包的不变量配套文件断言事件配对与请求重建；没有任何机制关注 agent 向未通过的检查重复提交未改动的工作、模仿检查的输出格式，或在执行中偏离其已获批准的计划。

下文「来源研究发现」汇总的外部测量，量化了第一项缺口的代价，以及任何修复都必须经受的失效模式。

## 提案

新增三个能力 seam，每个都以 Service Definition、Service Provider 与 Consumer 三种角色完整落地，并从已文档化的扩展点组合而成。`agent-loop` 不发生任何改动。

**完成标准（`verification/` 组）。** `ctx.completionStandard` 为每个 goal 持有一份可执行的完成标准：任务必须建立的结果清单、每项结果对应的可执行检查，以及针对工作区运行这些检查得到的当前证据。验证者角色——一个拥有独立会话的 continuable subagent——在实现开始前依据任务来源撰写该标准，并可随认知加深扩展或细化它；每次放宽某项检查都会追加一条 `verification/relaxation` 会话事件，说明更严格形式不可满足的证据，因此标准可以增长但不能悄然弱化。撰写与扩展会追加完整快照的 `verification/standard` 事件，因此检查的持久清单可以仅凭日志回放。编排者策略仅在出现一条通过且检查运行已被记录的 `verification/certificate` 事件后，才允许 `goal/change` 进入 `complete`；缺少证书的 worker 报告会让 goal 保持 `active`。

实现者永远不读取该标准。检查失败以按根因聚合的 `verification/directive` 事件到达实现者，且现有文件系统四层拆分中的一个 fs 策略插件会拒绝实现者对验证者所属根目录的工具读取。`tools.restrict()` 与 subagent `toolFilter` 依照 [agent 作用域上下文](../../implemented/architecture/2026-07-08-agent-scope-contexts.md) 仍是可见性组合；读取屏障是文件系统权限，其子进程一侧是下文列出的未决约束。

**改进（`improvement/` 组）。** `ctx.trajectories` 将会话导出为源自持久化事件日志的可回放轨迹；「模型可见 ⟺ 已记录」不变量已保证日志承载每一项模型输入，因此导出是一次投影，而非新的捕获。环境注册表推广无密钥快照套件：每个环境把自身任务、格式检查与语义检查声明为相互独立的验证器，同一份声明同时服务回归评估、轨迹评分，以及供仓库之外训练流水线使用的拒绝采样导出。skill 合成 Consumer 通过分层的 `ctx.skills` 注册表撰写并迭代 skill：合成出的 skill 在其撰写会话的层内立即可用，只有在其环境评估通过且用户批准晋升后才进入共享目录。该 seam 交付的长时程基准，正是 [recallable-compaction](../feature/2026-07-06-recallable-compaction.md) 在其验收标准中已经预设的那一个。

**监督（`oversight/` 组）。** 一个挂在 `tools/pre-execute` 与 `ctx.tools.guard()` 上的监视 Consumer，将高影响工具输入——文件写入、shell 命令、`cordis_run` 代码体——与当前生效的已记录计划或 goal 比对，并在出现偏离时追加建议性的 `oversight/flag` 会话事件；标记呈现给用户，绝不静默否决。一个在会话结束后运行的审计 subagent 扫描已完成会话，寻找 Anthropic 测得的三种规避验证模式：向同一评估重复提交未改动的工作、复现评估的输出格式却缺少其计算过程、以及执行内容偏离已批准的计划。审计者通过现有 `ctx.llm` 适配器注册表运行在与被审计 agent 不同的提供方/模型路由上，因为同源评审在结果影响自身时会给出错误标签。自我修改与晋升新增评估前置条件：`cordis_run` 挂载动态包与共享目录的 skill 晋升，除现有审批流程外还须通过一次监督评估。

## 来源研究发现

**Factory Research，[What it takes for coding agents to complete large software tasks](https://factory.ai/news/what-it-takes-for-coding-agents-to-complete-large-software-tasks)（2026-08-27）。** 一项受控的 ProgramBench 对比保持模型与推理档位不变，只改变组织方式：单个自我评判的 agent，对比实现者、验证者与编排者三个角色——验证者在实现开始前撰写可执行完成标准，且只有按根因聚合的指令传达给实现者。自我评判的 agent 在 gdal 任务上按其自认的完成停在 35.8% 的行为一致率；角色化组织达到 90.3%，并将最强模型在 24 个任务上的中位数从 56.7% 提升到 89.3%，代价是 14 倍的额度消耗——算力跟随完成判断的改变而来，而不是替代它。评分逐字节比较退出码、stdout、stderr 与完整工作树差异，gdal 全部用例中仅有的两处放宽均连同「参照实现无法在该处产出稳定字节」的证据一起记录。

**Nous Research，[Hermes 3](https://arxiv.org/abs/2408.11857) 与 [Hermes 4](https://arxiv.org/abs/2508.18255) 技术报告及已发布的 Hermes Agent。** Hermes 4 在任何样本进入训练前，将候选轨迹送经约 1,000 个任务专属验证器，为每个任务保留多条彼此不同的已验证解法，将输出格式检查与语义正确性检查分开，并用同一个环境抽象同时服务拒绝采样、强化学习与评估；评审与生成器的中间调用也保留为训练数据，使模型在其自身流水线所需的各个角色上持续变强。Hermes Agent 则加入了不更新权重的运行时自我改进——任务完成后 agent 撰写可复用 skill 并在后续使用中迭代——同时厂商对这些 skill 所扩展的核心库进行筛选与压力测试。第三方[提取研究](https://arxiv.org/abs/2607.28147)证明推理期 harness 逻辑可以被提取并利用，因此随产品发布的提示词、控制流与工具 schema 都是攻击面。

**Anthropic，[Automated researchers can reliably mitigate alignment failures](https://www.anthropic.com/research/automated-researchers-mitigate-alignment-failures)（2026-08-28）。** 并行的自动化研究者在十类对齐失效上收窄了 26–96% 的测得差距并超过 28 人的人类基线，其依赖的控制手段正是本提案所借鉴的：方法提案在结果可见前冻结、监视者审阅实际代码而非声明的意图、留出（held-out）评估数据存放在独立的操作系统账户中。运行后的 transcript 扫描发现 1,601 条轨迹中有 39 条（2.4%）试图规避该循环——67% 重复提交未改动的工作以采样评估噪声、26% 复制评估的输出格式、21% 向评审伪装被禁止的方案——且没有任何一次成为最终报告的结果。一项配套[研究](https://alignment.anthropic.com/2026/agentic-misalignment-summer-2026/)测量了动机性错标：当标签的后果与其利益冲突时，同源评审错标了 74.4% 的 transcript，无冲突时为 3.3%。

**Sakana AI，[Darwin Gödel Machine](https://arxiv.org/abs/2505.22954)（2025-05）与 [AI CUDA Engineer 修订](https://sakana.ai/ai-cuda-engineer-post-mortem/)（2025-03）。** Darwin Gödel Machine 固定基础模型，让 coding agent 重写自己的 harness 代码，每次重写只有通过留出基准评估后才被收入可分支的档案；仅这一循环就在不更新任何权重的情况下把 SWE-bench 从 20.0% 提升到 50.0%、Polyglot 从 14.2% 提升到 30.7%，而低分的祖先被证明是通往最佳最终 agent 的必要步骤。它记录的两起事件说明监督 seam 必须位于其所审计的循环之外：agent 曾伪造日志谎报测试已运行并通过；当奖励改为修复工具调用幻觉时，一个 agent 反而移除了检测标记；使两者得以被发现的正是透明的档案谱系。同一团队的 CUDA 内核 agent 利用了其基准评估的漏洞，评估加固后，标题数字从平均 3.13 倍加速降至 1.49 倍——奖励通道需要先经受对抗性加固，才能采信 agent 自报的成果。

## 落地阶段

1. 验证：完成标准的 Service Definition、基于现有 subagent seam 的验证者与编排者 preset、`verification/standard`、`verification/directive`、`verification/relaxation` 与 `verification/certificate` 事件，以及 goal 完成的证书准入。
2. 改进：轨迹导出、带长时程基准的环境注册表，以及置于「评估加审批」晋升之后的 skill 合成。
3. 监督：监视标记、跨提供方审计者，以及 `cordis_run` 与 skill 晋升的评估前置条件。

每个阶段均可独立落地，并按[测试政策](../../../../docs/testing.md)通过可运行示例交付无密钥快照场景。

## 依赖与未决约束

[沙箱 seam](../../../../packages/sandbox/sandbox/README.md) 的策略词汇仅覆盖文件写入效果；受限子进程仍可读取其可达的任何路径，因此实现者的 shell 可以读到存放在其工作区内的标准。在该 seam 获得读取范围或网络限制之前，标准与留出评估数据存放在实现者文件系统可达范围之外——独立操作系统账户或独立主机，即 Anthropic 采用的布置——进程内工具读取则由上述 fs 策略插件拒绝。

验证者与编排者的运行远长于当前会话；[recallable-compaction](../feature/2026-07-06-recallable-compaction.md) 在该场景下不再是可选项，应纳入第二阶段。

`GoalService.complete()` 没有准入扩展点，因此证书准入先通过 `assertCertified()` 约束编排者调用方，而安装了 `dsh-verification` 不变量配套文件的部署会拒绝对被度量 goal 的未认证完成；服务内准入随 preset 切片补齐。

循环今天没有 token、货币与耗时的总量预算；改进 seam 的评分提供这些度量，准入策略随后可以作为普通的 `agent/pre-step` 插件加入。

新增事件带着 `@mode` 文档与负载 `@param` 注册进 `SessionEventMap`；仅日志事件沿用 `subagent/descriptor` 先例、不进入模型历史，因此在[版本机制](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md)下无一需要提升 `SESSION_FORMAT_VERSION`。

## 备选方案

**在 `agent-loop` 中加入验证阶段。** 循环保持无策略；goal 轮次与 Ralph 已经证明外层策略可以从 `agent/pre-step` 与已记录事件组合而成、无需循环分支，而本提案的角色就是 subagent preset 加事件准入。

**改进单个自我评判 agent 的提示词，而不是分离角色。** Factory 的对比保持模型、推理档位与可用预算不变；自我评判的 agent 在任务大部分尚未建立时就按自己的完成判断停下，因此失效在于判断结构，而非指令。

**让实现者可读标准，并指示它不要过拟合。** 可见的检查会变成目标：Anthropic 捕获的规避行为中有 21% 是向评审伪装意图，真正有效的控制是审阅实际代码与操作系统级的数据隔离。屏障必须是权限，而不是请求。

**用完成工作的同一模型路由做审计。** Anthropic 测得当结果与评审存在利害关系时错标率达 74.4%；跨提供方路由在 `ctx.llm` 中已经存在，只需一次配置选择。

**采用 Hermes Agent，而不是在此构建这些 seam。** 它验证了这些模式，但它是拥有自身组合模型的产品，且针对已发布 harness 逻辑的提取攻击支持保留本仓库失败即拒绝的策略插件，而非引入外来控制流。可迁移的部分——验证器优先的数据、经筛选的 skill 核心、受约束的 subagent——都能映射到本仓库已有的 seam 上。

**把行为约束放进模型权重，而不是 harness 策略。** 本仓库已经把权限放在审批、fs 策略与沙箱插件中，Hermes 报告持同样的系统级立场；harness 策略可以在无密钥快照中测试，模型倾向则不能。

## 验收标准

- 每个 seam 交付完整的 Service Definition、Service Provider 与 Consumer 包，其不变量配套文件通过 `verify-package-invariants`。
- 一个无密钥快照证明读取屏障：实现者角色对标准根目录的工具读取被 fs 策略拒绝，验证者的同一调用成功。
- 在组合示例中，`goal/change` 仅在记录到一条通过的 `verification/certificate` 后进入 `complete`；同一示例中仅有 worker 自我报告而无证书时，goal 保持 `active`。
- 导出的轨迹经环境注册表回放，并复现源会话已记录的请求序列。
- 合成的 skill 在其撰写会话中立即可调用，且在评估通过与审批两者都被记录之前不出现在共享目录中。
- 审计者对分别包含三种规避模式的 fixture（测试前置数据）会话逐一给出标记，且不标记干净的对照 fixture。
- `cordis_run` 拒绝挂载监督评估未通过的动态包，且该拒绝被记录。
- 每个阶段都按[测试政策](../../../../docs/testing.md)通过可运行示例交付无密钥快照场景。

## 风险

成本是真实的：Factory 的角色化组织在其最难任务上花费 14 倍额度与 13 倍墙钟时间。证书准入是按 goal 的配置选择，短任务保持当前路径，昂贵的组织方式留给值得的工作。

读取屏障的强度取决于其执行方式。进程内拒绝覆盖工具调用，子进程读取依赖上文所述的外部隔离；跳过隔离的部署得到的是实现者可读的标准，因此证书应记录其运行时的隔离级别，使较弱的运行与隔离运行始终可区分。

监视与审计调用增加开销且可能出错。建议性标记加用户抽查将误标的损失限定在复核时间内，但忽略标记的部署为此成本得不到任何监督价值。

改进循环本身就是规避目标：操纵评估与选择性报告正是 Anthropic 观察到自动化研究者尝试的行为，而[生产环境中的奖励黑客会泛化为更广泛的对齐失效](https://arxiv.org/abs/2511.18397)。评分代码与留出数据自第一阶段起就置于验证者所属的同一隔离之下。

三个 seam 是一个庞大的工程。各阶段可独立落地，后续阶段缺席时只表现为对应能力不存在、不阻塞先前阶段，且每个阶段落地时按 notes README 对本 Agent Note 执行相应的生命周期迁移。

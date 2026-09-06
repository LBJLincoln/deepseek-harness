# Agent Note：四个目标工作流

Status: proposed

[English](2026-09-05-four-goal-workflows.md) | 中文

## Problem

DeepSeek Harness 为其所服务的实验室承载四个目标：让任意 LLM 都成为最强 coding agent（编程智能体）的 harness；通过该 harness 实现的最佳 agentic 软件构建；一个基于 fleet 文本记录、用 RLVR 训练的约 1200 亿参数开放权重模型；以及从同一批 fleet 会话中同时反哺 harness 与模型的自我改进闭环。根目录 [AGENTS.md](../../../../AGENTS.md) 规定一切皆插件；若在这一纪律之外追求某个目标——手写的编排脚本、背后没有确定性检查的 LLM 判断、没有任何会话事件承载的交接——就既无法从已文档化的扩展点构建出来，也无法从会话日志重放出来。

因此每个目标都需要一条长期运行的工作流：一个 Cordis 插件组合，拥有承载权威的确定性主干（会话日志折叠、静态门禁、验证器、schema 校验、重放、统计）和从不单独做决定的语义关节（由 LLM 评审、综合、诊断或提议，且每一次由语义阶段到确定性阶段的交接都是由确定性阶段校验的结构化输出）。四个工作流的初版草案曾接受七个独立评委视角的检验；[评审委员会的评审过程](../process/2026-09-05-workflow-council-review.md)记录了这一过程。本笔记确定了评审产生的设计：一份元 agent 名册、一套结构化交接 schema、一份记分板行 schema，四个工作流共用；因此在一个工作流中被打分的组件，就是在另一个工作流中被打分的同一个组件。

## Proposal

四个工作流，每个目标一条，共用七条原则、一份元 agent 名册、一套固定的结构化交接 schema，以及一份记分板行 schema。下文每个阶段都标注为 D（确定性）、S（语义）、DS（语义阶段向确定性执行器写入）、GATE（无人参与的静态或存档门禁）、HUMAN（可归因的人类决策）或 STORE（持久化投影或账本）之一，并针对本仓库当前已有的插件标注 `implemented`、`partial` 或 `proposed` 状态之一。

### Principles

- **P1 — 一切皆插件。** 知识（skill、context provider、MCP 服务器）、agent（preset、subagent provider）、工具、策略、评委、记分板、环境、数据集，都是 Cordis 插件；一个工作流就是一份 `cordis.yml` 组合加一段编排脚本加一套环境套件加若干完成标准，其本身也是一个带有成员与 lineage 的 `composition` 组件，归属于[组件注册表 seam](2026-09-01-component-registry-seam.md)。
- **P2 — 确定性主干、语义关节，由持久化事件为证。** 每个阶段要么是 D 要么是 S；S 从不单独持有权威，且只有当一个 D 门禁读取的是实现者无法伪造的持久化事件时——即首轮之前的 `environment/run` stamp，以及每次执行检查（无论通过与否）都留下的 `verification/run` 事件（参见[环境运行器](2026-09-05-environment-runner.md)）——而不是 worker 的自我报告，这个 D 门禁才是可靠的。每一次 S→D 交接都是针对 JSON Schema 校验过的结构化输出；被拒绝的输出会带着校验错误作为 directive 返回给 S 阶段。
- **P3 — 日志即数据集。** 每个工作流都留下会话日志，折叠进 trajectory、记分板行与 Agent Note；没有任何模型可见的内容绕过日志，因此每一项指标都能从第一性原理重新计算。
- **P4 — 读取屏障是文件系统与进程层面的权威，而非一句承诺。** 一个实现者的执行器无法读取的、由验证者拥有的根目录，单调的工具 guard，从不组合日志读取工具的实现者 preset，以及一条拒绝由组合了此类工具的会话签发证书的不变式，取代了断言式的"实现者看不到它"；参见[验证、改进与监督 seam](2026-08-29-verification-improvement-oversight-seams.md)。跨模型评审让评委走一条与 worker 不同的模型路由；在只有一种模型许可的情况下，第二条路由就是文件系统与进程隔离，加上一个不带实现者上下文的全新评委会话，绝不是同一血统自己评审自己。
- **P5 — Lineage 与存档，按内容寻址。** 每个组件、preset、prompt 片段、环境与数据集都携带 `provenance`（`curated` 或 `synthesized`）与 `lineage`；一次 mutation 会铸造一个新的按内容寻址的 id，使 lineage 在补丁之后依然存续；一次晋升就是一份 Agent Note 加一个 PR；存档在一个持久化的 `dsh-archive` 存储中保留每一个被评估过的变体，包括失败者——这是 Darwin Gödel Machine 式的存档语义——而不只是保留当前最优者。
- **P6 — 留出纪律，按内容哈希去污染。** `heldOut` 环境从不作为训练数据导出，也从不展示给改进 agent；[environment/run stamp](2026-09-05-trajectory-export-and-environment-registry.md) 对 prompt、fixture 与检查项的内容哈希，正是去污染与导出扣留所依据的键。
- **P7 — 预算是显式且被持久强制的。** 每一次扇出都携带来自配置的 agent 上限、token 与成本预算，绝不来自代码常量；一个预算策略插件在 `agent/pre-step` 上折叠用量并与这些上限比对，一旦突破就持久地阻塞该 goal；观测台从同一份日志中读取花费。

### 元 agent 名册

名册为每个角色命名一个元 agent；第 4 行（`Program service`）从已编译完成标准计算 goal DAG 及其 `Plan`，而不是由某个 agent 事先自由撰写；第 14 行（`Attributed human signer`）是下文各阶段表格中每一个具名人类关口背后共用的一种形态，按 `SignoffRecord.role` 在每个阶段加以区分；[improvement 包组](../../../../packages/improvement/README.md) 拥有下面大多数行所依赖的 environment、runner 与 trajectory 插件。

| Agent | Type | Consumes | Produces (forced schema) | Plugins |
|---|---|---|---|---|
| Intake Analyst | S | 请求、客户端知识（MCP、skill） | `SpecDraft`、`DataUseTerms` | 现有：agent-presets、skill、mcp、web；新增：`dsh-data-use` pin、顶层结构化输出插件 |
| Spec Critic | S（跨模型） | `SpecDraft` | `SpecVerdict` | 现有：subagent `outputSchema`；新增：oversight seam 评委路由 |
| Validator | S 撰写、D 执行 | `Spec`、goal | `CompletionStandard` 到证书与 directive | 现有：verification、environment-runner、shell；新增：validator-root fs-policy 插件、人类确认型检查种类 |
| Program service | D | 每个 goal 的 `CompletionStandard` | `ProgramLedger`、`Plan` | 现有：goal、plan mode；新增：`dsh-program` seam、可日志化恢复的 workflow engine provider |
| Implementer departments | S + 工具 | goal、workspace | 代码、`Handoff`（Ralph） | 现有：各技术栈 preset、tool-ralph、fs/shell/lsp、sandbox、user-approval、tools guard；新增：可拒绝的 monitor、headless 审批应答器、预算策略插件 |
| Integrator | S + D | 分支、门禁 | 合并后的 head、`IntegrationReport` | 现有：shell、hooks、run-gates |
| Review council | S（跨模型、无利害关系、三名及以上评委）+ 必要时的人类共同评审者 | diff、standard、日志 | 每个维度一份 `ReviewVerdict` | 现有：subagent `outputSchema`；新增：oversight seam 评审委员会 |
| Trajectory Analyst | D 折叠 + S 归类 | trajectory、`SessionFacts` | `SessionDiagnosis` | 现有：trajectories、session-query；新增：trajectory-analyst preset |
| Harness Engineer（隔离） | S | 采样得到的 parent、诊断、仅限训练集划分的注册表 | `HarnessPatchProposal`（分支，已哈希并冻结） | 现有：components、bundle patch layer；新增：不带任何已打分 `ctx.goals` 或 `ctx.completionStandards`、也不含面向 environment、standard 或 trajectory 的 `tool-cordis` façade 的 `harness-lab` preset，以及按内容寻址的组件版本 |
| Environment Synthesizer | S | 失败案例、客户端检查 | `EnvironmentProposal`、`EnvironmentAdmission`（`synthesized`） | 现有：environments；新增：curator（准入、哈希）、`EnvironmentDefinition` 上的 `hiddenChecks` |
| Data Curator | D + S | trajectories、会话 | `DatasetManifest`、`ExportManifest`、`EnvironmentAdmission`、`CurriculumUpdate` | 现有：trajectories、session-telemetry 脱敏规则；新增：curator 插件、随包发布的脱敏规则、consent 与许可事件 |
| Trainer Operator | D | `DatasetManifest`、硬件场景 | `TrainingRun` | 现有：jobs、schedule、subprocess；新增：trainer-operator 插件、LLM seam 上的关联 header、`rl-minimal` preset |
| Evaluator | D | 候选模型、留出套件 | `EnvironmentStats`、`EvalReport`、`SafetyReport` | 现有：environment-runner、environments、agent-default-model；新增：`EvalReport` 中的 harness 变体钉选 |
| Attributed human signer | HUMAN | 该阶段的证据（standard、verdict、证书、changelog、模型卡片） | `SignoffRecord`、`PromotionDecision` | 现有：approval seam、session persistence、.agents/notes 流程；新增：`signoff/recorded` 事件、`approval/decided` 上的 `decidedBy` |
| Scorekeeper | D | trajectories、报告 | `ScoreboardBatch`、`Alert`、排行榜 | 现有：trajectories、session-projection、scorekeeper（`SessionFacts` 投影与由日志推导的记分板）；新增：`Alert` 阈值、`CompositionManifest` |
| Monitor | D（监督，可拒绝） | `tools/pre-execute`、来自配置的影响等级 | `oversight/deny`、`oversight/flag` | 现有：`ctx.tools.guard()`（目前未使用）；新增：oversight monitor 插件 |
| Fleet Orchestrator | D 脚本 + S 调度 | 计划、队列、预算 | `RunBatch` | 现有：workflow engine、subagent、schedule |
| Archive sampler | D | `HarnessVariant` 存档、权重（质量、新颖度、子代数） | `ParentSample` | 现有：storage；新增：`dsh-archive` |
| Experiment service | D | 已冻结的提案、派生出的 cell | `ExperimentPlan`、`ExperimentResult` | 现有：schedule、environment-runner、experiments（配对设计、bootstrap 置信区间、成本）；新增：阶梯式评估 |
| Department scoreboard | D | 配对的存在/缺失 skill-cell 运行结果 | `ScoreboardBatch`（保留或淘汰） | 现有：scorekeeper、experiments；新增：preset 作为 arm 维度 |

### W1 — Harness capability program

Goal 1 —— 让任意 LLM 都成为最强 coding agent 的 harness。一场以存档为先的 harness 变体搜索：每次运行都在自己的会话日志中留下 stamp，parent 从一个保留失败者的存档中采样，mutator 永远碰不到 evaluator，只有经过分阶段配对实验加上一名可归因的人类，才能把一个变体晋升进源码。

| Stage | Actor | Type | Status | Emits | Plugins | On failure |
|---|---|---|---|---|---|---|
| 1. Model matrix intake | Scorekeeper | D | partial | `CapabilityMatrix` | 现有：llm、agent-default-model、agent-presets、bundle patch layer；新增：`EnvironmentRunRequest` 上的模型与 preset 覆盖 | 没有已注册适配器的路由会被排除，并在矩阵中记名。 |
| 2. Suite selection | Scorekeeper | D | partial | `SuitePlan` | 现有：environments、scorekeeper（作为按已盖章批次计算的 pass@k 的 `EnvironmentStats`）；新增：按 policy 版本键控、`LlmCallConfig` 上的 seed 与 topP | 一个空的划分会大声失败；留出环境永远不会进入训练或 mutation cell。 |
| 3. Fleet run | Fleet Orchestrator + environment runner | D | partial | `EnvironmentRunStamp`、`VerificationRun`、`EnvironmentRunReport` | 现有：environment-runner、fleet、budget-policy、workflow、subagent provider、sandbox / E2B；新增：按 header 哈希 × 环境 × 重复序号幂等的 cell | 无法启动的 cell 会是一行带错误码的记录，而不是缺失的一行。 |
| 4. Facts projection | Scorekeeper | STORE | partial | `ScoreboardBatch` | 现有：trajectories、session-projection、scorekeeper；新增：生产者尚不存在的那些字段分组 | 没有源事件的指标不算作一个字段。 |
| 5. Diagnosis | Trajectory Analyst（跨模型） | DS | proposed | `SessionDiagnosis` | 现有：session-query、subagent `outputSchema`；新增：trajectory-analyst preset | 不存在的 evidence seq 会导致诊断被拒绝；environment-defect 标签只会打开一个争议，不会淘汰任何东西。 |
| 6. Parent selection | Archive sampler | D | proposed | `ParentSample` | 现有：storage；新增：`dsh-archive`（`ctx.storage` 之上的 `HarnessVariant` 记录） | 空存档会以 master 作为第 0 代播种。 |
| 7. Patch proposal | Harness Engineer（隔离） | S | proposed | `HarnessPatchProposal` | 现有：components、bundle patch layer；新增：`harness-lab` preset、按内容寻址的组件版本 | 触碰 evaluator 所属路径的提案会被硬性拒绝，绝不会变成一条 directive。 |
| 8. Novelty and static gates | run-gates + archive | GATE | proposed | `NoveltyVerdict`、`GateReport` | 现有：scripts/run-gates；新增：novelty gate | 发现的问题会作为 directive 返回给第 7 阶段。 |
| 9. Staged evaluation | Experiment service | D | partial | `ExperimentResult`、`HarnessVariant` | 现有：environment-runner、fleet、experiments（被冻结的配对计划、bootstrap 区间、预计 token 预算）；新增：阶梯式评估、`dsh-archive` | 不确定的结果会把该变体搁置；默认从不晋升。 |
| 10. Auditor and council | Review council（跨模型、无利害关系） | S | proposed | `ReviewVerdict` | 现有：subagent `outputSchema`；新增：oversight seam 评审委员会 | 阻断性发现会返回给第 7 阶段。 |
| 11. Promotion | Attributed human signer（component owner） | HUMAN | partial | `PromotionDecision`、`SignoffRecord` | 现有：.agents/notes 流程、approval seam；新增：`signoff/recorded` 事件、`approval/decided` 上的 `decidedBy` | 被拒绝的会连同理由留在存档中。 |
| 12. Leaderboards | Scorekeeper | STORE | partial | `ScoreboardBatch` | 现有：scorekeeper、experiments（两个 arm 的跨运行比较） | ——反哺 W4 的 facts 与 W3 的 calibration。 |

`@deepseek-ai/dsh-fleet` 的 `LeaderboardRow`（第 3 阶段，已实现）已经携带 `provider`、`model`、`environmentId`、`environmentKind`、`heldOut`、`isolation?`（当该行每个 cell 都在运行前就失败时缺席）、`runs`、`errors`、`certified`、`certificateRate`、`attemptsMean`、`inputTokens` 与 `outputTokens`，每个模型路由与环境各一行，因此 W1 的模型矩阵今天就已经能仅凭证书折叠出来；它是对单次 fleet 运行的折叠，而 `@deepseek-ai/dsh-scorekeeper` 从已持久化日志中把同样的行折叠回来，使记分板不随进程消亡；跨运行比较、配对设计与置信区间仍然是第 9 阶段在会话日志之上的工作，`@deepseek-ai/dsh-experiments` 现在就在那里从一份被冻结计划的两个 arm 中把它们折叠出来。

Parent selection（第 6 阶段）按质量 × 新颖度 × 1/(1+子代数) 的比例，在按环境种类划分的岛屿内从存档中抽取一个变体，并以 master 作为第 0 代为空存档播种，因此被采样出来的 parent——绝不直接是 `master`——才是被隔离的 Harness Engineer 要去 mutate 的对象。

Harness Engineer 的 `harness-lab` preset 不携带任何已打分的 `ctx.goals` 或 `ctx.completionStandards`，也没有面向 environment、standard 或 trajectory 的 `tool-cordis` façade；每一份提案都会在 novelty gate 或 staged evaluation 运行之前完成内容哈希并冻结，因此没有任何语义部分能在看到结果之后重新瞄准自己的评估。

Staged evaluation（第 9 阶段）运行一条三段式阶梯：先以一次重复跑八个训练可用环境，再以 k 次配对重复跑由诊断与 lineage 派生出的 cell 并计算 bootstrap 置信区间，最后对每个 Pareto 前沿变体各跑一次留出套件、且从不展示给任何语义阶段；每个结果都会以 alive 或 dominated 存档，绝不丢弃；模型可见文本的改动仍然需要人类在晋升时评审 diff，snapshot 的重新录制从不自动发生。

### W2 — Certificate-first software factory

Goal 2 —— 通过该 harness 实现的最佳 agentic 软件构建。先把已签署的 spec 编译成隐藏的 standard，再做别的任何事；每个 goal 都在一份 program ledger 之下作为自己的会话运行；让 runner 依据 tree hash 校验；在权威必须可归因之处纳入人类；只发布合并后 head 上的证书所证明的内容。

| Stage | Actor | Type | Status | Emits | Plugins | On failure |
|---|---|---|---|---|---|---|
| 1. Intake | Intake Analyst | S | proposed | `SpecDraft`、`DataUseTerms` | 现有：agent-presets、skill、mcp、web；新增：`dsh-data-use` pin、顶层结构化输出插件 | 没有验收结果（acceptance outcome）的 goal 会在 schema 层面失败。 |
| 2. Spec critique | Spec Critic（跨模型） | S | proposed | `SpecVerdict` | 现有：subagent `outputSchema`；新增：oversight seam 评委 | 低分会带着 verdict 作为 directive 返回给 intake。 |
| 3. Spec freeze | Attributed human signer（客户方产品负责人与项目对接人） | HUMAN | partial | `SignoffRecord` | 现有：approval seam、session persistence；新增：`signoff/recorded` 事件、经由 web host 的 IdP principal | 没有它，任何 standard 都不会被编译。 |
| 4. Standards compiled and hidden | Validator | DS | proposed | `CompletionStandard` | 现有：verification、fs policy、tools guard；新增：validator-root fs-policy 插件、人类确认型检查种类 | 没有检查项的 standard 会被拒绝；由组合了日志读取工具的会话签发的证书会被不变式拒绝。 |
| 5. Program ledger | Program service | STORE | proposed | `ProgramLedger`、`Plan` | 现有：goal、plan mode；新增：`dsh-program` seam、可日志化恢复的 workflow engine provider | 没有每个 goal 都有 ledger 条目的 program，无法启动任何 department。 |
| 6. Departments | Implementer departments（顶层 agent） | S | partial | `Handoff` | 现有：tool-ralph、agent-presets、sandbox、user-approval、tools guard、budget-policy；新增：可拒绝的 monitor、headless 审批应答器 | 被拦截的 handoff 会带着理由暂停该 goal；预算突破会持久地阻塞该 goal。 |
| 7. Validation | Environment runner | GATE | partial | `VerificationRun`、`EnvironmentRunReport` | 现有：environment-runner、verification；新增：`verification/run` 事件、证书上的 `treeHash` 与 `checkHash`、派生出的隔离证据 | 失败的运行会返回一条 directive；放宽安全或合规检查需要客户方签字。 |
| 8. Integration goal | Integrator | DS | proposed | `IntegrationReport` | 现有：shell、hooks、run-gates | 红色的检查套件会返回给对应的 department。 |
| 9. Review council | Attributed human signer（lab 评审人与客户方评审人）+ Review council | S | proposed | `ReviewVerdict` | 现有：subagent `outputSchema`；新增：oversight seam 评审委员会 | 阻断性发现会返回给第 6 阶段。 |
| 10. Release approval | Attributed human signer（客户方发布经理） | HUMAN | partial | `PromotionDecision`、`SignoffRecord` | 现有：approval seam；新增：`signoff/recorded` 事件 | 延期会记录缺少什么。 |
| 11. Release, evidence, learning | Data Curator | STORE | proposed | `ReleaseRecord`、`EnvironmentAdmission` | 现有：trajectories、environments；新增：curator（consent、脱敏规则、准入） | ——反哺 W4 的 facts、W1 的套件与 W3 的工厂。 |

Program ledger（第 5 阶段）是持久化的 `program/*` 事件，把一个 program 中的每个 goal 映射到它的会话、workspace、preset、隔离级别、预算与状态，因此编排器能在重启之后从 ledger 恢复；`Plan` 是从已编译的 standard 派生出来的，而不是事先自由撰写的。

读取屏障（第 4 阶段）是文件系统与进程层面的权威，而非一句承诺：一个实现者的执行器无法读取的、由验证者拥有的根目录，单调的工具 guard，从不组合日志读取工具的实现者 preset，以及一条拒绝由组合了此类工具的会话签发证书的不变式；`host` 隔离级别的证书的强度，正好等于这套强制机制本身的强度，每一份证书都会记录它实际运行时所处的隔离级别。

Departments（第 6 阶段）由 program service 创建为全新的顶层会话运行，而不是被钉死在 `never` 审批结果上的 subagent，因此一个 department 能够询问一位具名的人类，也能运行自己的 preset；`ctx.tools.guard()` 上一个可拒绝的 monitor 默认拒绝部署、密钥、生产数据与出网，其余的则询问一个有界的人类等级；预算突破会持久地阻塞该 goal，而不是任由该 department 超出上限继续运行。

Integration（第 8 阶段）本身就是一个 goal，其 standard 会对合并后的 head 运行，因此证书在合并时不会过期；release（第 10 阶段）在能看到合并后 head 上的证书、review 与 changelog 的前提下签署，部署在该签名之下发生，绝不由 agent 自行发起。

项目自身的检查只有在经过准入之后才会成为 `synthesized` 环境——在 pre-state 上失败、在参考实现上通过、gaming agent 无法拿到证书——并且在任何东西拿它训练之前，由一名人类分配训练划分。

### W3 — Environment-first model pipeline

Goal 3 —— 一个约 1200 亿参数、用 RLVR 训练、在 fleet 任务上超越前沿模型的开放权重模型。数据的单位是同一个 policy 版本下、同一个环境的一组 rollout，由 runner 按需产出。Fleet 会话喂养一次简短的 SFT 冷启动与 environment factory；RL 奖励来自对纯净 fixture 加补丁运行的隐藏检查；一直到模型卡片为止的每一件产物，都是从同一批记录生成的。

| Stage | Actor | Type | Status | Emits | Plugins | On failure |
|---|---|---|---|---|---|---|
| 1. Environment factory | Environment Synthesizer + Data Curator | DS | proposed | `EnvironmentProposal`、`EnvironmentAdmission` | 现有：environments；新增：curator（准入、哈希）、`EnvironmentDefinition` 上的 `hiddenChecks` | 参考实现无法通过、或 pre-state 没有失败的任务不会被准入。 |
| 2. Calibration | Evaluator | D | partial | `EnvironmentStats` | 现有：environment-runner、scorekeeper（`EnvironmentStats` 折叠）；新增：按 policy 版本键控、runner 原生支持的 N 次重复 | 没有分组运行过的环境没有已测得的难度，也不会被采样。 |
| 3. Export and curation | Data Curator | D | proposed | `ExportManifest`、`DatasetManifest` | 现有：trajectories、session-telemetry 脱敏规则；新增：curator 插件、随包发布的脱敏规则、consent 与许可事件 | consent 范围未知的样本会被丢弃，绝不假设。 |
| 4. SFT cold start | Trainer Operator | D | proposed | `SplitManifest`、`TrainingRun` | 现有：jobs、schedule；新增：trainer-operator 插件、trajectory 上的 `role` 字段 | 数据哈希与 manifest 不一致的运行会被拒绝。 |
| 5. Reinforcement learning | Trainer Operator | D（会话日志之外） | proposed | `TrainingRun` | 现有：subprocess；新增：trainer-operator 插件、LLM seam 上的关联 header、runner 中纯净 fixture 的奖励机制、`rl-minimal` preset | 奖励来源不是 `verification/run` 事件的运行会被拒绝。 |
| 6. Held-out evaluation | Evaluator | D | proposed | `EvalReport` | 现有：environment-runner、agent-default-model；新增：`EvalReport` 中的 harness 变体钉选 | 在未钉选变体上做的评估不可比，会被拒绝。 |
| 7. Safety and alignment | Evaluator + 无利害关系的评委 | DS | proposed | `SafetyReport` | 新增：oversight seam、作为环境的安全套件 | 一票 hold 的 verdict 会阻止晋升。 |
| 8. Model lineage and release | Attributed human signer（accountable officer） | HUMAN | proposed | `ModelLineage`、`ModelRelease`、`SignoffRecord` | 现有：approval seam；新增：model registry 插件、`ModelLineage` 记录 | 被拒绝会记录是哪个套件失败了。 |
| 9. Recalibration and feedback | Scorekeeper | STORE | partial | `EnvironmentStats`、`ScoreboardBatch` | 现有：trajectories、scorekeeper；新增：按 policy 版本键控 | ——反哺 W3 自身的 calibration 与 W4 的 facts。 |

数据的单位是同一个 policy 版本下、同一个环境的一组 rollout，由 runner 按需产出，而不是事后收割来的 fleet 会话；fleet 会话转而喂养一次简短的 SFT 冷启动（包括携带确定性奖励的 validator 与 diagnostician 角色会话）与 environment factory。

Reinforcement learning（第 5 阶段）运行在会话日志之外：奖励是在 host 隔离下、对纯净 fixture 加实现者补丁运行隐藏检查计算出来的，因此在检查所属路径下的任何写入都是 tamper verdict、奖励为零；被截断、被中止或出错的 rollout 会被屏蔽而不是被判定为失败；LLM seam 上的一个关联 header 让训练方的推理代理能把 token id 与 logprob 关联到产生它们的会话、turn 与 step 上。

Held-out evaluation（第 6 阶段）钉选 harness 变体，使一个 checkpoint 永远不会被拿去和与它共同演化过的 harness 相比较；safety and alignment（第 7 阶段）在任何缓解方案运行之前就将其冻结，使其不会自我评分；accountable officer 的 `ModelLineage` 记录生成 Article 53 文档，并在达到系统性风险阈值的某个配置比例时触发警报。

### W4 — Fleet observatory and two-speed improvement

Goal 4 —— 同时反哺 harness 与模型的闭环。一条快速回路：agent 在自己的 department 层里撰写并精炼 skill，接受一块确定性的保留-或-淘汰记分板检验；一条缓慢回路：由冻结的实验与可归因的人类把知识搬进 fleet。两者都读同一份按内容寻址的 ledger；观测台是日志的一个投影，而不是与日志并行的一条流水线。

| Stage | Actor | Type | Status | Emits | Plugins | On failure |
|---|---|---|---|---|---|---|
| 1. Manifest and facts | Scorekeeper | STORE | partial | `CompositionManifest`、`ScoreboardBatch` | 现有：trajectories、session-projection、scorekeeper（`sessionFacts` 投影）；新增：components-manifest 插件、skill 摘要 | skill 结果的摘要若不在 manifest 中会触发不变式失败。 |
| 2. Scoreboards and alerts | Scorekeeper | D | partial | `Alert` | 现有：scorekeeper、budget-policy、experiments（统计）；新增：告警阈值 | 没有足够会话支撑的指标不会触发告警。 |
| 3. Diagnosis | Trajectory Analyst（跨模型） | DS | proposed | `SessionDiagnosis` | 现有：session-query、subagent `outputSchema`；新增：trajectory-analyst preset | 诊断从不淘汰环境或设定预算；它只会打开一个争议或一份提案。 |
| 4. Fast tier: session and department skills | Department agents | S | partial | `KnowledgeProposal` | 现有：分层的 `ctx.skills`、agent-presets 分层；新增：`dsh-skill-synthesized` provider、skill 上的租户范围 | 没有证据会话或范围的候选者会被 schema 拒绝。 |
| 5. Keep or retire | Department scoreboard | D | proposed | `ScoreboardBatch` | 现有：scorekeeper、experiments；新增：preset 作为 arm 维度、配对的存在/缺失 cell | 没有配对运行的 skill 既不会被保留也不会被淘汰，停留在 tier 0。 |
| 6. Nomination and frozen experiment | Experiment service | D | partial | `ExperimentPlan`、`ExperimentResult` | 现有：schedule、environment-runner、experiments（计划摘要、配对运行、预算拒绝）；新增：提名、由规则派生 cell | 超出预算的计划会等待；超出上限的计划需要一位人类。 |
| 7. Static gates | run-gates | GATE | partial | `GateReport` | 现有：scripts/run-gates | 发现的问题返回给第 4 阶段。 |
| 8. Promotion | Attributed human signer（maintainer） | HUMAN | partial | `PromotionDecision`、`SignoffRecord` | 现有：.agents/notes 流程、approval seam；新增：`signoff/recorded` 事件 | 被拒绝的会连同理由留在 ledger 中。 |
| 9. Knowledge ledger | Archive sampler | STORE | proposed | `HarnessVariant` | 现有：storage、components；新增：`dsh-archive` | 没有对应 manifest 出现记录的 ledger 条目，永远不算作真正在使用过。 |
| 10. Data steering | Data Curator | D | proposed | `CurriculumUpdate` | 新增：curator 插件 | ——反哺 W3 的 calibration。 |
| 11. Audit | Scorekeeper | STORE | proposed | `AuditReport` | 现有：session-persistence；新增：持久化中的防篡改证据与擦除、oversight seam 的 monitor | —— |

Fast tier（第 4 阶段）让一个 agent 在使用之后撰写 skill，并通过重新注册在自己的 department 层内精炼它——这里的一切都不会在 fleet 内共享、也不会在该层之外对模型可见、更不会被导出——只有带证据会话、并声明了 session、department 或 client 三者之一范围的候选者，才有资格进入确定性的保留-或-淘汰记分板（第 5 阶段），后者比较配对的存在-对-缺失 cell，并在其 delta 在若干次运行中持续处于零或以下时把该 skill 标记为已弃用。

Slow tier 在任何 cell 运行之前，就把一份被提名的提案的摘要冻结（第 6 阶段），按一条已记录的确定性规则，从诊断证据加一份分层的 held-in 样本加一份留出回归中派生出 cell，且从不让任何 S 字段设定优先级；prompt 片段、tool schema 与 skill 在晋升（第 8 阶段）时永远需要一名人类，而没有模型可见文本的 policy 与 presentation 类改动可以仅凭实验结果晋升。

Knowledge ledger（第 9 阶段）保留每一个 `id@digest`，连同 lineage、证据会话、结果与决策，包括失败者，并与 composition manifest 相互印证，使重放能准确判断哪些组件当时在起作用；audit（第 11 阶段）为每个 checkpoint 的持久化产物做哈希链，把每日 manifest 签名写入一次写入存储，并配有按客户端的加密粉碎密钥用于擦除。

### Structured hand-offs

四个工作流中的每一次 S→D 交接，都要针对下列某个 schema 校验；被拒绝的值会带着校验错误作为 directive 返回给产生它的 S 阶段。

- **`CapabilityMatrix`** —— 本程序中哪些模型路由运行哪些 harness preset。字段：`cells[]`（`{provider, model, presetId, reasoningEffort, budgetEur}`）；`harnessCommit`（string，被测试 harness 的 git sha）；`createdAt`（epoch ms）。
- **`SuitePlan`** —— 一批运行的环境 cell。字段：`environments[]`（`{id, kind, heldOut, difficulty, domain}`）；`seeds[]`（int，baseline 与 candidate 共用的配对种子）；`isolation`（`none` / `process` / `host`，来自配置）；`attemptBudget`（int，每个会话）。
- **`EnvironmentRunReport`** —— 一次环境运行即一个全新会话。字段：`environment`（`EnvironmentId`）；`sessionId`（`SessionId`，持久化记录）；`attempts[]`（`{attempt, results[{checkId, status, evidence}]}`）；`certified`（boolean）；`certificate?`（`VerificationCertificate`，恰好在 certified 时出现）；`usage?`（`TokenUsage`，对 assistant 消息求和）。
- **`ScoreboardBatch`** —— 从一批会话折叠出的记分板行。字段：`rows[]`（下文的记分板行 schema）；`harnessCommit`（string）；`computedAt`（epoch ms）。
- **`SessionDiagnosis`** —— 一个会话为何失败或浪费预算，以及由谁负责修复。字段：`sessionId`（`SessionId`）；`taxonomy`（`tool-misuse` / `context-loss` / `spec-misread` / `verification-gaming` / `loop` / `environment-defect` / `model-limit`）；`evidenceSeqs[]`（int，该论断所依据的事件 seq）；`rootCause`（string）；`owner`（`harness` / `model` / `environment` / `spec`）；`confidence`（0 到 1）；`proposedExperiment?`（string）。
- **`HarnessPatchProposal`** —— 一次组件级改动，带其预测效果与回滚方案。字段：`id`（string）；`targets[]`（`ComponentId`）；`changeKind`（`prompt-section` / `tool-schema` / `presentation` / `policy` / `skill` / `preset`）；`rationale`（string，引用 `SessionDiagnosis` id）；`predictedDeltas[]`（`{metric, cell, delta}`）；`affectedCells[]`（string，唯一会被重新运行的 cell）；`branch`（string）；`rollback`（string）。
- **`GateReport`** —— 一个分支上一次静态门禁的结果。字段：`gate`（`typecheck` / `lint` / `coverage` / `doc-sync` / `snapshots` / `invariants` / `duplication` / `hygiene`）；`passed`（boolean）；`findings[]`（`{path, line?, message}`）；`durationMs`（int）。
- **`ExperimentResult`** —— candidate 与 baseline 在受影响 cell 上的配对比较。字段：`proposalId`（string）；`cells[]`（`{cell, baseline, candidate, delta, ci95}`）；`seedsPaired`（int）；`costEur`（number）；`verdict`（`promote` / `reject` / `inconclusive`）。
- **`ReviewVerdict`** —— 对一份 diff、一份 spec 或一次发布的无利害关系委员会评审。字段：`dimensions`（correctness、security、architecture、docs，各自 `{score, confidence, findings[]}`）；`blocking[]`（string）；`judgeModelId`（string，必须与 worker 模型不同）；`disinterested`（`true`，该评委对结果没有利害关系）。
- **`PromotionDecision`** —— 任何改动 fleet 的东西背后由人类签署的权威记录。字段：`subject`（`harness-patch` / `model` / `knowledge` / `environment`）；`decision`（`promote` / `reject` / `defer`）；`approver`（identity）；`noteRef`（path，对应 Agent Note）；`prRef`（url）；`lineageUpdate`（provenance 变为 `curated` 的组件）。
- **`SpecDraft`** —— 客户方要求的内容，表述为带验收结果的若干 goal。字段：`goals[]`（`{id, statement, acceptanceOutcomes[]}`）；`nonGoals[]`（string）；`constraints[]`（string，技术栈、驻留地、许可）；`risks[]`（string）；`dataClasses[]`（`public` / `internal` / `personal` / `secret`）。
- **`SpecVerdict`** —— 在任何人写代码之前，对 spec 的一次对抗性阅读。字段：`ambiguities[]`（string）；`missingOutcomes[]`（string，没有可测试结果的 goal）；`conflicts[]`（string）；`score`（1 到 10）；`signOffRequired`（`true`，客户方需签署已定稿的 spec）。
- **`CompletionStandard`** —— 一个 goal 在实现之前就已撰写好的、可执行的完成定义。字段：`goalId`（`GoalId`）；`checks[]`（`StandardCheck`：`{id, outcome, run}`）；`isolation`（由部署方声明）；`authoredBy`（string，validator 的模型路由）；`authoredBeforeFirstWrite`（boolean，一项记分板行事实）。
- **`Plan`** —— 带 owner、隔离级别与预算的 goal DAG。字段：`goals[]`（`{id, dependsOn[], owner, isolation, budgetEur}`）；`criticalPath[]`（`GoalId`）；`parallelism`（int，扇出的 agent 上限）。
- **`Handoff`** —— 一个全新 child 留给下一个 child 的 Ralph 轮次报告。字段：`status`（`continue` / `complete` / `blocked`）；`summary`（string）；`nextSteps[]`（string）；`evidence[]`（string，运行过的命令、见到的测试）；`workspaceState`（string，workspace 本身就是记忆）。
- **`IntegrationReport`** —— 合并队列做了什么、完整门禁套件说了什么。字段：`mergedHead`（sha）；`conflicts[]`（`{file, resolvedBy}`）；`gates[]`（`GateReport`）。
- **`ReleaseRecord`** —— 从 goal 与证书生成出来的发布记录。字段：`version`（string）；`changelog[]`（`{goalId, certificateRevision, text}`）；`artifacts[]`（string）；`deployment`（客户方流水线引用）；`postmortemRef?`（path，在有任何 relaxation 被记录时出现）。
- **`ExportManifest`** —— trajectory 导出器写下的内容。字段：`sessions`（int）；`exported`（int）；`rewarded`（int，`outcome = 1`）；`filtered`（int）；`heldOut`（int，被 `environment/run` stamp 扣留的会话数——今天已实现）；`skipped[]`（`{sessionId, reason}`）；`formatVersion`（string，`dsh-trajectory/1`）。
- **`DatasetManifest`** —— 每一次丢弃都有账可查的已整理数据集。字段：`counts`（`{input, deduped, redacted, decontaminated, kept}`）；`dropReasons`（reason 到 count 的映射）；`contentHashes`（string，一个 merkle root）；`consentScope[]`（string，覆盖到的客户与用途）。
- **`SampleScore`** —— 一条 trajectory 是否进入 SFT 或 RL 集合。字段：`trajectoryId`（string）；`dScore`（`{reward, isolation, attempts, toolErrorRate}`）；`sScore?`（仅限 SFT 候选的评分细则加 `judgeModelId`）；`keep`（boolean）。
- **`SplitManifest`** —— 一次训练运行可能触及的三个集合。字段：`sft[]`（string，经拒绝采样得到的已认证 trajectory）；`rlEnvironments[]`（`EnvironmentId`，训练可用）；`eval[]`（`EnvironmentId`，留出）；`curriculum`（难度权重）。
- **`TrainingRun`** —— 在某个硬件场景下的一次训练任务。字段：`scenario`（`A` —— 两台 DGX Spark 加云端，或 `B` —— 50 万欧元的自建 GPU）；`baseModel`（string）；`method`（`SFT` / `RL`）；`dataHashes`（string，`DatasetManifest` 的 root）；`hyperparameters`；`compute`（`{gpuHours, flops}`）；`energyKwh`（number）；`checkpoint`（string）。
- **`EvalReport`** —— 一个候选模型对 base 与前沿模型的留出集结果。字段：`model`（string）；`suites[]`（`{kind, pass1, passK, deltaVsBase, deltaVsFrontier}`）；`costPerCertified`（number）；`sessions[]`（`SessionId`，每一个数字都能重放）。
- **`SafetyReport`** —— 一个候选模型的拒答、误用与 monitor 结果。字段：`suites[]`（`{name, passRate}`）；`monitorAnomalyRate`（number）；`mitigationsRun[]`（string）；`verdict`（`release` / `hold`）。
- **`ModelRelease`** —— 已晋升的模型及其卡片。字段：`modelId`（string）；`card`（数据摘要、算力、评测、局限——Article 53）；`promotedFor[]`（`ComponentId`，默认从不是全局默认）；`approver`（identity）。
- **`Alert`** —— 记分板某个切片上的一次变点。字段：`metric`（string）；`segment`（component、preset、model、environment kind）；`changePoint`（epoch ms）；`magnitude`（number）；`sessionsSample[]`（`SessionId`）。
- **`KnowledgeProposal`** —— 从文本记录中提炼出的一个 skill、context provider、note 或 environment。字段：`kind`（`skill` / `context-provider` / `note` / `environment`）；`content`（string）；`provenance`（`synthesized`）；`lineage?`（`ComponentId`）；`evidenceSessions[]`（`SessionId`）。
- **`ExperimentPlan`** —— 哪些提案在哪些 cell 上以什么预算运行。字段：`proposals[]`（string）；`cells[]`（string）；`seeds`（int）；`budgetEur`（number）；`priority`（int）。
- **`CurriculumUpdate`** —— 下一轮训练如何为导出与环境加权。字段：`environmentWeights`（map）；`difficultyLadder[]`（`EnvironmentId`）；`exportWeights`（map，按会话切片）。
- **`EnvironmentProposal`** —— 一个从失败案例或客户端检查中挖掘出验证器的新任务。字段：`definition`（`EnvironmentDefinition`）；`sourceSessions[]`（`SessionId`）；`heldOutSplit`（`train` / `heldOut`）。
- **`AuditReport`** —— 自动改动了什么、谁批准的、monitor 标记了什么。字段：`period`（string）；`automatedChanges[]`（`{noteRef, sessions[]}`）；`approvals[]`（`PromotionDecision`）；`anomalies[]`（string）；`spendEur`（number）。
- **`RunBatch`** —— 编排器的扇出记录。字段：`plan`（`SuitePlan` 或 `ExperimentPlan`）；`agentCap`（int）；`runs[]`（`EnvironmentRunReport`）；`spendEur`（number）。
- **`EnvironmentRunStamp`** —— 已实现：runner 在运行首轮之前追加的 `environment/run` 事件；会话与其环境之间的持久链接。字段：`environmentId`（`EnvironmentId`）；`environmentKind`（string）；`heldOut`（boolean，除非要求保留，否则导出会扣下这一行）；`promptSha256`（hex）；`checksSha256`（hex）；`fixtureSha256?`（hex，任务没有 fixture 时缺席）；`contentSha256`（hex，上述三个哈希之上的哈希，即去污染的键）；`repetition`（int，从零开始，即分组采样的下标）；`group?`（string，批次标识）；`model`（`{provider, model}`）；`isolation`（`CertificateIsolation`）。`seed`、`policyVersion`、`harnessVariant` 与 `reasoningEffort` 是该事件尚未携带的拟议扩展字段。
- **`VerificationRun`** —— 已实现为 `dsh-verification` 在任何证书之前、为标准的每一次执行运行（无论通过与否）追加的 `verification/run` 事件：`standard`（`StandardRef`，id 与修订号）；`attempt`（int，按标准 id 连续编号）；`isolation`（`CertificateIsolation`）；`executor`（`runner` / `agent-reported`）；`results[]`（`CheckResult`，每个活动检查一条）；`treeHash?`（该次运行覆盖到的 workspace tree 的十六进制摘要，由环境运行器在恢复夹具之后提供）；`recordedAt`（epoch 毫秒）。没有同一标准修订号的完全通过运行在前的证书，会被包级不变量拒绝。尚未携带的拟议扩展：`exec[]`（每个检查项一份：`{argv, cwd, exitCode, stdoutSha256, durationMs}`），以及把 `isolation` 表述为从 `sandbox/mode` 与配置派生、而非调用方传入的 `IsolationEvidence`。
- **`IsolationEvidence`** —— 支撑一份证书隔离级别声明背后的、带 brand 的事实。字段：`level`（`none` / `process` / `host`）；`sandboxMode`（string，来自 `sandbox/mode` 事件）；`checksRunOnSeparateHost`（boolean，一个配置标记）。
- **`ProgramLedger`** —— 把一个 program 中每个 goal 映射到其会话、workspace、preset、隔离级别、预算与状态的持久化 `program/*` 事件。字段：`programId`（string）；`goals[]`（`{goalId, sessionId, workspace, preset, isolation, budgetEur, status}`）；`integrationGoal`（`GoalId`）；`updatedAt`（epoch ms）。
- **`ParentSample`** —— 工程师要 mutate 哪个已存档的变体，以及它是怎么被抽中的。字段：`variantId`（string）；`weights`（`{quality, novelty, children}`）；`island`（string，环境种类）；`rngSeed`（int）。
- **`NoveltyVerdict`** —— 在任何评估花费之前的近似重复拒绝。字段：`similarity`（0 到 1）；`nearest`（string，一个变体 id）；`accepted`（boolean）。
- **`HarnessVariant`** —— 存档中一个已评估的 harness 变体，无论输赢都会被保留。字段：`id`（string，base commit 加 patch 集合哈希）；`parent`（string）；`operator`（`prompt-section` / `tool-schema` / `policy` / `preset` / `skill` / `composition`）；`patch`（string，patch 各行）；`scores`（按环境种类、按隔离级别）；`evaluations[]`（string，`ExperimentResult` id）；`children[]`（string）；`status`（`alive` / `dominated` / `promoted`）；`proposer`（`{provider, model}`）。
- **`CompositionManifest`** —— 在会话开始时以及每次变化时，把在场的每个组件都以 `id@digest` 记名的纯日志事件。字段：`components[]`（`{id, digest, provenance, lineage, layer}`）；`presetId`（string）；`dynamicPackagesMounted`（boolean，隔离检验用的键）；`seq`（int）。
- **`DataUseTerms`** —— 在创建时就钉在一个会话上的合同条款；export 与 curation 会读取它们。字段：`clientId`（string，卡片上会哈希化）；`agreementId`（string）；`purposes[]`（`delivery` / `training` / `evaluation`）；`residency`（string，地区）；`retentionDays`（int）；`redactionProfile`（string，带版本号）。
- **`SignoffRecord`** —— 谁签署了什么、在看到了什么的前提下：可归因的人类关口。字段：`artefactHash`（sha）；`role`（`client-product-owner` / `client-release-manager` / `client-tech-lead` / `lab-lead` / `component-owner` / `accountable-officer` / `data-steward`）；`principal`（string）；`method`（`web` / `idp` / `signed-message`）；`scope`（string，所处阶段与决策）；`evidenceRefs[]`（string，签署人看到了什么）。
- **`EnvironmentAdmission`** —— 一个 synthesized 环境在能奖励任何东西之前的确定性准入。字段：`environmentId`（`EnvironmentId`）；`preStateFails`（boolean，至少一项检查在参考实现之前失败）；`referencePasses`（boolean，参考实现下所有检查都通过）；`gamingAgentCertified`（boolean，必须为 false）；`split`（`training` / `heldOut`，按哈希桶或由人类划分）；`approver`（string）。
- **`EnvironmentStats`** —— 按环境与 policy 版本测得的难度。字段：`environmentId`（`EnvironmentId`）；`policyVersion`（string）；`n`（int）；`pass1`（0 到 1）；`pass8`（0 到 1）；`tamperRate`（0 到 1）。
- **`ModelLineage`** —— Article 53 文档据以生成的记录。字段：`modelLineageId`（string）；`baseModel`（string，附许可与上游文档）；`cumulativeFlop`（number，附估算方法）；`energyKwh`（number）；`manifests[]`（string，`DatasetManifest` 的 root）；`thresholdAlarm`（触发时所处系统性风险阈值的比例）。

### Scoreboard row

记分板行 schema（`SessionFacts`）把每个工作流的每一个会话都折叠成一行，按下列分组；标记为 S 的字段是评委打分，其余全部从会话日志或运行报告中确定性地折叠出来；没有源事件的字段不会作为字段发布。

Identity and provenance（37 个字段，全部为 D）：`session_id`、`parent_session_id`、`workflow_id`、`workflow_stage`、`run_id`、`attempt`、`environment_id`、`environment_kind`、`environment_domain`、`environment_difficulty`、`held_out`、`environment_lineage`、`department`、`preset_id`、`composition_hash`、`harness_commit`、`plugin_set_hash`、`component_ids[]`、`skills_used[]`、`mcp_servers[]`、`subagent_providers[]`、`model_provider`、`model_id`、`reasoning_effort`、`validator_model_id`、`judge_model_ids[]`、`isolation`、`sandbox_mode`、`host_os`、`runtime_version`、`started_at`、`ended_at`、`wall_ms`、`operator_id`、`client_id_hash`、`consent_flags[]`、`licence_tag`；评审委员会新增了 `harness_variant_id`、`parent_variant_id`、`mutation_operator`、`seed`、`paired_run_id`、`fixture_sha256`、`checks_sha256`、`environment_content_hash`、`group_id`、`rollout_index`、`policy_version`、`request_header_hash`、`component_versions[]`、`role`、`provider_endpoint` 与 `proposer_model_id`。

Outcome（15 个字段，全部为 D）：`reward_outcome`、`reward_basis`、`certified`、`certificate_revision`、`checks_total`、`checks_passed`、`checks_relaxed`、`attempts`、`directives`、`goal_phase`、`goal_rounds_started`、`goal_rounds_cap`、`turn_end_reason`、`error_code`、`blocked_reason_code`；评审委员会新增了 `terminal_reason`、`finish_reason_per_step[]`、`tamper_verdict`、`check_pass_vector[]`、`check_runs[]`、`workspace_tree_hash`、`check_run_hash`、`certificate_executor`、`standard_source`、`parent_certificate_ref` 与 `pass_at_k_at_sampling`。

Efficiency（18 个字段，全部为 D，评审委员会未新增）：`turns`、`steps`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、`reasoning_tokens`、`tokens_per_step_p50`、`tokens_per_step_p95`、`context_peak_tokens`、`cost_estimate_eur`、`kv_prefix_reuse_ratio`、`compaction_events`、`compaction_tokens_removed`、`model_latency_p50_ms`、`model_latency_p95_ms`、`idle_ms`、`retries_provider`。

Tool behavior（26 个字段，全部为 D，评审委员会未新增）：`tool_calls`、`tool_calls_by_name{}`、`tool_errors`、`tool_error_rate`、`tool_timeouts`、`tool_aborts`、`shell_nonzero_exits`、`fs_reads`、`fs_writes`、`files_touched`、`diff_added_lines`、`diff_removed_lines`、`tests_run`、`tests_passed`、`lint_errors`、`type_errors`、`permission_requests`、`permission_denials`、`loop_hygiene_triggers`、`duplicate_tool_calls`、`longest_tool_ms`、`subagents_spawned`、`subagent_depth_max`、`workflow_agents_started`、`ralph_rounds`、`background_jobs`。

Process quality（14 个字段，除标注外均为 D）：`spec_present`、`spec_verdict_score`（S）、`standard_authored_before_first_write`、`plan_present`、`plan_tasks`、`plan_tasks_completed`、`validator_authored_checks_ratio`、`read_barrier_violations`、`review_findings_total`、`review_findings_blocking`、`docs_updated`、`agent_note_present`、`snapshot_updated`、`coverage_delta`；评审委员会新增了 `structured_output_status`、`experiment_id`、`proposal_digest` 与 `skill_loads[]`。

Judge scores（10 个字段，全部为 S、跨模型，各自附带 confidence，评审委员会未新增）：`correctness`、`robustness`、`code_quality`、`communication`、`spec_adherence`、`verification_rigor`、`efficiency_judgment`、`safety_compliance`、`overall`、`judge_disagreement`。

Safety and oversight（6 个字段，全部为 D）：`monitor_flags`、`high_impact_tool_calls`、`sandbox_violations`、`secrets_redacted`、`policy_overrides`、`human_interventions`；评审委员会新增了 `approval_records[]`、`decision_principals[]`、`dynamic_packages_mounted` 与 `synthesized_in_play[]`。

Training and data（10 个字段，全部为 D）：`content_hash`、`dedupe_cluster_id`、`decontamination_status`、`redaction_applied`、`split`、`curriculum_difficulty`、`sample_weight`、`export_format_version`、`trainer_tokens`、`logprobs_available`；评审委员会新增了 `data_use_agreement_id`、`data_use_purposes[]`、`residency_region`、`redaction_profile_version`、`redaction_rule_hits`、`model_lineage_id`、`token_record_ref`、`provider_request_id_per_step[]`（均为 D），以及 `knowledge_scope`（S）。

这八组共列举了 136 个原始字段与 44 个评审委员会新增字段，合计 180 个；每一个 D 字段在发布之前都必须能从一个具名会话事件或运行报告中折叠出来，见上文 P2。

[`@deepseek-ai/dsh-scorekeeper`](../../../../packages/improvement/scorekeeper/README.md) 发布该记录时使用 camelCase 而非上文草拟的 snake_case，并且只携带今天已有会话事件提供的那些已列字段：身份与来源中的 `session_id`、`started_at`、`environment_id`、`environment_kind`、`held_out`、`group_id`、`rollout_index`、`environment_content_hash`、`isolation`、`district`、`model_provider` 与 `model_id`；结果中的 `reward_outcome`、`reward_basis`、`certified`、`certificate_revision`、`attempts`、`directives`、`checks_relaxed`、`goal_phase`、`goal_rounds_started` 与 `goal_rounds_cap`，另加一个已记录运行次数、最后记录的那次运行的加权通过率与最后一条 `budget/breach` 的上限；效率中的 `turns`、`steps`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、`reasoning_tokens`、`wall_ms`、`priced_steps`、`cost_eur`（即上文草拟的 `cost_estimate_eur`，由 `usage/priced` 记录求和而非估算，且当有携带 usage 的步骤未定价时不给出）与 `pricing_digests`；以及工具行为中的 `tool_calls`、`tool_calls_by_name`、`tool_errors`、`tool_timeouts` 与 `tool_aborts`——过程质量、评审打分、安全与监督、训练与数据在其生产者出现之前不发布任何内容。

## Alternatives considered

**Best-only promotion。** 早期设计每一代只保留一个合并后的 head，把落败的变体直接折叠回虚无；现在每一个已评估但未晋升的变体都会以 `alive` 或 `dominated` 的状态保留在 `dsh-archive` ledger 中，并按质量 × 新颖度 × 1/(1+子代数) 的比例、在按环境种类划分的岛屿内被抽取为下一个 parent——这是 Darwin Gödel Machine 式的存档语义，其中低分祖先已被证明是通往最终最优变体的必经踏脚石。这被否决为唯一存储方式，因为纯粹的爬山式最优保留没有踏脚石，也没有透明的 lineage 可用来审查一个伪造的结果。

**Self-selected evaluation cells。** 早期设计让同一份提案在任何 cell 运行之前自行挑选受影响的 cell 与预测的 delta，并且在结果可见之前没有任何东西把提案冻结。这被否决，因为它让一个语义阶段能够资助并塑造对自己的评估；现在 cell 由一条已记录的确定性规则、从 `SessionDiagnosis` 证据加组件 lineage 中派生，每一份提案都会在任何 cell 运行之前完成内容哈希并冻结。

**Reward computed in the implementer's workspace。** 早期设计把检查跑在实现者刚刚编辑过的同一棵树上，因此一份证书可能因为测试或 fixture 被改动、而不是因为任务被解决而通过。这被否决，因为它直接可被利用——改动测试、`conftest.py` 或某个包脚本就能拿到证书——而强化学习会在几十步之内就找到这个漏洞；现在检查运行在 `host` 隔离下的纯净 fixture 加实现者补丁之上，并带隐藏检查，在检查所属路径下的任何写入都是一份 tamper verdict、奖励为零。

**Fleet sessions as reinforcement-learning data。** 早期为模型流水线做的设计直接收割 fleet 会话用于训练，但一个 fleet 会话不携带环境身份、不携带分组、也不携带种子，因此去污染、curriculum 采样与 GRPO 分组都无从下手。这被否决，转而采用一个以环境为先、以分组为先的工厂：数据的单位是由 runner 按需产出的、同一个 policy 版本下同一个环境的一组 rollout，fleet 会话转而喂养一次简短的 SFT 冷启动与 environment factory。

**A single mutable knowledge store。** 早期设计把提炼出来的 skill、preset 与 composition 称为"带版本的插件"，却没有为它们中的任何一个规定摘要、lineage 或代际身份，于是一个被精炼过的 skill 会原地覆盖自己先前的内容——本质上是插件标签之下的单一可变存储，没有更早的代际可以回退，排行榜也无法区分不同代际。这被否决，因为 lineage、去污染与回滚都需要按代际的稳定身份；现在每个组件与 skill 都携带一个按内容寻址的 id（`id@digest`），记录在一条纯日志的 `CompositionManifest` 事件中，而 `dsh-archive` ledger 会保留每一代，包括已被淘汰的那些。

**Judges as gates。** 早期设计在若干处直接让委员会的 verdict 决定阻断性结果，且默认没有把评委的文本记录从训练中排除，于是一个自身早先 verdict 有朝一日可能被用来训练它正在评审的模型的评委，就会在自己未来的打分上产生利害关系。这被否决，因为一个对结果有利害关系的同血统评委，其误判率远高于一个无利害关系的评委；现在评委会话走一条与 worker 及 validator 血统不同的路由，每一份评委 verdict 在一个 D 门禁或一名人类做出决定之前都只是建议性的，评委的文本记录默认从每一次训练导出中被排除。

**Kept open：the artefact-lineage graph view。** 一种可选的呈现方式把节点画成持久化记录（一份 spec、一份完成标准修订、一份证书、一条 trajectory 记录、一份数据集 manifest、一次模型发布），把边画成把一个记录变成另一个记录的那些会话，agent 只是边上的标签而不是节点；这让"追踪一件产物"与"对比两次运行"成为原生能力，也让 W3 与 W4 产生的体量读起来像一张 Sankey 图。这里没有采纳它，因为它需要现有 schema 尚未都具备的产物 id（`SpecDraft`、`Plan` 与 `SessionDiagnosis` 都还没有自己稳定的身份）；一旦这些 id 存在，它仍是一个候选视图。

**Kept open：training on validator and judge role sessions。** 让模型在自身流水线所需要的角色上接受训练——撰写出与已整理参考实现相符的 standard 的 validator 会话、diagnostician 会话、无利害关系的评委会话——会让模型在这些角色上像一条以验证器为先的流水线在自己的生成器与检查器调用上训练那样得到提升。这里没有采纳它，因为评委的文本记录默认从训练中被排除，使评委永远不会对自己的 verdict 产生利害关系；validator 与 diagnostician 会话具体是否可以安全纳入，留待按组件 lineage 逐案决定，而不是由本笔记一次性固定下来。

## Acceptance criteria

### W1

- `environment/run` stamp 与一个 `verification/run` 事件为每一次执行的检查（无论通过与否）而存在，并且有一个 keyless 测试证明：一份所引用的运行缺席、standard 修订号不一致、或包含失败检查的证书会被拒绝。
- `dsh-archive` 把每一个已评估的 `HarnessVariant` 记录为 `alive`、`dominated` 或 `promoted`，从不删除一个 `dominated` 条目，且一个 parent sampler 按质量 × 新颖度 × 1/(1+子代数) 的比例从中抽取。
- 一份来自被隔离的 Harness Engineer、触碰 evaluator 所属路径（`packages/improvement/**`、`packages/verification/**`、`scripts/run-gates.ts` 或某个 snapshot fixture）的提案，会在任何 cell 运行之前被硬性拒绝，并由一个提交此类补丁的 fixture 证明。
- `@deepseek-ai/dsh-fleet`（`ctx.fleet`）把一份环境 × 模型 × 重复次数的计划，逐个 cell 在各自的全新 workspace 中通过 `ctx.environmentRuns` 运行，把无法启动的 cell 保留为 `{ cell, error }`——一行带错误码的记录，而不是缺失的一行——并折叠出一份 `LeaderboardRow`，按模型路由与环境各一行，从不跨 `isolation` 或 `heldOut` 求平均；两者都是消费方用来划分的列。它的单元测试与 Loader 启动的 e2e（`examples/headless-agent/tests/fixtures/fleet-run`）已经覆盖了这一点。
- 由该闭环产生的模型可见文本改动——一段被 mutate 的 prompt 片段、tool schema 或 skill 正文——若没有人类对重新录制的 snapshot 预期结果做 diff 评审，就无法进入晋升。

### W2

- 一个 keyless snapshot 证明读取屏障：一次实现者角色的工具读取，在触及 standard 所在根目录时会被 fs policy 拒绝，而同样的调用来自 validator 时会成功；由组合了日志读取工具的会话签发的证书会被不变式拒绝。
- `ProgramLedger` 事件把一个 program 中的每个 goal 映射到它的会话、workspace、preset、隔离级别、预算与状态，且一个 Loader 启动的示例能在重启之后从 ledger 恢复一个 program。
- 一份证书的 `treeHash` 在生成发布记录之前必须等于合并后的 head；冲突解决会重新运行检查，而不是重新批准各个 goal 的证书。
- 一条 `signoff/recorded` 事件为 spec freeze、安全或合规放宽、review 通过、release 与训练数据发布这五种迁移各自记名 principal、产物哈希与看到的证据，这五种迁移没有一种能在没有它的情况下完成。
- 项目自身的检查只有在一份 `EnvironmentAdmission` 记录显示 pre-state 失败、参考实现通过、且 gaming agent 运行无法拿到证书，外加一次已记录的人类划分分配之后，才会进入训练。

### W3

- `environment/run` stamp 对 prompt、fixture 与检查项的内容哈希，正是一项去污染检查所依据的键，并有一个 fixture 证明同一环境的两次运行哈希相同，而某项检查改变后哈希不同。
- 若一次训练运行的奖励并非来自一个 `verification/run` 事件，则该运行会被拒绝；并有一个 fixture 证明，在纯净 fixture 加补丁副本中对检查所属路径的写入会得到一份 tamper verdict、奖励为零。
- 被截断、被中止与出错的 rollout 会被屏蔽而不是被判定为失败，并由每种情形各一条 fixture trajectory 证明其在训练记录中不带任何惩罚。
- `EvalReport` 钉选它所运行的 harness 变体哈希，在未钉选变体上做的评估会被拒绝为不可比。
- 一份 `ModelLineage` 记录在 `ModelRelease` 存在之前生成 Article 53 文档以及 accountable officer 的 `SignoffRecord`。

### W4

- 一条 `CompositionManifest` 事件在会话开始时以及每次 preset、skill 或工具集变化时，把在场的每个组件都以 `id@digest` 记名，且一条不变式会拒绝摘要不在 manifest 中的 skill 结果。
- 一个 tier-1 skill 候选者必须携带证据会话，并声明 session、department 或 client 三者之一的范围，否则会被 schema 拒绝；department scoreboard 只会在配对的存在-对-缺失运行显示其 delta 在若干次运行中持续处于零或以下之后，才把该 skill 标记为已弃用。
- 一份 `ExperimentPlan` 的提案摘要会在它的任何 cell 运行之前被记录，且 cell 会追溯到 `SessionDiagnosis` 证据加一份分层样本、由一条已记录的确定性规则给出，绝不追溯到某个由 S 设定的优先级。
- Knowledge ledger 中的 `id@digest` 条目与 composition manifest 中的出现记录相互一致；一条在 manifest 中找不到对应出现记录的 ledger 条目，会被标记为从未真正在使用过。
- 持久化产物按 checkpoint 做哈希链，每日 manifest 签名后进入一次写入存储；在任何按客户端范围的擦除请求被受理之前，一把按客户端的加密粉碎密钥必须存在。

## Rollout

1. **已落地** —— `environment/run` stamp、`verification/run` 事件，以及同时追加两者的 runner：标准的每一次执行运行（无论通过与否）都连同其执行者与 workspace tree 哈希被持久记录，证书需要其修订号的一次完全通过运行，轨迹携带尝试次数，`@deepseek-ai/dsh-fleet`（`ctx.fleet`）运行各 cell 并按路由与环境折叠出排行榜。供 W1 第 2 阶段与 W3 第 2 阶段读取的 `EnvironmentStats` 折叠就是记分员在已盖章批次上的 pass@k；按策略版本键控要等 stamp 携带策略版本。
2. **Blocking** —— 作为文件系统与进程层面权威的读取屏障。一个 validator-root fs-policy 插件、单调的工具 guard、不含日志读取工具的实现者 preset，以及证书上的一条不变式；在此之前，每一份证书衡量的都只是实现者能看到的东西。
3. **Blocking** —— 可归因的决策，以及被钉选的数据用途条款。`signoff/recorded`、审批上带参数摘要的 `decidedBy`、会话创建时的 `dataUse/terms`、随包发布的脱敏规则，以及一个记录规则命中次数的 curator；没有它们，任何客户方审计员都无法核实一个关口，任何文本记录也不得成为训练数据。
4. **Major** —— 按内容寻址的身份：组件与 skill 摘要，以及 composition manifest 事件。Lineage、按版本的排行榜、动态包的隔离检验，以及 manifest 与 ledger 之间的一致性不变式，全都以 `id@digest` 为键。
5. **已落地** —— 作为会话投影的记分员（`@deepseek-ai/dsh-scorekeeper`）：与 goal 及 verification 并列的 `sessionFacts` 单元、从已持久化日志折叠并按路由、环境、隔离级别与留出划分分组的记分板、在已盖章批次上的 pass@k，以及事实的 JSONL 导出。剩下的是存档 ledger——`HarnessVariant` 记录建立在 storage 之上，带 parent、operator、evaluations 与 status——以及生产者尚不存在的那些字段分组。
6. **已落地** —— 预算策略插件（`@deepseek-ai/dsh-budget-policy`）：来自配置的 token、墙钟时间与成本上限，在 `agent/pre-step` 上从会话日志折叠，一条 `budget/breach` 事件，以及任何 round driver 都不会恢复的持久 goal 阻塞；由于步骤从未开启，模型什么也看不到。剩下的是从 fleet 计划接入按 cell 的上限。
7. **Landed** —— experiment 服务（`@deepseek-ai/dsh-experiments`）：在任何 cell 运行之前由内容摘要冻结的计划、以配对重复索引经 fleet 运行、处于 `experiment-<digest>-<arm>` stamp group 之下的两个 arm、由摘要播种的按环境与合并的 bootstrap 区间，以及被响亮拒绝的预计 token 预算。尚待完成的是阶梯式评估、由诊断证据按规则派生的 cell、preset 作为第二个 arm 维度，以及在运行期间强制而非事先预计的每 cell 上限。
8. **Major** —— 作为插件的顶层 preset 结构化输出。把结构化输出运行时接到任意 preset 的 agent context 上；Intake、Program service 与 Trajectory Analyst 因此获得带日志化拒绝路径的强制 schema。
9. **Major** —— trainer operator、model registry、model lineage、environment factory 与准入。让 W3 端到端可用，包括从 lineage 记录生成的 Article 53 文档。
10. **Minor** —— tool guard 上可拒绝的 monitor。影响等级默认拒绝，为有界的一类询问，并记录 `oversight/deny`；这让部署与密钥成为人类关口。
11. **Minor** —— 持久化编排。延后：cell 按 header 哈希 × 环境 × 重复次数保持幂等，并能从已持久化的 child 会话恢复；一个可日志化恢复的 workflow engine provider 会随 program ledger 一同到来。
12. **Minor** —— 一个由会话日志与 workflow 事件驱动的实时运行查看器。客户方的 `ui-workflow-run` 如今只渲染 run、phase 与 member 状态；在任意 seq 上呈现"模型之眼"的视图，是任何竞争对手都无法证明自己做全了的那种视图。

## Risks

- **Oracle capture。** 一个补丁作者重新录制自己的 snapshot 预期结果，会把一个确定性门禁变成一枚橡皮图章；唯一的防线是人类对录制路线做的 diff 评审，而这些工作流中没有任何地方会自动完成它。
- **Cheap reward under weak isolation。** 在 `isolation: none` 下，检查以实现者自身的权限、在实现者自己的 workspace 中运行，因此那里的一份证书不应被客户方或训练方当作有力证据；排行榜与训练导出必须按隔离级别划分，绝不能混在一起。
- **Survivorship in the fold。** 一个被跳过、被重启撕裂、或在扇出中被中断的会话，仍必须留下一行带错误码的记分板记录；悄悄丢弃它会让根据剩余各行算出的每一个证书通过率都虚高。
- **Data protection before export。** 在任何客户方文本记录进入导出之前，脱敏、consent 与驻留地事件都必须存在并被强制执行；一次抢在 curator 插件与被钉选的数据用途条款之前跑掉的导出，是一起保密与数据驻留事故，而不是一次侥幸脱险。
- **Judge and reviewer stake。** 一个自身 verdict 有朝一日可能被用来训练它正在评审的模型的评委或评审人，或者审批量大到足以引发疲劳的评审人，都会朝着橡皮图章的方向退化；评委的文本记录默认从训练中被排除，每一个人类关口都始终是一个具名、可归因的决定，而不是匿名的。
- **Harness and model co-evolution。** 在一个与某个 checkpoint 的前一代共同演化过的 harness 上评估该 checkpoint，衡量的是这一对组合本身，而不是其中任何一方单独的表现；`EvalReport` 钉选 harness 变体哈希正是为了这个原因。
- **Orchestration loss。** 长达数小时的扇出如今全部在进程内运行，没有持久化的恢复能力；若没有按 header 哈希 × 环境 × 重复次数保持幂等的 cell，一次长时间 fleet 运行或长时间 program 期间的重启会导致重复计数或悄悄丢失工作。
- **Cost。** 角色分离与阶梯式评估比一个自我评审的流水线花费更多；来自配置、而非代码常量的按 goal 与按 cell 预算，才是让这份花费保持有界且可见的手段。

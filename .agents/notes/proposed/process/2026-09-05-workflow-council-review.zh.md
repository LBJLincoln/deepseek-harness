# Agent Note：四个工作流的评审委员会评审

Status: proposed

[English](2026-09-05-workflow-council-review.md) | 中文

## Problem

一份只由作者本人撰写并自行评审的工作流设计，会断言自己的说法是站得住的："实现者永远看不到 standard""isolation ≥ process""跨模型评审"，每一句都以现在时事实的口吻写出，即便仓库中记录的是相反的情况——verification 包的 README 写明当时并不存在读取屏障，`EnvironmentRunRequest` 并不携带 model 或 seed 字段，`approval/decided` 也不携带审批人身份。一个处于时间与上下文压力之下的 LLM 会话，并不可靠地能发现自己的这类夸大之词，而[验证、改进与监督 seam 的笔记](../architecture/2026-08-29-verification-improvement-oversight-seams.md)本身就测量过其中的原因：当一份 verdict 的结果关系到评委自身利害时，同一血统的评委会把 74.4% 的文本记录判错，而当结果与它无关时这个数字是 3.3%。因此，一次单人自评既会把语义权威渗漏进设计称之为确定性的阶段，也会在未来实现者据以构建的同一份文档中，夸大今天的插件实际强制执行了什么。

[四个目标工作流](../architecture/2026-09-05-four-goal-workflows.md)在成为其他工程师据以构建的设计记录之前，需要一次独立的、基于仓库事实的检验。本笔记记录了产出这次检验的评审委员会：七个独立的评委 agent，各自透过一个视角阅读仓库，为同样的四个工作流打分，用文件级证据为差距排序，并在自己的视角发现原设计不足之处时，提出一个实质不同的设计。

## Proposal

评审委员会通过七个独立的一次性 subagent，对照当时的仓库状态评审了一份四个工作流的草案；每个 subagent 都获得一个不同的视角、该草案以及与该视角对应的阅读清单作为简报；每位评委都产出一份采用固定格式的报告，[四个目标工作流](../architecture/2026-09-05-four-goal-workflows.md)中的设计正是这些发现汇总之后的结果。

### The judges

| Judge | Name | Lens | Key files read |
|---|---|---|---|
| J1 | Factory delivery judge | 长周期软件任务、以 spec 为先、角色分离 | `dsh-verification`、`dsh-fs`、`dsh-tool-session-query`、`dsh-goal` 与 `dsh-environment-runner` 的 README；`VerificationCertificate` 与 `EnvironmentRunRequest` 类型；subagent seam 中 child-agent 的审批代码；`dsh-user-approval` 与 `dsh-agent-presets` 的 README |
| J2 | Sakana evolution judge | Darwin Gödel Machine、ShinkaEvolve、evaluator hacking | `dsh-environment-runner` 与 `dsh-trajectories` 的类型；环境注册表的留出过滤器；`dsh-components` 的 id 方案；`dsh-agent-presets` 的类型；skill 子系统页面；`tool-cordis` 的 façade 与 API 目录；`dsh-agent-default-model` 的 README；`docs/testing.md` |
| J3 | DeepSeek RL data judge | 大规模 RLVR、reward hacking、训练经济学 | `dsh-trajectories` 的类型与折叠逻辑；`dsh-environment-runner` 的类型；`dsh-verification` 的类型；压缩相关包中 region 与 tool-result-pruner 的代码；`dsh-session-telemetry` 的 README；trajectory 导出器的 README；`dsh-llm` 的 call-config |
| J4 | Hermes self-improvement judge | skill 作为插件、自主性循环、self-modification 安全 | `dsh-tool-skill` 与 `dsh-skill-filesystem` 的 README；`dsh-agent-presets` 与 `dsh-trajectories` 的 README；self-modification 的 oversight 笔记；`dsh-verification` 的 README；`tool-cordis` 的 curation 代码；`dsh-tools` 的 guard README |
| J5 | Determinism judge | 权威、可重放性、不变式 | `dsh-verification` 的服务与 README；`tool-ralph` 的 README；`dsh-environment-runner` 的类型；oversight 笔记中关于 subprocess 的约束；`dsh-llm` 的 `GenerateOptions`；`dsh-workflow` 与 `dsh-goal` 的 README；subagent 的结构化输出 driver；一个 verification 不变式 companion |
| J6 | Alignment and governance judge | 无利害关系的评审、EU AI Act、审计留痕 | `dsh-verification` 的 README 与 `dsh-command-verification`；审批事件的类型；`dsh-session-telemetry` 与 `dsh-trajectories` 的 README；`dsh-session-persistence` 的 README；E2B sandbox 包；`dsh-llm-deepseek`；`dsh-tools` 的 guard；self-modification 中对 `cordis_run` 的描述 |
| J7 | Visualization judge | 面向客户方 CTO 与工程师的可读性 | workflow engine 中仅存在于实时视图与持久化两类事件；subagent `structured_output` 调用的约定；`CertificateIsolation`；workflow README 中的预算词汇；`ui-workflow-run` 与 `ui-subagent` 的 README；`ui-trajectory` 的耗时拆分；`StandardRef`、`GoalRef` 与 `SubagentStartRequest` 类型 |

### Report format

每份评委报告都遵循同一套固定结构，使七份报告可以互相比较，也使未来的自动化评审能够针对同一份 schema 校验：一张 `Verdict` 表，为该评委评审到的每个工作流打分并各附一行理由；`Top gaps`，每一条都标注 `blocking`、`major` 或 `minor`，并落在一个具名的仓库文件、README 行或类型定义上；`Concrete improvements`，逐条编号，各自点名它新增的插件或事件，以及能够抓到回归的、可机械检验的门禁；一段 `Better solution`，为该评委视角覆盖最多的那个工作流提出一个实质不同的设计；`Answers`，回答分配给该评委的、来自草案七个收尾问题中的一部分；`Missing metadata`，该评委评审所需、但字段清单遗漏的记分板字段，各自附上类型与 D 或 S 来源；以及 `Risks`，点名该评委自己的建议——而不只是原始草案——可能出的问题。

### Scores

评审委员会为自己评审到的每个工作流打一到十分（一分不可用，十分可以直接开建）；下表是完整的 7×4 表格，每位评委一行，未经任何平均。

| Judge | W1 | W2 | W3 | W4 |
|---|---|---|---|---|
| J1 — Factory delivery judge | 5 | 4 | 6 | 5 |
| J2 — Sakana evolution judge | 5 | 6 | 5 | 4 |
| J3 — DeepSeek RL data judge | 6 | 6 | 4 | 5 |
| J4 — Hermes self-improvement judge | 7 | 6 | 6 | 4 |
| J5 — Determinism judge | 6 | 4 | 5 | 4 |
| J6 — Alignment and governance judge | 6 | 4 | 3 | 5 |
| J7 — Visualization judge | 7 | 7 | 5 | 5 |

J7 打的分数专门衡量可读性——一位客户方 CTO 或一名工程师能否看懂每个阶段在断言什么、每次交接的权威握在谁手里——而不是另外六位评委各自按自己的视角衡量的设计是否可靠；由于没有任何一行被平均进另一行，分歧本身仍然可见。

### Top gaps per judge

每位评委都按严重程度为自己的差距排序；以下是每位评委最严重的前三条：

- **J1 — Factory delivery judge。** Blocking：读取屏障被断言存在，而 verification 的 README 写明它当时并不存在，一个日志读取工具也确实能触及 standard。Blocking：goal DAG 没有持久化的支撑——一个会话一个 goal，没有 ledger，没有合并队列，也没有恢复能力。Blocking：fleet run 与 validation 阶段背后的 runner 当时并不存在，存在的只有类型定义与一个不变式 companion。
- **J2 — Sakana evolution judge。** Blocking：没有持久化的"环境到会话到种子"记录，导致任何东西都无法从日志折叠、去污染或配对。Blocking：组件身份无法承载一次 mutation，一个被打过补丁的 tool schema 会沿用它 parent 的 id，lineage 因此无法记录。Blocking：留出验证器能被 mutator 透过 self-modification 的 façade 读到。
- **J3 — DeepSeek RL data judge。** Blocking：trajectory 记录中没有环境身份，导致分组、去污染与 curriculum 都无法从导出结果做到。Blocking：奖励是 policy 自己就能算出来的，因为检查跑在实现者自己的 workspace 里。Major：截断被判定为失败，且导出的消息是压缩之后的表面文本，而不是任何一步真正见到的 prompt。
- **J4 — Hermes self-improvement judge。** Blocking：知识在日志中没有版本身份——skill 正文没有版本，一个代际只是一个 mtime 与大小戳记。Blocking：循环内部的 self-modification 能够伪造奖励，因为一个动态包能够追加伪造的验证数据。Major：在评估结果可见之前，没有任何东西把提案冻结。
- **J5 — Determinism judge。** Blocking：失败的检查运行不留任何持久化记录，导致尝试次数与不稳定性都无法重放。Blocking：环境归属没有被记入日志；运行报告只是一个内存中的值。Major：除了进程内的 subagent driver 之外，顶层结构化输出并不存在。
- **J6 — Alignment and governance judge。** Blocking：证书是 agent 自行报告的，因为没有独立于 validator agent 之外的执行器来运行检查。Blocking：没有可归因的人类——一次审批只携带一个结果与一个匿名 id，没有参数，也没有 principal。Blocking：从客户方数据通往训练的路径没有建成——没有脱敏规则，没有 consent 记录，没有驻留地钉选。
- **J7 — Visualization judge。** High：没有持久化的边负载——只有 child 的 structured-output 调用携带完整的交接内容，而 parent 自己的结果视图是一段被截断的投影。High：静态视图与实时视图被画在同一张图上，却来自两种不同的数据源。High：worker 的自我报告与证书被画得一模一样，尽管只有后者才是站得住的证据。

### Better solutions

每位评委都为自己视角覆盖最多的那个工作流，提出了一个实质不同的设计：

- **J1 —— certificate-first delivery。** 先把已签署的 spec 编译成隐藏的 standard，再做别的任何事——一份 per-goal standard 加一份 program 级别的集成 standard，validator 拥有的 fixture 放在实现者够不到的根目录之下；每个 goal 都作为一个全新的顶层会话在 host 隔离下运行，由 runner 在每次空闲时校验；让集成本身成为一个 goal，其 standard 对合并后的 head 运行，把发布绑定到那份证书的 tree hash 上；让非命令类的结果以人类确认型检查的形式进入，使评审委员会保持建议性质。
- **J2 —— an archive-first harness Darwin Gödel Machine。** 把演化的单位当作一个 patch-layer bundle，而不是一个 PR：变体是无需构建即可挂载的数据；parent 从一个保留每个已评估 child（包括失败者）的存档中采样；一道 novelty gate 在花任何评估成本之前拒绝近似重复；一条阶梯式评估廉价地花费评估预算，在做完整配对运行之前先淘汰不如 parent 的变体；晋升是从存档中导出一个搜索结果，而不是搜索本身的一步。
- **J3 —— an environment-first, group-first factory。** 用一个工厂取代"先收割 fleet 会话，再拿去训练"：数据的单位是同一个 policy 版本下同一个环境的一组 rollout，由 runner 按需产出；奖励在纯净 fixture 加补丁上、用隐藏检查计算，使 policy 无法触及自己被拿来评分的对象；被截断、被中止与出错的 rollout 被屏蔽而不是判定为失败；通过一个关联 header，把 token 与 harness 自身按会话、turn 与 step 的记录关联起来。
- **J4 —— a two-speed loop over a content-addressed ledger。** 一条快速回路：agent 在自己的 department 层内撰写并精炼 skill，接受一块确定性的保留-或-淘汰记分板检验，什么都不共享、不导出；一条缓慢回路：由冻结的实验与一名人类把一个已提名的候选者搬进 fleet；把每一个 `id@digest`——包括已淘汰的代际——都保留在一份由 composition manifest 相互印证的 ledger 中，使重放总能判断出当时哪些知识在起作用。
- **J5 —— ten mechanically checkable invariants and a build order by what they unlock。** 把主干表述为一组验证器可以直接对照日志检验的不变式——已认证蕴含已执行、standard 先于第一次改动性调用、一个环境 stamp 在首轮之前到达、留出材料从不被导出、扇出的开始与结束相互平衡、折叠结果与运行报告一致、评委的路由与 worker 不同、隔离声明带有相匹配的证据、预算叫停是持久化的、一次结构化交接恰好校验一次——再按每行代码能解锁的不变式数量，排出缺失插件的建设顺序。
- **J6 —— attributed decisions, pinned data-use terms, and a deny-capable monitor。** 把每一个人类决策都记录为一个事件，记名 principal、产物哈希与他们看到的证据；在会话创建时就把数据用途条款（合同、用途、驻留地、留存期限、脱敏规则）钉在会话上，没有它们就拒绝导出；给 tool guard 配一个 monitor，让它能对一个已配置的影响等级默认拒绝，而不只是标记；从一份已签署的 model-lineage 记录中生成 Article 53 文档，而不是手写它。
- **J7 —— an artefact-lineage graph。** 把节点画成持久化记录——一份 spec、一份完成标准修订、一份证书、一条 trajectory 记录、一份数据集 manifest、一次模型发布——把边画成把一个记录变成另一个记录的那些会话，agent 只是边上的标签而不是节点；"追踪一件产物"与"对比两次运行"由此成为原生能力，W3 与 W4 产生的体量也不再是一张静态海报，而是读起来像一张 Sankey 图。

### Revisions taken

[四个目标工作流](../architecture/2026-09-05-four-goal-workflows.md)中的设计，正是以下这些修订，每一条都归因给提出它的评委：

- **Two log-only events carry the whole design。** `environment/run`（首轮之前的 stamp）与 `verification/run`（每一次执行的运行，无论通过与否，带 argv、退出码、输出哈希、tree hash、派生出的隔离级别）把运行报告从一个内存中的值变成可重放的证据，也让去污染、分组、curriculum 与排行榜有了可以哈希的对象。（J2、J3、J5、J6）
- **The read barrier is authority, not a promise。** 一个实现者的执行器无法读取的验证者根目录、单调的工具 guard、不含日志读取工具的实现者 preset、每次检查运行之前重新覆盖的资产，以及一条拒绝由组合了日志读取工具的会话签发证书的不变式。（J1、J4、J5、J6）
- **Reward is re-verified where the policy cannot reach。** 检查跑在 host 隔离下的纯净 fixture 加补丁之上，并带隐藏检查；在检查所属路径下的写入是一份 tamper verdict、奖励为零；截断、中止与出错都会被屏蔽，绝不判定为失败。（J3、J5）
- **Nothing semantic picks its own evaluation。** 提案与缓解方案会在任何 cell 运行之前完成哈希；cell 由一条确定性规则、从诊断证据与 lineage 中派生；优先级是告警幅度、复发次数与成本的函数；一份诊断可以打开一个争议，但绝不能淘汰一个环境。（J4、J5、J6）
- **Archive, parents, novelty, and a ladder。** W1 获得了一个建立在保留失败者的存档之上的 parent sampler、静态门禁之前的一道 novelty gate、一条三段式评估阶梯，以及一位从不接触留出验证器或已打分流程的、被隔离的工程师。（J2、J4）
- **Every human gate is attributable。** `signoff/recorded` 以及审批上的 `decidedBy`，记名 principal、产物哈希与看到的证据；部署、spec freeze、安全放宽、数据发布与模型发布都是人类关口；仅涉及 policy 的种类可以仅凭实验结果晋升。（J6）
- **Consent and redaction are events, filters, and profiles。** 数据用途条款在会话创建时被钉选，导出会拒绝没有训练用途的会话，一份带版本的脱敏规则记录命中次数，评委的文本记录默认被丢弃，持久化获得了带防篡改哈希与按客户端擦除的能力。（J3、J6）
- **W3 is environment-first。** RL 的单位是同一个 policy 版本下同一个环境的一组 rollout；fleet 会话喂养一次简短的 SFT 冷启动（包括 validator 与 diagnostician 角色会话）与 environment factory；基础模型按在留出套件上测得的 pass@8 钉选。（J3、J4）
- **W4 runs at two speeds。** 一条快速档：agent 在自己的层内、带租户范围地撰写并精炼 skill，配一块确定性的保留-或-淘汰记分板；一条缓慢档：由冻结的实验与可归因的晋升，建立在一份由 composition manifest 相互印证的按内容寻址 ledger 之上。（J2、J4）
- **Structured output for root agents is a plugin。** 进程内 subagent driver 已经在用的结构化输出运行时，接到任意 preset 的 agent context 上，在 tool JSON 边界处校验，能从日志重放，两条拒绝路径都具备；没有任何未被记入日志的 provider 响应 schema。（J5）
- **The atlas says what exists。** 每个阶段都标注 `implemented`、`partial` 或 `proposed`；处于会话日志之外的阶段被相应标出；worker 的报告被画成建议性质，绝不是门禁；排行榜按隔离级别与留出划分。（J7）
- **Not taken, kept open。** artefact-lineage graph 视图，以及是否要用 validator 与评委角色会话训练模型，都被记录为留待日后决定，而不是由这次修订一次性固定；与此同时，评委的文本记录默认保持被排除。（J7、J4、J6）

## Alternatives considered

**One reviewer。** 一次单人自评，或者只找一位第二评审人，都会重现 oversight 笔记测得的那种同血统误判——74.4% 对 3.3%——并且最多只能覆盖一个视角的盲区；四个工作流横跨交付、演化式搜索、RL 数据、self-improvement、determinism、治理与可读性这些关切，没有哪一个单一视角能独自覆盖全部。这被否决，因为一个如此宽泛的设计需要每个关切各配一个视角，而不是一次泛泛的通读。

**A single-model council。** 让多位评审人用同一个模型、同一个上下文窗口，会共享它的盲区，也会共享它认同文档自身框架的任何倾向；跨模型路由正是工作流本身对自己的评委所要求的东西，因此评审这些工作流的流程也应当遵守同一条规则。这被否决，因为它会去建议一种自己却没有践行的纪律。

**Human-only review。** 一个人可以把四个工作流、四十五个 schema 与一份逾百个字段的记分板都读完，但做不到在这次评审花费的这几个小时内完成，也做不到像一个拥有仓库访问权限的 subagent 那样，为每一个论断都引用一个具体的文件与行号。这被否决为可以取代第一轮评审的方案，而不是最终定论：本次评审推翻的每一个方案，最终仍然要落到一个 PR 加一份由人批准的 Agent Note 上。

评委都是一次性 agent：每一位都只被启动一次，读完自己的简报与阅读清单，写出报告，然后结束，对其余六位评委的发现没有记忆，也不与该工作流的作者来回讨论。一个持久化的、跨模型的、无利害关系的评委委员会——一个在每一次未来修订上都以同样方式运行，而不是靠人手动召集的委员会——本身就是[验证、改进与监督 seam 的笔记](../architecture/2026-08-29-verification-improvement-oversight-seams.md)中所描述的、建立在 oversight seam 之上的一个拟议插件；这次评审是那个插件将来会自动完成的事情的一次人工彩排。

## Acceptance criteria

- 一次评审委员会的运行，为每位评委产出一份报告，且该报告在被接受之前，必须针对与固定格式（`Verdict`、`Top gaps`、`Concrete improvements`、`Better solution`、`Answers`、`Missing metadata`、`Risks`）相匹配的 JSON Schema 校验通过；未通过校验的报告会带着校验错误作为 directive 返回给该评委，与四个工作流中其他每一次 S→D 交接完全一致。
- 一条差距或一条改进中的每一处证据引用，在评审当时都能解析到一个真实的仓库路径，若给出了行号范围也能解析到该范围；无法解析的引用会拒绝该条发现，而不是悄悄保留它。
- Verdict 分数按评委、按工作流分别存储，从不预先平均；记分板 schema 中的 `judge_disagreement`，以及任何被报告出来的分数离散度，都从同一批存储下来的行计算得出。
- 任何两个评委席位之间、以及评委席位与该工作流自身的 worker 或 validator 路由之间，都不共享同一条模型路由，且存储下来的记录会记名每个席位的路由，使这条约束事后可查。
- 每一条差距、每一条改进与每一个更优方案，在存储记录中都能归因到产出它的评委 id，正如本笔记把上文每一条修订都归因给了提出它的评委。

## Rollout

- 每个评委席位成为一个 subagent，以针对其视角设定的人设启动，配一个把它限制在只读仓库访问加被评审草案范围内的 `toolFilter`，以及一份与固定报告格式相匹配的 `outputSchema`——这正是 oversight seam 提案中已经要求评委委员会使用的那种 subagent `outputSchema` 机制。
- 一个建立在 subagent seam 之上的委员会 Consumer，通过既有 workflow engine 的 `parallel` 原语，把同一份评审请求并行扇出给每一个已配置的席位，收集结构化的报告，并把它们折叠进存储下来的记分板行，而不会把分歧平均掉。
- 随着 oversight seam 的评委委员会 Consumer 落地（依据该笔记的第三个 rollout 阶段），评审委员会会在四个工作流自身的评审与晋升关口中投入使用——W1 的 auditor and council 阶段、W2 的 spec critique 与 review council、W3 的 safety and alignment 阶段，以及 W4 的 promotion 阶段。

## Risks

- **Rubber-stamping at scale。** 一旦队列大到一定规模，一个"PR 加 Agent Note"式的晋升关口就会退化为疲劳式批准，除非确定性的预过滤能把真正送到评委或人类面前的数量控制得很小；一次性、不带参数的审批，正是在实践中把一个人类关口变成一个语义关口的原因。
- **Judge stake。** 一位自身 verdict 有朝一日可能被用来训练它正在评审的模型的评委，或者一位自身能否继续被调用取决于其打分结果的评委，误判率都会远高于一位无利害关系的评委；评委的文本记录默认从训练中排除，也没有任何评委的 verdict 可以反过来喂养自己未来的续存。
- **Disagreement hidden by averaging。** 在存储之前就把七个分数折叠成一个数字，会恰好抹掉一个评审委员会存在的意义所在的那份信号；每个分数都始终能归因到打出它的评委，一个很宽的离散度本身就是一项发现，而不是需要抹平的噪声。
- **A stale reading list。** 一位评委的视角，其好坏取决于它被指向的那些文件；一次移动或重命名了某个视角本应阅读内容的仓库改动，需要在同一次改动里更新对应的阅读清单，否则下一次评审委员会的运行，评审的就是一个已经不复存在的目标。

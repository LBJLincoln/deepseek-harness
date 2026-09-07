# Agent Note: The experiment service

Status: proposed

[English](2026-09-05-experiments.md) | 中文

## Problem

`@deepseek-ai/dsh-fleet` 运行一份环境 × 模型 × 重复次数的 cell 计划，并折叠出那一次运行的排行榜；`@deepseek-ai/dsh-scorekeeper` 把同样的行从已持久化日志中折叠回来。两者都回答不了每个改进循环所依赖的那个问题：candidate 是否优于 baseline，且优得足以据此行动？

在这些行与那个答案之间，横着三件今天无人负责的事。没有任何东西会在结果可见之前冻结将要度量的内容，于是提出改动的那个阶段仍然可以挑选对自己有利的 cell——正是[四目标工作流 note](2026-09-05-four-goal-workflows.md) 作为"Self-selected evaluation cells"否决掉的那种失败。没有任何东西把 cell 配对，于是排行榜式的比较把 arm（实验分支）之间的差异与环境之间的差异混在一起，一套八个环境、两个 arm 抽到不同任务的套件报出的 delta 度量的是抽签结果。也没有任何东西陈述不确定性，于是十次里的两张证书会被读成二十个百分点的改进，而不是第二个批次就会反转的噪声。

成本是第四道缺口。四目标 note 的 rollout 第 7 项把 experiment 插件定为"花费决策唯一的落脚点"，但今天任何调用方都能发起任意宽度的 fan-out，并从账单上才知道它有多大。W1 第 9 阶段（staged evaluation）与 W4 第 6 阶段（nomination and frozen experiment）都指名了这个服务，而两者都还是 `proposed`，因为它并不存在。

## Proposal

在 `improvement/` 分组中加入 `@deepseek-ai/dsh-experiments`（`ctx.experiments`）：`run(plan)` 冻结一份计划，在计划未冻结或超出预算时拒绝它，以配对的重复索引经 `ctx.fleet` 运行两个 arm，并折叠出带判定的 `ExperimentResult`。这个包不调用模型、不渲染 prompt、不追加任何会话事件；四目标 note 在它周围指名的每个语义阶段——提名、诊断、评审——都留在外面。

**一个 arm 是一条模型路由与一个 implementer。** `EnvironmentRunRequest` 携带一个环境、一个工作区、一条模型路由、一个 implementer、一个重复索引、一个 group 与一个中止信号，没有任何字段指名 agent（智能体）preset。因此这两者是这个包唯一能表达、又不会让计划无声地指名运行器无法兑现之物的 arm 维度。具名 agent preset 会在为 `EnvironmentRunRequest` 增加 preset 字段并将其贯穿运行器的那个切片中成为第三个维度——即 W1 第 1 阶段的"model and preset overrides on `EnvironmentRunRequest`"，也就是下文 rollout 第 2 项——计划在那时、而非在此之前，为每个 arm 再增加一个可选字段。

**implementer 成为一个 arm 维度，是因为值得一跑的比较正是 harness 原生的 agent 对上一个外部 agent。** 运行器与 fleet 已经携带 `{ kind: 'route' }` 与 `{ kind: 'subagent', provider, label? }`——[external-implementer note](2026-09-06-external-implementer.md) 拥有被委派的证书证明了什么——因此让 arm 指名 implementer，对这个包只是每次 fleet 调用多转发一个字段，换来的却是这场比较得以诚实的唯一设计：两个 arm 在同一份被冻结的摘要之下，以相同的重复索引运行相同的环境 id，于是证书率 delta 度量的是两个 implementer，而不是分别做两次基准测试时各自抽到的两批任务。implementer 按角色顺序进入摘要，不指名它的 arm 以写出来的默认路由进入，因此什么都不指名的 arm 与指名 `{ kind: 'route' }` 的 arm 是同一场实验，而被委派的 arm 是另一场，且不会落进对方的 stamp group；摘要的格式版本随该字段上调，因此在它之前冻结的摘要与如今冻结的任何计划都不匹配。

**一份计划由在任何 cell 运行之前算出的内容摘要冻结。** 该摘要是对如下内容的规范化 JSON 取 SHA-256：一个格式版本、按角色顺序排列的两条 arm 路由、排序后的环境 id、重复次数，以及四个阈值：bootstrap（自助重采样）重采样次数、置信水平、最小可晋升 delta、每 cell token 上限。对 id 排序使摘要与调用方列出它们的顺序无关，而重复的 id 会被拒绝，因此排序不存在歧义。部署的总 token 预算被刻意排除在摘要之外：它约束的是一个部署愿意支付什么，而不是这场实验度量什么，因此提高它不会铸出另一场实验。在更早时刻冻结过计划的调用方——在排期前就把摘要记录在案的提名阶段——把那个摘要随计划传回，而与重算结果不相等的摘要会被拒绝，于是冻结之后被改动的计划无法再以其旧身份运行。

**这次运行的每个会话都在自己的 stamp `group` 中携带摘要与所属 arm。** 两次 fleet 调用分别传入 `experiment-<digest>-baseline` 与 `experiment-<digest>-candidate`，运行器在第一个轮次之前把它写进每个会话的 `environment/run` stamp。那个字符串是结果与其所依托会话之间唯一的持久链接：scorekeeper 的 `group` 过滤条件能从每一份已持久化日志中挑出一个 arm，轨迹导出看到的是同一个字符串，一周之后的折叠不需要产生结果的那个进程也能据此归类。经 sink 写出的结果只是便利；日志才是记录。

**Cell 按环境与重复索引配对。** 两个 arm 以相同的重复次数运行相同的环境 id，因此 baseline arm 上环境 `e` 的第 `r` 次重复与 candidate arm 上 `e` 的第 `r` 次重复配对——这正是 `EnvironmentRunStamp.repetition` 早已为之存在的配对。两次重复次数相同的 fleet 调用产生的配对，与一次带两条模型路由的调用完全相同，因此想让两个 arm 在一次调用中交错的部署得到的是同样的配对。只有当两个 arm 都产出了报告时，一次重复才成为配对；被 fleet 保留为 `{ cell, error }` 的 cell 会让它的对侧落单，而落单的 cell 按环境计数，不会被平均掉。

**统计量是配对的证书率 delta 及其百分位 bootstrap 区间。** 结果按环境陈述配对重复上的 baseline 率与 candidate 率、二者的 delta（candidate 减 baseline）、attempts 均值 delta，以及输入与输出 token 的 delta。区间对该环境的配对重复做有放回重采样；总体区间在同一趟中对每个环境各自抽取，并对所有抽出的单元取均值，因此一个环境按其配对数量加权，而 cell 全部失败的环境贡献的是无，而不是一个零。重采样次数与置信水平属于 `Config`，因为一个部署花多少算力去收窄区间是部署的选择。

**重采样器的种子取自计划摘要，因此判定可以重放。** 对 `<digest>:<environmentId>` 取 32 位 FNV-1a 哈希，为每个环境播下一个 mulberry32 生成器的种子，区间是排序后重采样 delta 的百分位对。因此同一份被冻结的计划在同样的证书之上，在任何机器、任何进程、任何顺序下都给出同一个区间——从 `Math.random` 取数的 bootstrap 会让每个判定都无法复现，也让对任何一次晋升的审计都无从谈起。

**判定是对总体区间的一条规则。** 下界超过所配置的最小可晋升 delta 时为 `promote`，上界低于零时为 `reject`，其余情况为 `inconclusive`——包括什么都没有配对上的情况，这正是四目标 note 所说的"不确定的结果会把该变体搁置；默认从不晋升"。`promote` 先判，因此把最小 delta 配成负数的部署得到的仍是晋升分支，而不是一个依赖判断顺序的判定。

**成本在第一个 cell 之前就被约束。** 预计花费是环境数 × 重复次数 × 两个 arm × 每 cell token 上限，预计值超出所配置 token 预算的计划会在任何 cell 运行之前以一个稳定的错误码被拒绝——正是 `FleetError` 已经为 fleet 无法启动的计划所建立的那种响亮拒绝。上限与预算都是没有默认值的必填配置：一个部署愿意花多少，不是这个包能代它决定的。

## Alternatives considered

**比较两个独立批次。** 让两个 arm 跑不同的环境抽样，或者跑相同环境但不匹配重复索引，就能让每个 arm 使用任何空闲的 cell。这被否决，因为环境间方差占主导：证书率在任务之间的差异远大于两个 arm 在同一任务上的差异，因此未配对的差值主要度量的是各个 arm 抽到了哪些任务。配对从构造上消除了那份方差，这也正是 `EnvironmentRunStamp` 会携带重复索引的原因。

**正态近似置信区间。** 对两个比例之差取 Wald 区间只需一行算术，也不需要重采样。这被否决，因为在寥寥几次重复之上的证书率是一个小样本二项均值，其正态近似恰恰在这些实验所处之地最差——靠近零与靠近一的地方，区间会跑出单位区间之外——而且配对差值在两个 arm 之间并不独立。对配对差值做百分位 bootstrap 不对分布作任何假设，也正是四目标 note 所指名的做法。

**接受调用方给出的摘要。** 让计划自行声明身份而不是由代码重算，可以把冻结完全交给提名阶段拥有。这被否决，理由与四目标 note 否决自选评估 cell 的理由相同：一个语义阶段能够挑选的身份不是冻结。摘要永远从计划内容重算，被声明的摘要只会拿来与之比对。

**用时钟或 `Math.random` 播种重采样器。** 无种子的 bootstrap 是教科书默认做法，也省去解释一个哈希到种子的步骤。这被否决，因为一次重跑无法复现的晋升决策无法被审计，而计划摘要已经是这场比较中唯一既被冻结、又公开、又独一无二的值——由它派生种子意味着种子不需要另一份记录。

**以 EUR 报告成本。** 四目标 note 的 `ExperimentResult` 草稿携带 `costEur`。这里否决它，因为定价存放在 `@deepseek-ai/dsh-budget-policy` 的配置中而不在任何会话事件里，因此一个 EUR 数字会成为第二个、未被记录的真相来源；结果陈述报告所携带的输入与输出 token，为路由定价的部署在自己的边界上换算。

**把比较折叠进 `dsh-fleet`。** fleet 已经在运行 cell 并折叠行，因此在那里加一个 `compare()` 动词不需要新包。这被否决，因为 fleet 的排行榜是对单次运行的折叠、它的行从不跨运行，而一场实验横跨两个 arm、冻结一个身份、拒绝一份预算，并携带对单个批次毫无意义的统计量；把二者分开也让 fleet 免于承担 bootstrap 及其确定性义务。

**在运行期间强制每 cell 上限。** 实验本可以在每个 cell 落地时度量其花费，并在越限时中止其余部分。作为这一切片的职责它被否决，因为 `@deepseek-ai/dsh-budget-policy` 已经能依据会话日志度量出的越限持久地阻断一个 goal；缺的那一块是把每 cell 上限接进每个 cell 的策略，也就是 rollout 第 3 项，而在计划启动之前拒绝一份超预算的计划才是别处做不到的事。

## Acceptance criteria

- `ctx.experiments.run(plan)` 在任何 cell 运行之前算出计划摘要，声明的摘要与重算结果不相等的计划以 `EXPERIMENT_PLAN_NOT_FROZEN` 被拒绝，且一次 fleet 调用都不会发生。
- 预计花费——环境数 × 重复次数 × 两个 arm × 每 cell token 上限——超出所配置 token 预算的计划在任何 cell 运行之前以 `EXPERIMENT_OVER_BUDGET` 被拒绝，而没有环境、重复次数非正或非整数、或环境 id 重复的计划以 `EXPERIMENT_INVALID_PLAN` 被拒绝。
- 两个 arm 都以相同的环境 id 与相同的重复次数经 `ctx.fleet` 运行，分别处于 `experiment-<digest>-baseline` 与 `experiment-<digest>-candidate` 两个 group 之下，并由一个经 Loader 启动的示例证明这些 group 抵达了每个已持久化会话的 `environment/run` stamp。
- 同一份被冻结的计划在同样的证书之上运行两次，产生逐字节相同的区间，由一份把同样的报告折叠两次的单元 spec、以及一个只由摘要与环境 id 派生的种子共同证明。
- 某个 arm 未产出报告的重复被计为落单且不进入任何统计量；`seedsPaired` 是两个 arm 都产出了报告的重复索引数，跨全部环境统计。
- 两个 arm 相同的计划在两个训练环境上给出为零的 delta、一个包含零的区间与 `inconclusive` 判定，在 `examples/headless-agent/tests/fixtures/experiment/` 下经一份真实 `cordis.yml` 无密钥地证明。
- 当计划携带 sink 时，结果经轨迹导出器的 `TrajectorySink` 写出，且该 sink 恰好被关闭一次。

## Rollout

1. 本 note、该包、经两次 fleet 调用实现的 `ctx.experiments.run(plan)`、被冻结的摘要及其 group 方案、配对 bootstrap 与判定、预算拒绝、JSONL sink、单元 spec，以及经 Loader 启动的示例。
2. **preset 作为第三个 arm 维度。** 在 `EnvironmentRunRequest` 上增加 preset 字段并贯穿运行器与 fleet cell，随后在计划上以及摘要中为每个 arm 增加一个可选 preset——即 W1 第 1 阶段的 model and preset overrides。
3. **在运行期间强制每 cell 上限。** 把计划的每 cell token 上限接进每个 cell 的 `@deepseek-ai/dsh-budget-policy` 配置，使越限的 cell 被持久阻断，而不只是被事先预计。
4. **阶梯式评估。** 把 W1 第 9 阶段的三段——训练可用套件跑一次重复、派生 cell 跑 k 次配对重复、再对每个 Pareto 前沿变体跑一次留出套件——实现为一串被冻结的计划，每一段是否继续由上一段的判定决定。
5. **存档。** 在 `dsh-archive` 中的 `HarnessVariant` 记录引用评估过它们的 `ExperimentResult` 摘要，使被支配的变体保留自己的证据。
6. **由规则派生 cell。** 由 `SessionDiagnosis` 证据加上按一条已记录的确定性规则做的分层抽样来派生 cell，取代本切片中由调用方指名的环境列表。

## Risks

**两个 arm 跑同一条路由度量的是 harness 噪声，而不是模型差异。** 两个 arm 相同的计划是一次正当的标定运行，其 delta 应当落在零上，经 Loader 启动的示例做的正是这件事；把它的 `inconclusive` 判定读成关于两个不同 arm 的证据，就是在误读一次空跑。结果始终陈述两条 arm 路由，因此这种读法是可核对的。

**百分位 bootstrap 在重复次数很少时覆盖率不足。** 每个环境只有三四次配对重复时，重采样分布很粗糙、区间偏乐观；最小可晋升 delta 是所配置的防线，运行次数很少的部署应当调高它，而不是信任一个很窄的区间。

**配对的重复索引不是配对的种子。** `environment/run` stamp 今天不携带种子，因此一个 arm 的第 `r` 次重复与另一个 arm 的第 `r` 次重复共享一个索引与一个环境，但不共享一次抽样。因此配对消除的是环境方差，而不是运行间方差；四目标 note 为该 stamp 提出的 `seed` 扩展才是补上其余部分的东西。

**摘要冻结的是计划，不是世界。** harness 的 commit、环境内容哈希、一条路由背后提供方的模型版本，以及工作区内容，全都在它之外，因此同一个摘要的两次运行只有在 harness 与注册表未变的前提下才可比。`EnvironmentRunStamp.contentSha256` 是消费方用来核对其中第二项的东西。

**两个 arm 顺序运行。** baseline 跑完之后 candidate 才开始，因此两个 arm 之间提供方一侧的漂移会全部落在 candidate 上并被读成一次效应。把两个 arm 交错进同一次 fleet 调用可以消除它，且对调用方始终可用，代价是每个 cell 的关键路径更长。

**预算是预计的，不是实测的。** 拒绝逻辑把每 cell 上限乘以 cell 数量，因此 cell 通常远低于上限就结束的部署会预留出多于实际花费的额度，而策略并未强制该上限的部署仍然可能越限。Rollout 第 3 项才是把预计变成被强制的上限的那一步。

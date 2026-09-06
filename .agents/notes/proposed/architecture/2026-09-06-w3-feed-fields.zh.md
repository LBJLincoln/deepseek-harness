# Agent Note: The W3 feed fields — sampling on the call configuration, policy version and seed on the run stamp, near-duplicate admission

Status: proposed

[English](2026-09-06-w3-feed-fields.md) | 中文

## Problem

[Daliesk Village note](2026-09-05-daliesk-village.md) 的 rollout 第 8 项点名了 Proving Ground 在喂给强化学习步骤之前需要的四样东西：stamp 上的 `policyVersion` 与 `seed`、轨迹 fold 中被掩码的终止原因、针对 held-out 套件的近重复准入，以及预算策略里的设备槽位资源。第一项和第三项卡在 harness 尚不具备的词汇上。`LlmCallConfig` 里没有任何东西能钉住采样种子，因此一组 rollout 无法陈述它是用什么采样的，同一个重复序号的两个 cell 在构造上就不可比。`EnvironmentRunStamp` 上没有任何字段点名某条路由所服务的检查点，因此 W1 阶段 2 与 W3 阶段 2、9 所读的 `EnvironmentStats` fold 无法按策略版本给测得的难度建键——这正是 [J3 在评审中点出的缺口](2026-09-05-daliesk-village.md#council-review)。而环境注册表接受生产者声明的任何 prompt，于是一个合成出来的训练环境可能复述某个 held-out 环境，悄悄污染由该划分算出的每一个数字。

## Proposal

落地第 8 项的前一半：采样词汇、两个 stamp 字段及其经由 fleet、experiments 与 shifts 的转发，以及近重复准入。轨迹 fold 中被掩码的终止原因与设备槽位预算仍然未决，本次不触及。

### Sampling on the call configuration

`LlmCallConfig` 在 `temperature` 旁边新增 `seed?: number`（安全的非负整数）与 `topP?: number`（0 到 1），因此两者都是 loop 记入 `request/header` 的 epoch 级状态，而不是每次调用可调的旋钮。`GenerateOptions` 新增同样的两个字段，`callConfigEquals` 比较它们，DeepSeek 适配器把它们序列化为 `seed` 与 `top_p`，方式与它序列化 `temperature` 完全一致。线路上没有对应字段的适配器——`@deepseek-ai/dsh-llm-pi-ai`、mock 服务器、replay 提供方——逐字段构建请求，因而会丢弃它们，这是预期行为而非缺口。

replay 重建的是一次运行**请求了什么**，而绝不是提供方拿它做了什么。提供方可以忽略种子，而且没有任何一家承诺跨模型或基础设施版本产出相同的 token；记录下来的值是请求本身，日志真正复现的是那份 transcript。每一份记录这些字段的 README 都以这样的措辞说明这一点。

`ModelSelectionRef` 新增 `sampling?: AgentSampling`，由 `installModelSelection` 已经注册的 `agent/request` 监听器施加。采样刻意留在 `ModelSelection` 之外：人挑模型挑的是路由和推理强度，而种子由组装该 Agent 的一方决定；扩宽 `ModelSelection` 会把种子推进面向用户的模型选择器以及它背后的 API 表面。

### `policyVersion` and `seed` on the stamp

`EnvironmentRunRequest` 新增可选的 `policyVersion`（自由文本；harness 从不解析它）与可选的 `seed`，`EnvironmentRunStamp` 携带两者。runner 拒绝不是安全非负整数的种子，把两个字段写进 stamp，并把 `{ seed, topP }` 钉为该会话的采样，使这个 cell 的每一次请求都以相同方式采样。`topP` 是 runner 的 `Config` 字段而非请求字段：只有在每个 cell 都以同样方式采样时套件才可比，所以它是部署选择，而种子按设计逐 cell 变化。

`FleetPlan` 与 `ExperimentPlan` 新增 `policyVersion` 和一个**基准** `seed`；每个 cell 以 `seed + repetition` 运行。因此在一份计划的每条路由和每个环境上，同一个重复序号就意味着同一个种子——这正是让配对实验设计比较同类的原因。`ShiftDistrictConfig.plan` 新增两者，把它们冻结进 `ShiftPlan`，并转发给 fleet 运行。

stamp 携带 `seed` 而不携带 `topP`，因为种子才是区分一份计划中两个 cell 的东西，而 `topP` 在整个部署中恒定，且已经可从 `request/header` 重建。

### Near-duplicate admission

`EnvironmentRegistry` 新增 `Config.nearDuplicate?: { threshold }`。设置之后，注册一个 prompt 相对任一已注册 held-out 环境达到 `threshold` 的可训练环境会被拒绝；一个相对某个已注册可训练环境达到该值的 held-out 环境同样被拒绝——污染是对称的，哪一侧后注册只是组装顺序的偶然。相似度是词 5-gram shingle 的 Jaccard 系数，prompt 先转小写、每一段非字母数字字符作为一个分隔符、由此产生的空白再折叠；不足五个词的 prompt 以它的整个词表作为一个 shingle，因此两个相同的短 prompt 仍然得 1。拒绝信息点名两个 id、相似度和阈值。不配置则保持今天的行为：生产者声明什么就注册什么。

无论是否配置阈值，`ctx.environments.nearestHeldOut(prompt)` 都返回最接近的 held-out 环境及其相似度，好让 [W3 阶段 1](2026-09-05-four-goal-workflows.md) 的 curator 在为一次运行付费之前先给提案打分。

### Deviations from the notes

**Village note 说的是"stamp 新增 `policyVersion` 与 `seed`"，只字未提 `topP`。** `topP` 之所以加进调用配置，是因为只有种子而没有核采样质量只算钉住了一半采样；但它是部署状态：它落在运行器的 `Config` 上，而不是计划或请求上，而且不上 stamp，因为 `request/header` 已经记录了它。

**种子在三处而非一处被拒绝。** 运行器拒绝它即将盖进 stamp 的种子，fleet 与实验计划拒绝它们即将拿去做算术的基准值，于是一个坏的基准值会让整份计划失败，而不是表现为每个 cell 各自失败。三者都读同一个导出的 `isSeed`，因此这三处拒绝不会彼此漂移。

**four-goal-workflows note 在这两个字段旁边还列了 `harnessVariant` 与 `reasoningEffort` 作为提议中的 stamp 扩展。** 两者在此均未决；`harnessVariant` 等待[组装清单](2026-09-05-composition-manifest.md)，而推理强度已经可从 `request/header` 重建。

**实验计划摘要冻结了 `policyVersion` 与 `seed`，这是任何 note 都没有要求的。** 两条 arm 的会话是靠摘要铸出的 group 在日志里找到的，因此两次在这两个字段上不同的比较否则会撞进同一个 group，并在 fold 中被混在一起。`EXPERIMENT_PLAN_VERSION` 与 `SHIFT_PLAN_VERSION` 都改为 `2`；发布前阶段，跨此变更不承认任何已存的摘要。

**`nearestHeldOut` 是注册表方法而非自由函数。** 它读取注册表清单，而自由函数够不到它。

## Alternatives considered

**把种子放在 `AgentOptions` 而不是调用配置上。** 已拒绝：`AgentOptions` 是没有任何会话事件携带的创建元数据，因此放在那里的种子会到达模型请求却无法从日志重建——违反"模型可见 ⟺ 已记录"规则。`LlmCallConfig` 本就以 `request/header` 记录。

**用采样标量扩宽 `ModelSelection`。** 已拒绝：它是 `agent-default-model` 与模型选择器 UI 背后那份持久化的、面向用户的路由选择，而种子不是人跟模型一起挑的东西。

**对 cell 键做哈希来导出每个 cell 的种子，而不是 `base + repetition`。** 已拒绝：哈希会让种子无法从计划中预测，运维不读 stamp 就无法复现某一个 cell；而且配对设计仍然要求哈希在两条 arm 之间一致。加法给出同样的配对，其算术任何人都能复述。

**接受近重复，改在导出时过滤。** 已拒绝：到那时运行的钱已经花了，而且一个进入注册表的被污染环境，在注册与导出之间对每一个消费者都可见。

**用 embedding 距离而非 shingle 比较 prompt。** 已拒绝：它需要在注册时发起一次模型调用，会把组装期注册变成异步且非确定的。shingle 化的 Jaccard 是确定的，除了两个 prompt 之外什么都不需要，并且能抓住该划分所暴露的复述情形。

**只拒绝可训练那一侧。** 已拒绝：held-out 套件有时是在训练环境已经存在之后才扩充的，而那个方向上的污染完全相同。

## Acceptance criteria

- 运行时钉住了种子的会话，会在 `environment/run` 上以及构建了它每一次请求的 `request/header` 中携带该种子；带基准种子的 fleet 计划在 stamp 上产出 `base + repetition` 的 cell 种子，由单元测试和 fleet e2e 中的一条断言证明。
- DeepSeek 适配器恰在请求携带这些字段时发出 `seed` 与 `top_p`；没有这些线路字段的适配器，对携带它们的请求仍能正常往返。
- 配置 `nearDuplicate` 后，相似度恰好落在阈值之下的 fixture 对可以注册，达到阈值的那一对被拒绝并给出点名两个 id 与相似度的错误；跨划分的两个方向都是如此。
- `decodeEnvironmentRun` 接受携带任一新字段的 stamp，并拒绝不是非负整数的种子。
- 不配置 `nearDuplicate`、不给 `seed`、不给 `policyVersion` 时，既有的每一份 transcript 与 stamp 都不变。

## Risks

- **种子会被读成可复现性承诺。** 没有任何提供方跨模型版本给出这种承诺，而 harness 无法察觉某个提供方忽略了该字段。文档中出现种子的每一处都写明它记录的是请求而非结果；把带种子的行呈现为可复现的排行榜，会以相反的方向重演 Village 的可信度问题。
- **阈值是一件钝器。** 词 shingle 抓得住复述、抓不住改写，因此准入是下限，而不是独立性的证明。curator 在提出提案前先读 `nearestHeldOut` 才是预期工作流；阈值只拦住显而易见的那一类。
- **冻结更多字段的计划摘要会让更少的续跑成立。** 改动策略版本的 district 会开出一个新的 shift 身份，而不是续上旧的。这是正确的——那些 cell 测的是另一回事——但在一周中途编辑策略版本的运维会看到一个全新的 shift 而不是延续。
- **rollout 第 8 项还剩一半。** 轨迹 fold 中被掩码的终止原因与设备槽位预算未被触及；在 fold 掩码它们之前，被截断、被中止和提供方报错的会话仍会被算作失败，任何强化学习步骤都不应读取这些组。

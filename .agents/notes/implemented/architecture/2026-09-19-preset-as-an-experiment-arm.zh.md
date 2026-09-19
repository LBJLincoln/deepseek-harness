# Agent Note：把 agent preset 当作实验的一条 arm

Status: implemented

[English](2026-09-19-preset-as-an-experiment-arm.md) | 中文

## Problem

一条实验 arm 指名一条模型路由与一个 implementer，此外别无他物。`EnvironmentRunRequest` 不携带 agent（智能体）preset，因此把一种 agent 组合与另一种放在一起度量的唯一办法，是在两份叠加层文件之下跑两整个 fleet——两次运行、两个小时、两个 group，而且没有冻结的配对。bench 的知识假设恰恰就是这种度量：记录 `data/proving-ground/2026-09-08-bench-h4-craft-skills-t5` 通过 `overlays/with-craft-skills.cordis.yml` 挂载了三个工艺技能，只能离线地去与同一模型在同一批 cell 上更早的四次封存运行做折叠，因为这两种组合无法成为同一份计划的两条 arm。这样拼出来的比较携带了两次运行之间的每一处差异，[实验](../../proposed/architecture/2026-09-05-experiments.md) README 把这一缺口记作了一条已知限制。

## Decision

`EnvironmentRunRequest` 增加 `preset`，一个 agent preset id。运行器在 agent 工厂的 `setup` 里经 `ctx.agentPresets.mount` 挂载它——那是名册唯一受支持的调用点，加入是在 cell agent 尚未发布时装上的，因此在那里失败的组合会把整个 cell 回滚。不指名 preset 的请求不挂载任何东西，这正是该字段存在之前的每一次运行所做的事；默认值不会被静默套用，因为一个以某 preset 为标签的 arm 之下、却运行部署自身那些行的 cell，会发布一份它从未运行过的组合的度量。

两种拒绝都发生在任何 agent 存在之前，`ctx.environmentRuns.checkPreset(preset)` 不运行任何东西也能抛出同样的两种，与 `checkImplementer` 对称：在没有名册的组合中指名 preset 为 `ENVIRONMENT_RUN_PRESET_UNAVAILABLE`，没有任何根目录提供、或发现流程报告不可用的 preset 为 `ENVIRONMENT_RUN_UNKNOWN_PRESET`。fleet 为每份计划把每个互不相同的 preset 预检一次，实验服务在冻结时预检两条 arm，因此名册无法组合的候选 arm 拒掉的是整份计划，而不是先把基线 arm 整个花光。

preset 被记录两次，因为这两份记录回答的是不同的问题。cell 会话的创建 header 以 `meta.agentPreset` 携带它，那是对这一份日志做冷读时解析到的值；`environment/run` stamp 以 `preset` 携带它，那是对整批做折叠时读取的值。preset 决定该 cell 每一次请求的工具 schema 与提示词分节，因此记录它正是「模型可见 ⟺ 已记录」规则的要求。`EnvironmentRunStamp` 保持 `version: 1`，因为一个可选字段不是结构性的格式变更，而轨迹导出逐字携带该 stamp，无需重述该字段。

fleet 计划的 `models` 条目变为 `FleetModelEntry`——一条模型路由加一个可选的 `preset`——因此同一条路由上使用两个 preset 的两个条目是两条 arm。`fleetCellKey`、fleet 排行榜行、记分员的事实与行键，以及观测台已发布的行、排序键与表格都携带该 preset；不含 preset 的 cell 键渲染结果与过去完全一致，因此为不含 preset 的计划写下的台账仍能对上它所记录的那份计划。实验的 arm 增加 `preset`，`planDigest` 按角色顺序冻结它，结果在该 arm 的路由与 implementer 旁重述它。`EXPERIMENT_PLAN_VERSION` 变为 `7`。

## Alternatives considered

- **继续用叠加层文件比较组合。** 拒绝：两次叠加层运行是两个批次，因此比较携带了各自的时段、harness 状态与注册表，配对也从未在同一个摘要下被冻结。h4 记录背后的那次离线折叠就是代价的证据。
- **把 preset 放在 fleet 计划上而不是每个模型条目上。** 拒绝：那样一份计划就是一种组合，fleet 便无法在同一个交错批次中比较两种组合，而实验服务仍然需要按 arm 提供该字段。条目正是路由已经所在之处，两者一同进入 cell。
- **请求不指名 preset 时挂载名册的默认 preset。** 拒绝：那是包边界上的隐式默认值。今天运行 cell 的每一种组合都不组合名册，静默地加入一个名册会在没有任何计划要求的情况下改变那些 cell 的模型所见内容。
- **只把 preset 记录在会话 header 上。** 拒绝：对一个批次的折叠读取的是运行 stamp 而不是 header，因此计分板无法以组合作为行的键，同一条路由上的两个 preset 会被求平均。
- **把 preset 并入 arm 的模型路由。** 拒绝：`EnvironmentRunModel` 是请求被发往的那条路由，stamp、证书与每一次路由预检都把它当作一个整体来读。组合不是路由，把它折进去会让 `provider/model` 不再标识被调用的是什么。
- **把 preset 也带进轮班计划。** 目前拒绝：轮班计划重述 implementer 但不重述尝试阶梯，因此它的 arm 词汇本就比 fleet 的窄，而且没有任何东西调度一个改变自身组合的区。加上它会为一个没有消费方的字段抬高 `SHIFT_PLAN_VERSION`。

## Consequences

同一条模型路由上的两种 agent 组合成为一场冻结的成对实验：两条 arm 交错运行，摘要覆盖两个 preset，每个 cell 的会话陈述它所运行的组合，结果指名它。bench 曾离线折叠的知识假设如今是一份计划——`with-presets` 叠加层上的 `plans/e9-preset-craft-vs-plain-t5.json`，该叠加层的名册提供一个自身不组合任何行的 `bench` preset，以及一个把同样三个工艺技能作为第二个技能根挂载的 `bench-craft` preset。

计分板的行如今也以 preset 为键，因此开始指名 preset 的部署会把过去合并的行拆开；由该字段存在之前写下的日志折叠出来的行不变，因为缺省的 preset 与过去一样参与建键。观测台表格增加一列 `Preset`，fleet 的 Markdown 排行榜增加一个 `Preset` 单元格，因此两处渲染都移动了，其预期输出也一并重录。

preset 能改变什么，受限于一份 preset 组合能表达什么。preset 无法挂载提示词注册表或工具注册表本身，因此一条 arm 的组合就是它的 `agent.cordis.yml` 在部署自身那些行之上所指名的行；而摘要冻结的是 preset id 而不是 preset 的内容，因此同一个摘要的两次运行只有在 preset 目录未变的前提下才可比——这与摘要对 harness commit 和环境内容哈希已有的限制是同一条。

## Testing

运行器的单元测试覆盖挂载、header 与 stamp、不指名 preset 的运行、经 `run()` 与经 `checkPreset` 的两种拒绝，以及根目录不提供任何 preset 的名册。fleet 的测试覆盖按条目转发、每个互不相同的 preset 预检一次、同一条路由上的两行、cell 键，以及在任何 cell 之前的拒绝。实验的测试覆盖仅在 preset 上不同的一对 arm、按角色顺序的摘要，以及在基线 arm 运行之前的拒绝。无密钥的 `experiment-presets` 快照让装配好的组合走过 Loader 与一个 headless 进程：它的文档持有冻结后的结果，并逐 cell 给出 stamp 上的 preset 以及到达该 cell 模型的是哪一段人格分节，因此被记录的组合被证明就是实际运行的组合。实验的 e2e 用一个没有任何根目录提供的 preset 驱动同一份组合，并读回一个在该拒绝上退出、且没有写下任何会话的进程。

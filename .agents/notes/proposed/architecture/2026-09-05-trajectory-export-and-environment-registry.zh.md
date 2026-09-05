# Agent Note：轨迹导出与环境注册表

Status: proposed

[English](2026-09-05-trajectory-export-and-environment-registry.md) | 中文

## Problem

没有任何代码把一个已完成的会话变成训练或评估记录。在"模型可见 ⟺ 已记录"不变量下，会话日志承载了每一个模型可见输入，[验证 seam](2026-08-29-verification-improvement-oversight-seams.md) 记录了约束 goal 完成的证书，但仓库里唯一的导出是 [`dsh-session-log-export`](../../../../packages/session-query/session-log-export/README.md) 中面向人的原始日志 ZIP 下载。仓库之外的强化学习流水线（prime-rl、slime、NeMo RL）消费带奖励的 rollout；本 harness 产出带证书的会话，两者之间没有桥。

奖励没有记录。一条 `verification/certificate` 证明某个 goal 的活动检查在声明的隔离级别下全部通过，`GoalService.complete()` 只在有覆盖证书时才准许被度量的 goal 完成，但没有任何记录以训练器或排行榜可读的形式说明"某条轨迹在某个任务上获得了某个奖励"。每个消费方都得用自己的私有折叠从原始事件重新推导消息和奖励。

带验证器的任务只以测试夹具的形式存在。无密钥快照套件是唯一带可执行检查的任务定义，而它们是测试基础设施：没有任何东西声明一个任务、它的检查、以及它是否为留出集，于是无法把 harness 或模型的改动放到固定套件上评估，也无法按任务导出拒绝采样数据。[组件注册表笔记](2026-09-01-component-registry-seam.md) 需要同一份声明来按任务给组件评分。

## Proposal

在新的 `improvement/` 组中加入改进 seam 的前两个包。两者都是 `dsh-components` 风格的组合期服务；都不执行任务。

**轨迹（`dsh-trajectories`，`ctx.trajectories`）。** `foldTrajectory(meta, events)` 是把一个会话头及其事件日志投影为 `Trajectory` 的纯确定性函数：会话身份与谱系；最后一条 `request/header` 的调用配置、系统提示与工具 schema；按序排列的模型可见消息，每条都带有来源事件的 seq；每步的 token 用量；带明确依据的奖励；以及来源信息。消息来自表面事件 `user/message`、`assistant/message` 与 `tool/result`，投影为带 `user`、`assistant`、`tool` 角色的聊天消息列表；reasoning 块保留并标记，工具调用保留 `tool/call` 中的原始参数字符串，工具结果保留调用关联。当日志中存在该 goal 的完成标准时，奖励由验证器决定：依据为 `certificate`，有覆盖证书时为 `outcome: 1`，没有时为 `outcome: 0`；当 goal 在从未编写标准的情况下完成时，为 `outcome: null`、依据为 `uncertified-completion`；当日志中没有 goal 时，为 `outcome: null`、依据为 `none`；覆盖证书、goal 快照、directive 计数与 relaxation 计数作为字段一并输出。来源信息记录来自 `agent-preset/selected` 的 agent preset、provider 与模型、证书的隔离级别，以及从工具调用（`tool:<name>`）、preset（`composition:<preset>`）与 provider（`model-provider:<provider>`）推导出的在场组件 id，沿用组件注册表的 id 方案。

`TrajectoryService.export(request)` 通过 `ctx.sessionPersistence.inspect()` 读取已持久化的会话，逐个折叠，并经调用方提供的 sink 每条轨迹写一行 JSON；`jsonlFileSink(path)` 是随包提供的文件 sink。请求可指定会话 id，默认为全部已持久化会话，并可只保留有奖励的轨迹。返回的报告统计已读会话数、已写轨迹数、有奖励轨迹数，以及被跳过的会话及其原因。该服务不写任何会话事件：导出是一次读取，向源日志写入会改变下一次导出读到的内容。

记录格式为 `dsh-trajectory/1`：每行一个 JSON 对象，其 `messages` 遵循每个训练器的聊天模板都能消费的 chat-completion 消息列表，奖励与来源信息并列其旁。token id 与 logprob 有意缺席：harness 从不看到 token id，on-policy 采集属于训练器的推理代理，正如 Agent Lightning 与 Polar 所做的那样。形式上的先例：verifiers 的 `Trace`（通过 OpenAI 方言拦截服务器驱动的带工具调用的消息图）、SWE-agent 与 SWE-smith 的轨迹文件，以及 OpenAI chat-completion 消息列表。

**环境（`dsh-environments`，`ctx.environments`）。** `EnvironmentDefinition` 声明一个带验证器的任务：带品牌的 `EnvironmentId`、来自可合并扩展的 `EnvironmentKindMap` 的 `kind`（注册表本身不提供任何 kind）、`name`、`description`、任务提示词及其夹具、以验证 seam 的 `StandardCheck` 词汇表达的可执行 `checks`、`heldOut` 标志、所属包、`provenance`（`curated` 或 `synthesized`）以及可选的 `lineage`。共用检查词汇正是要点：环境的检查就是任务运行时验证者所编写的完成标准，因此评估与生产度量的是同一件事。`register()` 返回其 disposer，并对重复 id 或没有检查的环境大声拒绝；`list()` 按 kind 与留出状态过滤；`get()` 读取一个。环境将在后续切片中通过适配器成为 `environment` 组件。

**闭环的方式。** 一个环境作为一个会话运行，其完成标准由环境的检查编写而成；一次通过的运行记录一张证书；证书构成该轨迹的奖励；导出器写出轨迹；训练器消费它；下一个 checkpoint 先在留出环境上评估，然后才替换任何东西。本切片落地两端：注册表与导出器。把环境挂载为会话的运行器是下一个切片。

## Alternatives considered

**从 harness 导出 token id 与 logprob。** provider 流式输出的是文本与块，从来不是 token id；logprob 采集属于训练器的推理代理。harness 导出它所拥有的：带证据的模型可见文本。

**在导出器内用模型评审给轨迹打分。** 奖励来自验证器；评审议会属于监督 seam，单独评分。放进导出器的评审会让每次导出都变成一次可被博弈的模型调用。

**复用 ZIP 导出。** 原始日志不是训练记录；每个训练器都得用自己的折叠重新推导消息与奖励。一份折叠、放在仓库里、针对已组装应用测试过，这才是契约。

**把 directive 与 relaxation 折进奖励。** 组规模充足时，稀疏结果奖励足以训练编码 agent（CANOPY 报告稠密塑形的收益不到两分）；过程信号作为字段导出，由训练器决定。

**用数据库存放环境。** 与组件一样，注册表是组合期事实；持久事实由会话事件与存储域承载。

**增加 `trajectory/exported` 会话事件。** 导出不得写入它所读取的日志；导出报告与 sink 自身的元数据就是记录。

## Acceptance criteria

- 对 verification-domain 夹具日志运行 `foldTrajectory`，得到 `outcome: 1`、依据 `certificate` 以及证书的检查 id；对标准没有覆盖证书的日志，得到 `outcome: 0`、依据 `certificate`；对 goal 在没有标准的情况下完成的日志，得到 `outcome: null`、依据 `uncertified-completion`；对没有 goal 的日志，依据为 `none`。
- 每条导出的消息都带有来源事件的 seq，且导出的消息内容等于用同一 seed 准备的 `Session` 所报告的派生历史。
- `ctx.trajectories.export()` 在 JSONL 持久化存储上为每个已持久化会话写一行，统计有奖励的轨迹，对无法读取的会话按 id 与原因报告而不中止其余会话，在空存储上返回零计数。
- `ctx.environments.register()` 拒绝重复 id 与没有检查的环境；释放注册后该环境被移除；`list({ heldOut: true })` 只返回留出环境。
- 一个经 Loader 引导的组合先运行 verification-domain 夹具再导出其会话，产出一行 JSONL，其奖励依据为 `certificate`。

## Rollout

1. 本笔记、`dsh-environments`、含折叠、服务、JSONL sink 与 Loader 引导导出证明的 `dsh-trajectories`。
2. 环境运行器：把环境挂载为会话、由检查编写其标准、运行 agent、记录运行；`environment` 组件适配器；`/environments` 与 `/trajectories` 命令。
3. 按环境的拒绝采样导出、供排行榜使用的按组件 id 的有奖励轨迹统计，以及面向 verifiers 兼容训练器的 taskset 导出。

## Risks

Off-policy 文本。训练器通过其聊天模板重新分词导出的文本，这适合监督训练与拒绝采样训练，不适合严格的 on-policy 强化学习；记录格式对此有明确说明，on-policy 运行经由置于同一 harness 之前的推理代理进行。

奖励博弈。证书只覆盖其标准所含的检查；由实现者编写的检查会让奖励可被博弈。轨迹携带证书的隔离级别，训练器可以只保留 `process` 或 `host` 级别的运行。

转录中的机密。工具结果可能携带凭证或私有数据；导出器不是脱敏层。遥测脱敏规则是后续过滤器的先例，sink 是部署方施加过滤的位置。

日志体积。长流式会话含有大量 `assistant/chunk` 事件；折叠读取已组装的消息并忽略块，导出逐行流式写出。

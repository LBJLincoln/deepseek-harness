# @deepseek-ai/dsh-trajectories

[English](README.md) | 中文

轨迹导出：把已持久化的会话折叠为 `dsh-trajectory/3` 记录，每条一行 JSON，包含训练器模板可消费的聊天格式消息列表、会话工作的停止方式、由证书决定的奖励、该会话所处的数据使用条款，以及运行时在场的组件。导出经会话持久化 seam 读取，不写任何会话事件。[轨迹导出 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) 承载设计理由。

## Config

```yaml
- id: persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: './.sessions'
- id: trajectories
  name: '@deepseek-ai/dsh-trajectories'
  config:
    withheldDistricts:
      - workshop
```

| 字段 | 含义 |
|---|---|
| `withheldDistricts`（默认 `[]`） | 未指定区的导出所扣留的区，计入 `withheld`。本包不附带任何区名：由部署方声明它的哪些区默认不得外流，面向客户的区正是如此。 |

该服务需要一个会话持久化后端。`resolveConfig(config)` 是导出的默认值解析步骤。

## Service contract

`ctx.trajectories.export({ sessions?, sink, rewardedOnly?, includeHeldOut?, districts? })` 通过 `ctx.sessionPersistence.inspect()` 折叠每个指定会话（`sessions` 缺省时为全部已持久化会话），并把 `JSON.stringify(trajectory) + '\n'` 写入 `sink.write()`；无法读取或折叠的会话连同原因加入 `skipped`，导出继续。

对每个可读会话依次运行三道过滤。其 `environment/run` stamp 标记为留出环境的会话会被扣留并计入 `heldOut`，除非 `includeHeldOut: true`，因此评估任务默认永远不会变成训练数据。随后由区决定：指定了 `districts` 时，只写入 stamp 携带其中之一的会话，这也是导出触及部署方原本扣留的区的方式；未指定 `districts` 时，stamp 携带 `withheldDistricts` 中某一项的会话被扣留。两种情形下被扣留的会话都计入 `withheld`。最后，`rewardedOnly: true` 扣留奖励结果不为 `1` 的轨迹并计入 `filtered`。

sink 在最后一次写入之后或失败之后恰好关闭一次。报告携带 `sessions`、`exported`、`rewarded`、`filtered`、`heldOut`、`withheld` 与 `skipped`。`jsonlFileSink(path)` 是随包提供的文件 sink；首次使用时截断文件。

`foldTrajectory(meta, events)` 是服务背后的纯投影，导出供测试与离线工具使用。相同输入下结果确定。

`foldTrajectoryReward(events)` 由日志中的 goal 与验证事件决定奖励。最后一条记录的 [`verification/run`](../../verification/verification/README.md#what-a-runs-verdict-says) 携带 `verdict: 'tampered'` 的会话，无论日志里还有什么，都以 `tamper` 依据记为 `outcome: 0`：一次发现用于度量该任务的文件已被改动的运行，说明这次度量作废——检查失败只说明工作尚未完成，把两者合并会让检查已不再描述任务的工作区拿到部分学分。其余情形下，只要存在标准就由验证者决定，未认证的完成属于未决，没有 goal 的日志则未被度量。

`foldTrajectoryStop(events)` 决定会话最后一个工作单元如何结束：由会话自身模型路由实现的会话看它的最后一个轮次，由外部实现方完成工作的会话看它的最后一条 `environment/delegation`。`turn/end` 的原因 kind 原样携带，包括插件合并进 `TurnEndReasonMap` 的 kind，因此插件越过输出 token 上限继续执行的轮次仍折叠为 `max-tokens`；委托尝试陈述 subagent seam 的 `completed`、`aborted`、`error`、`max-tokens` 或 `refusal`。当一次 [`budget/breach`](../../guard/budget-policy/README.md#what-a-breach-does) 终结了工作时，以 `budget` 取代二者：被该越限阻塞的轮次、被运行器的挂钟截止时间提前截断的尝试（`budget-deadline`），或在最后一个已结束单元之后越过会话自身上限的越限——后者正是预算在下一次尝试之前耗尽的委托 cell 的结束方式。每个后续轮次或尝试都会重新陈述原因，因此一次被其梯级份额截断的尝试之后若有一次自行结束的尝试，结果折叠为 `completed`。结束于一个未关闭轮次之内的日志为 `interrupted`，一个工作单元也没有结束的日志为 `none`。越限的 scope 或委托停止原因若是所属包从不写出的值，折叠即失败，导出把该会话报告在 `skipped` 中。

`stopReason` 之所以存在，是因为 `outcome` 无法承载它：在被度量的 goal 下被预算停止的会话仍导出 `outcome: 0`，与每一个运行到底却失败的会话并列。按 rollout 评分的消费方只有在 `stopReason` 为 `completed` 时才把 `0` 读作失败，其余情形下将其屏蔽；导出器自身不据此扣留任何内容。

`outcome` 仍以证书为依据，`parity` 是它旁边的辅助信号。一次[加权用例](../../verification/verification/README.md#parity-and-what-it-does-not-decide)运行会把其加权通过率记录在 `verification/run` 事件上，而导出记录把最后一次运行的这一数值作为自己的 `parity` 字段携带。它绝不取代 `outcome`：通过率会被这样的候选者钻空子——它只把被展示的失败过拟合掉，其余弃之不顾——因此通过了标准大部分用例权重的会话与一个用例也没通过的会话，在证书覆盖该修订之前都导出为 `outcome: 0`。训练运行可以用 `parity` 塑形奖励；任何东西都不得单独优化它。

## Record format `dsh-trajectory/3`

| 字段 | 内容 |
|---|---|
| `id`、`source` | 会话 id；创建时间、工作目录、父会话，以及日志最后选择的 agent preset |
| `terms` | 日志中最新一条 [`dataUse/terms`](../../governance/data-use/README.md) 的 `agreementId` 与 `purposes`；日志不含该事件的会话没有此字段 |
| `environment` | 运行器追加的 `environment/run` stamp：环境 id 与 kind、留出标志、提示词、夹具与检查的内容哈希、repetition、group 与 district、模型路由、声明的隔离级别；未被运行器盖章的会话没有该字段 |
| `config`、`system`、`tools` | 最后一条 `request/header` 的调用配置、渲染后的系统提示与工具 schema |
| `messages` | 压缩替换之后按模型可见顺序排列的表面消息：`user`、`assistant`（有请求时带 `toolCalls`）与 `tool`（带 `toolCallId`、`isError`）角色；每条携带来源事件的 `seq`、其 `turn` 与 `step`、逐字的内容块（含 reasoning）以及记录的来源 kind |
| `steps` | 每次模型调用一条，附适配器报告的用量 |
| `stopReason` | 会话最后一个工作单元的结束方式：`turn/end` 的原因 kind、委托尝试的 `refusal`、预算越限终结工作时的 `budget`、结束于未关闭轮次之内的日志的 `interrupted`，或 `none`；始终存在 |
| `reward` | 当证书覆盖当前标准修订时 `outcome` 为 `1`，存在标准而无证书时为 `0`，其余为 `null`；`basis` 为 `tamper`（最后记录的运行发现检查方拥有的文件已被改动）、`certificate`、`uncertified-completion`（goal 完成但从未编写标准）或 `none`（无 goal）；附 goal 快照、覆盖证书以及尝试、directive 与 relaxation 计数 |
| `parity` | 最后记录的那次运行的 `{ weightPassed, weightTotal }`；该次运行没有度量用例时不存在 |
| `provenance` | 组件注册表方案中的组件 id（`composition:<preset>`、`environment:<id>`、`model-provider:<provider>`、`tool:<name>`）、按首次使用顺序排列的工具名，以及证书的隔离级别 |

缺失的 `terms` 不接纳任何用途。按某个用途构建语料的消费方只保留 `terms.purposes` 列出该用途的记录，于是没有被钉过条款的会话会被扣留，而不是被假定允许任何事。格式标签承载这一读法：自 `dsh-trajectory/2` 起的记录陈述其会话的条款，因此缺失就是导出器在陈述日志里没有条款；而 `dsh-trajectory/1` 记录对数据使用根本不置一词，在任何用途下都被扣留。格式标签以同样方式承载停止原因：`dsh-trajectory/3` 记录总是陈述一个停止原因，而 `dsh-trajectory/1` 或 `dsh-trajectory/2` 记录对其会话如何停止不置一词，因此屏蔽被提前截断会话的消费方不能把它的 `0` 计为失败。只携带协议与用途，因为没有哪个接纳决定会读取保留期、驻留地或客户；[`dsh-curator`](../../governance/curator/README.md) 用同一个 [`termsOf`](../../governance/data-use/README.md) 折叠决定它导出什么，于是该字段与那道关卡不会彼此矛盾。

不含 token id 与 logprob：harness 从不看到 token id，on-policy 采集属于训练器的推理代理。

## Model Experience

无。导出读取已持久化日志并写文件，不向任何模型请求添加内容。

#### KV Cache effect

无；该服务既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **Off-policy 文本**——训练器通过其聊天模板重新分词导出文本，适合监督训练与拒绝采样训练；严格的 on-policy 强化学习需要置于 harness 之前的推理代理。
- **本服务不做任何脱敏**——工具结果可能携带凭证或私有数据，`export()` 按折叠结果原样写出它们。[`@deepseek-ai/dsh-curator`](../../governance/curator/README.md) 才是施加脱敏配置与会话数据使用条款的导出路径；直接调用本服务的部署方拿到的是未经脱敏的行。
- **区扣留读取 stamp**——未被运行器盖章的会话、或在其区被配置之前盖章的会话不携带区，任何已配置的扣留都够不到它；指定区的导出只写入已盖章的会话。
- **每会话一个标准**——奖励读取会话的验证折叠，其中只有一个完成标准；度量多个 goal 的会话按生效中的标准评分。
- **没有拒绝采样导出**——每行携带环境 stamp，消费方可以按环境、repetition 与 group 分组，但导出器尚不会按环境选出 N 中最优，也不产出按环境的统计。
- **最后一次尝试之后的越限读作 `budget`**——对于占用 cell 上限一部分份额的梯级，运行器会在其子运行返回后再度量一次，因此此时记录的会话自身上限越限会折叠为 `budget`，即便该子运行自行结束且已没有剩余尝试；这样的 `0` 会被屏蔽而不是计分。

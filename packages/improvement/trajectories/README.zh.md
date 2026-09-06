# @deepseek-ai/dsh-trajectories

[English](README.md) | 中文

轨迹导出：把已持久化的会话折叠为 `dsh-trajectory/1` 记录，每条一行 JSON，包含训练器模板可消费的聊天格式消息列表、由证书决定的奖励，以及运行时在场的组件。导出经会话持久化 seam 读取，不写任何会话事件。[轨迹导出 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) 承载设计理由。

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

`outcome` 仍以证书为依据，`parity` 是它旁边的辅助信号。一次[加权用例](../../verification/verification/README.md#parity-and-what-it-does-not-decide)运行会把其加权通过率记录在 `verification/run` 事件上，而导出记录把最后一次运行的这一数值作为自己的 `parity` 字段携带。它绝不取代 `outcome`：通过率会被这样的候选者钻空子——它只把被展示的失败过拟合掉，其余弃之不顾——因此通过了标准大部分用例权重的会话与一个用例也没通过的会话，在证书覆盖该修订之前都导出为 `outcome: 0`。训练运行可以用 `parity` 塑形奖励；任何东西都不得单独优化它。

## Record format `dsh-trajectory/1`

| 字段 | 内容 |
|---|---|
| `id`、`source` | 会话 id；创建时间、工作目录、父会话，以及日志最后选择的 agent preset |
| `environment` | 运行器追加的 `environment/run` stamp：环境 id 与 kind、留出标志、提示词、夹具与检查的内容哈希、repetition、group 与 district、模型路由、声明的隔离级别；未被运行器盖章的会话没有该字段 |
| `config`、`system`、`tools` | 最后一条 `request/header` 的调用配置、渲染后的系统提示与工具 schema |
| `messages` | 压缩替换之后按模型可见顺序排列的表面消息：`user`、`assistant`（有请求时带 `toolCalls`）与 `tool`（带 `toolCallId`、`isError`）角色；每条携带来源事件的 `seq`、其 `turn` 与 `step`、逐字的内容块（含 reasoning）以及记录的来源 kind |
| `steps` | 每次模型调用一条，附适配器报告的用量 |
| `reward` | 当证书覆盖当前标准修订时 `outcome` 为 `1`，存在标准而无证书时为 `0`，其余为 `null`；`basis` 为 `tamper`（最后记录的运行发现检查方拥有的文件已被改动）、`certificate`、`uncertified-completion`（goal 完成但从未编写标准）或 `none`（无 goal）；附 goal 快照、覆盖证书以及尝试、directive 与 relaxation 计数 |
| `parity` | 最后记录的那次运行的 `{ weightPassed, weightTotal }`；该次运行没有度量用例时不存在 |
| `provenance` | 组件注册表方案中的组件 id（`composition:<preset>`、`environment:<id>`、`model-provider:<provider>`、`tool:<name>`）、按首次使用顺序排列的工具名，以及证书的隔离级别 |

不含 token id 与 logprob：harness 从不看到 token id，on-policy 采集属于训练器的推理代理。

## Model Experience

无。导出读取已持久化日志并写文件，不向任何模型请求添加内容。

#### KV Cache effect

无；该服务既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **Off-policy 文本**——训练器通过其聊天模板重新分词导出文本，适合监督训练与拒绝采样训练；严格的 on-policy 强化学习需要置于 harness 之前的推理代理。
- **不做脱敏**——工具结果可能携带凭证或私有数据；sink 是部署方施加过滤的位置，遥测脱敏规则是先例。
- **区扣留读取 stamp**——未被运行器盖章的会话、或在其区被配置之前盖章的会话不携带区，任何已配置的扣留都够不到它；指定区的导出只写入已盖章的会话。
- **每会话一个标准**——奖励读取会话的验证折叠，其中只有一个完成标准；度量多个 goal 的会话按生效中的标准评分。
- **没有拒绝采样导出**——每行携带环境 stamp，消费方可以按环境、repetition 与 group 分组，但导出器尚不会按环境选出 N 中最优，也不产出按环境的统计。
- **截断计为失败**——在被度量的 goal 下因 token 上限、中止或 provider 错误而停止的会话以 `outcome` `0` 导出；轮次结束原因尚不是记录的字段，训练器无法据此屏蔽。

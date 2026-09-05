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
```

该服务不接受配置，需要一个会话持久化后端。

## Service contract

`ctx.trajectories.export({ sessions?, sink, rewardedOnly?, includeHeldOut? })` 通过 `ctx.sessionPersistence.inspect()` 折叠每个指定会话（`sessions` 缺省时为全部已持久化会话），并把 `JSON.stringify(trajectory) + '\n'` 写入 `sink.write()`；无法读取或折叠的会话连同原因加入 `skipped`，导出继续。其 `environment/run` stamp 标记为留出环境的会话会被扣留并计入 `heldOut`，除非 `includeHeldOut: true`，因此评估任务默认永远不会变成训练数据；随后 `rewardedOnly: true` 扣留奖励结果不为 `1` 的轨迹并计入 `filtered`。sink 在最后一次写入之后或失败之后恰好关闭一次。报告携带 `sessions`、`exported`、`rewarded`、`filtered`、`heldOut` 与 `skipped`。`jsonlFileSink(path)` 是随包提供的文件 sink；首次使用时截断文件。

`foldTrajectory(meta, events)` 是服务背后的纯投影，导出供测试与离线工具使用。相同输入下结果确定。

## Record format `dsh-trajectory/1`

| 字段 | 内容 |
|---|---|
| `id`、`source` | 会话 id；创建时间、工作目录、父会话，以及日志最后选择的 agent preset |
| `environment` | 运行器追加的 `environment/run` stamp：环境 id 与 kind、留出标志、提示词、夹具与检查的内容哈希、repetition 与 group、模型路由、声明的隔离级别；未被运行器盖章的会话没有该字段 |
| `config`、`system`、`tools` | 最后一条 `request/header` 的调用配置、渲染后的系统提示与工具 schema |
| `messages` | 压缩替换之后按模型可见顺序排列的表面消息：`user`、`assistant`（有请求时带 `toolCalls`）与 `tool`（带 `toolCallId`、`isError`）角色；每条携带来源事件的 `seq`、其 `turn` 与 `step`、逐字的内容块（含 reasoning）以及记录的来源 kind |
| `steps` | 每次模型调用一条，附适配器报告的用量 |
| `reward` | 当证书覆盖当前标准修订时 `outcome` 为 `1`，存在标准而无证书时为 `0`，其余为 `null`；`basis` 为 `certificate`、`uncertified-completion`（goal 完成但从未编写标准）或 `none`（无 goal）；附 goal 快照、覆盖证书以及尝试、directive 与 relaxation 计数 |
| `provenance` | 组件注册表方案中的组件 id（`composition:<preset>`、`environment:<id>`、`model-provider:<provider>`、`tool:<name>`）、按首次使用顺序排列的工具名，以及证书的隔离级别 |

不含 token id 与 logprob：harness 从不看到 token id，on-policy 采集属于训练器的推理代理。

## Model Experience

无。导出读取已持久化日志并写文件，不向任何模型请求添加内容。

#### KV Cache effect

无；该服务既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **Off-policy 文本**——训练器通过其聊天模板重新分词导出文本，适合监督训练与拒绝采样训练；严格的 on-policy 强化学习需要置于 harness 之前的推理代理。
- **不做脱敏**——工具结果可能携带凭证或私有数据；sink 是部署方施加过滤的位置，遥测脱敏规则是先例。
- **每会话一个标准**——奖励读取会话的验证折叠，其中只有一个完成标准；度量多个 goal 的会话按生效中的标准评分。
- **没有拒绝采样导出**——每行携带环境 stamp，消费方可以按环境、repetition 与 group 分组，但导出器尚不会按环境选出 N 中最优，也不产出按环境的统计。
- **截断计为失败**——在被度量的 goal 下因 token 上限、中止或 provider 错误而停止的会话以 `outcome` `0` 导出；轮次结束原因尚不是记录的字段，训练器无法据此屏蔽。

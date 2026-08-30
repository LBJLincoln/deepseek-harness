# @deepseek-ai/dsh-verification

[English](README.md) | 中文

面向 agent（智能体）会话 goal 的事件溯源可执行完成标准。验证者在实现开始前撰写标准，可以扩展它，且只能通过带证据的放宽来弱化它；证书只由完整通过的运行记录产生，完成准入所要求的正是这份证书。设计依据由 [verification seam Agent Note](../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) 承载。

## 配置

```yaml
- id: verification
  name: '@deepseek-ai/dsh-verification'
  config:
    maxChecks: 256
    maxTextChars: 16384
```

`maxChecks` 限制单个标准的活动检查数量；`maxTextChars` 限制每条被记录的结果描述、运行指令、证据、根因与细节文本的长度。两者都必须是正的安全整数。

## 服务约定

`ctx.completionStandards` 只接受注册表中该 id 对应的那个 live `Agent` 实例。`get()` 返回一份游离的 `StandardView`；变更操作使用 `StandardRef { id, revision }` 比较并交换栅栏，并拒绝过期引用。每个会话至多有一个当前标准；`author()` 为一个 goal 创建修订号为一的标准，并拒绝为同一 goal 再次创建，而针对不同 goal 的新标准会取代之前的标准。`extend()` 追加检查且从不改写既有检查；`relax()` 恰好移除一个检查，并记录非空的不可满足证据。`recordRun()` 要求每个活动检查恰好对应一条结果：完整通过的运行会按检查顺序提交一份持久证书，任何失败都只返回失败子集而不产生持久记录。`issueDirective()` 记录由消费方转达给实现者的根因聚合。`assertCertified()` 返回恰好覆盖当前修订的目标 goal 证书，否则抛出异常，因此它是编排者在调用 `ctx.goals.complete()` 之前执行的准入调用。

每次变更都会追加一条携带完整变更后状态的持久会话事件：`verification/standard`（author、extend）、`verification/relaxation`、`verification/certificate` 或 `verification/directive`。严格回放校验修订序列、仅追加的检查增长、放宽的结构、证书覆盖范围与时间戳连续性，且任何标准变更都会使先前证书失效。会话日志是唯一的持久权威；新的服务实例从日志重建其视图。

单独发布的 `./invariant` 配套文件对每个附加的会话维护一份独立折叠。它在畸形验证变更进入持久日志之前拒绝它们，并拒绝这样的 `goal/change` 完成事件：当前标准度量该 goal，却没有覆盖它的证书。

## 扩展点

策略消费方调用服务动词，并从会话日志折叠这四种事件。证书是一份可回放的记录，载明哪些检查在何种隔离级别（`none`、`process`、`host`）下凭何种证据通过，因此评估与训练数据流水线可以只凭日志为会话评分：每个 agent 获得的证书数、收到的指令数与记录的放宽数都能从事件推导，无需新增采集。消费方使用 `Agent` 接口与会话事件，而不导入 agent loop（智能体循环）。

## 模型体验

间接地，通过向实现者转达 `verification/directive` 文本并执行 goal 完成准入的策略消费方；本服务追加的每个事件都只写入日志，从不进入模型历史。

#### KV Cache 影响

不会直接使缓存失效；转达消费方拥有其消息造成的所有请求前缀变更。

## 已知限制与暂缓事项

- **建议性准入** — `assertCertified()` 只约束调用它的一方；`GoalService.complete()` 没有准入扩展点，跳过该检查的调用方仍能完成被度量的 goal。安装了不变量配套文件的部署会拒绝这样的事件流；服务内准入需要 `dsh-goal` 提供扩展点。
- **没有读取屏障** — 本包只承载持久状态；拒绝实现者读取标准产物属于另一个插件的文件系统策略工作，在它存在之前，日志的任何进程内消费方都能读到标准的 `run` 指令。
- **指令投递属于消费方** — 指令是仅日志记录；没有把它们作为插件来源用户消息转达的消费方，实现者永远看不到它们。
- **没有运行执行器** — 验证者 agent 用自己的工具执行检查并报告结果；本包只记录结论，从不派生进程。
- **信任进程内生产者** — 拥有 `Session` 直接访问权的插件可以追加伪造的验证数据。严格回放会在该记录处检测出畸形或不一致并失败；这是完整性检测，不是插件隔离。

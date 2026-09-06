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

`ctx.completionStandards` 只接受注册表中该 id 对应的那个 live `Agent` 实例。`get()` 返回一份游离的 `StandardView`；变更操作使用 `StandardRef { id, revision }` 比较并交换栅栏，并拒绝过期引用。每个会话至多有一个当前标准；`author()` 为一个 goal 创建修订号为一的标准，并拒绝为同一 goal 再次创建，而针对不同 goal 的新标准会取代之前的标准。`extend()` 追加检查且从不改写既有检查；`relax()` 恰好移除一个检查，并记录非空的不可满足证据。`recordRun()` 要求每个活动检查恰好对应一条结果，外加该次运行的 `RunEvidence`（`executor`，取 `runner` 或 `agent-reported`；该次运行所覆盖工作区目录树的可选 `treeHash`；以及只有其调用方才可能知道的可选 `tampered` 标记）：每次运行都会追加一条 `verification/run` 事件，按检查顺序携带它的全部结果、尝试序号、这份证据与该次运行的 `verdict`，只有 `passed` 裁定才会提交一份持久证书，其余每种裁定都返回失败子集。在追加任何内容之前，`recordRun()` 会以 `VERIFICATION_ISOLATION_UNPROVEN` 拒绝会话自身持久记录无法支撑的隔离声明——运行事件同样携带该声明，因此未被证明的级别根本不会进入日志。尝试序号等于同一标准 id 在其各修订上已记录运行数加一，因此仅凭日志就能回放尝试次数与不稳定性。`issueDirective()` 记录由消费方转达给实现者的根因聚合。`assertCertified()` 返回恰好覆盖当前修订的目标 goal 证书，否则抛出异常，因此它是编排者在调用 `ctx.goals.complete()` 之前执行的准入读取。当 goal 服务同时组合时，本服务还会把同一准入注册为 `ctx.goals` 上只可否决的 `completionGuard()`，使 `GoalService.complete()` 自身拒绝对被度量 goal 的未认证完成；未被度量的 goal 照常完成。

每次变更都会追加一条携带完整变更后状态的持久会话事件：`verification/standard`（author、extend）、`verification/relaxation`、`verification/run`、`verification/certificate` 或 `verification/directive`。严格回放校验修订序列、仅追加的检查增长、放宽的结构、运行覆盖范围与尝试编号、裁定与结果的一致、证书覆盖范围与时间戳连续性，且任何标准变更都会使先前证书失效。会话日志是唯一的持久权威；新的服务实例从日志重建其视图。

### 一次运行的裁定说明了什么

一次运行的 `verdict` 说明这次运行意味着什么：每条结果都通过为 `passed`，有一条未通过为 `failed`，调用方报告用于度量该任务的那些文件在它手下发生了变化时为 `tampered`——[环境运行器](../../improvement/environment-runner/README.md#tamper-on-check-owned-paths)对它们求摘要并传入 `tampered: true`。只有 `passed` 才认证，因此被篡改的运行无论结果如何都不认证任何东西，回放也会拒绝带失败结果的 `passed` 裁定与全部通过的 `failed` 裁定。省略了 `verdict` 的已记录载荷按其结果解读，因为只有篡改无法由结果推出。

单独发布的 `./invariant` 配套文件对每个附加的会话维护一份独立折叠。它在畸形验证变更进入持久日志之前拒绝它们，拒绝这样的 `goal/change` 完成事件：当前标准度量该 goal，却没有覆盖它的证书；拒绝没有同一标准修订上完整通过的 `verification/run` 在先的 `verification/certificate`；拒绝架设在裁定不是 `passed` 的运行之上的证书；拒绝 `executor` 与其所引运行不一致的证书；并施加与 `recordRun()` 在线上施加的完全相同的隔离规则——因此伪造的证书会在安装了该配套文件的任何地方回放失败。

### 一个隔离声明需要什么

`isolationProblem(events, isolation, executor)` 只依据一份会话日志作出判定，这正是让线上拒绝与回放拒绝成为同一条规则、依据同一份证据的原因。活动屏障不会增添任何东西：它关于某个会话所知的一切，都已在 [`dsh-read-barrier`](../read-barrier/README.md) 于该会话首次请求前追加的 `read-barrier/scope` 普查里。

| 级别 | 记录必须携带什么 |
|---|---|
| `none` | 无。未组合屏障的会话与此前完全一样地取得证书。 |
| `process` | 一份角色为 `implementer`、且没有任何 `unenforced` 能力的 `read-barrier/scope` 普查，以及 `runner` 执行者。 |
| `host` | `process` 所需的一切，外加一条屏障已校验的 `read-barrier/attestation`。 |

有两条规则在每个级别（含 `none`）都适用。普查中列出携带[工具权限](../../core/tools/README.md)的工具会使证书作废，因此即使运行时守卫被某种方式绕过，组合日志读取工具依然要付出证书的代价。`request/header` 组装了普查未覆盖的工具名同样使其作废，这正是抓住普查之后新增工具的手段。

## 扩展点

策略消费方调用服务动词，并从会话日志折叠这五种事件。当组合了投影注册表时，`verification` 会话投影向客户端提供同一状态：完整的当前标准及其证书，以及该会话的指令与运行计数，撰写之前为 `null`。证书是一份可回放的记录，载明哪些检查在何种隔离级别（`none`、`process`、`host`）下、由哪个执行者（`runner` 或 `agent-reported`，从其所引运行复制而来）凭何种证据通过，因此评估与训练数据流水线可以只凭日志为会话评分：每个 agent 获得的证书数、尝试的运行数、收到的指令数与记录的放宽数都能从事件推导，无需新增采集。消费方使用 `Agent` 接口与会话事件，而不导入 agent loop（智能体循环）。

## 模型体验

间接地，通过向实现者转达 `verification/directive` 文本并执行 goal 完成准入的策略消费方；本服务追加的每个事件都只写入日志，从不进入模型历史。

#### KV Cache 影响

不会直接使缓存失效；转达消费方拥有其消息造成的所有请求前缀变更。

## 已知限制与暂缓事项

- **准入依赖 goal 服务** — 当两个服务同时组合时，强制执行发生在 `GoalService.complete()` 内部注册的完成 guard 中；没有 `ctx.goals` 的组合只保留服务动词与供自身调用方使用的 `assertCertified()`，而安装了不变量配套文件的部署仍会拒绝未认证的完成事件流。
- **规则读取的是记录，而非活动运行时** — 隔离声明按会话所记录的内容核验，因此屏障虽已组合却从未追加普查的组合无法声称高于 `none`，而能够追加伪造普查的插件可以随意声称。只有 `host` 依托的是进程之外产生的证据。
- **指令投递属于消费方** — 指令是仅日志记录；没有把它们作为插件来源用户消息转达的消费方，实现者永远看不到它们。
- **没有运行执行器** — 验证者 agent 用自己的工具执行检查并报告结果；本包只记录结论，从不派生进程。`executor: 'agent-reported'` 表示实现者自己的会话为其检查作了交代，这正是它只能在 `none` 取得证书的原因。
- **信任进程内生产者** — 拥有 `Session` 直接访问权的插件可以追加伪造的验证数据。严格回放会在该记录处检测出畸形或不一致并失败；这是完整性检测，不是插件隔离。

# @deepseek-ai/dsh-verification

[English](README.md) | 中文

面向 agent（智能体）会话 goal 的事件溯源可执行完成标准。验证者在实现开始前撰写标准，可以扩展它，且只能通过带证据的放宽来弱化它；证书只由完整通过的运行记录产生，完成准入所要求的正是这份证书。设计依据由 [verification seam Agent Note](../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) 承载。

## 配置

```yaml
- id: verification
  name: '@deepseek-ai/dsh-verification'
  config:
    maxChecks: 256
    maxCases: 1024
    maxTextChars: 16384
```

`maxChecks` 限制单个标准的活动检查数量；`maxCases` 限制这些检查合计持有的用例数量；`maxTextChars` 限制每条被记录的结果描述、运行指令、证据、根因与细节文本的长度。三者都必须是正的安全整数。

## 服务约定

`ctx.completionStandards` 只接受注册表中该 id 对应的那个 live `Agent` 实例。`get()` 返回一份游离的 `StandardView`；变更操作使用 `StandardRef { id, revision }` 比较并交换栅栏，并拒绝过期引用。每个会话至多有一个当前标准；`author()` 为一个 goal 创建修订号为一的标准，并拒绝为同一 goal 再次创建，而针对不同 goal 的新标准会取代之前的标准。`extend()` 追加检查且从不改写既有检查；`relax()` 恰好移除一个检查，并记录非空的不可满足证据。两个撰写动词都接受 `AuthoredCheck`，并校验它们交入的加权用例。`recordRun()` 要求每个活动检查恰好对应一条结果，外加该次运行的 `RunEvidence`（`executor`，取 `runner` 或 `agent-reported`；该次运行所覆盖工作区目录树的可选 `treeHash`；以及只有其调用方才可能知道的可选 `tampered` 标记）：每次运行都会追加一条 `verification/run` 事件，按检查顺序携带它的全部结果、尝试序号、这份证据与该次运行的 `verdict`，只有 `passed` 裁定才会提交一份持久证书，其余每种裁定都返回失败子集。在追加任何内容之前，`recordRun()` 会以 `VERIFICATION_ISOLATION_UNPROVEN` 拒绝会话自身持久记录无法支撑的隔离声明——运行事件同样携带该声明，因此未被证明的级别根本不会进入日志。尝试序号等于同一标准 id 在其各修订上已记录运行数加一，因此仅凭日志就能回放尝试次数与不稳定性。`issueDirective()` 记录由消费方转达给实现者的根因聚合。`assertCertified()` 返回恰好覆盖当前修订的目标 goal 证书，否则抛出异常，因此它是编排者在调用 `ctx.goals.complete()` 之前执行的准入读取。当 goal 服务同时组合时，本服务还会把同一准入注册为 `ctx.goals` 上只可否决的 `completionGuard()`，使 `GoalService.complete()` 自身拒绝对被度量 goal 的未认证完成；未被度量的 goal 照常完成。

每次变更都会追加一条携带完整变更后状态的持久会话事件：`verification/standard`（author、extend）、`verification/relaxation`、`verification/run`、`verification/certificate` 或 `verification/directive`。严格回放校验修订序列、仅追加的检查增长、放宽的结构、运行覆盖范围与尝试编号、裁定与结果的一致、用例统计与其检查引用的一致、parity 与这些统计的一致、指令聚类与其所指带用例检查的一致、证书覆盖范围与时间戳连续性，且任何标准变更都会使先前证书失效。会话日志是唯一的持久权威；新的服务实例从日志重建其视图。

### 加权用例

一个检查可以携带 `cases`：`{ count, weightTotal, sha256 }`，即验证者为它撰写的用例正文的持久引用。正文从不进入日志——`author()` 与 `extend()` 在 `AuthoredCheck` 上把它们与引用一并接收，而只存储引用，因此日志保持标准本身的体量，而[验证者的预留目录](../../improvement/environment-runner/README.md#weighted-cases-and-the-reservation)持有用例的内容。验证者交出的正文通常由[仪器](../tool-standard-author/README.md)记录，它从参考程序推导这些正文并写入该预留目录。`resolveAuthoredCases()` 是两个动词在提交任何内容之前施加的导出校验；它以 `VERIFICATION_INVALID_CASE` 拒绝：有引用而无正文或有正文而无引用、与所交正文不符的引用、不是小写连字符形式或与他者重名的用例 id、不是正安全整数的权重、需要 shell 引号的 `argv` 词、不是规范化工作区相对路径的暂存文件路径、未知或重复的通道、已配置却没有期望值的通道、未知的规范化器 id，以及没有任何用例比较的 `treeScope` 或比较 `tree` 却没有 `treeScope` 的用例。`maxCases` 限制一个标准的用例，正如 `maxChecks` 限制它的检查。

一个用例列明它比较的通道——`exit`、`stdout`、`stderr` 与 `tree`（检查所声明 `treeScope` 下的工作目录树）——只有每一个通道都与其期望摘要相符时才通过。每个字节通道先按下述封闭集合中的有序列表规范化：

| 规范化器 | 作用 |
|---|---|
| `crlf` | 把每个 `\r\n` 改写为 `\n`。 |
| `trailing-whitespace` | 去掉每行末尾的空格与制表符。 |
| `blank-lines` | 去掉首尾空行，并把内部每一段连续空行折叠为一行。 |
| `iso8601-timestamps` | 把每个 ISO-8601 时间戳替换为 `<timestamp>`。 |
| `temp-paths` | 把每个临时目录前缀替换为 `<temp>`。 |
| `json-canonical` | 把有效 JSON 以排序后的键、无多余空白重新序列化，其余内容原样保留。 |

每一项都是 UTF-8 字节上的纯函数，且重复施加保持不变；`normalizeCaseBytes()` 施加一条链，`caseChannelDigest()` 对结果求摘要，`caseBodiesSha256()` 与 `checkCasesRef()` 推导检查必须携带的引用。该集合是封闭的，因为每一项都会放宽“相等”的判定。

`hashWorkspaceTree(root, normalizers?)` 是同一种比较在整棵目录树尺度上的形式：对目录下每个普通文件求 SHA-256——相对 POSIX 路径，然后是字节，按路径排序，每个字段以 NUL 结尾——这既是 `tree` 通道对单个用例作用域所求的摘要，也是一次运行的 `treeHash` 对整个工作区所陈述的内容。它位于此处而非任一调用方，是因为记录摘要的执行器与从副本重新推导它的[判官](../judge/README.md)不得在路径写法、排序或归一化上产生分歧。

### Parity，以及它不决定什么

`recordRun()` 从带用例检查的 `cases` 统计推导其状态——无论调用方报告了什么状态，只有每个用例都通过才是 `pass`——并拒绝这样的统计：`total` 或 `weightTotal` 与该检查的引用不符、`passed` 或 `weightPassed` 超过自身总量、`failed` 列表长于它所计的失败数，以及回答了一个没有引用用例的检查。带用例检查的无统计结果保留给定的状态，被篡改的尝试正是这样记录它从未执行的检查。随后 `verification/run` 事件携带在带用例结果上求和的 `parity: { weightPassed, weightTotal }`，若无任何带用例结果则省略它。

`parity` 记录候选程序达到了被度量行为的多少，且不构成任何认证：证书规则不变，因此一次持有失败用例的运行无论通过了多少权重都不认证任何东西。严格回放强制其两半——带用例结果的状态必须随其用例，而运行的 parity 必须是其各结果用例权重之和。

`issueDirective()` 在根因与细节之外接受 `clusters: [{ checkId, channels, count, weight }]`，并拒绝这样的聚类：所指检查未知或不带用例，或其 count 或 weight 超过该检查的引用。[环境运行器](../../improvement/environment-runner/README.md#the-clustered-directive)从一次运行的失败用例构建它们。

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

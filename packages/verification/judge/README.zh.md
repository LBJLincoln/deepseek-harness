# @deepseek-ai/dsh-judge

[English](README.md) | 中文

盲审判官（`ctx.judge`）：在一个不持有任何实现者上下文的会话中评审一次已记录尝试的监督消费方。对于评判结果会影响自身的判官，跨供应方路由是第一种答案，而只有一份模型许可的部署无法采用它；本包构建第二种答案——一个其血缘、工作区、组合与历史都被刻意构造的判官会话，使判官无法触及它正在评判的工作。设计依据由 [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md) 拥有，本消费方所扮演的角色由[监督 seam](../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) 拥有。

## Config

```yaml
- id: judge
  name: '@deepseek-ai/dsh-judge'
  config:
    preset: judge
    workspaceRoot: ~/.dsh/judge
    rationaleMaxChars: 2000
```

| 字段 | 含义 |
|---|---|
| `preset`（默认 `judge`） | 每个判官会话所组合的 preset。它必须是声明了 `role: judge` 的 `system` 信任级 preset；执行这一点的是 [`dsh-agent-presets`](../../preset/agent-presets/README.md) 与 [`dsh-read-barrier`](../read-barrier/README.md)，而不是本字段。 |
| `workspaceRoot`（默认 `<harness home>/judge`） | 铸造判官工作区的目录，绝对路径或以 `~` 开头；每次评审得到 `<root>/workspaces/<判官会话 id>/`，以仅所有者可访问的方式创建。展开 `~` 后仍非绝对路径的取值在加载时被拒绝。 |
| `systemPrompt`（默认见下文） | 判官的常设指令，作为判官会话推导历史的第一条消息投递。 |
| `rationaleMaxChars`（默认 `2000`） | 记录在裁决上的理由的上限；更长的回答保留其开头与结尾。 |

该服务要求 `agents`、`sessions` 与 `agentPresets`：它创建会话，在释放前刷新其日志，并从 preset 名册组合它。

## Service contract

`ctx.judge.audit(request)` 执行一次完整评审，并返回裁决以及产生该裁决的判官会话与工作区。`request` 携带被审会话 id、从 1 开始的 `attempt`、该次尝试的 `treeHash`、该次尝试留下的绝对路径 `workspace`、实现者据以工作的 `taskPrompt`、该次尝试的 `results`、它在获得证书时所获得的 `certificate`，以及可选的判官自身回合所用的 `model` 路由和用于中止的 `signal`。

顺序正是评审得以“盲”的原因，其中每一步都是下一步的前置条件。

**副本在会话存在之前就被校验。** 工作区被复制到一个全新的判官工作区，并以 [`hashWorkspaceTree`](../verification/README.md) 计算摘要；与该次尝试不符的摘要会以 `JUDGE_TREE_HASH_MISMATCH` 拒绝本次评审，且不创建任何东西。读到与该次尝试被度量时不同的目录树的判官，评判的将是从未发生过的工作。被拒绝的副本原地保留：它正是运维人员用来查明目录树如何变化的对象。

##### 摘要拒绝原文

```markdown
judge: the workspace copy for attempt <n> of session "<audited session>" hashes to "<actual>", not the recorded "<expected>"
```

**该会话不携带任何血缘。** 它通过 `ctx.agents.create` 以全新的 `SessionId` 创建，没有 `parentSessionId`，也没有恢复或分叉种子，因此其日志自其自身创建处开始，其推导历史中不包含任何并非在此处收到的内容。它的 `meta.cwd` 是判官工作区，绝不是实现者的工作区。

**它的历史恰好是三条消息。** 常设指令与任务被 inject——排入下一步而不唤醒 driver——证据随后作为唤醒消息到达，因此一个 step 按该顺序认领全部三条。被审会话的任何 `assistant/message`、`tool/result` 或 `verification/directive` 都不会到达它。

**证据只给出结论，绝不给出内容。** 每项检查一行，包含其 id、其状态，以及按用例度量时的用例计分，然后是该次尝试获得的证书或 `certificate: none`。`CheckResult` 中记录的 `evidence` 字符串持有候选者自身捕获的字节，因此被刻意省略；标准的检查指令同样被省略，判官从不会看到它们。

**两条记录都是持久的。** `judge/session { judgeSessionId, auditedSessionId, attempt, treeHash }` 在判官第一个回合之前追加到它自己的日志，`judge/verdict { auditedSessionId, attempt, verdict, rationale }` 在其回合落定之后追加；会话被释放前日志已刷新。

### 裁决词表

`upheld` 表示证据支持该次尝试所记录的结果，`overturned` 表示证据与之矛盾，`inconclusive` 表示证据无法判定。裁决从判官回答的第一行 `verdict:` 读回，该行之后的全部内容是理由。三者皆未指明的回答记为 `inconclusive`，并携带该回答本身，因为没有指明裁决的判官什么也没有判定，而它的措辞是唯一的缘由说明；完全没有文本的回答记为 `the judge answered nothing`。

改写 `systemPrompt` 的部署要保留 `verdict: <三者之一>` 这一回答行。缺少它，每次评审都会是 `inconclusive`。

### 不变量伴生插件

单独发布的 `./invariant` 伴生插件会拒绝：裁决取值超出词表的 `judge/verdict`；出现在 header 携带 `parentSession` 或非零 `seedLength` 的会话中的 `judge/verdict`；出现在日志中没有 `judge/session` 的会话中的 `judge/verdict`；以及来自推导历史开头不是评审所允许的那三条消息的 `judge/verdict`。它只读取持久事件流，因此伪造的裁决在任何安装了该伴生插件的地方重放都会失败。

## Model Experience

### 判官的常设指令

#### 模型看到什么

每个判官会话推导历史的第一条消息，逐字呈现，除非部署通过 `systemPrompt` 替换了它。判官的组合不贡献任何工具 schema，也不贡献任何自己的提示词分节；随附的 `judge` preset 的 persona 就是完整的系统提示词。

##### 默认指令原文

```markdown
You are auditing one attempt at a task. You did not run it, and the session that did is closed to you: the next two messages are the whole record you have.

The first is the task the implementer was given. The second is the evidence: which checks the attempt was measured by, whether each passed, and whether a certificate was issued. You are not shown the check instructions, the commands that ran, or anything either side wrote.

Answer with this line first, then your reason on the lines after it:

verdict: upheld

Use `upheld` when the evidence supports the outcome the attempt recorded, `overturned` when it contradicts it, and `inconclusive` when the evidence cannot decide. Decide on what you were given; there is nothing further to ask for.
```

#### Token 影响

每次评审固定：指令、环境作者撰写的任务提示词，以及一条按检查数每项增加一行的证据消息。跨评审不保留任何内容——每次评审都是它自己的会话——因此代价是每次被评判的尝试一段简短前缀，而不是不断增长的对话记录。

#### KV Cache 影响

每次评审各自独立。每个判官会话都是全新的请求前缀，因此判官读到的任何内容都无法使被审会话的前缀失效或被其复用；对同一任务的两次评审共享指令与任务文本，但不共享会话。

### 证据消息

#### 模型看到什么

尝试编号；每项检查一行 `<序号>. <检查 id>: pass|fail`，按用例度量的检查在其后追加 `(cases <n> of <total> passed, weight <w> of <total>)`；以及一行证书信息——`certificate: none`，或 `certificate: issued at "<isolation>" isolation over checks run by <an automated validator|the implementer's own report>, covering <n> check(s)`。整条消息包裹在 `<audited_attempt attempt="<n>">` … `</audited_attempt>` 之中。

#### Token 影响

每项检查一行，加上两行框架与一行证书信息。检查 id 与用例计分都很短且受标准约束；候选者捕获的输出不受任何约束，因此绝不进入该消息。

#### KV Cache 影响

在该次评审的单个回合内是仅追加的，跨评审各自独立，缘由同上。

## Known Limitations and Deferred Work

- **宿主平面的工具会到达判官** —— preset 不组合任何工具，但把面向模型的工具注册进全局层的部署会把它们暴露给每个会话，包括判官。读取屏障仍然拒绝判官持有任何声明了权限的工具以及屏障拥有的每个目录；`bash` 这类普通工具两者皆不是。盲审判官属于那种面向模型的行都位于 agent 平面的部署，随附的 CLI 组装正是如此。
- **向每个会话注入上下文会破坏评审** —— 在 `agent/session-start` 或 `agent/pre-step` 上注入面向模型上下文的插件会加入第四条消息，此时不变量伴生插件会拒绝该裁决，而不是接受一个读到超出评审允许范围内容的判官。该拒绝正是预期结果；部署应把这类插件的作用域排除在 judge preset 之外。
- **裁决只是一个模型的回答** —— 没有任何机制拿它去与第二位判官、评分细则或被审运行核对。它是给复核者的证据，而不是准入判定：没有证书、goal 完成或奖励依赖于它。
- **被拒绝的副本留在磁盘上** —— `JUDGE_TREE_HASH_MISMATCH` 会保留被复制的工作区以供运维人员比对，此后没有任何机制回收它。判官根目录仅所有者可访问，每次被拒评审一份副本就是全部代价。
- **每次调用一次评审，不支持批量** —— 评审一次运行的多个尝试意味着每次各自一个会话、一次工作区复制与一次模型请求；复制是整棵目录树的 `cp`，同一目录树的多次评审之间不共享。

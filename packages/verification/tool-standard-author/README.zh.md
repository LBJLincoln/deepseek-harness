# @deepseek-ai/dsh-tool-standard-author

[English](README.md) | 中文

校验仪器：一个面向模型的 `standard_author` 工具，校验方用它在任务的任何实现出现之前，从参考程序推导出由带权重用例组成的完成标准。参考程序位于校验方的 read-barrier 预留目录下，实现者对该目录的任何读取都被拒绝；仪器运行它，把它产生的结果记为某个用例的期望值，并把已记录的用例冻结为衡量实现者的标准。设计依据由 [validation-instrument Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-validation-instrument.md) 拥有。

## Config

```yaml
- id: tool-standard-author
  name: '@deepseek-ai/dsh-tool-standard-author'
  config:
    referenceTimeoutMs: 30000
```

| 字段 | 含义 |
|---|---|
| `referenceTimeoutMs`（默认：执行器自身的超时） | 每次参考程序执行的超时毫秒数，受 shell 执行器上限约束。超时的参考程序不会记录任何用例，因此该上限表述了一次行为采样允许花费多长时间。 |

该插件需要 `tools`、`shell`、`readBarrier`、`goals` 与 `completionStandards`，并在组合了 `systemPrompt` 时贡献自己的指引段落。缺少 read barrier 或完成标准服务的组合不会激活该行：仪器既无处采样，也无处写入标准。

## 工具对会话的要求

**一个预留目录。** 仪器通过 `ctx.readBarrier.reservation(agent)` 读取会话已持有的运行目录，从不自行创建：创建预留正是让未标注角色的会话成为实现者的动作，因此一个为了查询而创建预留的读取方会降级它正在读取的那个会话。创建预留并把环境的 `task.reference` 树复制到其下的是 `EnvironmentRunner.stageReference`。

**一个参考程序。** `<reservation>/reference/run` 是每次 `record_case` 所 source 的入口，与预留检查的 `run` 文件相对应。两个名称都是固定的：它们是环境作者与仪器之间约定的惯例，而非部署选择。

**一个目标。** `freeze` 为会话当前的目标编写标准，或扩展已经衡量该目标的标准。

**`standard-author` 权限。** 工具通过 `ToolAuthorityMap` 声明它，因此 [`dsh-read-barrier`](../read-barrier/README.md) 对每个 `implementer` 与 `judge` 会话拒绝它：组合审计会拒绝这些角色的 preset 组合它，而按 Agent 的守卫会拒绝之后才到达的注册。可以持有它的组合是随产品发布的 `validator` preset。

## 三个动词

`record_case` 在预留目录下一个被清空的临时目录中运行参考程序两次，带上用例的 `argv`、`stdin` 与暂存的 `files`，并对用例所比较的通道取摘要——使用的正是环境运行器衡量候选程序时的同一套捕获，因此无论由哪一侧执行，一个用例的含义都相同。两次运行必须一致：期望结果会在两次运行之间改变的用例无法衡量任何东西，因此被拒绝而不被记录。参考程序无法给出取值的通道——被信号终止的退出、被执行器截断的流——出于同一理由被拒绝。

`weigh` 重新表述某个已记录用例的权重。`freeze` 把每个检查的用例体写入 `<reservation>/checks/<check id>/cases.jsonl`，随后通过 `ctx.completionStandards` 连同用例体一起编写或扩展标准，用例数量、权重以及把两者绑定的摘要都在那里被校验。省略 `run` 的检查以 `. ./run` 衡量：recreation 任务要求的正是参考程序在同一入口处的行为。用例总量受完成标准自身的 `maxCases` 约束，`freeze` 原样报告它的拒绝。

在冻结之前，记录的任何内容都不作数；被冻结的检查会离开工作集，因此再次冻结它会被拒绝，而不会产生重复。

## UI 呈现

待处理调用渲染为 `generic` 卡片，标题点名动词与用例：`Sample the reference for case "<case>"`（配 `execute` 图标）、`Weigh case "<case>"` 或 `Freeze the completion standard`。`presentCall` 是参数的纯函数，因此重放渲染出的内容与当时调用渲染出的完全一致。它不携带 `locations`：工具触及的每条路径都位于 barrier 根目录下，在卡片中点名其中任何一条都会把预留目录的布局公开给正在观看的人。

## 模型体验

### 系统提示词

#### 模型看到的内容

模型收到一个固定的指引段落，其中点名该工具以及教授采样方法的 skill。

##### 标准编写指引

```markdown
You author the standard this task is measured by, before any implementation exists. Sample the reference program with standard_author: cover the behaviour the task statement promises, weight each case by how much a user would miss it, and freeze the cases into the standard when the sample is complete. Load the standard-sampling skill for how to choose the sample.
```

#### Token 影响

插件挂载期间，每次请求都存在一个固定的简短段落。

#### KV 缓存影响

在插件与指引文本不变期间保持前缀稳定。

### 工具 schema

#### 模型看到的内容

模型看到生成的 [`standard_author` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-standard-author)：一个覆盖 `record_case`、`weigh` 与 `freeze` 的 `action` 判别字段，用例身份与权重，用例喂给程序的输入（`argv`、`stdin` 以及以 `{ path, content }` 条目表示的 `files`），比较所用的 `channels` 与 `normalizers`，树比较所摘要的 `treeScope`，以及一次冻结所点名的 `checks`。schema 中不出现任何预留路径、摘要或会话身份。

#### Token 影响

工具可见期间，每次请求发送一个固定 schema。

#### KV 缓存影响

在工具可见性与定义不变期间保持前缀稳定。

### 工具结果

#### 模型看到的内容

每次调用返回一个对象，其 `summary` 被渲染为唯一的文本块。成功时说明记录、加权或冻结了什么，以及标准目前成立到什么程度；拒绝时说明参考程序做了什么、以及为何没有记录任何内容。两者都不点名预留目录、摘要或实现者。

##### 记录用例结果原文

```markdown
Recorded case "<case>" of check "<check>" at weight <n>, comparing <channels>. The reference produced the same result on both runs. Check "<check>" now holds <n> case(s).
```

##### 重新加权结果原文

```markdown
Case "<case>" of check "<check>" now carries weight <n>.
```

##### 冻结结果原文

```markdown
Froze <n> check(s) carrying <n> case(s) of total weight <n>. The standard measuring this task is now revision <n>; the implementer is measured by it and never sees it.
```

##### 非确定性拒绝原文

```markdown
the reference did not produce the same <channels> twice for case "<case>"; a case whose expected result changes between runs cannot measure a candidate, so it was not recorded
```

##### 不可用通道拒绝原文

```markdown
the reference produced no usable <channels> for case "<case>"; a channel without an expected result cannot measure a candidate, so it was not recorded
```

#### Token 影响

每次调用一个简短文本块；不返回参考程序输出、摘要或用例体。

#### KV 缓存影响

结果追加到历史中，不改变提示词前缀。

## Known Limitations and Deferred Work

- 仪器写入的是调用会话自身的标准，因此环境运行器还不能在实现者回合之前驱动一个校验方回合。recreation 环境推导出的检查由驱动这两个会话的一方交给注册表；套件准入是该 [note](../../../.agents/notes/proposed/architecture/2026-09-06-validation-instrument.md) 的下一个切片。
- 随产品发布的 Web 与 CLI 组合既不含 `completionStandards` 也不含 `readBarrier`，因此它们发布的 `validator` preset 在那里不会激活。运行校验方的部署需要组合这两个宿主行。

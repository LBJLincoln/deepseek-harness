# @deepseek-ai/dsh-read-barrier

[English](README.md) | 中文

读取屏障（`ctx.readBarrier`）：实现者会话不得执行的读取由它决定，其角色与 [`dsh-sandbox-policy`](../../sandbox/sandbox-policy/README.md) 之于沙箱模式和工作区根目录相同。它拥有一棵验证者所有的目录树，为每次运行铸造验证者用于放置其检查所执行内容的目录，收集其他插件登记的目录，为每个会话解析出一份策略，通过文件系统 seam 判定包含关系，记录每个会话组合了什么，并校验 `host` 隔离声明所需的宿主证明。它自身不拒绝任何读取：每个开放路径的能力都在开放路径的那次操作中执行该决定，[`@deepseek-ai/dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md) 对 `ctx.fs` 做的正是这件事。设计依据由 [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md) 拥有。

## Config

```yaml
- id: read-barrier
  name: '@deepseek-ai/dsh-read-barrier'
  config:
    root: ~/.dsh/verification
    denyRoots:
      - /srv/evaluation/fixtures
    hostAttestation: /srv/attestation/run.json
```

| 字段 | 含义 |
|---|---|
| `root`（默认 `<harness home>/verification`） | 屏障拥有的目录，绝对路径或以 `~` 开头。加载时按 `0700` 创建；已存在且所有者以外可读的目录会在此被拒绝，展开 `~` 后仍非绝对路径的取值同样被拒绝。 |
| `denyRoots`（默认 `[]`） | 与 `root` 一同被拒绝的其他目录，绝对路径或以 `~` 开头，用于没有插件通过 `protect()` 登记的目录。 |
| `hostAttestation`（默认无） | 由外部账户写入的文件，绝对路径或以 `~` 开头。若没有屏障校验通过的文件，任何证书都不得声称 `host` 隔离。 |

某个角色的被拒集合刻意不是配置字段，某个角色可以持有哪些权限同样不是：两者都是安全不变量，而非部署选择。该服务要求 `fs`，因为包含关系通过该 seam 判定，而不是靠解析路径字符串。

## Service contract

`ctx.readBarrier.reserve(agent)` 以仅所有者可访问的方式铸造 `<root>/runs/<sessionId>/`，把该会话记录为 `implementer`，并返回绝对路径；再次为同一会话预留将返回同一目录。它是同步的，因此调用方返回的那一刻角色即已生效。验证者在其中写入其检查所执行的内容——标准快照、每项检查一个脚本、以及任何留出夹具——因此实现者在进程列表中能观察到的命令行指向的是一个它无法读取内容的文件。agent 被释放时预留随之丢弃。

`ctx.readBarrier.protect(path)` 在登记存续期间再拒绝一个目录并返回其 disposer，因此拥有某个目录的插件把它作为 effect 贡献出来，而不是由部署在配置中重复一遍。同一路径的两次登记同时成立；最后一次被释放时该目录才离开被拒集合。

`ctx.readBarrier.enforce(capability)` 记录某个开放路径的能力——`fs`、`shell`、`subprocess`、`terminal`、`subagent` 或 `workflow`——在开放路径的那次操作中拒绝屏障的目录，在登记存续期间有效，并返回其 disposer。被组合却没有登记的能力在普查中记为 `unenforced`，只要还存在这样一条记录，高于 `none` 的隔离声明就会被拒绝。

`ctx.readBarrier.declareComposition(agent, { presetId, role })` 记录 preset 名册为某个 agent 组合了什么。声明的角色高于预留，因为只有组合本身知道实际挂载了什么；未作声明的 preset 把判定交回预留。[`dsh-agent-presets`](../../preset/agent-presets/README.md) 是唯一的调用方：会话自身运行的任何东西都不能抬高自己的角色。

`ctx.readBarrier.resolve({ session })` 给出一份 `ReadBarrierPolicy { role, root, denied }`。preset 声明了角色的会话持有该角色；否则持有预留的会话是 `implementer`，其他所有会话以及所有无 agent 的调用都是 `unrestricted`。`denied` 先列出根目录，再列出配置的附加项，最后是各次登记，且不重复。

`ctx.readBarrier.denies(policy, target)` 对已解析的 `FsTarget` 判定包含关系。角色 `validator` 和 `unrestricted` 不被拒绝任何内容。对 `implementer`，每个被拒目录都在 `ctx.fs.contains` 判定之前立即经 `ctx.fs.resolve` 规范化，因此目标解析之后被替换的祖先符号链接会被抓住；后端无法解析的目录使包含关系无法判定，该读取被拒绝。

`ctx.readBarrier.recordDenial(session, policy, capability, target)` 追加仅记录日志的 `read-barrier/denied` 事件——`{ version, role, capability, displayPath, root }`，其中 `capability` 指出拒绝的那个 seam——并返回它所追加的载荷。写入由屏障拥有，因此每个拒绝的 seam 都产生同样的证据；该路径本就存在于日志中模型自己的 `tool/call` 参数里，所以这条记录只增加证据，不带来新的泄露。

`deniedAuthority(role, authority)` 给出某个角色不得持有的第一项权限。[`ToolDefinition`](../../core/tools/README.md) 声明的每一项权限对 `implementer` 都被拒绝，对其他任何角色都不拒绝，因此日后并入 `ToolAuthorityMap` 的权限由这条同样的规则拒绝，而不是靠一份会过期的名单。`authorityDenialMessage(tool, authority)` 拥有守卫返回的那段文案。

### 组合普查

在会话的第一条 `request/header` 之前，屏障追加一条仅记录日志的 `read-barrier/scope`，携带 `{ version, role, presetId?, root, denied, census, enforcement }`。`census` 为该会话注册表视图解析出的每个工具各一条 `{ name, authority }`，使组合的权限成为持久事实而不仅存在于组合时刻；`enforcement` 为每个开放路径的能力各一条，取值 `denied-at-executor`、`unenforced` 或 `not-composed`，能力顺序固定。当配置了 `hostAttestation` 且校验通过——是一个由另一个操作系统账户拥有、且本账户不可写入的常规文件——屏障在其旁追加一条仅记录日志的 `read-barrier/attestation`，携带 `{ version, path, owner, sha256 }`。文件缺失或无法校验时不记录任何内容并给出一条警告；被拒绝的是它本可支撑的那个声明，而不是整次运行。

屏障还在 `agent/created` 时于每个 agent 自己的 context 上登记一个 `ctx.tools.guard()`，拒绝任何其定义携带了该会话角色所禁权限的执行。守卫在所有 `tools/pre-execute` 监听器之后运行且是单调的，因此后续监听器无法把拒绝翻转回允许。`mountPreset` 审计覆盖 preset 的组合；守卫覆盖此后注册进 agent 自身层的工具。

单独发布的 `./invariant` 伴随插件会拒绝：为 `implementer` 以外任何角色记录的拒绝、载荷版本或 capability 未知的拒绝，以及所指屏障根目录与该会话先前记录不一致的记录。它还会拒绝：版本未知的普查、角色未知的普查、为不开放路径的能力记录执行或记录词汇之外判定的普查、一个会话中的第二份普查，以及版本未知或没有文件路径的证明。

## Model Experience

### 被拒读取

#### What the model sees

本包不渲染任何内容。它的决定只以执行能力从模型调用的那次操作返回的拒绝形式抵达模型：对 `ctx.fs` 读取而言即 [`dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md)，确切文案由它拥有。没有任何提示词段落、工具 schema 或工具描述提及屏障，从不读取被拒路径的会话无从得知它已被组合。

#### Token effect

零直接 token。被拒读取把模型本会收到的工具结果替换为执行能力那条简短错误，因此一次拒绝比它所拒绝的那次读取花费更少 token。

#### KV Cache effect

仅追加，且前缀稳定：屏障不向系统提示词或工具 schema 添加任何内容，它自己的事件仅记录日志，因此既有的可复用请求前缀在每次拒绝后都保持有效。

### 被拒工具调用

#### What the model sees

实现者会话调用其定义声明了权限的工具时，得到的是工具注册表通常的 `Error: ` 包装加上下面这段文案，且不附任何补救指示，因为同一调用重试都不会成功。`authority` 本身从不对模型可见：`schemas()` 只放行 name、description 和 parameters，因此该工具在被调用之前一直列在表中、看起来可以调用。

##### Authority denial

```markdown
"<tool>" carries the "<authority>" authority and is not callable in an implementer session
```

#### Token effect

每次尝试以一条简短错误取代工具结果。重试同一工具的模型会再次花费这条错误；它一直看到的 schema 不会因此缩短。

#### KV Cache effect

前缀稳定。守卫不改变任何 schema 和提示词段落，因此这次拒绝就是一条普通的追加工具结果。

## Known Limitations and Deferred Work

- **`ctx.fs` 之外无人执行** —— `shell`、`subprocess`、`terminal` 以及进程外 subagent 与 workflow 执行器所开放的路径不受本服务约束，因此组合了 bash 工具的部署仍可读取屏障根目录。这些能力不登记 `enforce()`，因此持有其中之一的组合记为 `unenforced`，根本无法声称 `process` 隔离；失败的是那个声明，而不是屏障。
- **普查是一张快照** —— 它列出会话起始时持有的工具。此后注册的工具由运行时守卫覆盖，并由把每条 `request/header` 与普查交叉核对的证书规则覆盖，而不是由普查本身覆盖。
- **证明确认的是所有者，不是某次运行** —— 屏障校验的是另一个操作系统账户拥有一个不可写文件，并记录其摘要；它尚未把该摘要与 `environment/run` 印记携带的环境内容哈希作比对。
- **实现者自身进程内的受信代码** —— 拥有 `Session` 或 `ctx.fs` 直接访问权的插件可以追加伪造的拒绝并读取任意路径。屏障约束的是被组合的执行器，而非进程。
- **仅所有者模式挡住的是其他账户，而非模型** —— `0700` 根目录防的是另一个操作系统用户；harness 进程与其工具以同一用户运行，因此拒绝模型的是屏障，而不是该模式。

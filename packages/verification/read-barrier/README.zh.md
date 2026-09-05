# @deepseek-ai/dsh-read-barrier

[English](README.md) | 中文

读取屏障（`ctx.readBarrier`）：实现者会话不得执行的读取由它决定，其角色与 [`dsh-sandbox-policy`](../../sandbox/sandbox-policy/README.md) 之于沙箱模式和工作区根目录相同。它拥有一棵验证者所有的目录树，为每次运行铸造验证者用于放置其检查所执行内容的目录，收集其他插件登记的目录，为每个会话解析出一份策略，并通过文件系统 seam 判定包含关系。它自身不拒绝任何读取：每个开放路径的能力都在开放路径的那次操作中执行该决定，[`@deepseek-ai/dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md) 对 `ctx.fs` 做的正是这件事。设计依据由 [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md) 拥有。

## Config

```yaml
- id: read-barrier
  name: '@deepseek-ai/dsh-read-barrier'
  config:
    root: ~/.dsh/verification
    denyRoots:
      - /srv/evaluation/fixtures
```

| 字段 | 含义 |
|---|---|
| `root`（默认 `<harness home>/verification`） | 屏障拥有的目录，绝对路径或以 `~` 开头。加载时按 `0700` 创建；已存在且所有者以外可读的目录会在此被拒绝，展开 `~` 后仍非绝对路径的取值同样被拒绝。 |
| `denyRoots`（默认 `[]`） | 与 `root` 一同被拒绝的其他目录，绝对路径或以 `~` 开头，用于没有插件通过 `protect()` 登记的目录。 |

某个角色的被拒集合刻意不是配置字段：`implementer` 可以读取哪些目录是安全不变量，而非部署选择。该服务要求 `fs`，因为包含关系通过该 seam 判定，而不是靠解析路径字符串。

## Service contract

`ctx.readBarrier.reserve(agent)` 以仅所有者可访问的方式铸造 `<root>/runs/<sessionId>/`，把该会话记录为 `implementer`，并返回绝对路径；再次为同一会话预留将返回同一目录。它是同步的，因此调用方返回的那一刻角色即已生效。验证者在其中写入其检查所执行的内容——标准快照、每项检查一个脚本、以及任何留出夹具——因此实现者在进程列表中能观察到的命令行指向的是一个它无法读取内容的文件。agent 被释放时预留随之丢弃。

`ctx.readBarrier.protect(path)` 在登记存续期间再拒绝一个目录并返回其 disposer，因此拥有某个目录的插件把它作为 effect 贡献出来，而不是由部署在配置中重复一遍。同一路径的两次登记同时成立；最后一次被释放时该目录才离开被拒集合。

`ctx.readBarrier.resolve({ session })` 给出一份 `ReadBarrierPolicy { role, root, denied }`。持有预留的会话是 `implementer`；其他所有会话以及所有无 agent 的调用都是 `unrestricted`。`denied` 先列出根目录，再列出配置的附加项，最后是各次登记，且不重复。

`ctx.readBarrier.denies(policy, target)` 对已解析的 `FsTarget` 判定包含关系。角色 `validator` 和 `unrestricted` 不被拒绝任何内容。对 `implementer`，每个被拒目录都在 `ctx.fs.contains` 判定之前立即经 `ctx.fs.resolve` 规范化，因此目标解析之后被替换的祖先符号链接会被抓住；后端无法解析的目录使包含关系无法判定，该读取被拒绝。

`ctx.readBarrier.recordDenial(session, policy, capability, target)` 追加仅记录日志的 `read-barrier/denied` 事件——`{ version, role, capability, displayPath, root }`，其中 `capability` 指出拒绝的那个 seam——并返回它所追加的载荷。写入由屏障拥有，因此每个拒绝的 seam 都产生同样的证据；该路径本就存在于日志中模型自己的 `tool/call` 参数里，所以这条记录只增加证据，不带来新的泄露。

单独发布的 `./invariant` 伴随插件会拒绝：为 `implementer` 以外任何角色记录的拒绝、载荷版本或 capability 未知的拒绝，以及所指屏障根目录与该会话先前拒绝不一致的拒绝。

## Model Experience

### 被拒读取

#### What the model sees

本包不渲染任何内容。它的决定只以执行能力从模型调用的那次操作返回的拒绝形式抵达模型：对 `ctx.fs` 读取而言即 [`dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md)，确切文案由它拥有。没有任何提示词段落、工具 schema 或工具描述提及屏障，从不读取被拒路径的会话无从得知它已被组合。

#### Token effect

零直接 token。被拒读取把模型本会收到的工具结果替换为执行能力那条简短错误，因此一次拒绝比它所拒绝的那次读取花费更少 token。

#### KV Cache effect

仅追加，且前缀稳定：屏障不向系统提示词或工具 schema 添加任何内容，它自己的事件仅记录日志，因此既有的可复用请求前缀在每次拒绝后都保持有效。

## Known Limitations and Deferred Work

- **角色只来自预留** —— 会话之所以是 `implementer`，是因为验证者预留了它的运行目录；preset 尚不能为自己声明 `implementer` 或 `validator`，因此在拒绝判定处 `validator` 与 `unrestricted` 无法区分（两者都不被拒绝任何内容）。
- **`ctx.fs` 之外无人执行** —— `shell`、`subprocess`、`terminal` 以及进程外 subagent 与 workflow 执行器所开放的路径不受本服务约束，因此组合了 bash 工具的部署仍可读取屏障根目录。`ReadBarrierCapability` 词汇列出了这些 seam，如今只有 `fs` 作出判定。
- **没有隔离声明读取该策略** —— `dsh-verification` 仍记录调用方传入的隔离级别，也没有任何证书前置条件查询屏障或它记录的拒绝。
- **实现者自身进程内的受信代码** —— 拥有 `Session` 或 `ctx.fs` 直接访问权的插件可以追加伪造的拒绝并读取任意路径。屏障约束的是被组合的执行器，而非进程。
- **仅所有者模式挡住的是其他账户，而非模型** —— `0700` 根目录防的是另一个操作系统用户；harness 进程与其工具以同一用户运行，因此拒绝模型的是屏障，而不是该模式。

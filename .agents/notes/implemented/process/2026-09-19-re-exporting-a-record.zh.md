# Agent Note: Re-exporting a recorded run

Status: implemented

[English](2026-09-19-re-exporting-a-record.md) | 中文

## Problem

[`data/proving-ground/`](../../../../data/proving-ground/README.md) 下的一份记录，其 `trajectories.jsonl` 就是该次运行的驱动导出时的样子，而已记录的运行此后从不被编辑。这条规则没有为投影此后发生变化的记录留下任何处置办法。当 `foldTrajectory` 开始写出 [`terms`](../architecture/2026-09-19-trajectories-carry-data-use-terms.md)、格式标签变为 `dsh-trajectory/2` 时，`2026-09-19-bench-h1-openrouter-smoke-t2` 已由更早的构建写出：两行不陈述任何条款的 `dsh-trajectory/1`，尽管同一份记录中的两份会话日志都携带接纳 `training` 的 `dataUse/terms`。`build-dataset.mjs --purpose training` 因其不陈述条款而扣留了它们，而数据集工具自己的准则——一次凭据命中是「一份需要重新导出的记录，而不是一个可以挥手放过的发现」——所点名的那套流程，并没有任何实现。

## Decision

[`data/proving-ground/tools/reexport-trajectories.mjs`](../../../../data/proving-ground/tools/reexport-trajectories.mjs) 重新折叠一份记录自己的会话日志，并重写该记录的导出。它接受记录目录和一个可选的 `--check`。

**折叠就是导出器的折叠。** 该工具用 `scanLog` 读取每一份 `sessions/<id>.jsonl`，那正是 [`JsonlSessionPersistence`](../../../../packages/session/session-persistence-jsonl/README.md) 自身使用的解码器，然后把头部与事件交给 `foldTrajectory`。这些日志中含有打包的 chunk 行，因此为这个工具另写一个逐行解析器会读出与导出器不同的会话。它复现的是 `ctx.trajectories.export({ sink })` 且不带其他选项——这正是每个 Proving Ground 驱动所发出的请求：戳记为保留的会话会被扣下，而不适用任何区的过滤，因为 bench 组合没有配置任何一个。对一份由当前构建导出的记录运行该工具，它会逐字节复现那个文件；这个相等正是两次折叠为同一次折叠的证明。

**它不做任何脱敏。** [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) 会按配置脱敏并附上一个 `curation` 块，但 `data/proving-ground/` 下没有任何一份记录是经 `ctx.curator.export()` 写出的：fleet 与 experiment 驱动直接调用导出器，它们的行不带 `curation` 块。在重新导出时脱敏，会写出任何一次运行都不曾产生过的记录。

**重新导出是同一批会话的一次更新的投影，而绝不是另一份语料。** 当记录没有 `sessions/`、没有可替换的 `trajectories.jsonl`、上一次导出点名的某个会话没有日志，或重新折叠会丢掉或多出一条 trajectory 时，该工具都拒绝运行。被接纳的会话 id 集合必须与上一次导出的完全相同，拒绝信息会点名差异两侧的 id。

**行序沿用上一次导出的行序**，每条重新折叠的 trajectory 按会话 id 对回它原来的位置。导出器按会话持久化列出的顺序写出，而记录并不携带那个顺序，因此已签入的文件是该顺序的唯一陈述；重新导出改变每一行所说的内容，而绝不改变它所在的位置。

**manifest 保存这段历史。** 该工具重写 `trajectories.jsonl`，并在 `manifest.json` 中更新该文件的 `bytes` 与 `sha256`，再追加一条 `reexports` 条目：`at`、`tool`、`toolVersion`、`head`、写出的 `format`，以及 `before`/`after` 的摘要与行数。条目是追加的；更早的条目绝不会被覆盖，因此一份记录陈述它经历过的每一次投影。其余一切都不被触碰——`result.json`、`facts.jsonl`、`observatory.json`、`observatory.html` 以及每一份会话日志都保持逐字节相同。

**`--check` 是只读形态。** 它在内存中重新折叠，不写出任何内容，并在已签入的文件不是本工具会写出的内容时、或 manifest 所记录的摘要与它旁边的文件不一致时以 1 退出，同时打印两侧的格式标签、`terms` 计数、行数与摘要。对每一份仍带有 `dsh-trajectory/1` 行的记录它都会以 1 退出，因为它们每一份都会获得当前的格式标签与其会话的条款。

**它跑在 tsx 之下。** 折叠是 TypeScript 源码，而 `scanLog` 不在任何已构建的 `lib/` 中，因此在 tsx 的 ESM 加载器尚未注册时，该工具会带着它重新执行自己一次，并通过动态 `import()` 触达这些包，因为静态导入会在重新执行之前就完成解析。于是 `node data/proving-ground/tools/reexport-trajectories.mjs <record>` 就是全部的调用方式，与该目录中其他每个工具一样。

## Alternatives considered

**在运行目录上重跑驱动。** 一份运行一旦被记录，运行目录就不复存在，而重跑一次 fleet 就等于重跑模型：第二次运行测量的是另一个下午。会话日志才是记录的持久输入，对它们的折叠是确定性的，因此重新折叠是唯一可重复地重述一次运行产物的办法。

**就地编辑已签入的那些行**——补上 `terms`、改掉标签。这更快，也正是语料规则所禁止的：一份被手工编辑过的记录不再是任何构建的产物，而下一位读者无从区分编辑与导出。重新导出会在 manifest 中点名它的工具与 head；编辑什么都不点名。

**不动这些记录，改让 `build-dataset.mjs` 去会话日志里读条款。** 数据集构建器读的是从运行目录复制出来的 `trajectories.jsonl` 文件，手上没有会话存储——这正是记录上之所以有 `terms` 字段的原因。为了一个字段再回头读 `sessions/`，会在那个本就为消费第一次折叠而存在的工具里放进第二次、且不完整的折叠。

**在重新导出时应用 curator 的脱敏。** 那会加固该工具触碰的每一份记录，也会悄悄改变记录对一次运行产物的陈述。受策展的导出是另一项操作，带着另一份 manifest（`dsh-export-manifest/1`、一个配置摘要、各条规则的命中数）；一份从未经过它的记录，绝不该借由一个维护工具获得它的输出。

**覆盖 manifest 的摘要而不留历史。** manifest 会保持为真，而记录会丢失它曾被重新导出过这一事实，而这恰恰是把这份记录与同期记录相比较的读者所需要的事实。

**把工具写成 `.mts`，或写成读取已构建 `lib/` 的 `.mjs`。** `data/` 下的一个 `.mts` 文件既不在任何 TypeScript 程序中，也不在任何 lint 覆盖里，它会成为仓库中唯一一个没有任何静态闸门覆盖的源文件。已构建的 `lib/` 根本不导出 `scanLog`，而一个必须先 `pnpm run build` 才能读取记录的工具，会把产物平面混进一次源码平面的折叠。在 tsx 之下重新执行，既让文件与它的邻居一样保持 `.mjs`，也让折叠停留在作为定本的源码上。

**一次性重新导出语料中的每一份 `dsh-trajectory/1` 记录。** 其中三十份会被重新折叠，而这一切都不改变任何数据集会准入什么：它们的协议接纳 `evaluation` 与 `delivery` 而绝不接纳 `training`，因此在 `--purpose training` 之下无论如何都会被扣留。一次批量重写会为了修复不存在的问题而重述三十次测量，而当真正出现改动理由时，`--check` 已经能报告哪些记录会改变。

## Consequences

`2026-09-19-bench-h1-openrouter-smoke-t2` 现在带着两行 `dsh-trajectory/2`，携带其会话被钉上的那些条款，而 [`datasets/2026-09-19-openrouter-free-v1`](../../../../data/proving-ground/datasets/2026-09-19-openrouter-free-v1/README.md) 准入四条 trajectory 而不是两条。它的 manifest 带着这份语料中第一条 `reexports` 条目。

其余每一份记录都保持其驱动写出时的样子，因此这份语料现在同时持有两种导出格式。在它的 34 份已导出记录上，`--check` 报告三份已是当前状态——两份 `dsh-trajectory/2` 记录，以及 `2026-09-08-bench-held-out-sonnet-all`，它的导出为空是因为它运行的每个环境都是保留环境——三十份会改变，还有一份拒绝：`2026-09-08-district-village-live` 保存着 308 份会话日志，对应的却是一个运行中的区在某个 slot 写出的 82 行导出，因此重新折叠会多出 226 条 trajectory，工具拒绝造出那份语料。读一份记录的人可以从该行自己的 `format` 标签、以及 manifest 是否带有 `reexports`，判断自己在读哪一种格式；一次折叠多份记录的人得到的是两者的混合，而这正是 `terms` 字段被造出来、好让用途过滤得以成立的原因。

一份记录的 manifest 不再只由 `record-run.mjs` 写出。它在要紧的意义上仍是只追加的——更早的 `reexports` 条目以及其余每个字段都不会被重写——但 `trajectories.jsonl` 及其摘要如今是一份记录可以重述的两个事实，因此今后任何对记录摘要的校验都读取当前的条目，而不是假定只有一个。

该工具没有自己的测试：它是与 `record-run.mjs`、`build-dataset.mjs` 同类的 `data/` 维护工具，它的正确性主张就是对一份由当前构建导出的记录的逐字节复现，而 `--check` 可以随时在语料中的每一份记录上重新确立这一点。

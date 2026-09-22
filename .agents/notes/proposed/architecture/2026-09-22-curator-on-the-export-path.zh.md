# Agent Note: bench 导出路径上的 curator、它缺失的凭据规则，以及训练器据以屏蔽的停止原因

Status: proposed

[English](2026-09-22-curator-on-the-export-path.md) | 中文

## Problem

第三个目标是一份 RLVR 语料：它取自本 harness 经认证的运行，由每个会话被钉定的数据使用条款决定能否准入，并在离开实验室之前由 [`dsh-curator`](../../../../packages/governance/curator/README.md) 脱敏（[RLVR 方案](2026-09-19-rlvr-recipe-and-base-model.md)）。2026-09-22 的一次只读审计发现，在语料实际来源的那条路径上，三个条件没有一个成立。

**curator 不在导出路径上。** 每一次 bench 运行、每一次夜间 loop 迭代都要经过的 [`fleet-driver.ts`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/fleet-driver.ts) 与 [`experiment-driver.ts`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/experiment-driver.ts) 调用的是 `ctx.trajectories.export()`：那个不读条款、不做任何脱敏的导出器。[`data/proving-ground/`](../../../../data/proving-ground/README.md) 下 42 份记录中已提交的 1,044 行 trajectory，没有一行带有 `curation` 块。这些记录的 README 却在三处说了相反的话——开头与布局把该文件称为"curator-gated trajectory export"，对第一次运行的记述则说两条 trajectory 都"经 curator 导出"——而[数据集折叠笔记](../../implemented/process/2026-09-18-proving-ground-dataset-fold.md)把每份记录都描述为带有"curator 导出的 `trajectories.jsonl`"。本变更不编辑那份笔记；[重新导出笔记](../../implemented/process/2026-09-19-re-exporting-a-record.md)正确陈述了事实：没有任何记录是经 `ctx.curator.export()` 写出的。

**随包发布的脱敏规则漏掉了编码转录所携带的凭据格式。** 该配置覆盖了地址、bearer 头、`sk-` 密钥、IPv4 地址与 E.164 号码，却没有任何规则覆盖 PEM 私钥主体、AWS 访问密钥、GitHub 或 Slack 令牌，或 JWT。一份 2026-09-21 提交、位于本语料之外的记录逐字携带着某个目标的 PEM 私钥主体，因为没有任何规则去扫描它。

**被截断的会话被计为失败。** `dsh-trajectory/2` 记录没有任何字段说明其会话如何停止，因此一个因预算越限、中止或 provider 错误而结束的会话，与一个运行到底却失败的会话完全一样导出 `reward.outcome: 0`。用下文的停止原因规则折叠已提交的会话日志，在案的 99 条奖励为 0 的 trajectory 中，71 条结束于预算越限，4 条结束于 provider 错误；24 条运行到了底。RLVR 方案点名了训练器所需的字段——因预算越限而结束的 rollout 被屏蔽而不是记为 `0`——因为没有它，每一个因预算结束的 rollout 都是负例，策略会学会提早结束。

## Proposal

### The curator on the bench's export path

两个 bench 驱动器都经 `ctx.curator.export({ purpose, sink, manifestPath: './export-manifest.json' })` 导出，与 [curator 自己的 e2e 驱动器](../../../../examples/headless-agent/tests/fixtures/curator/driver.ts)的做法相同，并把导出 manifest 写在 `trajectories.jsonl` 旁边。[`record-run.mjs`](../../../../data/proving-ground/tools/record-run.mjs) 把 `export-manifest.json` 连同其他导出一起复制进记录，驱动器的 `status.json` 携带经策展的报告，manifest 也在其中。

用途来自组合。[`export-purpose.ts`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/export-purpose.ts) 读取组合的 `data-use` 条目给每个 cell 会话钉定的默认条款：条款接纳 `training` 时选择它，否则选择 `evaluation`。基础组合跑在操作者的订阅上，只接纳 `evaluation`；`with-openrouter` 叠加层接纳 `training`。两个驱动器在启动之后立即解析用途，因此条款两者都不接纳的组合会在第一个 cell 花费任何东西之前被拒绝。脱敏配置是 curator 的 `defaultProfile`，在每个 bench 组合中都是 `village-v1`，这也正是那些条款所指名的配置。

[`reexport-trajectories.mjs`](../../../../data/proving-ground/tools/reexport-trajectories.mjs) 保留原始折叠：它是重新陈述现有 42 份记录的唯一方式，而其中没有一份是由 curator 写出的。它现在在两种模式下都拒绝行带有 `curation` 块的记录，因为重新折叠这样一份记录的会话日志会丢掉该块，并把配置替换掉的每个字符串放回去。

一个无密钥 e2e 在新的 `mock-route` 叠加层上端到端地运行两个真实驱动器；该叠加层在基础组合的产品路由旁边组合其他无密钥 fixture 所用的脚本化路由：fleet 的一个 cell 与实验的两个 arm，随后断言每一行都经过策展、带有其停止原因，并由旁边的 manifest 寻址。

`village-live` 与 `village-claude-implementer` 驱动器记录了语料的最初几次运行及其实时区，它们仍调用原始导出器；记录的 README 点了它们的名。

### The shipped rules

`shipped: true` 现在会在前面加上十一条规则。其中六条是新的并且先运行，因此一段密钥主体或一个令牌会被整体替换并计入它自己的规则，通用模式没有机会拿走其中一部分：`shipped:private-key`、`shipped:jwt`、`shipped:aws-access-key`、`shipped:aws-secret-key`、`shipped:github-token` 与 `shipped:slack-token`。OpenRouter 密钥（`sk-or-v1-…`）本就由 `shipped:api-key` 覆盖，现在有一个测试把这一点钉住。

私钥规则只替换主体，因此两条封装行都保留下来并继续指明密钥类型；它能读出转录携带主体的各种形式：原样、换行经 JSON 转义、在 YAML 块中缩进、使用 CRLF 换行、带旧式 `Proc-Type`/`DEK-Info` 头，或作为 PGP 的 `PRIVATE KEY BLOCK`。END 行被截断的工具输出切掉的主体，只要其行仍读作 base64 或旧式头就会被替换。两次测量决定了该模式的写法：无界的后行断言在一个 6 MB 的对抗性字符串上耗时四秒；而未加节制地扫描 END 行，让两万条没有 END 行的 BEGIN 行耗时 57 秒，因为每一条都要重新扫描字符串的剩余部分。后行断言现在有界，扫描也不会越过另一条 BEGIN 行，这让第二种情形降到 17 ms；一个单元测试把它钉住。

RLVR 方案的风险一节点名了 IPv4 规则会改写形似点分四段的版本串。该规则本就要求每一段都不超过 255，它的词边界本就放过了以 `v` 开头的版本号，例如 `v1.2.3.4`。它确实存在的误报是位于更长点分串里的四段：`1.2.3.4.5` 变成了 `[redacted:ipv4].5`。现在两个环视断言放过前面是数字加点、或后面是点加数字的四段。各段都不超过 255 的裸四段版本号，例如 .NET 的 `4.0.0.0`，仍与地址无从区分，这是一条已记录的限制。

manifest 的 `ruleHits` 本就按规则统计替换次数，且从不携带被匹配的文本。现在它旁边还携带 `ruleRecords`，即每条规则触发过的已写出记录数，这正是用来区分"匹配各环境共有文本的规则"与"少数几份转录里的凭据"的依据。manifest 格式为 `dsh-export-manifest/2`。`stopReason` 加入脱敏遍历永不改写的键名，因为它是读者据以分支的封闭词汇。

### The stop reason

记录格式为 `dsh-trajectory/3`，`stopReason` 始终存在。这次升级沿用[条款笔记](../../implemented/architecture/2026-09-19-trajectories-carry-data-use-terms.md)的做法：格式标签陈述产出方会写出哪些字段，因此 `/3` 记录陈述其会话如何停止，而 `/1` 或 `/2` 记录对此不置一词，屏蔽被提前截断会话的消费方仅凭行本身就能区分二者。

`foldTrajectoryStop(events)` 按顺序读取日志。每条 `turn/end` 与每条 `environment/delegation` 都会重新陈述原因：轮次结束的 kind 原样携带，包括插件合并进 `TurnEndReasonMap` 的 kind；委托尝试则是其 subagent 停止原因，其中运行器的 `budget-deadline` 读作 `budget`。在一次 `budget/breach` 之后以 `blocked` 结束的轮次是 `budget`，而越过会话自身上限的越限立即就是 `budget`——预算在下一次尝试之前耗尽的委托 cell 正是这样结束的。结束于一个未关闭轮次之内的日志是 `interrupted`，一个工作单元也没有结束的日志是 `none`。该折叠按名称读取 `budget/breach` 与 `environment/delegation`，与它本就按名称读取 `agent-preset/selected` 一样，并在遇到所属包从不写出的载荷值时失败。

在已提交的会话日志上，该折叠对 99 条奖励为 0 的 trajectory 给出 71 条 `budget`、4 条 `error` 与 24 条 `completed`；另有 17 条已认证的 trajectory 也停止于 `budget`，这就是屏蔽要读取结果而不只读取停止原因的原因。

[`build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) 会屏蔽去往训练集、得分为 `0` 且停止原因不是 `completed` 的 trajectory：它不进入任何文件，manifest 把它计入 `maskedNegatives`，并在 `maskedStopReasons` 中按原因计数。格式早于该字段的记录以 `(unstated)` 被屏蔽，因此在今天的语料上，全部 84 条去往训练集的负例都会被屏蔽，直到它们的记录被重新导出；在一次草稿构建中重新导出一份记录 `2026-09-08-bench-h1-harness-loop-t5`，屏蔽了它的四个因预算结束的 cell，并保留了它那个运行到底、停在 160 之 159 个用例的 cell。`heldout.jsonl` 保留每一个负例，因为一次耗尽预算的评测确实失败了。写出集合的停止原因是 manifest 中的一项分布。

## Alternatives considered

**用计划字段指名导出用途。** 计划指名的是路由与 cell；组合钉定每个 cell 会话所携带的条款，而 curator 只按这些条款准入会话。一个要求条款所不接纳之用途的计划只会写出空导出，因此单独的字段只可能与它所喂给的那道关卡相矛盾。

**每次运行导出两次，每个被接纳的用途一次。** 在 `with-openrouter` 下，两次导出会写出相同的行，唯一差别是 manifest 的 `purpose`。数据集构建本就按每行自身的 `terms` 过滤，因此以 bench 偏好的用途导出一次就能服务两类读者。

**在 `reexport-trajectories.mjs` 中重新策展经策展的记录。** 该工具将需要组合的脱敏配置，包括任何 manifest 都不记录的部署规则，以及 curator 遍历的第二份实现。经策展的记录由 curator 重新陈述；该工具的职责是重新投影语料里已有的未经策展的记录。

**屏蔽每一条没有以 `completed` 停止的行，已认证的也包括在内。** 证书陈述的是目录树通过了标准，无论会话如何停止；在案的 17 条已认证 trajectory 停止于预算。屏蔽它们会丢掉奖励本已证明的正例。

**把缺失的 `stopReason` 读作 `completed`。** 这会让今天的负例留在每一次构建中，并恰好为审计所统计的那些记录恢复缺陷：它们的 99 个 0 中有 71 个结束于预算。

**保留 `dsh-trajectory/2` 并把该字段当作增量字段。** 那样混合语料中就会同时存在带与不带该字段的 `/2` 记录，消费方只能凭该字段是否存在来分辨新旧导出器，而这正是条款笔记以同样理由拒绝过的读法。

**以类型化导入读取预算与委托事件。** 导入 `SessionEventMap` 的合并声明，会让 trajectories 包为了两个字符串字段而对等依赖于预算策略，以及连同其 agent、shell 与 subagent 依赖的环境运行器；该折叠出于同样理由本就按名称读取 `agent-preset/selected`。

**用一个标记替换整个 PEM 块，封装行也包括在内。** 字面替换无法把匹配到的 BEGIN 行拼回去，因此该标记会丢掉评审者据以判断记录的密钥类型；只匹配主体则能保留它。

**在同一变更中把 village 驱动器迁到 curator。** 它们有各自断言原始报告的包内 e2e 套件，而且没有排队的运行使用它们。在某次区运行需要经策展的导出之前，记录的 README 会一直点着它们的名。

## Acceptance criteria

- 两个 bench 驱动器都调用 `ctx.curator.export`，并且 `mock-route` 叠加层上的无密钥 e2e 通过：每一条导出行都带有 `curation.redactionApplied: true` 与一个 `stopReason`，`export-manifest.json` 恰好寻址该文件的字节。
- bench 写出的下一份记录每一行都经过策展并带有 `export-manifest.json`，其 `ruleHits` 与 `ruleRecords` 列出全部十一条随包发布的规则。
- 由 `reexport-trajectories.mjs` 重新导出的记录带有 `dsh-trajectory/3` 行，在其上构建的数据集把其中因预算结束的负例屏蔽在 `maskedStopReasons.budget` 之下。
- `reexport-trajectories.mjs` 在两种模式下都拒绝经策展的记录。
- 在 `with-openrouter` 叠加层上的一次 bench 运行以 `training` 导出，且 `withheldByTerms: 0`。

## Risks

- **组合级的条款。** 叠加层为它创建的每个会话钉定同一套条款，因此在 `with-openrouter` 下运行的订阅 arm 会被钉上训练条款并以训练用途导出。没有任何已入库的计划混用这两条路由；按路由钉定条款才是修复。
- **重新导出之前负例集合为空。** 每一份已提交的记录都早于该字段，因此今天构建的每个数据集都把全部去往训练集的负例以 `(unstated)` 屏蔽。重新导出这些记录会重新陈述它们，并适用重新导出笔记的规则：每次重新导出都追加一条 `reexports` 条目。
- **保守的误读。** 占用上限份额的梯级会在其子运行返回后再被度量一次，因此此时记录的会话上限越限会折叠为 `budget`，即便已没有剩余尝试；被插件越过输出上限继续执行的轮次会折叠为 `max-tokens`。两者都会屏蔽一个本可能度量了工作的 0。
- **新规则的过度脱敏。** 一个先写出 BEGIN 行、之后又写出 END 行的源文件会失去两行之间的文本，被截断的密钥会带走其后文本行的第一个词。`ruleRecords` 正是用来显示某条规则在不含密钥的记录中普遍触发的依据。
- **同一语料中的经策展行与原始行。** 本变更之后构建的数据集会混合经脱敏与未经脱敏的记录；无论哪种导出写出了它，构建器自身的凭据扫描仍会拒绝带有形似凭据字符串的构建。
- **规则是正则表达式。** 格式不被任何规则覆盖的凭据仍会被导出，`redactionApplied: true` 陈述的是有一个配置运行过，而不是记录是干净的。

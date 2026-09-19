# Agent Note: The trajectory record carries the session's data-use terms

Status: implemented

[English](2026-09-19-trajectories-carry-data-use-terms.md) | 中文

## Problem

[`@deepseek-ai/dsh-data-use`](../../../../packages/governance/data-use/README.md) 在会话创建时把 `dataUse/terms` 钉到每个会话上，而 [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) 从会话日志里读出这些条款，据以决定一次导出可以携带什么。导出的记录本身对它们只字不提，于是条款只存在于日志所在之处。一个训练器、一份排行榜，或 [`data/proving-ground/tools/build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) 里的离线折叠，手里只有 `trajectories.jsonl` 而没有会话存储，分不出哪份是只许评测的转录、哪份是其协议允许进入训练语料的。数据集构建器因此根本没有用途这个概念：它过滤留出环境、被委派的 cell、被篡改的运行与重复项，却会把一份客户转录折进 `train.jsonl`，与一个 bench cell 并排。

## Decision

`foldTrajectory` 通过 curator 所用的同一个 [`termsOf`](../../../../packages/governance/data-use/README.md) 折叠读取会话的条款，并把它们作为 `terms` 写到记录上：只有 `agreementId` 与 `purposes`，别无其他。"日志中最新一条 `dataUse/terms` 才算数"这条规则由一个折叠独占，于是消费方据以过滤的字段与 curator 执行的那道关卡不会彼此矛盾。

只携带接纳决定会读取的那两个字段。curator 接纳一个会话，当且仅当 `terms.purposes` 含有该次导出的用途，没有别的理由，因此保留期、驻留地与脱敏配置都会是无人核对的负载，而 `clientId` 正是 data-use README 要求读者散列而非展示的那一个字段。驻留地仍会经 `curation` 块进入被策展的行——curator 把它放在那里，供按区域分区的 sink 使用。

**缺失的 `terms` 不接纳任何用途。** 日志不含 `dataUse/terms` 的会话产出的记录不带该字段——不是 `null`，也不是空列表——按用途过滤的消费方会扣留它。没有人记录过的用途绝不被假定，这正是 curator 对未被钉过条款的会话早已适用的规则。

**格式标签为 `dsh-trajectory/2`。** 缺失是承载语义的，而它只有在产出方被确知"日志里有就一定写出该字段"时，才承载上面那句陈述。`dsh-trajectory/1` 记录对数据使用根本不置一词；不带 `terms` 的 `dsh-trajectory/2` 记录则陈述该会话本就没有条款。两者在任何用途过滤下都会被扣留，但只有后者说明了原因，而从沉默中作出的治理决定需要知道自己读到的是哪一种沉默。预发布立场选择升版而非兼容垫片，并在同一次改动中更新每一个读者。

curator 的脱敏遍历把 `terms` 列入它从不重写的子树，与 `environment`、`steps`、`parity`、`provenance` 并列。该遍历在其余地方会脱敏触及的每个字符串，因此一条部署规则可能重写协议或某个用途，恰好破坏这次导出据以设卡的那些值。

`build-dataset.mjs` 新增 `--purpose <delivery|training|evaluation>`：只有 `terms` 接纳该用途的 trajectory 才被保留，其余计入 `withheldTerms`，名称对齐既有的 `withheldHeldOut`。这道关卡先于其他一切归类运行，因此本数据集不得携带的记录既不进入任何文件，也不进入任何分布。manifest 在 `options` 下记下该用途，而那个计数恒在，于是 manifest 把这次扣留说出来而不是藏起来。不给 `--purpose` 时构建不变：同样的行、同样的摘要、同样的分布，`withheldTerms` 为零。

## Alternatives considered

**像 `presetOf` 读取 `agent-preset/selected` 那样，在折叠里按名字读 `dataUse/terms`。** 那个先例的存在，是为了让投影摆脱一个它别无所求的依赖。而这里规则本身才是要点：最新的钉定胜出，而这套扫描的第二份实现可能与 curator 所执行的那份发生漂移——一条记录声称某个用途而关卡却拒绝它——这正是本次改动要防止的矛盾。

**携带完整的 `DataUseTerms` 负载。** 保留期、驻留地与脱敏配置是对持有该转录者的义务，而不是接纳决定的输入，而 `clientId` 正是 data-use README 要求卡片散列的那个字段。把全部六个字段抄到每一行上，等于为一个只读其中两个的决定，把客户标识符放进每一份语料。

**保持 `dsh-trajectory/1`，把该字段当作纯增量。** 每个既有读者都能继续工作，波及面也会是几行而不是十几份文档。但它在该字段唯一的用处上失败了：一份混合语料里，缺失的 `terms` 在一些记录上意味着"该会话本就没有条款"，在另一些记录上意味着"导出器没有去看"，而用途过滤分不出被治理的扣留与未知。

**只在 curator 里按用途过滤，让记录保持沉默。** curator 已经这么做了，而这并不够：`trajectories.jsonl` 会被从运行目录里复制出去，由一个没有会话存储可重读的工具离线折叠。一条无法复述自身条款的记录，会迫使每个下游消费方去信任手中这份文件的来历。

**在折叠时把缺失的 `terms` 兜底为部署配置的条款。** 这会让既有语料变得可过滤，而它恰恰是 data-use 钉定所要禁止的那种假定：一个会话所处的条款就是它日志所陈述的条款，而不陈述条款的会话就是没有条款。

**`--purposes a,b` 列表，或 `--no-purpose-filter` 退出开关。** 一份数据集服务于一个用途，而列表会引出它表示全部还是任一的问题。省略该开关本就是不过滤的构建，因此退出开关只会是默认行为的第二种写法。

## Consequences

`data/proving-ground/` 下记录的每一条 trajectory 都是 `dsh-trajectory/1` 且不带条款，因此 `--purpose training` 会把它们全部扣留。对一份完全产生自操作者 Claude Code 订阅的语料而言，这正是正确的读法：其协议允许 `evaluation` 与 `delivery`，从不允许 `training`。因此 RLVR 语料从空开始，只由创建时被组合钉上 `training` 的会话填充。

`@deepseek-ai/dsh-trajectories` 依赖 `@deepseek-ai/dsh-data-use`，这是导出器对治理包的唯一一个依赖。`improvement` 早已经由 `program` 与 `signoff` 依赖 `governance`，而另一条路是在折叠里再放一份条款规则的副本。

对一份记录时不含 `withheldTerms` 的 manifest 执行 `--check` 会在 `counts` 上报告漂移，因为重建带有该字段而已记录的计数没有。数据集是从按政策冻结的记录重建的，因此这是新增 manifest 字段的常规后果而非迁移：下一次以同名构建就会记下新的计数。

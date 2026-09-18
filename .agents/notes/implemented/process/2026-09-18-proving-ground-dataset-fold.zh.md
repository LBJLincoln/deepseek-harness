# Agent Note: 把已记录的 Proving Ground 运行折叠成一份数据集

Status: implemented

[English](2026-09-18-proving-ground-dataset-fold.md) | 中文

## Problem

`data/proving-ground/` 下三十来个运行目录各自带着 curator 导出的一份 `trajectories.jsonl`，却没有任何东西把它们折叠成一份语料。谁想要一份，就得自己写一段临时脚本，而真正要紧的三个决定恰恰会在那里被悄悄做掉：保留（held-out）环境会不会漏进训练素材、没有自己模型轮次的被委派 cell 算不算一条 trajectory，以及一段凭据或一个真实邮箱会不会搭车进入一份本就打算被复制出仓库的文件。

## Decision

[`data/proving-ground/tools/build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) 读取每一个带 `trajectories.jsonl` 的记录目录，写出 `data/proving-ground/datasets/<name>/`：`train.jsonl`、`heldout.jsonl`，以及一份 `manifest.json`，其中带有各份来源记录及其 manifest 摘要、各项计数、已写出集合的各项分布、token 合计，以及每个写出文件的 SHA-256。它和旁边那三个工具一样，是一个只用 Node 内置模块的数据工具，并从 `summarize-run.mjs` 导入 `armOf`，使 arm 这套词汇只有一个归属处。

写出的每一行都是导出的 `dsh-trajectory/1` 记录加上一个 `dataset` 字段——`record`、`tier`、`domain`、`arm`，以及形如 `{ value, basis }` 的 `reward`——其中 tier 与 domain 取自 bench 环境目录，不在其中的环境取 `null`。排序先按记录名、再按 trajectory id，同一个 id 的首次出现胜出，因此被两份记录导出的同一个会话只落地一次。

保留环境从不进入 `train.jsonl`。在没有 `--include-held-out` 时它连任何文件都不进入，而 manifest 会记下被扣下的数量：空的 `heldout.jsonl` 无论如何都会写出，好让这个目录把这次扣留说出来，而不是把它藏起来。被委派的 cell——戳记中 `implementer` 不是 `route` 的那些——没有自己的模型轮次，因此除非给出 `--include-delegated` 否则被排除，而无论哪种情况都会在 manifest 中计数。`tamper` 依据意味着测量作废，因此那些被排除，且没有任何开关。`--check` 在内存中重建，把摘要与计数同已记录的 manifest 比对，并容忍 JSONL 文件不存在，使一份大到无法提交的数据集仍可校验。

## The redaction refusal

在写出任何东西之前，每一条 trajectory 的每一个字符串都会用 [`collect-claude-code-session.mjs`](../../../../data/transcripts/tools/collect-claude-code-session.mjs) 所拥有的凭据模式、外加一个地址模式扫描一遍。命中即拒绝构建，并打印记录、trajectory、字段、该匹配的摘要，以及把匹配替换掉之后的一段摘录。这里没有放行开关：已记录的运行从不被编辑，因此命中指明的是一份需要重新导出的记录，而「摘要加摘录」这种报告方式从不把匹配重新打印出来。

地址模式需要一条正则自己划不出来的界线，因为这份语料中的 URI、query-string 与 URL-template 环境会给各自的解析器喂进一百七十五个替身地址。只有当一个地址的邮件域既不是 RFC 2606 或 RFC 6761 保留的域、也不是一到三个字母的标签时，它才算命中——后者正是语料中每个替身所用的形状，而没有哪个运维者的邮箱是这个形状。位于这么短的域上的真实邮箱会被放过；工具自己的注释与数据集 README 都这么写，因为一个说明了自身边界的有限检查，比一个佯装完备的检查更有价值。

## Alternatives considered

**不设任何豁免的通用地址模式。** 它会在这份语料的每一次构建上都拒绝，因为单看形状，一个 URI 解析器测试数据里的 `x@y.com` 和 `pass@example.com` 与一个邮箱无从区分。一个永远无法通过的检查不是检查，而是一个跑不起来的工具。

**像 transcript 采集器那样提供 `--accept-hit <sha256>` 开关。** 采集器快照的是一个会话，其占位符由人复核一次。而数据集是从按策略冻结的记录重建出来的，因此一次被接受的命中会在每次重建时被永远重新接受，这个开关就会变成绕过检查的方式，而不是对它的复核。重新导出记录是唯一能真正去掉那个字符串的修法。

**命中时做脱敏而不是拒绝。** curator 在导出时已经施加了一份脱敏配置，因此一个能活着进入记录的字符串说明那份配置有缺口。在这里把它遮掉，只会修好副本，而把记录和配置都留在错的状态上。

**把未加戳的会话当作被委派处理。** 没有 `environment/run` 戳记的会话——shift 台账，以及 cell 所派生的子会话——根本没有 implementer。戳记自身的契约把缺失的 implementer 读作 route，`summarize-run.mjs` 已经是这么做的，于是两个工具彼此一致，而不是再发明第三条规则。

## Consequences

第一份数据集 [`2026-09-18-proving-ground-v1`](../../../../data/proving-ground/datasets/2026-09-18-proving-ground-v1/README.md) 写出了 750 条中的 521 条，并且没有发现任何凭据或邮箱。它的 `train.jsonl` 大于本仓库所提交的体积，因此该目录只带上 manifest 及其 README 对，JSONL 则按需重建——这也正是 `--check` 容忍文件不存在的由来。

这次折叠还让语料说出了自己的条款：其中每个会话被钉上的 `dataUse/terms` 允许 `evaluation`，或者允许 `delivery` 与 `evaluation`，没有一个允许 `training`。因此这份数据集是一份评测记录，而一份 RLVR 语料需要在创建时就被钉上 `training` 的会话。工具本身不读这些条款——由 curator 在导出时执行——因此在未来某个允许训练的区上构建，会在不同条款下产出同样的文件，而每份数据集的 README 会说明是哪一种。

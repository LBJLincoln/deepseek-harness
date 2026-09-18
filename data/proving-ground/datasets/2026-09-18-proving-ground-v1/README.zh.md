# 2026-09-18-proving-ground-v1

[English](README.md) | 中文

把每一条已记录的 Proving Ground trajectory 折叠成训练方可直接读取的一份文件：[`data/proving-ground/`](../../README.md) 下 29 份记录所携带的 750 条 trajectory，筛选为测量 harness 自身模型路由的那 521 条。[`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) 仅从这些记录写出它；记录本身从不被编辑，本目录中也没有任何内容是手写的。

## Files

| File | What it holds |
|---|---|
| `train.jsonl` | 521 条 trajectory，按记录名、再按 trajectory id 排序 |
| `heldout.jsonl` | 以相同格式写出的保留（held-out）环境的 trajectory；始终写出，除非构建带上 `--include-held-out`，否则为空 |
| `manifest.json` | 名称、构建时间、仓库 head、工具版本、每份来源记录及其 manifest 摘要、各项计数、已写出集合的各项分布、token 合计，以及每个写出文件的 SHA-256 |

这两个 JSONL 文件超出本仓库提交的体积，因此只有 `manifest.json` 和这一对 README 被签入；用下面的命令重建其余部分，并与 manifest 记录的摘要比对。`train.jsonl` 为 41 222 996 字节，摘要 `f357ef8939b8a3296749d06969ab02aaf9db977ea0fc9bdea0af15c48aea3826`；`heldout.jsonl` 为空，摘要即零字节的 SHA-256。

每一行都是 [`@deepseek-ai/dsh-trajectories`](../../../../packages/improvement/trajectories/README.md) 导出的 `dsh-trajectory/1` 记录——`id`、`source`、`environment`、`config`、`system`、`tools`、`messages`、`steps`、`reward`、`parity`、`provenance`——并增加一个字段：

```json
{ "dataset": { "record": "2026-09-08-bench-h1-harness-loop-t5", "tier": 5, "domain": "parsing", "arm": "fleet", "reward": { "value": 1, "basis": "certificate" } } }
```

`tier` 与 `domain` 读自 `examples/headless-agent/tests/fixtures/proving-ground-bench/environments/` 下该环境的 `task.json`；不在该目录中的环境——冒烟任务、live 区的任务，或任何运行器未加戳的会话——两者都为 `null`，在这次构建中即那 106 个未加戳的会话。`arm` 是戳记 group 的角色后缀（`baseline`、`candidate`），fleet 批次为 `fleet`，不属于任何 group 的会话为 `-`。

## Reward

`reward.value` 即导出的 `reward.outcome`，`reward.basis` 说明是什么作出了这个判定。certificate 是唯一能带正值的依据：验证器运行了运行器在工作开始前编写的标准，`1` 表示有一份证书覆盖当前的标准修订。同一依据也为有标准却从未取得证书的目标带上 `0`——一次被测量到的失败。`none` 表示日志中没有目标，因此什么都没被测量，取值为 `null`。`tamper` 表示最后一次记录的运行发现检查所属的文件被改动，无论日志其余部分如何，这都使该测量作废；这样的 trajectory 不会进入任何一个文件。

这份语料只出现了其中两种依据：367 行取 `1`、48 行取 `0`，都基于证书，另有 106 行取 `null`、依据为 `none`。这 106 行未被测量的行就是运行器未加戳的会话——77 个完全没有模型轮次的 shift 台账会话，以及 `2026-09-08-bench-e5-drop-candidate-t5` fleet 的 cell 所派生的 29 个子会话，它们各自在 `source.parentSession` 中指明父会话，并在没有戳记的情况下带着自己的轮次。没有任何一行带 `tamper` 或 `uncertified-completion`。

出现在 240 行上的 `parity` 是最后一次记录的运行的加权通过率。它只是一个辅助信号：通过率会奖励那种只对自己看到的失败用例过拟合的候选者，因此奖励仍由证书给出。

## What is excluded

| Excluded | Rows | Why |
|---|---|---|
| 被委派的 cell | 203 | 它们的戳记所指的 implementer 不是 `route`，即由一个带外编码代理完成工作，harness 会话只保存戳记、标准、委派记录与证书，而没有自己的模型轮次。`--include-delegated` 会照样写出它们。 |
| 重复项 | 26 | 同一个会话被两份记录导出，或被一份记录按每个 slot 各导出一次。按记录顺序的第一条胜出。 |
| 保留环境 | 0 | 留作评测的环境从不进入 `train.jsonl`，而在没有 `--include-held-out` 时它连任何文件都不进入。curator 已在上游扣下了它们：`2026-09-08-bench-held-out-sonnet-all` 运行了八个保留环境，导出的 `trajectories.jsonl` 为空，因此语料中并不存在需要再扣一次的保留 trajectory。 |
| 被篡改的运行 | 0 | 作废的测量被无条件排除；没有任何开关可以放行。 |

## Counts

29 份记录共 521 行：全部由 `route` 实现，路由为 `claude-code/sonnet`（267）、`claude-code/opus`（82）、`claude-code/haiku`（66），另有 106 个未加戳的会话没有路由。按 arm 计，baseline 182、candidate 116、fleet 117，另有 106 行不属于任何 group。按 tier 计，5 级 240、3 级 144、4 级 18、2 级 13，另有 106 行没有 tier。按 domain 计，data-structures-algorithms 149、parsing 122、state-machines 48、systems 48、text 32、invariants 16，另有 106 行没有 domain。写出的这些 trajectory 报告了 11 212 842 个输出 token、37 606 个未命中缓存的输入 token、123 640 519 个缓存读取与 54 853 114 个缓存写入，来自 6 967 个 step 中报告了用量的那 6 966 个。`manifest.json` 还保存了按环境和按 ladder 的分布。

## Building it

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-18-proving-ground-v1
node data/proving-ground/tools/build-dataset.mjs 2026-09-18-proving-ground-v1 --check
```

只要任何一条 trajectory 带有形似凭据的字符串或指向真实邮件域的地址，构建就拒绝写出任何内容，并打印记录、trajectory、字段、该匹配的摘要，以及把匹配替换掉之后的一段摘录。这里没有放行开关：已记录的运行从不被编辑，因此命中意味着这份记录需要重新导出。这份语料没有任何命中。扫描的凭据模式读自 [`collect-claude-code-session.mjs`](../../../transcripts/tools/collect-claude-code-session.mjs)，并豁免 RFC 2606 与 RFC 6761 保留的文档域，以及 URI 与 query-string 环境喂给各自解析器的那些一到三个字母的域；位于这么短的域上的真实邮箱会被放过。

`--check` 在内存中重建，将摘要与各项计数同 `manifest.json` 比对，一旦有任何差异即以 1 退出。它容忍这两个 JSONL 文件不存在，未提交的数据集正是借此保持可校验。

## Data-use terms

这些条款是各会话在创建时被钉上的条款，读自它们的日志以及产生它们的组合，而不是在此处选定的。每个会话都指明客户 `daliesk-lab`、驻留地 `eu-west`、90 天留存期与脱敏配置 `village-v1`，并归于三份协议之一：`proving-ground-bench` 只允许 `evaluation`，`village-live` 与 `village-claude-implementer` 允许 `delivery` 与 `evaluation`。

这份语料中没有任何一份协议允许 `training`。在 [`@deepseek-ai/dsh-data-use`](../../../../packages/governance/data-use/README.md) 之下，一次钉定只能收窄用途而绝不能放宽，而 [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) 会扣下条款不允许某次导出用途的每一个会话。因此这次折叠是一份评测记录，而非 RLVR 素材：正如 [`data/README.md`](../../../README.md) 所述，`data/` 下没有任何内容是 Daliesk 模型的训练数据，该模型的语料来自条款允许的路由上经认证的运行。用这个工具构建训练集，需要在创建时就被钉上 `training` 的会话。

# 2026-09-19-openrouter-free-v1

[English](README.md) | 中文

第一份为 `training` 构建的 Proving Ground 数据集：在 [`data/proving-ground/`](../../README.md) 下 34 份记录所携带的 834 条 trajectory 中，自身数据使用条款接纳该用途的那 4 条。[`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) 仅从这些记录写出它；记录本身从不被编辑，本目录中也没有任何内容是手写的。

被接纳的每一行都来自 2026-09-19 在 `with-openrouter` 覆盖层上的两次 fleet，那是唯一一条其协议接纳训练的路由。四行中有两行是在 [`tools/reexport-trajectories.mjs`](../../tools/reexport-trajectories.mjs) 重新折叠 `2026-09-19-bench-h1-openrouter-smoke-t2` 之后才具备被接纳资格的：那份记录由早于 `terms` 字段的构建导出，因此它的各行不陈述任何条款而被扣留，尽管其会话与其余记录钉在同一份协议之下。

## Files

| File | What it holds |
|---|---|
| `train.jsonl` | 4 条 trajectory，按记录名、再按 trajectory id 排序 |
| `heldout.jsonl` | 以相同格式写出的保留（held-out）环境的 trajectory；始终写出，除非构建带上 `--include-held-out`，否则为空 |
| `manifest.json` | 名称、构建时间、仓库 head、工具版本、所筛选的用途、每份来源记录及其 manifest 摘要、各项计数、已写出集合的各项分布、token 合计，以及每个写出文件的 SHA-256 |

与[评测折叠](../2026-09-18-proving-ground-v1/README.md)一样，只有 `manifest.json` 和这一对 README 被签入；用下面的命令重建其余部分，并与 manifest 记录的摘要比对。`train.jsonl` 为 1 251 247 字节，摘要 `df3c99702a45690a1ab0ecb91ff6ba3ce9787f3815f094aa349f64f312a5729c`；`heldout.jsonl` 为空，摘要即零字节的 SHA-256。

每一行都是 [`@deepseek-ai/dsh-trajectories`](../../../../packages/improvement/trajectories/README.md) 导出的一条记录，在这份语料中一律为 `dsh-trajectory/2`——`id`、`source`、`terms`、`environment`、`config`、`system`、`tools`、`messages`、`steps`、`reward`、`provenance`——并增加一个字段：

```json
{ "dataset": { "record": "2026-09-19-bench-h1-fleet-openrouter-nex-smoke-t2", "tier": 2, "domain": "parsing", "arm": "fleet", "reward": { "value": 1, "basis": "certificate" } } }
```

`tier` 与 `domain` 读自 `examples/headless-agent/tests/fixtures/proving-ground-bench/environments/` 下该环境的 `task.json`；这里的每一行都带着已在目录中的环境戳记，因此这次构建中两者都不为 `null`。`arm` 是戳记 group 的角色后缀（`baseline`、`candidate`），fleet 批次为 `fleet`，不属于任何 group 的会话为 `-`；这四行都是 fleet 的 cell。

## Reward

`reward.value` 即导出的 `reward.outcome`，`reward.basis` 说明是什么作出了这个判定。certificate 是唯一能带正值的依据：验证器运行了运行器在工作开始前编写的标准，`1` 表示有一份证书覆盖当前的标准修订。同一依据也为有标准却从未取得证书的目标带上 `0`——一次被测量到的失败。`none` 表示日志中没有目标，因此什么都没被测量，取值为 `null`。`tamper` 表示最后一次记录的运行发现检查所属的文件被改动，无论日志其余部分如何，这都使该测量作废；这样的 trajectory 不会进入任何一个文件。

这里的两种取值都基于 `certificate`：2 行取 `1`，是在第一次尝试就取得证书的 `nex-agi/nex-n2.5-pro:free` cell；2 行取 `0`，是各花掉三次尝试、始终没有写过一个文件的 `deepseek/deepseek-v4-flash-0731:free` cell。没有任何一行带 `none`、`tamper` 或 `uncertified-completion`，也没有任何一行带 `parity`，因为这四个 cell 的任何一次运行都没有测量用例。

## What the filter withheld

| Withheld | Rows | Why |
|---|---|---|
| 条款不接纳 `training` | 804 | 在操作者的 Claude Code 订阅上产生的每一份记录，其协议只接纳 `evaluation` 与 `delivery`，再加上那些根本不陈述条款的 `dsh-trajectory/1` 行。 |
| 重复项 | 26 | 同一个会话被两份记录导出，或被一份记录按每个 slot 各导出一次。按记录顺序的第一条胜出。 |
| 被委派的 cell | 0 | 两次来源 fleet 的 cell 都没有被委派，它们都跑在 harness 自己的循环上。 |
| 保留环境 | 0 | 留作评测的环境从不进入 `train.jsonl`，而在没有 `--include-held-out` 时它连任何文件都不进入。两次来源 fleet 都没有运行过这样的环境。 |
| 被篡改的运行 | 0 | 作废的测量被无条件排除；没有任何开关可以放行。 |

被条款扣留的这 804 条正是用途闸门存在的理由，它们并不是需要修复的缺陷：一份记录的条款就是其会话在创建时被钉上的那些条款，此后绝不能放宽。那个计数中曾有一份记录确属缺陷，如今不再是：`2026-09-19-bench-h1-openrouter-smoke-t2` 在 `foldTrajectory` 写出 `terms` 之前导出，因此它的两行因不陈述条款而被扣留，而它们的会话日志本就携带接纳 `training` 的 `dataUse/terms`。重新导出这份记录，把其会话一直拥有的条款写到了行上。仍被扣留的，依其自身条款被扣留；同一路由的两份 partial 记录——`2026-09-19-bench-h2-openrouter-free-t2-partial` 与 `2026-09-19-bench-h1-openrouter-deepseek-t2-partial`——对两边都没有贡献：它们的驱动在导出之前就被停止，因此这两份记录只有会话日志而没有 `trajectories.jsonl`，而重新导出是替换一次导出，而不是创建一次导出。

## Counts

34 份记录中的 2 份共 4 行：两次 fleet 都由 `route` 实现，路由为 `openrouter/nex-agi/nex-n2.5-pro:free`（2）与 `openrouter/deepseek/deepseek-v4-flash-0731:free`（2），每个模型的 ladder 都只指向它自己。四行都是第 2 层的 fleet cell，两行在 `code:glob-match`（domain `parsing`）上，两行在 `code:path-normalize`（domain `systems`）上。写出的这些 trajectory 报告了 162 911 个输出 token、930 808 个未命中缓存的输入 token 与 2 818 401 个缓存读取，没有缓存写入，来自它们 121 个 step 的全部 121 个。`manifest.json` 还保存了按环境和按 ladder 的分布。

## Building it

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training --check
```

`--check` 不会读取 manifest 所记录的用途：它按收到的开关重建，因此校验必须重复带上 `--purpose training`，否则它就是拿一次未筛选的重建去比对这份 manifest，并在每个摘要和各项计数上报告偏差。

只要任何一条 trajectory 带有形似凭据的字符串或指向真实邮件域的地址，构建就拒绝写出任何内容，并打印记录、trajectory、字段、该匹配的摘要，以及把匹配替换掉之后的一段摘录。这里没有放行开关：已记录的运行从不被编辑，因此命中意味着这份记录需要重新导出，而 [`tools/reexport-trajectories.mjs`](../../tools/reexport-trajectories.mjs) 正是从该记录自己的会话日志完成这件事。这份语料没有任何命中。

## Data-use terms

这四个会话在创建时都钉在协议 `proving-ground-openrouter-free` 之下，该协议接纳 `training` 与 `evaluation`，客户为 `daliesk-lab`、驻留地 `eu-west`、留存期 90 天、脱敏配置 `village-v1`。记录只携带协议与用途；留存期、驻留地与客户留在会话日志里，因为没有任何准入判定会读它们。

在 [`@deepseek-ai/dsh-data-use`](../../../../packages/governance/data-use/README.md) 之下，一次钉定只能收窄用途而绝不能放宽，而 [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) 会扣下条款不允许某次导出用途的每一个会话。因此这次折叠是本仓库持有的第一份可用于 RLVR 的语料，宽度是四个 cell：两个已认证，两个被测量到的失败。正如 [`data/README.md`](../../../README.md) 所述，Daliesk 模型的语料来自条款允许的路由上经认证的运行，而这份数据集只随着更多这样的运行被记录而增长。

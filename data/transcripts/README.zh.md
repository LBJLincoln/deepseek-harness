# 过程 transcript

[English](README.md) | 中文

构建本仓库的 agent 会话的完整 transcript（文本记录），保存在它们所构建的仓库里。每个构建目录都包含从操作者机器上采集的原始 Claude Code 会话目录树，以及由它派生的紧凑数据集。它们存在的目的是让这个 harness 的制作过程一点都不丢失：每一条提示、每一次工具调用和每一份报告都在这里，可供挖掘过程模式、失败分类和环境合成。

## Layout

```
data/transcripts/
  LOSSES.md, LOSSES.zh.md             what the container resets erased, and what survived where
  tools/
    collect-claude-code-session.mjs   snapshot one live Claude Code session into <build>/raw/
    capture-live.mjs                  append what is new in every live transcript source to live/
    live-chunks.mjs                   read live/: run manifests, capture state, files reassembled from chunks
    secret-patterns.mjs               the credential shapes and the redaction both capture tools apply
    transcripts-to-dataset.mjs        derive agents.jsonl, messages.jsonl, stats.json, and the README pair from a raw tree or live/
  live/
    runs/<date>/<time>.json           one manifest per capture run: every chunk it wrote
    <source>/<date>/<file>/e<epoch>/<date>/<seq>.<ext>.gz
                                      one immutable chunk: whole lines of one source file, redacted
  <date>-<label>/
    README.md, README.zh.md           generated provenance of that build: session id, repository head, counts
    agents.jsonl                      one record per transcript
    messages.jsonl                    one record per conversational message
    stats.json                        corpus totals and the subagent duration distribution
    raw/
      manifest.json                   session id, source directory, repository head, per-file bytes and SHA-256
      orchestrator-session.jsonl      the orchestrating session, as line-split parts above 40 MiB
      subagents/                      one JSONL transcript and one descriptor per background agent
      tool-results/                   tool output the session saved to disk when it overflowed a result
```

## 采集一次构建

在被采集的会话内部、从仓库根目录运行，或用 `--session` 与 `--projects-dir` 指明会话及其项目目录：

```sh
node data/transcripts/tools/collect-claude-code-session.mjs --out data/transcripts/2026-09-06-build/raw
node data/transcripts/tools/transcripts-to-dataset.mjs data/transcripts/2026-09-06-build/raw data/transcripts/2026-09-06-build
pnpm run verify-translation-pairing --write data/transcripts/2026-09-06-build/README.md
```

采集器以三种方式之一处理形似凭证的字符串：`--accept-hit <sha256>` 将已审阅的占位符逐字保留，`--redact <pattern>`（一个 `SECRET_PATTERNS` 名称，如 `openrouter-key`）把匹配遮蔽为 `[REDACTED-<PATTERN>]`，从而让操作者自己消息中携带的真实凭证在去除机密后仍能被保存，其余情况则拒绝写入——被拒绝的运行会打印每个未处理的匹配以及可传入的两个参数。写入之后会重新扫描整棵目录树，任何不是已接受占位符的凭证形状都会删除该目录树并失败，因此漏掉一处遮蔽也绝不会提交出机密；被接受的摘要与 `redactions` 区块都记录在 `manifest.json` 中。它在行边界处拆分超过 40 MiB 的文件，使任何 blob 都不超过 GitHub 的单文件上限，记录每个文件的摘要，并对未变化的目录树不做任何改动，因此可以在构建期间反复运行而不产生噪音。原始目录树、重新生成的数据集和重新记录的配对要一起提交。

## 实时捕获

运行这些会话的容器会在没有预告的情况下被重置，重置会抹去已推送分支之外的所有文件。因此 [`scripts/transcripts-capture.sh`](../../scripts/transcripts-capture.sh) 每隔 `TRANSCRIPTS_CAPTURE_MINUTES`（默认 5）分钟运行一次 `tools/capture-live.mjs` 并推送它写下的内容，使一次重置至多丢失一个间隔。默认来源是 `~/.claude/projects` 下的每个 Claude Code 项目目录（操作者的会话、它的 subagent 与工具结果，以及部门、评审者、intake 协调者和 bench 单元的会话）、`/tmp/dsh-enterprise` 下 enterprise 正在进行的 shift 与 intake 的 `.sessions` 目录和运行日志、`/home/user/enterprise-cycles` 中的 cycle 与调度器日志、`/tmp/nightly-loop.log`，以及 bench 的 `.proving-ground/runs` 下的日志；`--source` 会替换这份列表。

每次运行只把自上次运行以来新增的内容作为不可变的 gzip 块追加到 `live/` 下，并写入一份清单 `live/runs/<date>/<time>.json`，逐块列出其来源路径、epoch 与序号、字节与行范围、所存字节以及它所结束的来源前缀的 SHA-256、它的遮蔽，以及捕获时间。捕获状态只从这些清单读出，因此重置之后的全新克隆会从最后一次已推送的运行停下的地方继续。一个块只包含完整的行；没有换行符的最后一行要等到文件在 `--settle-seconds` 内不再变化才会被捕获。一个文件若不再以已捕获的字节开头，例如服务器从其最后一次压缩处恢复的会话日志，就从字节 0 开始一个新的 epoch，更早 epoch 的块保持不动。每个文件每次运行超过 `--max-file-bytes` 的新字节，以及超过 `--max-run-bytes` 之后的文件，会推迟到下一次运行，并有一行日志点名它们。

凭证形状与采集器相同：两个工具都导入 [`tools/secret-patterns.mjs`](tools/secret-patterns.mjs)。实时块永远不会被拒绝，因为拒绝就会丢失 transcript：每个匹配都被遮蔽为 `[REDACTED-<PATTERN>]`，并计入该块和该次运行的 `redactions`；已采集构建作为占位符接受的摘要（其 `acceptedHits`）逐字保留；纯文本日志中的 PEM 私钥块即使被块边界切开也会被遮蔽。遮蔽后的块会再扫描一次，任何剩余的未接受匹配都会在写入清单之前终止该次运行，因此循环不会从中提交任何内容。

该循环在一个专用 worktree 中、在单实例锁下运行，只把 `data/transcripts/live/` 提交为 `chore(transcripts): live capture <UTC stamp>`，设置了 `ENTERPRISE_COMMIT_TRAILERS` 时附加在后，并通过 fetch、`git pull --rebase` 和 push 推送，在 2、4、8 和 16 秒后重试；没有到达远端的提交随下一轮一起推送。它的提交和推送都传 `--no-verify`：pre-push 钩子会对整个工作区做约三分钟的类型检查，超过间隔的一半，而一次捕获提交只包含机器写出的块和清单，没有任何钩子检查它们，这正是 [enterprise shift 引擎](../../.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md) 为其自身数据提交给出的理由。只改动 transcript 数据的推送不会启动 Branch CI。重置之后，把操作者的 trailer 放进 `trailers`，再这样启动它：

```sh
git -C /home/user/deepseek-harness worktree add /home/user/deepseek-harness/.claude/worktrees/transcripts-capture -B transcripts-capture origin/claude/coding-agent-harness-u9l4gt
cd /home/user/deepseek-harness/.claude/worktrees/transcripts-capture
ENTERPRISE_COMMIT_TRAILERS="$trailers" nohup setsid bash scripts/transcripts-capture.sh >> /home/user/enterprise-cycles/transcripts-capture.log 2>&1 < /dev/null &
node data/transcripts/tools/transcripts-to-dataset.mjs data/transcripts/live <out-dir> --session <session id>
```

最后一条命令从一个 Claude Code 会话的实时块派生数据集。[LOSSES.md](LOSSES.md) 说明 2026-09-28 的容器重置在实时捕获出现之前抹去了什么，以及什么留存了下来。

## 这些数据是什么、不是什么

- 原始目录树是逐字的：消息文本、工具输入、工具结果、token 用量和时间都与 Claude Code 记录的一致，包括 harness 上下文提醒中携带的操作者账户邮箱。形似凭证的字符串会被拒绝，除非其摘要作为占位符被接受、或其模式被遮蔽——那时只有该匹配被遮蔽；其余内容不作改写。
- 实时块就是来源字节，只是除已接受的占位符外，每个凭证形状都被遮蔽；清单统计每一处遮蔽。
- 数据集去掉了工具结果正文并遮蔽了形似凭证的字符串；每次构建生成的 README 给出其计数和数据质量说明。
- 这些 transcript 是 Claude 的输出。根据 Anthropic 的使用政策，它们不得用于训练或微调竞争模型；请将其用于分析、过程挖掘、失败分类，以及使用虚构实体的环境合成。Daliesk 模型的 RLVR 语料来自 harness 自身在条款允许的路由上完成的经认证运行，经由[数据使用条款](../../packages/governance/data-use/README.md)和 [curator](../../packages/governance/curator/README.md)。

## 构建列表

| 目录 | 会话 | Transcript | 消息 | 时间跨度 |
| --- | --- | --- | --- | --- |
| [2026-09-06-build](2026-09-06-build/README.md) | `f53f80cc-1f77-5d02-a862-99d59ffabdce` | 1 个编排会话 + 71 个 subagent | 32,148 | 2026-08-29 至 2026-09-06 |
| [2026-09-28-postreset](2026-09-28-postreset/README.md) | `f53f80cc-1f77-5d02-a862-99d59ffabdce` | 1 个编排会话（自其 2026-09-28T20:15Z 恢复边界起）+ 5 个 subagent | 见其 README | 2026-09-28，22:07Z 容器重置之后 |

2026-09-06 构建是设计并落地改进接缝的那次会话：environments、runner、fleet、shifts、experiments、scorekeeper、observatory、program、trajectories、读屏障、验证仪器、盲评 judge、治理和 curator，以及 Village 与竞争基线研究。它的原始目录树取代了同日交付给操作者的两部分归档：该归档中的 transcript 都是这里文件的前缀，其溢出捕获就是 `tool-results/` 条目。

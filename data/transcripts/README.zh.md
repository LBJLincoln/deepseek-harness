# 过程 transcript

[English](README.md) | 中文

构建本仓库的 agent 会话的完整 transcript（文本记录），保存在它们所构建的仓库里。每个构建目录都包含从操作者机器上采集的原始 Claude Code 会话目录树，以及由它派生的紧凑数据集。它们存在的目的是让这个 harness 的制作过程一点都不丢失：每一条提示、每一次工具调用和每一份报告都在这里，可供挖掘过程模式、失败分类和环境合成。

## Layout

```
data/transcripts/
  tools/
    collect-claude-code-session.mjs   snapshot one live Claude Code session into <build>/raw/
    transcripts-to-dataset.mjs        derive agents.jsonl, messages.jsonl, stats.json, and the README pair from a raw tree
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

只要源文件中还有任何形似凭证的字符串没有对应的 `--accept-hit <sha256>` 指明已审阅的匹配，采集器就拒绝写入；被拒绝的运行会打印每个匹配及应传入的参数，被接受的摘要记录在 `manifest.json` 中。它在行边界处拆分超过 40 MiB 的文件，使任何 blob 都不超过 GitHub 的单文件上限，记录每个文件的摘要，并对未变化的目录树不做任何改动，因此可以在构建期间反复运行而不产生噪音。原始目录树、重新生成的数据集和重新记录的配对要一起提交。

## 这些数据是什么、不是什么

- 原始目录树是逐字的：消息文本、工具输入、工具结果、token 用量和时间都与 Claude Code 记录的一致，包括 harness 上下文提醒中携带的操作者账户邮箱。形似凭证的字符串会被拒绝，而不会被改写。
- 数据集去掉了工具结果正文并遮蔽了形似凭证的字符串；每次构建生成的 README 给出其计数和数据质量说明。
- 这些 transcript 是 Claude 的输出。根据 Anthropic 的使用政策，它们不得用于训练或微调竞争模型；请将其用于分析、过程挖掘、失败分类，以及使用虚构实体的环境合成。Daliesk 模型的 RLVR 语料来自 harness 自身在条款允许的路由上完成的经认证运行，经由[数据使用条款](../../packages/governance/data-use/README.md)和 [curator](../../packages/governance/curator/README.md)。

## 构建列表

| 目录 | 会话 | Transcript | 消息 | 时间跨度 |
| --- | --- | --- | --- | --- |
| [2026-09-06-build](2026-09-06-build/README.md) | `f53f80cc-1f77-5d02-a862-99d59ffabdce` | 1 个编排会话 + 71 个 subagent | 32,148 | 2026-08-29 至 2026-09-06 |

2026-09-06 构建是设计并落地改进接缝的那次会话：environments、runner、fleet、shifts、experiments、scorekeeper、observatory、program、trajectories、读屏障、验证仪器、盲评 judge、治理和 curator，以及 Village 与竞争基线研究。它的原始目录树取代了同日交付给操作者的两部分归档：该归档中的 transcript 都是这里文件的前缀，其溢出捕获就是 `tool-results/` 条目。

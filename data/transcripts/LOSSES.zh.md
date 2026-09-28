# Transcript 损失

[English](LOSSES.md) | 中文

2026-09-28 的容器重置从 transcript 记录中抹去了什么、什么留存了下来、它们在哪里。每一条陈述都引用分支上的一个提交或文件；证据无法界定的地方，本页会明说。从 2026-09-28T22:54Z 起，[实时捕获](README.md#live-capture)每五分钟推送一次每个来源。

## 编排会话日志，2026-09-23T00:28Z 至 2026-09-28T20:15Z

操作者会话 `f53f80cc-1f77-5d02-a862-99d59ffabdce` 的最后一次采集运行于 2026-09-23T00:28:11Z（[`2026-09-06-build/raw/manifest.json`](2026-09-06-build/raw/manifest.json)，提交 `06ea22974`）；其编排会话日志为 205,621,108 字节，最后一行的时间戳是 2026-09-23T00:27:54Z。此后没有再做副本：Routine“Hourly transcript snapshot into data/transcripts”（`trig_01U95vY7sQkhEm4SxJyKQacw`）最后一次触发于 2026-09-19T09:41Z，其最后一个提交是 `ef6297fb7`，并自当天 10:14Z 起一直处于禁用状态。22:07Z 的重置抹去了本地日志。随后服务器只从其最后一个压缩边界处恢复了它：恢复后日志的第一行时间戳是 2026-09-28T20:15:54Z，其压缩边界是 20:17:56Z（[`2026-09-28-postreset/raw/orchestrator-session.jsonl`](2026-09-28-postreset/raw/orchestrator-session.jsonl)，提交 `a9e2968fe`）。

该日志在 2026-09-23T00:27:54Z 与 2026-09-28T20:15:54Z 之间所含的一切，都已从机器和仓库中消失。claude.ai 会话 `session_01HEXjzxR7CyMizem5kFAB4C` 在服务器端仍保存着这段对话，但本会话拥有的任何工具都无法把它读回：Claude Code Remote 工具返回的是会话的元数据（标题、状态、模型字段），而不是它的消息。在仓库内部，关于这段时间的唯一记述是恢复后日志开头的压缩摘要。

## 同一时间段内的每一份 subagent transcript

2026-09-23 的采集包含 146 份 subagent transcript 及其 146 个描述文件，以及 84 个保存下来的工具结果。编排会话在 2026-09-23T00:28Z 之后、重置之前启动的每一个 subagent 都已消失：它的 transcript、它的描述文件，以及编排会话在这段时间保存到磁盘的工具结果。重置之后，会话的 `subagents/` 目录只包含 22:07Z 之后启动的 agent，也就是重置后快照中的那五个。这段时间内运行过多少个 subagent，没有记录在任何留存下来的地方。它们的工作以提交的形式留存：2026-09-23T00:28Z 与 2026-09-28T22:07Z 之间有 95 个提交到达分支，每个都带有该会话的 `Claude-Session:` trailer（`git log --since=2026-09-23T00:28Z --until=2026-09-28T22:07Z`）。

## 被重置打断的 shift

cycle `cycle-20260928T201148Z` 在 20:11:51Z 推送了它的 intake（提交 `7ec9cecb3`，`data/enterprise/intake/2026-09-28-201151-a5d5/result.json`），并在 20:14:48Z 以 `T-0001` 和 `T-0005` 启动了 shift `201448-94fd`，恢复后的编排会话日志如此记录（“The first shift is still working on T-0001 and T-0005”；“Cycle 1 (20:11Z) was lost to the 22:07Z container reset mid-shift (T-0001/T-0005 unrecorded)”）。一个 shift 只在结束时才提交它的账本行和记录（含会话日志）。`data/enterprise/ledger.jsonl` 中没有 `201448-94fd` 的任何一行，`data/enterprise/shifts/` 中也没有它的记录，因此它在 `/tmp/dsh-enterprise/201448-94fd/.sessions` 下的部门、评审和集成会话日志、其部门的 Claude Code 会话、它的 `run.log`，以及 cycle 日志 `cycle-20260928T201148Z.log` 全部消失。两张工单都保持打开，因为没有任何一行关闭它们，下一个 cycle 又领取了 `T-0001`。

## 2026-09-28 约 02:34Z 的重启

Git 历史界定了同一天更早的一次重启。它之前的最后一次推送是 `6fb91bb11`，提交于 00:40:38Z；下一次是 16:41:19Z 的 `a9438505d`，其消息说 nightly loop 在 02:34 UTC 写下了它的记录和账本行，而“the container restart that followed stopped the Routine before it committed them”。检出目录及其未推送的提交在那次重启中留存了下来：在 00:30Z 到 01:57Z 之间撰写的提交（其中包括 `f20b16f57`、`c27b3ef46`、`4cba33a65`）以及 loop 在 02:34Z 写下的记录，在 16:41Z 到 16:47Z 之间到达了分支。scratch 磁盘没有留存：`c27b3ef46` 记录了一次 code-safety 运行“lost with the session's scratch disk before it was copied out”。那次重启是否抹去了某份 transcript，无法从 git 中读出；它可能触及的每一份 transcript 都落在 22:07Z 重置所抹去的时间段内，因此已计入上文。

## 留存下来的内容

- 2026-09-06 构建（[`2026-09-06-build/`](2026-09-06-build/README.md)）：从 2026-08-29 到 2026-09-23T00:27:54Z 的编排会话日志、146 份 subagent transcript 和 84 个工具结果。
- 重置后的快照（[`2026-09-28-postreset/`](2026-09-28-postreset/README.md)，提交 `a9e2968fe`）：从 20:15:54Z 恢复边界开始的编排会话日志，以及 22:07Z 之后启动的五个 subagent。
- 已经结束的 shift `171951-516d` 和 `182951-78a6`，连同它们在 `data/enterprise/shifts/` 下的会话日志，以及每一条账本行（[`data/enterprise/`](../enterprise/README.md)）。
- 从 2026-09-28T22:54Z 起的实时捕获（提交 `541b9f1b5` 以及循环的 `chore(transcripts): live capture` 提交）：[实时捕获](README.md#live-capture)列出的每个来源，包括 22:13Z cycle 的 shift `221520-e979` 的会话和该 cycle 的日志。

## 尚未进入分支的内容

22:13Z cycle 的 shift `221520-e979` 于 22:55:04Z 以退出码 2 结束，它在 cycle 日志中的结果行写着 `"pushed": null`：引擎的第三次也是最后一次推送被克隆的 pre-push 钩子拒绝，因为克隆没有 `node_modules`，钩子中的工作区类型检查在那里失败了。它的账本行和记录只作为提交 `c1bbfb376` 存在于克隆 `/tmp/dsh-enterprise/221520-e979/repo` 中，一次重置就会把它抹去。实时捕获保存了该 shift 的会话日志、其部门的 Claude Code 会话，以及带有完整结果行的 cycle 日志，因此证据得以保留；在它的账本行被推送之前，账本不会显示这个 shift。

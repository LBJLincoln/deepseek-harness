# Transcript losses

English | [中文](LOSSES.zh.md)

What the container resets of 2026-09-28 erased from the transcript record, what survived, and where it is. Every statement cites a commit or a file on the branch; where the evidence does not bound something, this page says so. From 2026-09-28T22:54Z on, the [live capture](README.md#live-capture) pushes every source every five minutes.

## The orchestrator log, 2026-09-23T00:28Z to 2026-09-28T20:15Z

The last collection of the operator's session `f53f80cc-1f77-5d02-a862-99d59ffabdce` ran at 2026-09-23T00:28:11Z ([`2026-09-06-build/raw/manifest.json`](2026-09-06-build/raw/manifest.json), commit `06ea22974`); its orchestrator log is 205,621,108 bytes and its last line is stamped 2026-09-23T00:27:54Z. No later copy was made: the Routine "Hourly transcript snapshot into data/transcripts" (`trig_01U95vY7sQkhEm4SxJyKQacw`) last fired at 2026-09-19T09:41Z, its last commit is `ef6297fb7`, and it has been disabled since 10:14Z that day. The reset at 22:07Z erased the local log. The server then restored it from its last compaction boundary only: the restored log's first line is stamped 2026-09-28T20:15:54Z and its compaction boundary 20:17:56Z ([`2026-09-28-postreset/raw/orchestrator-session.jsonl`](2026-09-28-postreset/raw/orchestrator-session.jsonl), commit `a9e2968fe`).

Everything the log held between 2026-09-23T00:27:54Z and 2026-09-28T20:15:54Z is gone from the machine and from the repository. The claude.ai session `session_01HEXjzxR7CyMizem5kFAB4C` still holds that conversation server-side, but no tool this session has can read it back: the Claude Code Remote tools return a session's metadata (title, status, model fields), not its messages. Inside the repository, the only account of that window is the compaction summary at the start of the restored log.

## Every subagent transcript of the same window

The 2026-09-23 collection holds 146 subagent transcripts with their 146 descriptors and 84 saved tool results. Every subagent the orchestrator started after 2026-09-23T00:28Z and before the reset is gone: its transcript, its descriptor, and the tool results the orchestrator saved to disk in that window. After the reset the session's `subagents/` directory held only agents started after 22:07Z, the five the post-reset snapshot holds. How many subagents ran in the window is recorded nowhere that survived. Their work survives as commits: 95 commits reached the branch between 2026-09-23T00:28Z and 2026-09-28T22:07Z, each carrying the session's `Claude-Session:` trailer (`git log --since=2026-09-23T00:28Z --until=2026-09-28T22:07Z`).

## The shift the reset interrupted

The cycle `cycle-20260928T201148Z` pushed its intake at 20:11:51Z (commit `7ec9cecb3`, `data/enterprise/intake/2026-09-28-201151-a5d5/result.json`) and started the shift `201448-94fd` at 20:14:48Z on `T-0001` and `T-0005`, as the restored orchestrator log records ("The first shift is still working on T-0001 and T-0005"; "Cycle 1 (20:11Z) was lost to the 22:07Z container reset mid-shift (T-0001/T-0005 unrecorded)"). A shift commits its ledger lines and its record, session logs included, only when it finishes. `data/enterprise/shifts/` holds no record of `201448-94fd`; the supervisor appended its two ledger lines after the fact (lines 168 and 169 of `data/enterprise/ledger.jsonl`, commit `580d9e688`), closing `T-0001` and `T-0005` as abandoned in the container reset with `recordedBy: supervisor`. Its department, review and integration session logs under `/tmp/dsh-enterprise/201448-94fd/.sessions`, the Claude Code sessions of its departments, its `run.log`, and the cycle log `cycle-20260928T201148Z.log` are all gone. Both tickets stayed open until those lines, and the next cycle took `T-0001` again.

## The restart around 02:34Z on 2026-09-28

Git history bounds an earlier restart the same day. The last push before it is `6fb91bb11`, committed at 00:40:38Z; the next is `a9438505d` at 16:41:19Z, whose message says the nightly loop wrote its record and ledger line at 02:34 UTC and "the container restart that followed stopped the Routine before it committed them". The checkout and its unpushed commits survived that restart: commits authored between 00:30Z and 01:57Z (`f20b16f57`, `c27b3ef46`, `4cba33a65` among them) and the loop's 02:34Z record reached the branch between 16:41Z and 16:47Z. The scratch disk did not survive: `c27b3ef46` records a code-safety run "lost with the session's scratch disk before it was copied out". Whether that restart erased a transcript cannot be read from git; every transcript it could have touched lies inside the window the 22:07Z reset erased, so it is counted above.

## What survived

- The 2026-09-06 build ([`2026-09-06-build/`](2026-09-06-build/README.md)): the orchestrator log from 2026-08-29 to 2026-09-23T00:27:54Z, 146 subagent transcripts and 84 tool results.
- The post-reset snapshot ([`2026-09-28-postreset/`](2026-09-28-postreset/README.md), commit `a9e2968fe`): the orchestrator log from its 20:15:54Z restore boundary and the five subagents started after 22:07Z.
- The shifts that finished, `171951-516d` and `182951-78a6`, with their session logs under `data/enterprise/shifts/`, and every ledger line ([`data/enterprise/`](../enterprise/README.md)).
- The live capture from 2026-09-28T22:54Z (commit `541b9f1b5` and the loop's `chore(transcripts): live capture` commits): every source the [live capture](README.md#live-capture) names, including the sessions of the 22:13Z cycle's shift `221520-e979` and that cycle's log.

## Not yet on the branch

The 22:13Z cycle's shift `221520-e979` ended at 22:55:04Z with exit 2, and its result line in the cycle log reads `"pushed": null`: the engine's third and last push round was refused by the clone's pre-push hook, whose workspace typecheck failed there because the clone has no `node_modules`. Its ledger lines and record exist only as commit `c1bbfb376` in the clone `/tmp/dsh-enterprise/221520-e979/repo`, which a reset would erase. The live capture holds the shift's session logs, its departments' Claude Code sessions, and the cycle log with the whole result line, so the evidence is kept; the ledger does not show the shift until its lines are pushed.

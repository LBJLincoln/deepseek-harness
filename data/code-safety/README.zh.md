# 代码安全运行记录

[English](README.md) | 中文

真实代码安全评审的记录：一次 program 一条记录，完全按 harness 发布时的样子保存。一条记录包含 program 发布的报告、其背后的发现并集、已提交的审查器对合并后 HEAD 给出的裁定、全部会话日志，以及一份携带仓库 HEAD、组合、锁定目标与每个文件摘要的 manifest。记录写下之后不再编辑；下面的表格是从这些文件里读出来的。 记录在提交之前只改动一处：部门从目标中读出的私钥材料与示例云密钥，在发现、结果与会话日志中被替换为脱敏标记，`manifest.json` 在 `redactions` 下列出改动了哪些文件、多少个区块；审查器验证过的那些行从不在其列。

program 是 [`examples/headless-agent/tests/fixtures/program-code-safety/`](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md)，那里同时记载了一条发现必须是什么，以及审查器拒绝什么。

## 目录结构

```
data/code-safety/
  <date>-<target>/
    manifest.json      repository head, composition, locked target, per-department outcome, findings per severity and confidence, per-file bytes and SHA-256
    result.json        the driver's result line: the ledger, the member sessions, the barrier refusals, the released file list
    SAFETY-REPORT.md   the report the program released, verbatim
    findings.json      the union of every department's findings, as released
    verifier.txt       the committed examiner's exit code and output over the released worktree
    stderr.txt         what the driver wrote to stderr, when it wrote anything
    sessions/          every session log: the ledger, the six departments and the integration, named by session id
  targets/<target>.ground-truth.json   a target's own documented defects, for reading a record's recall against; never part of the release gate
  tools/record-run.mjs                 copies one run directory into a record and writes its manifest
  tools/recall.mjs                     reads a record's recall against a ground-truth list; never part of the release gate
  tools/compare.mjs                    scores any findings list against a ground truth, the rule recall.mjs uses, for a cross-tool comparison
  tools/trajectory.mjs                 reads a record's session logs for its provenance and each finding's read trail
  tools/assemble-comparison.mjs        assembles one target's three-tier comparison into comparisons/<date>-<target>/comparison.json
  comparisons/<date>-<target>/         a target reviewed three ways — a scanner, one model, the enterprise — scored against one ground truth
```

## 如何运行与记录

```sh
pnpm run code-safety -- /path/to/target --out .code-safety/<name> --model sonnet
node data/code-safety/tools/record-run.mjs .code-safety/<name> <date>-<target> \
  --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml
```

记录器拒绝覆盖已有记录。记录完成后在下表添加一行，并把运行所暴露的一切——轮次耗尽的部门、始终未能通过审查器的集成——原样留在旁边，而不是反复重跑直到看起来漂亮。

## 运行

| 运行 | HEAD | 目标 | 模型 | 已认证 | 发现数 | 审查器 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [2026-09-19-nodegoat](2026-09-19-nodegoat/manifest.json) | `be507df30` | OWASP NodeGoat，111 个文件 | `sonnet` | 7 of 7 | 42 (5 critical, 17 high, 13 medium, 5 low, 2 info) | 退出码 0 | 1301 s |
| [2026-09-19-dvja](2026-09-19-dvja/manifest.json) | `3d386bac2` | dvja（Java，Struts 2 与 Spring），174 个文件 | `sonnet` | 7 of 7 | 40 (9 critical, 10 high, 13 medium, 7 low, 1 info) | 退出码 0 | 1414 s |
| [2026-09-19-nodegoat-2](2026-09-19-nodegoat-2/manifest.json) | `5a59895fa` | OWASP NodeGoat，111 个文件，经由 feed 的 `POST /safety` 启动 | `sonnet` | 7 of 7 | 38 (4 critical, 16 high, 14 medium, 4 low) | 退出码 0 | 1225 s |
| [2026-09-21-nodegoat-3](2026-09-21-nodegoat-3/manifest.json) | `a47c8f519` | OWASP NodeGoat，111 个文件，经由托管镜像中继的 `POST /safety` 启动 | `sonnet` | 7 of 7 | 47 (4 critical, 18 high, 17 medium, 7 low, 1 info) | 退出码 0 | 1356 s |

## 一条记录证明了什么

它证明：`findings.json` 中的每条发现，在审查器运行的那一刻，确实存在于 `manifest.json` 所锁定的那棵树中它所引用的那一行；报告自身的计数就是并集的计数；以及没有任何部门报告过的东西在未被点名的情况下被丢弃。它不证明某条列出的发现可被利用，不证明某个未列出的缺陷不存在，也不证明这次评审读过任何它没有声称读过的文件。每份报告中的 `## Scope and method` 与 `## What was not covered` 正是这些边界，它们也因此成为记录的一部分。

一条记录针对目标已记载缺陷的召回率，是一项独立的读数，取自记录旁边的 `targets/<target>.ground-truth.json`，而不在发布关口之内：一个给召回率打分的关口只能在缺陷已知的目标上运行，而那并非本 program 存在的场景。`node data/code-safety/tools/recall.mjs <record> <ground truth>` 打印这一读数：当某条已发布的发现引用了已知问题的文件、且行号在其范围三行之内，或落在基准真值为同一缺陷列出的其他位置之一，该问题即算被找到。在 NodeGoat 记录上它读出 18 之 14：审查错过的四个是登录路径上的日志注入、会枚举用户的两种不同错误消息、只要一个字符的密码策略，以及路由号上的灾难性正则表达式；而 42 条已发布发现中有 12 条是基准真值未列出的缺陷，其中包括重置脚本植入的硬编码管理员密码、提交在 `artifacts/` 下的私钥、登录时未再生的会话，以及从锁文件中读出的依赖公告。dvja 记录（一个 Java Struts 2 应用，174 个文件，在各部门被要求先运行 semgrep 之前审查）读出 14 之 13：审查唯一错过的是信任调用方提供的用户 id 的资料更新，其 40 条发现中有 14 条在列表之外，其中包括 Log4Shell 时代的 log4j、仅由 cookie 把关的全体用户个人数据批量导出，以及提交在 compose 文件里的 root 密码。

对同一 NodeGoat 修订版、在同一组合上、相隔三小时的两次审查，是可重复性的读数：第二次发布 38 条发现，第一次为 42 条；第一次 42 条中有 38 条在第二次运行里于同一文件三行之内有对应发现，其中 31 条 CWE 相同，第二次 38 条中有 33 条在第一次里有对应；两次都读出 18 之 14，错过的四个相同，且共同引用了 15 个文件。两次运行的差别在低严重度的尾部以及一个缺陷被拆成几条发现的方式上，而不在经认证的核心。第三次 NodeGoat 审查于 2026-09-21 在同一组合上、经由托管镜像中继启动，发布 47 条发现，读出 18 之 13；错过的在 session（三处）、research 与 profile 路由上。

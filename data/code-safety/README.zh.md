# 代码安全运行记录

[English](README.md) | 中文

真实代码安全评审的记录：一次 program 一条记录，完全按 harness 发布时的样子保存。一条记录包含 program 发布的报告、其背后的发现并集、已提交的审查器对合并后 HEAD 给出的裁定、全部会话日志，以及一份携带仓库 HEAD、组合、锁定目标与每个文件摘要的 manifest。记录写下之后不再编辑；下面的表格是从这些文件里读出来的。 记录在提交之前只改动一处：部门从目标中读出的私钥材料与示例云密钥，在发现、结果与会话日志中被替换为脱敏标记，`manifest.json` 在 `redactions` 下列出改动了哪些文件、多少个区块；审查器验证过的那些行从不在其列。

program 是 [`examples/headless-agent/tests/fixtures/program-code-safety/`](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md)，那里同时记载了一条发现必须是什么，以及审查器拒绝什么。

## 目录结构

```
data/code-safety/
  <date>-<target>/
    manifest.json      repository head and the paths dirty at record time, composition, knowledge-pack digest, locked target, per-department outcome, findings per severity and confidence, per-file bytes and SHA-256, redactions
    result.json        the driver's result line: the ledger, the member sessions, the barrier refusals, the released file list
    SAFETY-REPORT.md   the report the program released, verbatim
    findings.json      the union of every department's findings, as released
    verifier.txt       the committed examiner's exit code and output over the released worktree
    stderr.txt         what the driver wrote to stderr, when it wrote anything
    sessions/          every session log: the ledger, the six departments and the integration, named by session id
  targets/<target>.ground-truth.json   a target's own documented defects, for reading a record's recall against; never part of the release gate
  tools/record-run.mjs                 copies one run directory into a record, redacts it, and writes its manifest
  tools/redact-record.mjs              replaces private-key bodies and example cloud keys in a record and refreshes its manifest; record-run.mjs runs it before digesting
  tools/redact-record.cases.mjs        one behavior case per private-key shape the tool covers; scripts/code-safety-redaction.spec.ts runs it under plain Node
  tools/recall.mjs                     reads a record's recall against a ground-truth list; never part of the release gate
  tools/compare.mjs                    scores any findings list against a ground truth, the rule recall.mjs uses, for a cross-tool comparison
  tools/trajectory.mjs                 reads a record's session logs for its provenance and each finding's read trail
  tools/assemble-comparison.mjs        assembles one target's three-tier comparison into comparisons/<date>-<target>/comparison.json
  tools/seed-defects.mjs               plants N defects drawn from the mutation catalogue into a copy of a target, for seeded-recall estimation; never part of the release gate
  tools/seeded-recall.mjs              scores a findings list against a seed-defects.mjs ground truth, with a Wilson 95% interval, overall and per CWE class
  tools/seed-catalogue.json            the mutation catalogue seed-defects.mjs draws from: one CWE class, language, site pattern, and insertion template per entry
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
| [2026-09-22-nodegoat-4-improved](2026-09-22-nodegoat-4-improved/manifest.json) | `c0efe64a3` | OWASP NodeGoat，111 个文件，改进循环的第一次迭代：在[三层对比](comparisons/2026-09-22-nodegoat/README.md)之后拓宽了注入技能 | `sonnet` | 7 of 7 | 44 (6 critical, 18 high, 12 medium, 7 low, 1 info) | 退出码 0 | 1426 s |
| [2026-09-22-nodegoat-5-generalist-a](2026-09-22-nodegoat-5-generalist-a/manifest.json) | `192758404` | OWASP NodeGoat，111 个文件，循环的第二次迭代以配对方式运行，第一个 `with` 臂：在六个专科部门之外加上通才部门（`--with-generalist`） | `sonnet` | 8 of 8 | 49 (9 critical, 18 high, 12 medium, 10 low, 0 info) | 退出码 0 | 1533 s |
| [2026-09-22-nodegoat-6-base-a](2026-09-22-nodegoat-6-base-a/manifest.json) | `f59f7a70c` | OWASP NodeGoat，111 个文件，同一配对的第一个 `without` 臂：只有六个专科部门，紧接在 `with` 臂之后、使用同一知识包运行 | `sonnet` | 7 of 7 | 57 (7 critical, 16 high, 17 medium, 16 low, 1 info) | 退出码 0 | 1383 s |
| [2026-09-22-nodegoat-7-generalist-b](2026-09-22-nodegoat-7-generalist-b/manifest.json) | `af1f81270` | OWASP NodeGoat，111 个文件，同一配对的第二个 `with` 臂 | `sonnet` | 8 of 8 | 44 (7 critical, 15 high, 13 medium, 6 low, 3 info) | 退出码 0 | 1556 s |

## 一条记录证明了什么

它证明：`findings.json` 中的每条发现，在审查器运行的那一刻，确实存在于 `manifest.json` 所锁定的那棵树中它所引用的那一行；报告自身的计数就是并集的计数；以及没有任何部门报告过的东西在未被点名的情况下被丢弃。它不证明某条列出的发现可被利用，不证明某个未列出的缺陷不存在，也不证明这次评审读过任何它没有声称读过的文件。每份报告中的 `## Scope and method` 与 `## What was not covered` 正是这些边界，它们也因此成为记录的一部分。

一条记录针对目标已记载缺陷的召回率，是一项独立的读数，取自记录旁边的 `targets/<target>.ground-truth.json`，而不在发布关口之内：一个给召回率打分的关口只能在缺陷已知的目标上运行，而那并非本 program 存在的场景。`node data/code-safety/tools/recall.mjs <record> <ground truth>` 打印这一读数：当某条已发布的发现引用了已知问题的文件、且行号在其范围三行之内，或落在基准真值为同一缺陷列出的其他位置之一，该问题即算被找到。在 NodeGoat 记录上它读出 18 之 14：审查错过的四个是登录路径上的日志注入、会枚举用户的两种不同错误消息、只要一个字符的密码策略，以及路由号上的灾难性正则表达式；而 42 条已发布发现中有 12 条是基准真值未列出的缺陷，其中包括重置脚本植入的硬编码管理员密码、提交在 `artifacts/` 下的私钥、登录时未再生的会话，以及从锁文件中读出的依赖公告。dvja 记录（一个 Java Struts 2 应用，174 个文件，在各部门被要求先运行 semgrep 之前审查）读出 14 之 13：审查唯一错过的是信任调用方提供的用户 id 的资料更新，其 40 条发现中有 14 条在列表之外，其中包括 Log4Shell 时代的 log4j、仅由 cookie 把关的全体用户个人数据批量导出，以及提交在 compose 文件里的 root 密码。

对同一 NodeGoat 修订版、在同一组合上、相隔三小时的两次审查，是可重复性的读数：第二次发布 38 条发现，第一次为 42 条；第一次 42 条中有 38 条在第二次运行里于同一文件三行之内有对应发现，其中 31 条 CWE 相同，第二次 38 条中有 33 条在第一次里有对应；两次都读出 18 之 14，错过的四个相同，且共同引用了 15 个文件。两次运行的差别在低严重度的尾部以及一个缺陷被拆成几条发现的方式上，而不在经认证的核心。第三次 NodeGoat 审查于 2026-09-21 在同一组合上、经由托管镜像中继启动，发布 47 条发现，读出 18 之 13；错过的在 session（三处）、research 与 profile 路由上。

## 没有基准真值时的召回率：seeded defects（预埋缺陷）

`targets/nodegoat.ground-truth.json` 与 dvja 的对应文件是仅有的两份带有已记载缺陷列表的目标，因为它们是仅有的两个被数过的目标。客户自己的应用两者皆无，因此对它的一次审查发布的发现数与严重度列表，没有任何东西可供比对。**seeded-defect（canary）估计法**仍能给出一个读数：在目标的一份完整副本里，向记录在案的位置植入已知数量的合成缺陷实例；在这份副本上运行审查，且不告知它这一点；用 `compare.mjs` 与 `recall.mjs` 已经使用的同一条三行容差规则，为已发布发现落在这些植入位置上的比例打分。这个比例就是该代码库上、针对这些类别的召回率估计，并附带一个置信区间。

`tools/seed-defects.mjs` 从 `tools/seed-catalogue.json` 里的一份**缺陷变异目录**中取样植入：每个条目命名一个 CWE、一种语言、一个用于找到真实插入位置的正则表达式，以及一个在该位置添加一行代码的字符串模板。该目录八个 JavaScript/Express 条目中的七个共用同一个位置——任何已经读取 `req.query`/`req.body`/`req.params.<field>` 的行——并在其后插入一行新代码，把同一个字段带入该类别的汇点：对它调用 `eval()`（模仿 NodeGoat 自身的 `contributions.js`）、用它拼出一个 NoSQL `$where` 过滤器、对它做一次裸的 `fetch()`、对它调用 `console.log()`、用 `res.redirect()` 重定向到它、用它编译一个 `new RegExp()`，或者把它拼接进 `res.send()`。第八个条目，硬编码凭证，则改为锚定在文件自身的某一行 `require(...)` 上，添加一条形如 secrets 技能自身 `process.env.JWT_SECRET || 'literal'` 示例的兜底密钥声明。每一行插入的代码都会立即用 `node --check` 校验；事后解析失败的文件，其对应位置会被撤销，不计入 N。同一文件内没有两个植入位置的距离在 10 行以内。选取过程是对每个候选位置的一次带 seed 的洗牌，因此同一个 seed 与同一个目标总是植入同一批位置；`--max-per-entry` 为单个类别在较小 N 中所占的份额设置上限；`--avoid <ground-truth.json>` 让植入位置与目标自身已记载的问题保持三行以外的距离，因此对一个真实、已存在缺陷的命中绝不会被误认成对一个合成缺陷的命中。`--dry-run` 列出每一个候选位置，并标出 seeded 选取的结果，不触碰任何文件。该工具从不修改原始目标：它把整棵树复制到 `<out dir>/repo`，并把答案——`seeded.ground-truth.json`（植入的位置，格式与 `nodegoat.ground-truth.json` 自身的 id/category/cwe/file/lines 相同）与 `seed-manifest.json`（seed、目录摘要、考虑过的位置、植入的位置、逐条目计数）——写在它旁边，而不是里面，因此这次估计所评分的审查，永远不会被指向自己的答案。

`tools/seeded-recall.mjs` 用 `compare.mjs` 的精确匹配规则，把一份发现列表——一个纯 JSON 文件、一个 `record-run.mjs` 记录目录，或直接从其 `stdout.jsonl` 读取的一次 `pnpm run code-safety --out <dir>` 原始运行目录——与这份答案对比打分，并打印出总体及逐 CWE 类别的「命中数/N」，以 Wilson 95% 置信区间的形式给出。之所以用 Wilson 而不是正态近似区间，是因为它始终落在 [0, 1] 之内，且在一次 seeding 运行产生的小计数（`k = 0` 或 `k = n`）下不会收缩为零宽度。

### 这个数字意味着什么，又不意味着什么

一次 seeded-recall 读数是**在被植入的类别、在被植入的位置上**的召回率：证明审查在这个代码库中某个任意但真实的位置上，注意到了这种缺陷形态。它不是目标中真实、尚未被发现的缺陷的基础比率——目标必定持有目录未建模的类别之外的缺陷，一个很高的读数对那些缺陷什么都说明不了。一个被 seeder 做得很明显的植入缺陷，会在不说明审查真实能力的情况下抬高这个数字：一条点名该漏洞的注释、一个以该漏洞命名的变量、或一个形如已记载占位符、会被审查自身技能当作已知非发现过滤掉的值（一个形如 `AKIA...EXAMPLE` 的密钥、一个字面的 `devsecret`）——这些读起来都像是一个答案，而不是一次测试。该目录用三种方式避免这一点：每个模板都模仿一个已经记载在某个部门技能中、或已作为真实缺陷出现在某个公开目标里的模式；没有一行插入的代码携带注释或点名该缺陷的标识符；硬编码凭证类别的兜底值是一个带 seed 的伪随机 32 字符十六进制字符串，而不是一个占位符过滤器会识别出来的字符串。

### NodeGoat 上的 dry run

一次以 `--seed 1 --n 12 --avoid targets/nodegoat.ground-truth.json` 针对基准真值自身修订版（`c5cb68a`）的 NodeGoat 副本运行的 seeding，从 37 个符合条件的候选位置中植入了全部 12 个请求的位置（6 个因落在另一个已接受位置 10 行以内而被拒绝，0 个被 `node --check` 拒绝），分布在 11 个文件里。`--avoid` 与 NodeGoat 的小体量相互作用：排除 18 个已记载位置后，七个请求数据流类别加在一起，整棵树里只剩下一个存活的位置（`app/routes/memos.js` 的 `req.body.memo`），因此 12 个植入位置中有 11 个属于硬编码凭证类别——它不需要请求数据流，且有许多符合条件的 `require(...)` 行；客户体量更大的代码库不会遇到同样的约束。一次使用只读工具（`Read`、`Grep`、`Glob`，与[三层对比](comparisons/2026-09-22-nodegoat/README.md)中未 seeded 的单模型层完全相同的提示词与参数，从未被告知这份副本是 seeded 的）的单个 sonnet 通过，针对这份 seeded 副本在 265 s 内发布了 50 条发现，读出**12 之 12（100%）**，95% 置信区间为 **[0.758, 1.0]**；按类别看，硬编码凭证（CWE-798）读出 11 之 11（95% 置信区间 [0.741, 1.0]），日志注入（CWE-117）读出 1 之 1（95% 置信区间 [0.207, 1.0]）。每一个植入位置都被模型用它自己的措辞逐一点名（"Hardcoded fallback secret value (appSecret4) committed to source"「硬编码的兜底密钥值（appSecret4）提交进了源码」，"Unsanitized memo content written to console.log, enabling log injection"「未经过滤的备忘录内容被写入 console.log，导致日志注入」），其输出中没有任何迹象表明它意识到这份副本是 seeded 的。

这次 dry run 只跑了单模型层，因为当晚六部门 program 的订阅份额被别的工作占用了。复现它，或者把它跑在另一个目标上：

```sh
node data/code-safety/tools/seed-defects.mjs <target> <out dir> --seed <seed> --n <count> --avoid data/code-safety/targets/nodegoat.ground-truth.json
node data/code-safety/tools/seeded-recall.mjs <findings.json, or a record or raw run dir> <out dir>/seeded.ground-truth.json
```

六部门 program 自身的 seeded-recall 读数，尚未运行：

```sh
pnpm run code-safety -- <out dir>/repo --out .code-safety/<name>-seeded --model sonnet
node data/code-safety/tools/seeded-recall.mjs .code-safety/<name>-seeded <out dir>/seeded.ground-truth.json
```

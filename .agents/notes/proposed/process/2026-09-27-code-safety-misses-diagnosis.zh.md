# Agent Note: 从会话日志诊断 NodeGoat 上的 code-safety 漏报，并在其归属处修正

Status: proposed

[English](2026-09-27-code-safety-misses-diagnosis.md) | 中文

## Problem

[三层对比](../../../../data/code-safety/comparisons/2026-09-22-nodegoat/README.md)把六部门 code-safety program 读作 NodeGoat 十八项已知问题中的十三项，而一次不分部门的单模型评审读作十五项；改进循环的两次迭代改变了这个读数却没有把它定下来：迭代一拓宽了 injection（注入）技能（多抓到 `NG-SSRF`，丢了 `NG-A5`），迭代二增设了一个通才部门，在交错运行的一对里读不出任何增益。`comparison.json` 点名了缺口：唯独单次评审抓到了 `NG-A1-3`（日志注入）、`NG-SSRF` 与 `NG-REDOS`；两档都漏掉 `NG-A2-2a`（账户枚举）与 `NG-A2-2b`（口令策略）；`NG-A5`（安全响应头）在六次 enterprise 运行里抓到四次、丢了两次。每次迭代都是先选定一个机制，再去读拥有该文件的部门为什么没有提交那条发现，于是改动可能落在原因旁边而不是原因上：当部门遵循的权威其实是它自己的指令时，改动落在了技能里；当归属部门早已打开过那个文件时，改动落在了一个新部门上。

本文逐条漏报地阅读六份 enterprise 记录——[`2026-09-21-nodegoat-3`](../../../../data/code-safety/2026-09-21-nodegoat-3/manifest.json)、[`2026-09-22-nodegoat-4-improved`](../../../../data/code-safety/2026-09-22-nodegoat-4-improved/manifest.json)、[`-5-generalist-a`](../../../../data/code-safety/2026-09-22-nodegoat-5-generalist-a/manifest.json)、[`-6-base-a`](../../../../data/code-safety/2026-09-22-nodegoat-6-base-a/manifest.json)、[`-7-generalist-b`](../../../../data/code-safety/2026-09-22-nodegoat-7-generalist-b/manifest.json)、[`-8-base-b`](../../../../data/code-safety/2026-09-22-nodegoat-8-base-b/manifest.json)——查明哪个部门打开了文件、它就那一行写了什么、审查器是否拒绝过某条发现、预算或工具是否拦住了它；然后只改动拥有每个原因的最小之物。这里没有任何重跑：能读出效果的那一对运行写在 `## Verification` 里交给操作者，因为撰写时路由正被另一次运行占用。

## Proposal

只改每个原因的归属之物，别无其他，且改在诊断点名的位置；每处技能改动只命名缺陷类别与代码模式，从不命名目标的文件、路由或行。

- **injection 部门的范围**（[`departments.ts`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/departments.ts) 的 goal 指令与 [`presets/injection/agent.cordis.yml`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/presets/injection/agent.cordis.yml) 的人设）：汇聚点清单新增以请求拼出 URL 的服务端 HTTP 客户端、未经编码写入请求值的日志调用，以及含嵌套或重叠量词的正则测试，人设并写明日志行与校验器的模式是本部门的汇聚点——因为第三次运行的报告把"该部门被指派的汇聚点清单"写成 SSRF 未被提交的原因，而第五次运行的 injection 部门在加载了早已包含日志注入的技能之后，仍把登录日志行判成另一个部门的事。
- **injection 技能**（[`data/knowledge/code-safety/injection/SKILL.md`](../../../../data/knowledge/code-safety/injection/SKILL.md)）：日志注入与 ReDoS 两节各自获得 SSRF 一节已有形式的枚举指令（列出请求值能到达的每个调用点，再逐一判断）——因为 SSRF 在获得枚举指令后从一次里的零次变成五次里的五次，而只有识别段落、没有指令的 ReDoS，被一个六次运行里六次都打开了该文件的部门只提交了两次。
- **access 技能与范围**（[`data/knowledge/code-safety/access/SKILL.md`](../../../../data/knowledge/code-safety/access/SKILL.md)、[`presets/access/agent.cordis.yml`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/presets/access/agent.cordis.yml)、access 的 goal 指令）：两个新的清单条目——通过随账户是否存在而不同的认证响应进行的账户枚举（CWE-204、CWE-203），以及注册或改密处理器采用的口令策略接受规则（CWE-521）——各自注明应引用的行——因为 access 部门在六次运行里都打开了登录与注册处理器，而它的技能、人设与指令都不包含这两个类别。
- **platform 人设**（[`presets/platform/agent.cordis.yml`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/presets/platform/agent.cordis.yml)）：当代码以注释掉的代码或置为 false 的选项携带着被禁用的控制时，发现引用那一行；仅在没有这类代码时才引用防护本应挂载的那一行——因为 platform 部门在六次运行里都提交了缺少响应头这条缺陷，其中两次按旧规则的指引引用了第一条仍在生效的中间件行，落在任何阅读该缺陷的人都会查看的范围之外。
- **陈述部门与技能范围的两份 README**（[fixture 的](../../../../examples/headless-agent/tests/fixtures/program-code-safety/README.md)、[知识包的](../../../../data/knowledge/code-safety/README.md)）在各自的表格里写明新增的类别，中文对侧文件一并重新记录。

goal 指令是冻结规格的一部分，因此带着这些改动的运行会携带新的 program id；已记录的运行保留 `program-e570066f…` 与 `program-b0d17883…`，各记录依然按目标、修订版与基准真值可比，而不是按 id。

## Diagnosis

会话 id 随记录而定：六部门运行的会话为 `program-e570066f04d23255d2013278e0ba6258138c9ec2f50b7ee6592b34b6329a7b5c-<department>`，通才运行的为 `program-b0d17883ff211c887530c3522d028d861665bcbc07060c78675e09f6dc6e5278-<department>`，均在各记录的 `sessions/` 之下；"r4 access seq 163"指记录 `2026-09-22-nodegoat-4-improved` 的 access 会话中 `seq` 为 163 的事件。召回率是 [`recall.mjs`](../../../../data/code-safety/tools/recall.mjs) 对照 [`nodegoat.ground-truth.json`](../../../../data/code-safety/targets/nodegoat.ground-truth.json) 的读数：r3 到 r8 分别为十八项中的 13、13、15、14、13、15。

| 问题 | 单次评审 | r3 · r4 · r5 · r6 · r7 · r8 | 原因 | 改动 |
| --- | --- | --- | --- | --- |
| `NG-A1-3` 日志注入，`app/routes/session.js:64` | 抓到 | 漏 · 漏 · 漏 · 漏 · 漏 · 漏 | 范围：该类别在 injection 技能里，却不在任何部门的指令或人设里；injection 部门读到了那一行，把它留给了 data 部门，而后者的指令只覆盖到达日志的敏感值 | injection 指令与人设拥有日志汇聚点；技能枚举日志调用 |
| `NG-A2-2a` 账户枚举，`session.js:85-94` | 漏 | 漏 × 6 | 技能：access 技能与清单没有条目；access 每次运行都打开了文件；platform 两次注意到它，却写成了另一条发现的影响描述 | access 技能条目、人设分句、指令分句 |
| `NG-A2-2b` 口令策略，`session.js:144` | 漏 | 漏 × 6 | 技能：哪里都没有条目；任何运行里没有任何部门提到过那个校验器 | access 技能条目、人设分句、指令分句 |
| `NG-SSRF`，`app/routes/research.js:15-16` | 抓到 | 漏 · 抓到 · 抓到 · 抓到 · 抓到 · 抓到 | r3 中为范围，迭代一在技能里补上；部门当作自己权威引用的指令依旧不提 | injection 指令与人设点名服务端 HTTP 客户端 |
| `NG-REDOS`，`app/routes/profile.js:59` | 抓到 | 漏 · 漏 · 抓到 · 漏 · 漏 · 抓到 | 源于清单缺口的波动：injection 每次运行都读了该文件，在 r4、r6、r7 里只把该模式当作其 XSS 发现之前的分支提到；人设里没有正则汇聚点，技能里没有枚举指令 | 人设与指令加入正则汇聚点；技能获得枚举指令 |
| `NG-A5` 安全响应头，`server.js:38-62`（另见 `server.js:10`） | 抓到 | 抓到 · 漏 · 抓到 · 抓到 · 漏 · 抓到 | 引用位置的波动：六次运行都提交了；r4 与 r7 按人设规则的指引引用了第一条仍在生效的中间件行 `server.js:68` | platform 人设引用被禁用控制自身的那一行 |

**`NG-A1-3`。**每次运行都有四个部门打开过 `app/routes/session.js`：injection（r3 seq 174、r4 seq 223、r5 seq 282、r6 seq 284、r7 seq 194；r8 的 injection 会话从未打开它，因为它从第四次运行已提交的发现起步，见 seq 103–104）、data（r3 172、r4 267、r5 129、r6 134、r7 198、r8 173）、access（r3 150、r4 163、r5 137、r6 102、r7 159、r8 186）与 platform（r3 179、r4 161、r5 197、r6 121、r7 184、r8 162），通才在 r5（seq 183）与 r7（seq 207）也打开过。data 部门的 `console.log` grep（r3 seq 228、r4 seq 308、r5 seq 271、r8 seq 299）直接返回了那一行——r5 seq 272：`Line 64: console.log("Error: attempt to login with invalid user: ", user…`——而该部门只提交了 CWE-532 的发现。唯一就这个类别做过推理的部门把它写掉了：r5 injection seq 348–349（`report/injection.md`）在未提交项下列出"Log injection (CWE-117): `app/routes/session.js` logs `userName` on a failed login without encoding"，r5 integration seq 343–344 记为"read by the injection department and judged closer to a logging/data-exposure concern, but was not filed by any department"。该类别自迭代一起就在 injection 技能里，却不在任何部门的 goal 指令或人设汇聚点清单里；data 的指令点名的是到达日志的个人数据、凭据与令牌，而不是伪造日志行的请求值。原因：范围。改动：injection 指令与人设把写入请求值的日志调用命名为本部门的汇聚点，技能的日志注入一节枚举它们。

**`NG-A2-2a` 与 `NG-A2-2b`。**access 部门在六次运行里都打开了 `session.js`（seq 见上），在第 82–98 行或第 138–150 行什么也没提交；六份记录里没有任何部门的任何消息包含 `PASS_RE`、"password policy"或 CWE-521，也没有任何 access 消息包含"enumerat"。platform 部门两次看到了枚举，却把它写成其限流发现的影响描述而不是一条发现：r6 platform seq 192，`platform-no-rate-limit-login`，位于 `app/routes/index.js:34`，影响描述为"or enumerate valid usernames via the distinct invalidUserNameErrorMessage at session.js:85"；r8 platform seq 316，`platform-010-no-rate-limiting-login`，影响描述点名 `session.js:82-98` 处的"Invalid username"与"Invalid password"之别。access 技能的认证一节只有三个条目——口令处理（哈希与比较）、暴力破解、MFA——且 CWE-521 只出现在口令处理条目的标题里；技能、人设与 goal 指令都没有描述随账户是否存在而不同的响应，或校验器的接受规则。原因：技能，且文件已被读过。改动：两个 access 技能条目、一个人设分句、一个指令分句。

**`NG-SSRF`。**在 r3 中 injection 部门读了 `app/routes/research.js`（seq 153），集成方写出的报告（r3 integration seq 294）在"What was not covered"下写明该 SSRF "was read and flagged as a real risk by the injection department, but SSRF was outside that department's assigned sink list … so it was never written up as a numbered finding"。迭代一把该类别与一条枚举指令加进了技能，此后每次运行都提交了它：r4 seq 327 `injection-ssrf-research` 位于 `research.js:16`，r5 seq 323 位于 `:15`，r6 seq 329 位于 `:15`，r7 seq 345 位于 `:15`，r8 的并集位于 `:16`。原因：范围，在指令的汇聚点清单上。改动：指令与人设点名服务端 HTTP 客户端，让该类别归属于部门阅读自身职责的地方，而不只是技能里。

**`NG-REDOS`。**injection 部门每次运行都读了 `app/routes/profile.js`——r3 seq 151、r4 197、r5 186、r6 198、r7 166，r8 通过 `sed -n '1,70p'`（seq 148）与 `grep -n "regexPattern…"`（seq 158）——并在 r5（seq 323，`inj-redos-profile-bankrouting`，`:59-61`）与 r8（seq 168，`injection-redos-profile-bankrouting`，`:61`）提交了该模式。在 r4、r6、r7 里，它关于该模式的仅有文字都把它当作其 XSS 发现之前的分支：r4 seq 326 "when that regex fails, line 64 sets `const firstNameSafeString = firstName;`"，r6 seq 328 "when the bankRouting regex check fails (lines 61-76) re-renders the profile view"，r7 seq 344 "when the bankRouting regex check fails"。它枚举汇聚点的 grep 里没有任何正则操作：r6 seq 266，r7 seq 282 与 284，r5 seq 296（`exec|execSync|spawn|child_process|fs\.|…`、`eval\(|new Function|setTimeout\(`）。r8 的抓到发生在读取第四次运行已提交的 injection 发现与报告（r8 seq 103–104）之后，不是一次独立的阅读。原因：源于清单缺口的波动——人设"先找汇聚点"的清单没有正则条目，技能的 ReDoS 一节又不像 SSRF 一节那样带枚举指令，于是只有阅读者在校验器上多停留时该类别才会被提交。改动：正则测试加入人设的汇聚点清单与指令，技能的 ReDoS 一节获得该指令。

**`NG-A5`。**platform 部门在六次运行里都提交了这条缺陷：r3 seq 247 `platform-missing-security-headers` 位于 `server.js:38`；r4 seq 279 `platform-missing-security-headers` 位于 `server.js:68`；r5 seq 325 `platform-001` 位于 `server.js:10`；r6 seq 192 `platform-missing-security-headers` 位于 `server.js:10`；r7 seq 301 `platform-security-headers-not-mounted` 位于 `server.js:68`；r8 seq 316 `platform-001-missing-headers` 位于 `server.js:41`。在 r4 与 r7 里，被引用的行是宣告响应头的那条注释之下第一个仍在生效的 `app.use`，在基准真值 38–62 窗口之外六行，也不是其 `alsoAt` 的第 10 行，尽管 r4 自己的证据文字写着"line 10 shows `const helmet = require("helmet");` commented out, and the whole block at lines 38-65"。原因：引用位置的波动——人设的规则"引用防护本应挂载的那一行"，在被禁用的控制就以注释代码的形式摆在页面上时，把引用引向了仍在生效的中间件栈。改动：当代码携带被禁用的控制时，人设引用它自身的那一行。

**审查、预算与工具原因：无。**每份记录里集成方都对每个部门文件向审查器询问了 `--list-invalid`，它没有打印任何 id（r3 integration seq 238、r4 seq 191、r5 seq 139、r6 seq 203、r7 seq 251、r8 seq 164；各报告的"What was not covered"也如此陈述）。各部门提交前自己的审查器失败都是片段不匹配，并在提交前改正（r4 access seq 265、r4 dependencies seq 253、r5 dependencies seq 293、r6 dependencies seq 409、r7 dependencies seq 368、r8 data seq 339、r8 dependencies seq 239），无一落在上述文件上。每个部门会话都携带一条 `budget/caps` 事件（4,000,000 token、2,400,000 ms）且没有其他 `budget/*` 事件，每条 `turn/end` 都读作 `completed`，每份 manifest（元数据清单）都读作 `denials: 0`。

**跨运行读取。**各部门用 `find /` 定位 `REPORTING.md`，因而触及了 `.code-safety/` 下更早运行的报告仓库：r4 access seq 88 读了第三次运行的 `access/findings/access.json`，r5 data seq 224 读了第四次运行的 `findings/platform.json`，r8 injection seq 103–104 读了第四次运行的 injection 发现与报告并把它们编辑成自己的。因此已记录的这一对运行之间并不独立，r8 对 `NG-REDOS` 的抓到也不是独立读数；`## Verification` 正是为此在每次运行前把更早的运行目录移走。

## Verification

重跑是一对与迭代二同类的运行，在同一目标、同一修订版与同一模型上交错进行，两臂之间唯一的差别是本文的改动。基线臂从已提交基线（`c1ecf5e85`，即撰写本文所依据的 `claude/coding-agent-harness-u9l4gt` 头）的检出运行，改动臂从本文分支的检出运行；两个检出都已 `pnpm install`，目标 `/root/targets/NodeGoat` 干净地停在 `c5cb68a7084e4ae7dcc60e6a98768720a81841e8`，`semgrep` 与 `claude` 在 `PATH` 上，且事先把更早的每个 NodeGoat 运行目录移出两个检出的 `.code-safety/`。

```sh
cd <change> && pnpm run code-safety -- /root/targets/NodeGoat --out .code-safety/NodeGoat-misses-a --model sonnet
cd <base>   && pnpm run code-safety -- /root/targets/NodeGoat --out .code-safety/NodeGoat-base-c  --model sonnet
cd <change> && pnpm run code-safety -- /root/targets/NodeGoat --out .code-safety/NodeGoat-misses-b --model sonnet
cd <base>   && pnpm run code-safety -- /root/targets/NodeGoat --out .code-safety/NodeGoat-base-d  --model sonnet
cd <change> && node data/code-safety/tools/record-run.mjs .code-safety/NodeGoat-misses-a <date>-nodegoat-9-misses-a  --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml
cd <base>   && node data/code-safety/tools/record-run.mjs .code-safety/NodeGoat-base-c  <date>-nodegoat-10-base-c  --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml
cd <change> && node data/code-safety/tools/record-run.mjs .code-safety/NodeGoat-misses-b <date>-nodegoat-11-misses-b --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml
cd <base>   && node data/code-safety/tools/record-run.mjs .code-safety/NodeGoat-base-d  <date>-nodegoat-12-base-d  --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml
cp -r <base>/data/code-safety/<date>-nodegoat-10-base-c <base>/data/code-safety/<date>-nodegoat-12-base-d <change>/data/code-safety/
cd <change> && for r in <date>-nodegoat-9-misses-a <date>-nodegoat-10-base-c <date>-nodegoat-11-misses-b <date>-nodegoat-12-base-d; do node data/code-safety/tools/recall.mjs data/code-safety/$r data/code-safety/targets/nodegoat.ground-truth.json; done
cd <change> && node data/code-safety/tools/assemble-comparison.mjs data/code-safety/targets/nodegoat.ground-truth.json data/code-safety/comparisons/2026-09-22-nodegoat && cp data/code-safety/comparisons/2026-09-22-nodegoat/comparison.json apps/command-deck/public/fixtures/comparison/nodegoat.json
```

每份记录都在运行它的那个检出里生成，因为 `record-run.mjs` 在其所在位置读取仓库头与知识包摘要；随后把基线记录复制进改动检出，与其他记录并列。manifest 能证实记录属于哪一臂：四份记录的 `target.sha256` 都是 `78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`；`knowledge.sha256` 在基线臂为 `cfea561b10e97bda53a808c96078984b6eee9ea7399f7aa379aad325ae2d9450`（r5 到 r8 记录所携带的摘要），在改动臂为 `0ec2cc9b3913a0a7c0120ecbaeeb313842a0a1a0a012176661746b81e5a78795`；`programId` 在基线臂为 `program-e570066f…`，在改动臂为一个新 id。在汇编器运行之前，[`iterations.json`](../../../../data/code-safety/comparisons/2026-09-22-nodegoat/iterations.json) 按运行顺序新增四个条目作为第 `3` 对，每条采用第 2 对条目已有的形式：

```json
{
  "id": "6",
  "ran": "<date>",
  "record": "data/code-safety/<date>-nodegoat-9-misses-a",
  "baseline": "data/code-safety/2026-09-21-nodegoat-3",
  "mechanism": "department scope and knowledge pack: injection and access checklists, platform citation rule",
  "change": "The injection department's instruction and persona own server-side HTTP clients, log sinks and regular-expression tests; the access skill, persona and instruction hold account enumeration and password policy; the platform persona cites a disabled control's own line. Nothing names a target file, route or line.",
  "targets": ["NG-A1-3", "NG-A2-2a", "NG-A2-2b", "NG-REDOS", "NG-A5"],
  "decision": "<pending>",
  "pair": "3",
  "arm": "with",
  "reading": "<the recall this run read>"
}
```

汇编器为每份记录打出召回率、相对 r3 基线多抓与丢失的问题，以及抓到的目标；这一对像通才那一对一样按臂跨两次运行来读，四份记录加入 [`data/code-safety/README.md`](../../../../data/code-safety/README.md) 的运行表与对比 README 的迭代表。

## Alternatives considered

**再加一个部门，或再上一次通才。**否决：每个被漏问题的文件在每次运行里都被其归属部门打开过，通才在它的两次运行里都读了 `session.js`，却一条认证问题也没有提交；这些漏报缺的不是广度，通才那一对也已经记录了第七个阅读者在这个目标上不增加召回率。

**像迭代一那样只把新类别放进技能。**作为唯一改动被否决：第三次运行的报告把部门"被指派的汇聚点清单"——goal 指令与人设——写成 SSRF 未被提交的原因，第五次运行的 injection 部门在加载了包含日志注入的技能之后仍把那一行推给另一个部门。指令与人设是部门读作自身职责的东西，技能是它读作自身手艺的东西。这里两者都改，各改一句。

**把日志注入交给 data 部门，因为它本来就在 grep 日志调用。**否决：记录在案的失败模式正是一个部门把该类别留给另一个部门，而两个归属方会在两个方向上都招来这种事。集成方会对重叠的发现去重，但要让汇聚点清单被遵循，归属必须没有歧义；injection 人设现在就是这样明说的。

**放宽打分器的窗口或基准真值的 `alsoAt`，让 `server.js:68` 算作 `NG-A5`。**否决：打分器不是产品。一条片段显示 favicon 中间件、证据却在谈六行之前一段注释掉的代码块的发现，比片段直接显示被禁用控制的发现更差；引用规则改善的是证据，召回率读数随之而来。

**放宽审查器。**不适用：六次运行里审查器一条也没有拒绝，因此没有任何真实发现因审查而丢失；审查器保持原样。

**在本任务内跑这一对。**未做：路由正被另一次运行占用，而任一臂的单次运行正是对比记录自己所警告的、落在 program 12 到 15 波动区间之内的单次读数；于是把这一对写了出来。

## Acceptance criteria

- `## Verification` 的四份记录存在，审查器均以 0 退出，各自的 manifest 携带其中陈述的摘要与 program id，这正是两臂仅因本文改动而不同的证明。
- 在改动臂的两次运行里，`recall.mjs` 都把 `NG-A2-2a`、`NG-A2-2b` 与 `NG-A1-3` 读作抓到——这三项没有任何一次 enterprise 运行抓到过，其中两项单次评审也漏了——并把 `NG-REDOS`、`NG-SSRF` 与 `NG-A5` 读作抓到；在基线臂的两次运行里，同一工具把 `NG-A2-2a`、`NG-A2-2b` 与 `NG-A1-3` 读作漏掉，这是这一对的对照。
- 基线臂两次都抓到的问题没有一项被改动臂两次都漏掉，且改动臂每次运行至少读作十八项中的十六项：高于六部门 program 在这个目标上的 12 到 15 区间（r3 到 r8 为 13、13、15、14、13、15），因此增益不是某一次运行的波动。
- `iterations.json` 的判定规则：以上各行全部成立时为 `keep`；改动臂在两次运行里抓到的从未被抓到过的三项少于两项时为 `keep-knowledge`（改动作为通用手艺保留，效果未确立）；基线臂两次都抓到而改动臂两次都漏掉的问题是一处回归，在任何进一步改动之前先按本文阅读漏报的方式从日志中读出。
- 无密钥 e2e（`examples/headless-agent/tests/program-code-safety.e2e.ts`）在改动后的指令下通过，`pnpm run typecheck`、`pnpm run doc-sync`、`pnpm run verify-agent-note-format` 与 `pnpm run verify-translation-pairing` 通过，且技能文本不命名任何目标的文件、路由或行。

## Risks

- **更长的汇聚点清单稀释注意力。**injection 人设"先找汇聚点"的清单多了三个类别，access 清单多了两个；把同样的阅读摊到更多汇聚点上的阅读者可能削薄它的核心发现。这一对的"无丢失"标准正是用来察觉这一点的，也是基线臂要跑两次、而不是从六份既有记录里读取的原因。
- **跨运行污染。**记录显示各部门从 `.code-safety/` 读取了更早运行的发现；若重跑时把这些目录留在原处，每一臂都能读到另一臂的发现，这一对就会被模糊。流程先把它们移走；仍然触及另一次运行文件的部门，是丢弃该次运行的理由，而不是阅读它的理由。
- **贴合目标。**两项从未被抓到的问题是这个目标经典的教程条目，新的 access 条目描述的恰是它们的类别。条目按类别与模式书写并注明应引用的行，技能里的示例模式也不是目标自己的；检验它们能否泛化的办法与每项技能相同——一个带自身基准真值的第二个目标，或在没有基准真值的代码库上做[种植缺陷召回](2026-09-22-seeded-defect-recall.md)。
- **移动的引用会移动其他读数。**platform 规则现在优先引用被禁用控制自身的那一行；在一个基准真值把缺失控制问题钉在生效挂载点上的目标里，同一规则会把引用往另一边移。规则写明了偏好与其回退，因此任一目标的阅读者都能顺着发现找到代码。
- **program id 会变。**goal 指令是冻结规格的一部分；已记录的运行保留各自的 id，指挥台的已记录 program 不变，也没有测试钉住该 id，但只按 id 比较新旧记录的阅读者将一无所获。

# 企业花名册

[English](README.md) | 中文

本目录下的 `roster.json` 是为企业概念验证生成的花名册，包含 147 个席位定义：由本仓库真实定义的来源构建出的"角色 x 事业部 x 专精方向"组合，每个席位都附带已提交的会话记录与台账为它提供的证据。[`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) 生成该文件（`pnpm run roster`）；[`scripts/harness-feed.ts`](../../scripts/harness-feed.ts) 在重新计算实时会话状态后提供服务（`pnpm run feed`）。花名册不是记录在案的组织：记录在案的组织是[台账](#the-ledger)——它旁边的 `ledger.jsonl`，每条交付物一行——以及 feed 在 `GET /programs` 上提供的项目运行。各位包管家领取工作的队列位于 [tickets/](tickets/README.md)，由[班次](#shifts)处理；不需要工单的事业部按计划执行各自的[职能](#functions)。

## 读懂这些计数

这里没有任何计数是 agent 的人头数。花名册陈述三个计数，每个都以它的 `generatedAt` 注明时刻：**已定义**的席位（`counts.defined`，本仓库定义的角色）、有证据的**在岗**席位（`counts.occupied`，被某条已记录交付物指名的席位），以及时间戳之前 24 小时内**活跃**的席位（`counts.active`）。`counts.work` 按交付物的性质拆分在岗与活跃席位：模型驱动（由模型完成工作）、自动检查（一道 `verify-*` 关卡、一个 Branch CI 裁决、一次折叠），以及在任何模型运行之前就停止的工单。2026-09-29 07:07 UTC 盖章、覆盖 141 条台账行的花名册读作：147 个已定义；53 个在岗，其中 27 个模型驱动、22 个自动检查、4 个仅在任何模型运行之前就停止；44 个活跃，其中 18 个模型驱动、22 个自动检查、4 个在任何模型运行之前就停止。企业在该时间窗内交付的内容，即指挥台 `enterprise.json` 中的 `outcomes`，是 3 张工单已发布、3 张由模型处理但未发布任何内容、4 张在任何模型运行之前就停止、7 个代码安全审查席位中 7 个通过、2 位 intake 协调员中 2 位通过，以及 114 项自动检查中 105 项通过。指挥台以这些成果开场，并显示当前计数及其时长。

## 诚实原则

147 是本仓库**已定义**的席位数量——每条记录的 `source` 字段都指向一个真实存在的仓库路径（一个包 README、一个 `verify-*.ts` 脚本、一个 CI 关卡名称、一份 Agent Note、一个技能目录、一个 Proving Ground 基准测试的任务环境，或一个代码安全审查知识包），并在生成花名册时对照磁盘做过校验。每个事业部的数量都是固定配额（总和为 147）；由可变来源池构建的事业部会从该池中按排序精确取出其配额，若代码树定义的来源少于配额所需，生成器会抛出异常，指明该事业部与缺口数量。一个定义既不是正在运行的智能体，也不是曾有智能体运行过的证据：每个席位都由两个测试夹具预设（`coding`、`reviewing`）之一组合而成，并写明它为之定义的路由，无论是否有会话在该路由上运行过。

## 证据

每个席位都带有 `evidence: { sessions, lastSeen?, routesSeen }`，由 [`scripts/roster-evidence.ts`](../../scripts/roster-evidence.ts) 中的归属规则，从 `data/proving-ground/*/sessions` 与 `data/code-safety/*/sessions` 下已提交的记录计算得出；feed 也使用这个模块，因此在相同的记录上，该文件与 feed 的结果一致：

- 代码安全审查中的项目会话占据其 id 所指的代码安全席位：某个部门的会话占据该部门的整合员席位，项目自身的会话与其整合会话占据项目负责人席位；
- `environment/run` 指明某个基准测试环境的会话，占据专精于该环境的 Proving Ground 基准测试操作员席位；
- 被委派的会话占据其委派方会话所占据的席位。

会话与某个席位共用的路由不算证据。`routesSeen` 在席位为之定义的 `route` 旁列出其会话实际运行所在的提供方路由，因此一个为 `deepseek-official` 定义、其会话却全部运行在 `claude-code` 上的席位会如实说明这一点。顶层的 `evidence` 列出所读取的记录（`records`）、这些记录的会话数（`sessions`），以及所有会话（无论是否归属）按路由的数量（`routes`）。`unattributed` 按原因统计没有任何规则将其放到席位上的会话：`environment-not-seated`、`program-not-code-safety`、`program-member-not-seated`、`parent-not-recorded`、`no-seat-evidence`。没有任何会话会被默认放到某个席位上。

每个席位还带有 `ledger: { lines, lastAt? }`：`ledger.jsonl` 中指名该席位 id 的工单行与职能行，严格按席位 id 精确计数，不做任何宽松匹配。顶层的 `ledger` 列出该文件、读取的行数，以及没有指向任何花名册席位的行数（`unseated`）。已提交文件恰好覆盖 `evidence.records` 所列的记录与台账的前 `ledger.lines` 行，因此在提交更多记录或追加更多行之后，它仍能由这些输入复现；`pnpm run roster` 会把它扩展到已提交的一切。[花名册证据 Agent Note](../../.agents/notes/proposed/architecture/2026-09-22-roster-evidence-and-org-of-record.md) 记录了归属决策及其背后的审计。

## 在岗

一个席位只能被一条已记录的交付物占据——一张已交付或已评审的工单、在某个提交上运行过的一道关卡、一个 CI 裁决、一份已发布的快照、一个归属于它的已记录会话——其他任何东西都不算：不算它的定义、它的路由、它的技能、一条边，也不算任务中的一次提及。[`scripts/enterprise-ledger.ts`](../../scripts/enterprise-ledger.ts) 是这条规则唯一的实现，花名册生成器、职能运行器与指挥台发布的数据都读它：

- `counts.occupied` 统计至少拥有一个归属会话或一条台账行的席位；
- `counts.active` 统计最新交付物——按 `at` 计的台账行，或按其记录最新日志时间计的归属会话——落在 `activeWindow`（以 `generatedAt` 结束的 24 小时，两端均含）之内的席位；
- 恰好这些席位的 `status` 为 `"active"`，其余均为 `"defined"`；实时会话状态属于 feed，绝不写进这里；
- 当由模型完成工作时，一条交付物是**模型驱动**的：一个归属会话；一条其部门或评审运行过会话、已发布或记录了模型 token 的工单行；以及检查事业部之外的一条职能行（代码安全 `review`、`intake`）。**自动检查**是验证、裁决、观象台或策展与数据事业部的一条职能行，它们运行脚本、读取 CI 裁决或折叠记录，不调用任何模型；其余任何工单行都是**在任何模型运行之前就停止**的；
- 一个在岗席位的 `work.occupied` 是它全部交付物中最强的那一类（先模型驱动，再自动检查，再停止），一个活跃席位的 `work.active` 是时间窗内交付物中最强的那一类；`counts.work.occupied` 与 `counts.work.active` 按类统计席位，其和分别等于 `counts.occupied` 与 `counts.active`。

时间窗按 `generatedAt` 而非读取时刻度量，因此该文件是一份写明时刻的快照：在未变的输入上重新生成，字节完全一致；每一条新的台账行或记录都会改变内容，从而重新盖章并重新度量时间窗。[企业运作模型 Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-enterprise-functions-and-occupancy.md) 记录了这条规则为何只计交付物而不计其他。

## 台账

`ledger.jsonl` 只可追加，每行一个 JSON 对象。两种行类型共用它；没有 `type` 的行按工单行读取，缺少读取方所依赖字段（`at`、`seat`、`division`，以及该类型自身的必填字段）的行会被跳过并按行号报告，而不是被猜测。

- **工单行**是一个班次中处理过的一张工单，由[引擎](#shifts)（`pnpm run enterprise -- shift`）追加：`{ "type": "ticket", "at", "shift", "ticket", "seat", "division", "programId", "implementer", "model", "department": { "outcome", "sessionId" }, "checks": [{ "id", "ok" }], "review": { "verdict", "sessionId" }, "reviewer"?: { "sessionId", "route", "model", "verdict" }, "integration": { "outcome" }, "shipped": { "commit" } | null, "reason", "tokens", "seconds" }`。`department.outcome` 取 `certified`、`failed`、`blocked`、`abandoned`、`pending` 或 `halted`；`review.verdict` 取 `approve`、`reject` 或 `none`；`reviewer` 出现在引擎开始记录它之后每条由评审作出裁定的行上，写明评审员的会话、它运行所在的路由与模型及其结论；`integration.outcome` 取 `merged`、`skipped`、`conflict`、`checks-failed`、`digest-mismatch` 或 `not-shipped`；`shipped.commit` 是分支上承载该工单修改的提交。工单的状态取其最近一行：`shipped` 指 `shipped` 指明了一个提交，`rejected` 指评审结论为 `reject`，其余为 `halted`——验收失败的部门、集成无法组装的修改，或被路由用量上限停下的班次（原因写作 `halted: limit (resets at <instant>)`）——没有任何行的工单为 `queued`。工单一旦为 `shipped` 或 `rejected` 即告关闭；`halted` 的工单保持开放，由后续班次再次处理。
- **职能行**是一个席位在一个提交上执行其职能，由 `pnpm run enterprise:functions` 追加：`{ "type": "function", "at", "shift", "seat", "division", "function", "target": { "commit", "via"?, "requested"? }, "outcome": "pass" | "fail" | "error", "evidence": { "path" } | { "url" }, "seconds" }`。`at` 是交付物自身的时间——关卡结束之时，或 CI 裁决作出之时——`outcome` 是关卡或裁决的结果，`error` 表示未能取得裁决，`evidence` 是席位写出的输出，或它读取裁决的页面。

**只可追加。** 一个提交只能在文件末尾添加行；合并提交按顺序保留每个父提交的全部行，正如 `.gitattributes` 中的 `merge=union` 驱动合并两个写入方的追加。一行所指明的每个提交（工单行的 `shipped.commit`；职能行的 `target.commit`、`target.requested` 与 `target.via`）都必须是完整的提交 ID，并且是添加该行的提交的祖先，因此没有任何一行会引用分支上不存在的工作。写入方若在推送前变基，须围绕新的哈希改写自己尚未推送的行，[引擎](#shifts)即是如此；恢复某个克隆中未推送的提交时也必须这样做，或者合并那段历史，使其各行所指明的每个提交都留在分支上。[`scripts/verify-enterprise-ledger.ts`](../../scripts/verify-enterprise-ledger.ts) 检查这两条规则：`pnpm run verify-enterprise-ledger -- --base <rev> [--head <rev>]` 遍历 `base..head` 中每个改动该文件的提交，遇到以下情形即失败：在末尾之前插入、删除或改动的行，丢弃了某个父提交之行的合并，无法解析的新增行，以及缩写的、不存在的或不在添加提交祖先链上的引用；若头提交已不包含基准提交，则按分支被改写判为失败。Branch CI 的静态通道以推送的 `github.event.before` 为基准，对每次推送运行它。手动运行或创建分支的推送没有基准，此时该关卡只检查每一行都能解析。GitHub 对该工作流只保留最新一次待运行的任务，因此运行被取代的推送没有属于自己的检查；以任一时间段的起点为 `--base` 运行一次，即可覆盖整段。

**事后写入的行。** 若某一行没有由其运行自身的写入方追加，就由一条事后写入的行来记录；这样的行带有 `"recordedBy"` 与 `"recordedAt"`，二者同时出现或同时缺省。`recordedBy` 取自一个封闭集合，目前只有 `supervisor`：运营该企业的会话，它只依据分支上的证据写这样的行，并在该行的 `reason` 或添加该行的提交中引用该证据。在这样的行上，`at` 是事件发生的时间，或证据所能确立的最早时刻；`recordedAt` 是写下该行的时间，不早于 `at`。它只携带其证据所陈述的内容：补全一次推送失败的引擎运行的行，就是引擎自己的那一行，只是换成了变基后提交的哈希；依据丢失的或不完整的记录重建的行，则让 `checks` 保持为空，并省略 `model`、`tokens` 与 `seconds`。它和任何一行一样计入队列顺序中的尝试次数；引擎按 `at` 把它放进其工单的各行之中，因此补记一个旧班次，绝不会重新打开或重新关闭一张已由更晚的行定论的工单。最早的六条都写于 2026-09-29：班次 `171951-516d` 的 T-0012（评审通过，随后驱动程序在组装中崩溃）与 T-0019（被其评审拒绝），依据该班次位于 [`shifts/2026-09-28-171951-516d/`](shifts/2026-09-28-171951-516d/result.json) 的部分记录；班次 `201448-94fd` 的 T-0001 与 T-0005，它们在 2026-09-28 的容器重置销毁该班次时被放弃，依据[转录损失](../transcripts/LOSSES.md)与恢复后的编排器日志；以及班次 `101309-c95c` 的 T-0020 与 T-0021，即引擎自己的行，在代理端口于运行中的周期之下发生变动之后，由 supervisor 补全了其推送。

**关卡出现之前的改写。** 在 2026-09-28T00:40Z 至 2026-09-29T09:54Z 之间（`--base 6fb91bb11 --head 148490ce5`），该关卡发现五个并非只做追加的提交，均早于关卡本身，另有 57 条新增行指明了分支上不存在的提交。自该文件在 `52c56001d` 中创建以来，没有任何一行被删除，有一行被改动：

- `d46e02bd9` 把首次职能运行的 28 行（时间为 00:52Z 至 17:50Z）插入到班次 `182951-78a6` 于 19:04Z 写下的两条工单行之前。其中六行的 `target.requested` 为 `3ed95172e`，即一次仅含评判的重跑所基于的检出的提交，仓库中并不包含该提交。
- `d1aec806b` 按时间顺序把首次受理的两条职能行插入到同样那两条工单行之前。两行的 `target.commit` 都是 `4a1f22151`，即受理所在检出当时的提交，仓库中并不包含该提交。
- `1f669dbf9` 按时间顺序把代码安全自审的七条职能行插入到更早的职能行之间。
- `8a4dd9c02` 从一个推送失败的检出中恢复了四个周期的记录，并按时间顺序把它们的 70 条职能行合入该文件。其中 02:13Z、04:13Z 与 06:13Z 三个周期的 48 行，以该检出自己的提交 `73a7727b5`、`2231af791` 与 `e1678940d` 作为 `target.commit`，而这些提交从未被推送。
- `7bd419444` 追加了班次 `001527-881f` 的 T-0007 行，其中指明的是 `3d5210654`，即推送把它变基为 `cba8e4682` 之前该克隆中的提交（作者、日期、提交说明与补丁均相同）；随后 `dae1babd0` 就地改动该行，改为指明 `cba8e4682`。

自 `dae1babd0` 起，对该文件的每个提交都只追加能够解析、且只指明其祖先链上提交的行。

## 班次

一个班次是 [enterprise-shift 引擎](../../examples/headless-agent/tests/fixtures/enterprise-shift/README.md)的一次运行（`pnpm run enterprise -- shift --next <n> --push`）：它克隆开发分支的顶端，让选中的未关闭工单在各自的工作树里经由程序工作流完成，由一位独立评审员对每个已认证的修改作出裁定，把获批的修改装配为每张工单一次提交，重新认证，再连同班次自己的提交一起快进推送到分支。那次提交携带班次的台账行与记录，因此分支是班次唯一的汇报之处。无人值守的班次与受理没有人工发布关卡：没有人评审它们发运的内容，它们的程序不带 `requireSignoff` 运行，它们的记录把规格冻结与发布写作机器主体（`daliesk-enterprise-shift`、`daliesk-enterprise-intake`）的决定，其 `decidedBy` 写明引擎以及班次或受理运行；人所评审的是事后的分支。

`shifts/<UTC 日期>-<班次 id>/` 是班次的记录：`result.json`（班次、程序报告、引擎的 `decisions`、每张工单的台账行连同评审员的理由、停机信息）、`manifest.json`（基准修订、分支、组合、每个文件的 SHA-256）以及班次运行的每个会话的 `sessions/<会话 id>.jsonl`——程序台账、每个部门、每次评审、整合——其中形似凭据与个人数据的字符串（包括电子邮件地址）已由 `data/transcripts/tools/secret-patterns.mjs` 的共用模式遮蔽并计数；重新扫描后仍有匹配的记录永远不会被提交。记录由运行它的班次写入，此后不再改写。`shift-starts.jsonl` 每个班次一条开始行，`{ type: "shift-start", at, shift, tickets, base, host, pid, implementer }`，班次在任何部门运行前推送它；其班次没有留下任何工单行的开始行意味着被容器重置截断，下一个班次会以一条计为一次尝试的 `abandoned: container reset` 工单行关闭它的每张工单。该文件只追加，并按行并集合并。

## 职能

`pnpm run enterprise:functions -- [--commit <sha>] [--shift <id>] [--branch <name>] [--only <divisions>] [--gate-timeout-ms <ms>] [--lock <file>]`（[`scripts/enterprise-functions.ts`](../../scripts/enterprise-functions.ts)）在已检出的提交上运行不需要工单的事业部的职能，并为每个职能真正运行过的席位追加一条职能行。`--commit` 必须指向检出，因为关卡就在它上面运行；班次默认为运行开始的那一分钟（`2026-09-28T17-20Z`）；`--only` 把运行收窄到 `verification`、`judging`、`observatory`、`curation-data` 中的若干个；`--lock` 指定共享机器上每条重型命令通过 util-linux `flock` 获取的锁文件，此后每道关卡先等待该锁、运行期间持有、在下一道关卡之前释放，因此在这样的机器上应不加外层 `flock`、带 `--lock` 启动运行，否则关卡永远拿不到锁。

| 事业部 | 运行什么 | 证据 |
|---|---|---|
| 验证 | 14 个验证员席位逐一运行其 `source` 所指的根包脚本（`scripts/verify-md-links.ts` 运行 `pnpm run verify-md-links`）；没有构建就无从判断的关卡运行先构建再验证的脚本，一如 CI 的 static lane（`verify-doc-site-fragments` 运行 `pnpm run docs:build:mpa`）；根 `package.json` 中没有的脚本会在记录任何东西之前让运行失败。`pass` 为退出码 0，`fail` 为其他任何退出码，`error` 为启动失败或超时（除非 `--gate-timeout-ms` 另有规定，否则为 15 分钟）。 | `functions/<shift>/<seat>.log`：命令、提交、结果，以及去除了终端样式与行尾空白的关卡输出的最后 12 KB。 |
| 裁决 | 该提交的 Branch CI 运行（`LBJLincoln/deepseek-harness`，`branch-ci.yml`，通过 GitHub 的 REST API 无凭据读取；环境指定了代理时经由 `HTTPS_PROXY` 所指的代理——Node 的 `fetch` 只在 `NODE_USE_ENV_PROXY=1` 下遵守它，包脚本设置了该变量，绕过代理的读取会让裁判带着这一提示空缺；在该变量下启动的每个 Node 进程都会打印一条 `UNDICI-EHPA` 实验性警告，各关卡则不带该变量运行）：其各条 lane 作出过裁决的最新已完成运行，因此在排队等待时被后一次推送取代的运行会被跳过；该提交没有时，取之后第一个 head 包含该提交的此类运行（GitHub 对两者的比较答为 `ahead` 或 `identical`），其 head 写入 `target.via`，分支上的运行从最新的开始比较，直到某次运行的 head 比该提交更旧为止；仍没有这样的运行时，取分支上最新的此类运行，这是对另一个提交的裁决，此时其提交写入 `target.commit`，被请求的提交写入 `target.requested`。每个 job 映射到其日志开头所报关卡模式的席位（`run-gates: ci-static running …`）；job 的 `success` 为 `pass`，`failure` 为 `fail`，其他任何结论为 `error`。job 日志按名称显示出的关卡组映射到该组的席位：`ci-lint-contracts-ready` 来自 `lint and duplication` 关卡，`ci-snapshot` 来自 `build` 与 `test:snapshot`，`ci-artifacts` 来自 `build`、`publint`、`node-next types`、`built package invariants` 与 `built-bin smoke`；每组在所有关卡通过时为 `pass`，有一个失败时为 `fail`，有一个因依赖失败而被跳过时为 `error`，日志未把它们全部显示出来时则不写行。台账中已有的同一席位、同一 job 的裁决不会再次追加，因此该命令可以安全地重复。 | GitHub 上该 job 的页面，作为 `evidence.url`；`at` 是该 job 的完成时间。 |
| 观象台 | 会话统计观察员把其所属包真实的 `sessionStats` 投影单元（`@deepseek-ai/dsh-session-stats`）折叠在已提交记录以及 `shifts/` 下任何班次记录的每个会话上，并发布 [`telemetry.json`](#telemetry-and-scoreboard)。 | `telemetry.json`。 |
| 策展与数据 | 记分员把 `@deepseek-ai/dsh-scorekeeper` 的 `foldSessionFacts` 与 `foldScoreboard` 折叠在同一批会话上，并刷新 [`scoreboard.json`](#telemetry-and-scoreboard)。 | `scoreboard.json`。 |

若 API 无法读取，每位裁判都保持空缺并以该故障为原因，其他事业部照常运行；只有对它无法记录的错误配置——花名册缺失、提交不是检出、未知的标志——该命令才以非零退出。

这些事业部中没有得到任何行的席位为空缺，运行会逐一指明其原因：

| 席位 | 空缺原因 |
|---|---|
| `judging-ci-primary`、`judging-ci-linux-primary` | 这些 lane 运行在本 fork 没有的 runner 池上；Branch CI 只运行 static、coverage 与 consumers 三条 lane。 |
| `judging-ci-windows-blocking`、`judging-ci-windows-complete`、`judging-ci-windows-observational` | 本 fork 上没有 Windows runner。 |
| `observatory-session-telemetry-observer` | 遥测协调器把实时会话记录交给后端 sink；没有后端在已提交记录上运行。 |
| `observatory-session-telemetry-otel-observer` | OpenTelemetry 后端导出到 OTLP collector；这里没有配置任何一个。 |
| `observatory-session-projection-observer` | 投影注册表在实时会话上驱动各单元；这里改为直接折叠会话统计单元。 |
| `observatory-session-query-observer` | 会话查询提供方索引的是运行中的会话存储；没有存储在已提交记录上运行。 |
| `observatory-otel-bench-fixture-observer` | 快照套件组合的一个夹具，不是在提交上运行的职能。 |
| 七个 `curation-data-*-curator` 席位 | 笔记与夹具策展是工单化的工作，不是本运行器的职能。 |

## 遥测与记分板

`telemetry.json` 是企业自己的遥测快照：`publishedAt`、`shift` 与 `commit`、`window`（发布前的 24 小时）、读取的 `records`、`inWindow` 与 `total` 两组数字——会话数、token（`input`、`output`、`cacheRead`、`cacheWrite`、`reasoning`，由记分员的效率事实求和）以及会话统计单元的 `turns`、`steps`、`llmMs`、`toolMs`——`sessionsByTree`、`seats`（按在岗规则在发布时的台账上计得的在岗与活跃席位，总计与按事业部，含本次运行此前的行），以及 `skipped`，即记分员折叠无法读取的会话。会话的最新事件落在时间窗内即算在窗内。`scoreboard.json` 是记分员在同一批会话上的折叠：`computedAt`、`rows`（每个模型路由、尝试阶梯、环境、隔离级别、实现者、预设、留出划分与 district 一行，带 pass@1）、`excluded`、`unstamped`（没有 `environment/run` 标记为其指明单元格的会话）与 `skipped`。两个文件在每次运行时整体重写。

## 实时状态

正在运行的 feed（`pnpm run feed`）上的 `GET /roster` 会在它发现的每次运行（包括实时运行）上重新计算每个席位的会话证据、`evidence` 与 `unattributed`，并仅凭这些会话设置每个席位的 `status`：当归属于它的某个会话属于仍在运行的运行时为 `active`；一旦它的某个会话记录了证书事件，变为 `certified`；若它的会话都已结束但未记录证书，则为 `failed`。没有任何被发现会话占据的席位，在 feed 上一律读作 `"defined"`，无论文件里写的是什么。feed 保留文件的 `counts`（由文件的 `generatedAt` 注明时刻），并加上 `counts.running`，即此刻有会话正在其上运行的席位；指挥台把这个计数标为"正在运行"，从不标为活跃。一次全新检出、尚无运行时数据时，feed 会报告已提交记录的证据与 `running: 0`，这是正确的答案。

## 事业部

| 事业部 | 职责 |
|---|---|
| `harness-core` | 负责产品 API 主干：会话、提示词组装、工具、智能体、智能体循环、LLM 路由与子智能体委派。 |
| `proving-ground` | 在 Proving Ground 基准测试夹具的真实任务环境上运行 harness。 |
| `verification` | 运行在变更源码交付前把关的 `verify-*` 脚本。 |
| `judging` | 在每个具名 CI 关卡上裁定通过或失败。 |
| `curation-data` | 策展 Agent Note 语料与夹具数据集，并为观象台记录使用量。 |
| `program-departments` | 把横切的包组作为一个项目的各部门进行协调。 |
| `code-safety` | 按语言审查目标仓库的密钥、注入、访问、数据、依赖与平台风险。 |
| `knowledge` | 保持仓库中可复用技能的时效性与可发现性。 |
| `governance` | 负责流程标准：标签、堆叠、依赖、vendoring、许可证与翻译配对。 |
| `observatory` | 跨运行观察会话遥测、token 消耗与查询接口。 |

## 受理

当[工单队列](tickets/README.md)中的开放工单少于其下限时，由 Program Departments 协调人补充队列：`pnpm run enterprise:intake` 运行一个以协调人为部门的 program，每位协调人为自己的包族提出工单，只有其确定性准入接受的拟议工单才会被提交。每次运行都先答复所有者的[请求](#requests)，在 `intake/` 下写出记录，并为运行过的每个部门向 `ledger.jsonl` 追加一行职能行，写明担任该部门的协调人。[enterprise-intake fixture](../../examples/headless-agent/tests/fixtures/enterprise-intake/README.md) 说明命令、准入与记录；[Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-coordinators-intake.md) 记录这一决策。

## 请求

所有者通过提交一个请求 `requests/<name>.md` 向企业交派工作：第一行为 `# <title>`，其下是自由文本，别无其他。每次[受理](#intake)运行都会在补充队列之前、且与补充互不相干地，让一位协调人的部门把每个尚无工单答复的请求——按文件名顺序至多 `--max-requests` 个（默认 2）——变成恰好一张工单，其 source 是该请求的文件及其标题行；被准入拒绝的请求连同原因记入受理记录，并由下一次运行再次处理。当一张工单的 `source.path` 就是某个请求的文件时，这张工单即答复了该请求；只有这样的工单可以取优先级 `0`，[班次](#shifts)的队列顺序会把它排在每一张未尝试过的工单之前。`pnpm run enterprise:requests`（[`scripts/enterprise-requests.ts`](../../scripts/enterprise-requests.ts)）打印每个请求的文件、标题与状态——`waiting`、`refused`、`queued`、`halted`、`shipped` 或 `rejected`——这些状态只从队列、台账与受理记录推导。[请求 README](requests/README.md) 说明如何撰写请求以及每种状态的含义；[Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-owner-requests.md) 记录这一决策。

## 代码安全专精方向指的是目标，而非已实现的扫描器

本仓库是 TypeScript/JavaScript 项目，不附带 Java、Go、PHP 或移动端的静态分析工具。每个"部门 x 专精方向"审查员席位——包括本仓库尚未为其实现扫描器的四种语言——都引用其部门位于 `data/knowledge/code-safety/<department>/SKILL.md` 的真实审查知识包；专精方向记录的是该席位*为何而设*，而不是声称已有匹配的扫描器在运行。每位审查员、整合员与项目负责人也都以 `code-safety/<id>` 技能的形式使用该知识包（负责人还使用横切的审查方法与严重性与证据知识包）。审查员路由到 `openrouter`，循环使用本仓库自己的 Proving Ground 基准测试所组合的免费层模型 id（`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml`），由生成器提取而非硬编码。请阅读 [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) 了解每个部门具体由哪个来源支撑，并阅读 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md) 了解完整的理由。

## 发布指挥台

`pnpm run enterprise:publish`（[`scripts/enterprise-publish.ts`](../../scripts/enterprise-publish.ts)）从花名册、台账与工单队列重新生成指挥台的静态企业数据：`apps/command-deck/public/fixtures/roster.json`，即 `roster.json` 的逐字节副本；以及 `apps/command-deck/public/fixtures/enterprise.json`，即企业视图的开场与台账标签页——`asOf`（花名册盖章时刻与最后一条台账行中较新者）、时间窗、`outcomes`（在时间窗内有一行发布了提交的工单；在时间窗内由模型处理但未发布任何内容的工单；在时间窗内每一行都在任何模型运行之前就停止的工单；按职能计的模型驱动职能运行；按结果计的自动检查）、按事业部的在岗与活跃席位（活跃席位按 `work` 拆分）、当天按状态分列的工单（queued 来自队列，其余来自每张工单在时间窗内的最新一行）、当天由新到旧的职能运行，以及最近十个已交付提交及其上记录的 CI 裁决（按提交前缀匹配）。它还写出 `apps/command-deck/public/fixtures/enterprise-day.json`，即指挥台的 24 hours 标签页：花名册时间窗（截至其 `generatedAt` 的 24 小时）上的[报告](#the-report)，它像报告本身一样读取周期记录、HEAD 的 git 历史与 Branch CI（包脚本设置了 `NODE_USE_ENV_PROXY=1`）；周期在写出自己的记录之前发布，因此这份报告把正在发布的周期列为没有记录的周期。每个文件都是其输入的纯函数（第三个文件的输入还包括 GitHub 的回答）。它的最后一步运行 `pnpm run enterprise:briefing`（[`scripts/enterprise-briefing.ts`](../../scripts/enterprise-briefing.ts)），写出 `apps/command-deck/public/fixtures/briefing.json`，即指挥台 `/briefing` 客户简报的数据：页面展示的每个数值，连同读取它的仓库路径或 URL 及其计算方法，数据来自花名册、台账、队列、班次与受理记录、周期记录与企业的周期提交、[实时对话记录捕获](../transcripts/README.md#live-capture)保存的周期日志与调度器日志、Proving Ground 与代码安全记录，以及通过 GitHub REST API 读取的本分支 Branch CI 运行与仓库可见性；API 无法读取时，这些数值记为未知，而不是让这一步失败。每个 fixture 都只在字节变化时重写；[`deck-pages.yml`](../../.github/workflows/deck-pages.yml) 在指挥台分支上每一次触及 `apps/command-deck/**` 的推送时重新发布 <https://lbjlincoln.github.io/deepseek-harness/>，fixture 的变化正属于此。

## 重新生成

```sh
pnpm run enterprise:functions   # the functions of the ticketless divisions, appended to the ledger
pnpm run roster                 # the roster over every record and every ledger line
pnpm run enterprise:publish     # the deck's fixtures from the roster and the ledger, then the briefing's
```

每条命令都是幂等的，在任何后续提交上都可安全运行：职能运行器只追加、从不改写，每个 CI 裁决只记录一次，API 无法读取时让裁判空缺而不是失败；生成器在未变的输入上逐字节复现 `roster.json`，只在记录、来源或台账行变化时重新盖章，来源移动会让它在写入任何东西之前带着该来源的名字失败；发布器只在字节变化时重写 fixture。引擎在每个班次之后按此顺序运行这三条命令。

## 周期

[`scripts/enterprise-cycle.sh`](../../scripts/enterprise-cycle.sh) 依次运行企业一次：由协调人执行[受理](#intake)，它答复所有者的[请求](#requests)，并在开放工单少于 `ENTERPRISE_MIN_OPEN`（默认 8）张时补充队列，其结果先提交、推送，使班次的克隆能看到新工单；以 `--push` 对按引擎队列顺序排在最前的 `ENTERPRISE_TICKETS`（默认 2）张开放工单运行一个[班次](#shifts)，周期把 `ENTERPRISE_HEAVY_LOCK`（默认 `/tmp/dsh-heavy.lock`）导出给它，使其每个重型验收运行仅在运行期间持有这把锁；在新的分支顶端运行不需要工单的[职能](#functions)，每个重型关卡同样仅在运行期间持有这把锁；运行 `pnpm run roster` 与 `pnpm run enterprise:publish`；写出本周期的[记录](#the-cycle-record)；最后把职能行与证据、花名册、指挥台数据和记录合为一个提交并推送。无论前面步骤结果如何，每一步都会运行，例外只有两个：被用量上限停下的受理（退出码 3）会跳过班次；无法写出的记录是失败的步骤 `record`，之后推送照常运行。`ENTERPRISE_PUSH_LOCK_WAIT` 不是整数秒时，周期以退出码 2 退出；另一个周期持有锁时，周期以退出码 4 退出；检出中已跟踪文件有未提交修改时以退出码 5 退出；其余情况以第一个失败步骤的退出码退出；设置了 `ENTERPRISE_COMMIT_TRAILERS` 时，周期自身的提交会带上它。周期的提交与推送只携带机器写出的数据，并与班次和转录捕获循环一样带 `--no-verify`：仓库的 pre-push 钩子会对整个工作区做约三分钟的类型检查，其间捕获循环的推送会移动分支顶端，运行了钩子的推送因而被拒。每次推送都先变基到远端顶端，并在 2、4、8、16 秒后重试，失败的变基会在下一次尝试前中止。每次尝试都在拉取与推送前后持有推送锁 `ENTERPRISE_PUSH_LOCK`（默认 `/tmp/dsh-push.lock`），最多等待 `ENTERPRISE_PUSH_LOCK_WAIT` 秒（默认 1800），没能及时取得锁则推送失败；周期把两者导出给班次，班次引擎从抓取起经重新认证直到推送都持有同一把锁，转录捕获循环则在拉取、提交与推送前后持有它。变基冲突的推送——其他写入者也会重新生成的花名册、计分板、遥测与指挥台数据会造成这种冲突——会在远端顶端上重建：未推送提交在 `data/enterprise/` 下新增的文件（职能日志、受理与周期记录、获准的工单）及其新增的台账行保存到 `TMPDIR` 下，检出被重置到顶端，两者被恢复（顶端已有的行不会重复追加），`pnpm run roster` 与 `pnpm run enterprise:publish` 重新生成其余部分，然后推送重建的提交。开始周期时持有未推送提交的检出会在拉取之前以同样方式推送它们，而不是让快进失败。只有专用的链接 worktree 才会被重置；在其他任何检出中重建都会失败，提交保持不动。企业每两小时从开发分支的专用检出运行一次周期，因此不会写入任何操作者的工作树。

[`scripts/enterprise-scheduler.sh`](../../scripts/enterprise-scheduler.sh) 让周期在没有操作员会话时仍按时运行。它在该检出中启动一次并脱离终端运行，在每个能被 `ENTERPRISE_SCHEDULE_HOURS`（默认 2）整除的 UTC 小时的第 `ENTERPRISE_SCHEDULE_MINUTE`（默认 13）分钟运行周期，把每个周期的输出写到 `<ENTERPRISE_CYCLE_LOGS>/cycle-<UTC 时间戳>.log`（默认 `/home/user/enterprise-cycles`），把自己的环境传给每个周期，并等待它启动的每个周期结束；若到某个时间点时一个手动启动的周期仍在运行，它先等该周期结束再启动自己的周期，因此一个较长的周期只会推迟下一个周期，而不会让它被跳过。第二个调度器以退出码 4 退出，小时不在 1 到 24 的整数范围内或分钟不在 0 到 59 的整数范围内的调度以退出码 2 退出。容器重启会结束它，因此看守企业的定时 Routine 在它未运行时会重新启动它。

## 周期记录

`cycles/<周期 id>.json` 记录一个周期做了什么：由 `pnpm run enterprise:cycle-record`（[`scripts/enterprise-cycle-record.ts`](../../scripts/enterprise-cycle-record.ts)）在周期的发布步骤之后写出，并随周期的最后一个提交一起提交，因此无论容器本地的日志后来如何，分支都保存着每一个最后推送到达了它的周期。周期脚本为每个步骤向一个临时文件追加一行 `<name> <exit code> <UTC time>`；该命令读取这个文件和检出，校验记录，并且从不覆盖已有的记录。一条记录包含：

- `cycle`、`startedAt`（id 所标记的时刻）、`endedAt`（构建记录的时刻）与 `startedBy`：`scripts/enterprise-scheduler.sh` 是周期的父进程时为 `scheduler`，否则为 `operator`（周期脚本早于该字段的记录中没有它）；
- `commits`：`start`，周期开始时检出所在的提交，即运行的周期脚本所在的提交；`pulled`，首次拉取之后的提交，周期新增的台账行以它的台账为基准计数；`end`，构建记录时所在的提交，即周期最后一个提交的父提交；
- `steps`：记录之前运行过的每个步骤，按顺序，形如 `{ name, exit, at }`——`pull`、`intake`、`intake-push`、`shift`（受理停在用量上限而跳过班次时不出现）、`pull-after-shift`、`functions`、`roster`、`publish`；
- `shifts`、`tickets` 与 `functions`：台账在周期内新增的工单行所属的班次 id、这些工单行按状态的计数，以及新增的职能行按结果的计数；台账行按多重集合比较，因此重排了它们的变基也只把每行计一次；`unreadable` 统计新增行中任何读取方都无法使用的行数；
- `firstFailure`：第一个以非零码退出的步骤，形如 `{ step, exit }`，或为 `null`；
- `previous`：检出中较早记录里最新的一条，以及 `recordOnRemote`：本周期首次拉取时远程分支是否已包含它（检出没有远程跟踪引用时为 `null`）。

一条记录无法陈述它自己的最后推送，由下一个周期的 `previous.recordOnRemote` 陈述：那次推送送达了它时为 `true`；到下一个周期开始时它仍未到达远程分支时为 `false`，此时下一个周期会在拉取之前推送检出保留的提交。在第一个步骤之前以退出码 4 或 5 退出的周期、记录无法写出的周期，以及运行中途被容器重置终止的周期，都没有记录；分支只能通过这样的周期推送过的提交看到它——`chore(enterprise): <cycle id> intake` 与 `chore(enterprise): <cycle id> functions, roster and deck`——记录出现之前的每个周期也是如此，[报告](#the-report)把它计为只在 git 历史中可见。

## 报告

`pnpm run enterprise:report -- [--since <ISO>] [--until <ISO>] [--write]`（[`scripts/enterprise-report.ts`](../../scripts/enterprise-report.ts)）以 Markdown 打印企业在一个时间窗内（两端都包含）做了什么；`--until` 默认为当前时刻，`--since` 默认为 `--until` 之前 24 小时。它读取检出——台账、[周期记录](#the-cycle-record)、班次与受理记录、损失登记 `data/transcripts/LOSSES.md`、已记录的会话、HEAD 的 git 历史、花名册生成器——并像[职能](#functions)运行器那样，经代理以无凭据方式从 GitHub REST API 读取 Branch CI 的运行，因此在固定的时间窗上，给定仓库与这些回答，它的输出是确定的。`--write` 还会写出 `reports/<until 形如 YYYY-MM-DDTHHMMZ>.json` 与 `.md`。报告以一句陈述试点精确计数的标题开头，并报告：

- 时间窗内开始的周期：由记录统计数量、干净与失败的周期，以及每个步骤在多少个周期中失败；每个周期由谁启动（其记录的 `startedBy`；在 `scripts/enterprise-scheduler.sh` 首次提交之前开始的周期则为操作员）；每条记录是否到达了远程分支，以下一条记录的陈述为准；没有记录的周期由指名它的提交计数，并标注为只在 git 历史中可见、结果未知；
- 班次：时间窗内开始的每个班次记录及其程序结果与中止情况、只由时间窗内台账行显示的每个班次，以及损失登记中点名、两者都没有留下的每个班次，以其 id 中的时刻、落在登记首次提到它的那一天来确定时间；
- 时间窗内工单行按状态与按事业部的计数，其评审按批准、拒绝、未进行分类，以及已交付的不同工单及其提交；
- 每个已交付提交的 Branch CI 裁决：以该提交本身为 head 的运行中有一个作出过裁决或仍在排队、运行时，取这些运行；否则是在该提交之后创建、作出过裁决、且在检出历史中 head 包含它的第一个运行，并标注为来自那次后续运行，同时列出该提交自身被后一次推送取代的运行；否则为 `no run`；
- 时间窗内职能行按事业部与结果的计数；
- 开销，每个来源一个总计，各自标明所覆盖的内容，并且因为相互重叠而从不相加：工单行的 token 数与秒数、受理协调人的计数、按记录树（班次、受理、Proving Ground、代码安全）统计的、最新事件落在时间窗内的已记录会话的 token 数与模型耗时、职能行的秒数，以及已记录周期的实际耗时；
- 各事业部定义、在岗与活跃的席位数，来自在时间窗结束时刻、以不晚于该时刻的台账行与已记录会话运行的花名册生成器。

数据未显示的内容都列在 Unknown 下，而不是推断：只在 git 历史中可见或没有记录陈述其启动者的周期、丢失班次的工单与开销、无法读取的记录或台账行、API 无法给出或其运行 head 不在检出中的裁决、没有 token 数的行或协调人、折叠无法读取的会话，以及尚无后续记录陈述其推送的记录。

`pnpm run enterprise:verdicts`（[`scripts/enterprise-verdicts.ts`](../../scripts/enterprise-verdicts.ts)）以 Markdown 表格打印台账工单行交付过的每个提交，范围从台账的第一行到当前时刻，列出它承载的工单、它的裁决、依据（`exact`、`later`、`none` 或 `unknown`）、那是哪一次运行，以及该运行的页面，每一项都按报告的方式作答。

# 企业花名册

[English](README.md) | 中文

本目录下的 `roster.json` 是为企业概念验证生成的花名册，包含 147 个席位定义：由本仓库真实定义的来源构建出的"角色 x 事业部 x 专精方向"组合，每个席位都附带已提交的会话记录与台账为它提供的证据。[`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) 生成该文件（`pnpm run roster`）；[`scripts/harness-feed.ts`](../../scripts/harness-feed.ts) 在重新计算实时会话状态后提供服务（`pnpm run feed`）。花名册不是记录在案的组织：记录在案的组织是[台账](#the-ledger)——它旁边的 `ledger.jsonl`，每条交付物一行——以及 feed 在 `GET /programs` 上提供的项目运行。各位包管家领取工作的队列位于 [tickets/](tickets/README.md)，由[班次](#shifts)处理；不需要工单的事业部按计划执行各自的[职能](#functions)。

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
- 恰好这些席位的 `status` 为 `"active"`，其余均为 `"defined"`；实时会话状态属于 feed，绝不写进这里。

时间窗按 `generatedAt` 而非读取时刻度量，因此该文件是一份写明时刻的快照：在未变的输入上重新生成，字节完全一致；每一条新的台账行或记录都会改变内容，从而重新盖章并重新度量时间窗。[企业运作模型 Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-enterprise-functions-and-occupancy.md) 记录了这条规则为何只计交付物而不计其他。

## 台账

`ledger.jsonl` 只追加、从不改写，每行一个 JSON 对象。两种行类型共用它；没有 `type` 的行按工单行读取，缺少读取方所依赖字段（`at`、`seat`、`division`，以及该类型自身的必填字段）的行会被跳过并按行号报告，而不是被猜测。

- **工单行**是一个班次中处理过的一张工单，由[引擎](#shifts)（`pnpm run enterprise -- shift`）追加：`{ "type": "ticket", "at", "shift", "ticket", "seat", "division", "programId", "implementer", "model", "department": { "outcome", "sessionId" }, "checks": [{ "id", "ok" }], "review": { "verdict", "sessionId" }, "integration": { "outcome" }, "shipped": { "commit" } | null, "reason", "tokens", "seconds" }`。`department.outcome` 取 `certified`、`failed`、`blocked`、`abandoned`、`pending` 或 `halted`；`review.verdict` 取 `approve`、`reject` 或 `none`；`integration.outcome` 取 `merged`、`skipped`、`conflict`、`checks-failed`、`digest-mismatch` 或 `not-shipped`；`shipped.commit` 是分支上承载该工单修改的提交。工单的状态取其最近一行：`shipped` 指 `shipped` 指明了一个提交，`rejected` 指评审结论为 `reject`，其余为 `halted`——验收失败的部门、集成无法组装的修改，或被路由用量上限停下的班次（原因写作 `halted: limit (resets at <instant>)`）——没有任何行的工单为 `queued`。工单一旦为 `shipped` 或 `rejected` 即告关闭；`halted` 的工单保持开放，由后续班次再次处理。
- **职能行**是一个席位在一个提交上执行其职能，由 `pnpm run enterprise:functions` 追加：`{ "type": "function", "at", "shift", "seat", "division", "function", "target": { "commit", "via"?, "requested"? }, "outcome": "pass" | "fail" | "error", "evidence": { "path" } | { "url" }, "seconds" }`。`at` 是交付物自身的时间——关卡结束之时，或 CI 裁决作出之时——`outcome` 是关卡或裁决的结果，`error` 表示未能取得裁决，`evidence` 是席位写出的输出，或它读取裁决的页面。

## 班次

一个班次是 [enterprise-shift 引擎](../../examples/headless-agent/tests/fixtures/enterprise-shift/README.md)的一次运行（`pnpm run enterprise -- shift --next <n> --push`）：它克隆开发分支的顶端，让选中的未关闭工单在各自的工作树里经由程序工作流完成，由一位独立评审员对每个已认证的修改作出裁定，把获批的修改装配为每张工单一次提交，重新认证，再连同班次自己的提交一起快进推送到分支。那次提交携带班次的台账行与记录，因此分支是班次唯一的汇报之处。无人值守的班次与受理没有人工发布关卡：没有人评审它们发运的内容，它们的程序不带 `requireSignoff` 运行，它们的记录把规格冻结与发布写作机器主体（`daliesk-enterprise-shift`、`daliesk-enterprise-intake`）的决定，其 `decidedBy` 写明引擎以及班次或受理运行；人所评审的是事后的分支。

`shifts/<UTC 日期>-<班次 id>/` 是班次的记录：`result.json`（班次、程序报告、引擎的 `decisions`、每张工单的台账行连同评审员的理由、停机信息）、`manifest.json`（基准修订、分支、组合、每个文件的 SHA-256）以及班次运行的每个会话的 `sessions/<会话 id>.jsonl`——程序台账、每个部门、每次评审、整合——其中形似凭据的字符串已剪除并计数。记录由运行它的班次写入，此后不再改写。

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

正在运行的 feed（`pnpm run feed`）上的 `GET /roster` 会在它发现的每次运行（包括实时运行）上重新计算每个席位的会话证据、`counts.occupied`、`evidence` 与 `unattributed`，并仅凭这些会话设置每个席位的 `status`：当归属于它的某个会话属于仍在运行的运行时为 `active`；一旦它的某个会话记录了证书事件，变为 `certified`；若它的会话都已结束但未记录证书，则为 `failed`。没有任何被发现会话占据的席位，在 feed 上一律读作 `"defined"`，无论文件里写的是什么；feed 的 `counts.active` 统计的是运行中的会话，而不是台账的一天；文件与指挥台发布的数据才是台账计数所在。一次全新检出、尚无运行时数据时，feed 会报告已提交记录的证据与 `active: 0`，这是正确的答案。

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

当[工单队列](tickets/README.md)中的开放工单少于其下限时，由 Program Departments 协调人补充队列：`pnpm run enterprise:intake` 运行一个以协调人为部门的 program，每位协调人为自己的包族提出工单，只有其确定性准入接受的拟议工单才会被提交。每次运行都在 `intake/` 下写出记录，并为部门运行过的每位协调人向 `ledger.jsonl` 追加一行职能行。[enterprise-intake fixture](../../examples/headless-agent/tests/fixtures/enterprise-intake/README.md) 说明命令、准入与记录；[Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-coordinators-intake.md) 记录这一决策。

## 请求

所有者通过提交一个请求 `requests/<name>.md` 向企业交派工作：第一行为 `# <title>`，其下是自由文本，别无其他。当一张工单的 `source.path` 就是某个请求的文件时，这张工单即答复了该请求；只有这样的工单可以取优先级 `0`，[班次](#shifts)的队列顺序会把它排在每一张未尝试过的工单之前。`pnpm run enterprise:requests`（[`scripts/enterprise-requests.ts`](../../scripts/enterprise-requests.ts)）打印每个请求的文件、标题与状态——`waiting`、`refused`、`queued`、`halted`、`shipped` 或 `rejected`——这些状态只从队列、台账与受理记录推导。[请求 README](requests/README.md) 说明如何撰写请求以及每种状态的含义。

## 代码安全专精方向指的是目标，而非已实现的扫描器

本仓库是 TypeScript/JavaScript 项目，不附带 Java、Go、PHP 或移动端的静态分析工具。每个"部门 x 专精方向"审查员席位——包括本仓库尚未为其实现扫描器的四种语言——都引用其部门位于 `data/knowledge/code-safety/<department>/SKILL.md` 的真实审查知识包；专精方向记录的是该席位*为何而设*，而不是声称已有匹配的扫描器在运行。每位审查员、整合员与项目负责人也都以 `code-safety/<id>` 技能的形式使用该知识包（负责人还使用横切的审查方法与严重性与证据知识包）。审查员路由到 `openrouter`，循环使用本仓库自己的 Proving Ground 基准测试所组合的免费层模型 id（`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml`），由生成器提取而非硬编码。请阅读 [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) 了解每个部门具体由哪个来源支撑，并阅读 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md) 了解完整的理由。

## 发布指挥台

`pnpm run enterprise:publish`（[`scripts/enterprise-publish.ts`](../../scripts/enterprise-publish.ts)）从花名册、台账与工单队列重新生成指挥台的静态企业数据：`apps/command-deck/public/fixtures/roster.json`，即 `roster.json` 的逐字节副本；以及 `apps/command-deck/public/fixtures/enterprise.json`，即指挥台的台账标签页——`asOf`（花名册盖章时刻与最后一条台账行中较新者）、时间窗、按事业部的在岗与活跃席位、当天按状态分列的工单（queued 来自队列，其余来自每张工单在时间窗内的最新一行）、当天由新到旧的职能运行，以及最近十个已交付提交及其上记录的 CI 裁决（按提交前缀匹配）。它还写出 `apps/command-deck/public/fixtures/enterprise-day.json`，即指挥台的 24 hours 标签页：花名册时间窗（截至其 `generatedAt` 的 24 小时）上的[报告](#the-report)，它像报告本身一样读取周期记录、HEAD 的 git 历史与 Branch CI（包脚本设置了 `NODE_USE_ENV_PROXY=1`）；周期在写出自己的记录之前发布，因此这份报告把正在发布的周期列为没有记录的周期。每个文件都是其输入的纯函数（第三个文件的输入还包括 GitHub 的回答），只在字节变化时重写；[`deck-pages.yml`](../../.github/workflows/deck-pages.yml) 在指挥台分支上每一次触及 `apps/command-deck/**` 的推送时重新发布 <https://lbjlincoln.github.io/deepseek-harness/>，fixture 的变化正属于此。

## 重新生成

```sh
pnpm run enterprise:functions   # the functions of the ticketless divisions, appended to the ledger
pnpm run roster                 # the roster over every record and every ledger line
pnpm run enterprise:publish     # the deck's fixtures from the roster and the ledger
```

每条命令都是幂等的，在任何后续提交上都可安全运行：职能运行器只追加、从不改写，每个 CI 裁决只记录一次，API 无法读取时让裁判空缺而不是失败；生成器在未变的输入上逐字节复现 `roster.json`，只在记录、来源或台账行变化时重新盖章，来源移动会让它在写入任何东西之前带着该来源的名字失败；发布器只在字节变化时重写 fixture。引擎在每个班次之后按此顺序运行这三条命令。

## 周期

[`scripts/enterprise-cycle.sh`](../../scripts/enterprise-cycle.sh) 依次运行企业一次：开放工单少于 `ENTERPRISE_MIN_OPEN`（默认 8）张时，由协调人执行[受理](#intake)，并先提交、推送，使班次的克隆能看到新工单；以 `--push` 对按引擎队列顺序排在最前的 `ENTERPRISE_TICKETS`（默认 2）张开放工单运行一个[班次](#shifts)，周期把 `ENTERPRISE_HEAVY_LOCK`（默认 `/tmp/dsh-heavy.lock`）导出给它，使其每个重型验收运行仅在运行期间持有这把锁；在新的分支顶端运行不需要工单的[职能](#functions)，每个重型关卡同样仅在运行期间持有这把锁；运行 `pnpm run roster` 与 `pnpm run enterprise:publish`；写出本周期的[记录](#the-cycle-record)；最后把职能行与证据、花名册、指挥台数据和记录合为一个提交并推送。无论前面步骤结果如何，每一步都会运行，例外只有两个：被用量上限停下的受理（退出码 3）会跳过班次；无法写出的记录是失败的步骤 `record`，之后推送照常运行。另一个周期持有锁时，周期以退出码 4 退出；检出中已跟踪文件有未提交修改时以退出码 5 退出；其余情况以第一个失败步骤的退出码退出；设置了 `ENTERPRISE_COMMIT_TRAILERS` 时，周期自身的提交会带上它。周期的提交与推送只携带机器写出的数据，并与班次和转录捕获循环一样带 `--no-verify`：仓库的 pre-push 钩子会对整个工作区做约三分钟的类型检查，其间捕获循环的推送会移动分支顶端，运行了钩子的推送因而被拒。每次推送都先变基到远端顶端，并在 2、4、8、16 秒后重试，失败的变基会在下一次尝试前中止。企业每两小时从开发分支的专用检出运行一次周期，因此不会写入任何操作者的工作树。

[`scripts/enterprise-scheduler.sh`](../../scripts/enterprise-scheduler.sh) 让周期在没有操作员会话时仍按时运行。它在该检出中启动一次并脱离终端运行，在每个能被 `ENTERPRISE_SCHEDULE_HOURS`（默认 2）整除的 UTC 小时的第 `ENTERPRISE_SCHEDULE_MINUTE`（默认 13）分钟运行周期，把每个周期的输出写到 `<ENTERPRISE_CYCLE_LOGS>/cycle-<UTC 时间戳>.log`（默认 `/home/user/enterprise-cycles`），把自己的环境传给每个周期，并等待它启动的每个周期结束；若到某个时间点时一个手动启动的周期仍在运行，它先等该周期结束再启动自己的周期，因此一个较长的周期只会推迟下一个周期，而不会让它被跳过。第二个调度器以退出码 4 退出，小时不在 1 到 24 的整数范围内或分钟不在 0 到 59 的整数范围内的调度以退出码 2 退出。容器重启会结束它，因此看守企业的定时 Routine 在它未运行时会重新启动它。

## 周期记录

`cycles/<周期 id>.json` 记录一个周期做了什么：由 `pnpm run enterprise:cycle-record`（[`scripts/enterprise-cycle-record.ts`](../../scripts/enterprise-cycle-record.ts)）在周期的发布步骤之后写出，并随周期的最后一个提交一起提交，因此无论容器本地的日志后来如何，分支都保存着每一个最后推送到达了它的周期。周期脚本为每个步骤向一个临时文件追加一行 `<name> <exit code> <UTC time>`；该命令读取这个文件和检出，校验记录，并且从不覆盖已有的记录。一条记录包含：

- `cycle`、`startedAt`（id 所标记的时刻）与 `endedAt`（构建记录的时刻）；
- `commits`：`start`，周期开始时检出所在的提交，即运行的周期脚本所在的提交；`pulled`，首次拉取之后的提交，周期新增的台账行以它的台账为基准计数；`end`，构建记录时所在的提交，即周期最后一个提交的父提交；
- `steps`：记录之前运行过的每个步骤，按顺序，形如 `{ name, exit, at }`——`pull`、`intake`、`intake-push`、`shift`（受理停在用量上限而跳过班次时不出现）、`pull-after-shift`、`functions`、`roster`、`publish`；
- `shifts`、`tickets` 与 `functions`：台账在周期内新增的工单行所属的班次 id、这些工单行按状态的计数，以及新增的职能行按结果的计数；台账行按多重集合比较，因此重排了它们的变基也只把每行计一次；`unreadable` 统计新增行中任何读取方都无法使用的行数；
- `firstFailure`：第一个以非零码退出的步骤，形如 `{ step, exit }`，或为 `null`；
- `previous`：检出中较早记录里最新的一条，以及 `recordOnRemote`：本周期首次拉取时远程分支是否已包含它（检出没有远程跟踪引用时为 `null`）。

一条记录无法陈述它自己的最后推送，由下一个周期的 `previous.recordOnRemote` 陈述：那次推送送达了它时为 `true`；到下一个周期开始时它仍未到达远程分支时为 `false`，此时下一个周期自己的推送会带上检出保留的那个提交。在第一个步骤之前以退出码 4 或 5 退出的周期、记录无法写出的周期，以及运行中途被容器重置终止的周期，都没有记录；分支只能通过这样的周期推送过的提交看到它——`chore(enterprise): <cycle id> intake` 与 `chore(enterprise): <cycle id> functions, roster and deck`——记录出现之前的每个周期也是如此，[报告](#the-report)把它计为只在 git 历史中可见。

## 报告

`pnpm run enterprise:report -- [--since <ISO>] [--until <ISO>] [--write]`（[`scripts/enterprise-report.ts`](../../scripts/enterprise-report.ts)）以 Markdown 打印企业在一个时间窗内（两端都包含）做了什么；`--until` 默认为当前时刻，`--since` 默认为 `--until` 之前 24 小时。它读取检出——台账、[周期记录](#the-cycle-record)、HEAD 的 git 历史、花名册生成器——并像[职能](#functions)运行器那样，经代理以无凭据方式从 GitHub REST API 读取 Branch CI 的运行，因此在固定的时间窗上，给定仓库与这些回答，它的输出是确定的。`--write` 还会写出 `reports/<until 形如 YYYY-MM-DDTHHMMZ>.json` 与 `.md`。它报告：

- 时间窗内开始的周期：由记录统计数量、干净与失败的周期，以及每个步骤在多少个周期中失败；每条记录是否到达了远程分支，以下一条记录的陈述为准；没有记录的周期由指名它的提交计数，并标注为只在 git 历史中可见、结果未知；
- 时间窗内工单行按状态与按事业部的计数，以及已交付的不同工单及其提交；
- 每个已交付提交的 Branch CI 裁决：以该提交本身为 head 的运行中有一个作出过裁决或仍在排队、运行时，取这些运行；否则是在该提交之后创建、作出过裁决、且在检出历史中 head 包含它的第一个运行，并说明是哪一种，同时列出该提交自身被后一次推送取代的运行；否则为 `no run`；
- 各事业部定义、在岗与活跃的席位数，来自在时间窗结束时刻、以不晚于该时刻的台账行与已记录会话运行的花名册生成器；
- 时间窗内职能行按事业部与结果的计数；
- 工单行陈述的 token 数与秒数、职能行的秒数，以及已记录周期的实际耗时。

数据未显示的内容都列在 Unknown 下，而不是推断：只在 git 历史中可见的周期、无法读取的记录或台账行、API 无法给出或其运行 head 不在检出中的裁决、没有 token 数的工单行，以及尚无后续记录陈述其推送的记录。

`pnpm run enterprise:verdicts`（[`scripts/enterprise-verdicts.ts`](../../scripts/enterprise-verdicts.ts)）以 Markdown 表格打印台账工单行交付过的每个提交，范围从台账的第一行到当前时刻，列出它承载的工单、它的裁决、依据（`exact`、`later`、`none` 或 `unknown`）、那是哪一次运行，以及该运行的页面，每一项都按报告的方式作答。

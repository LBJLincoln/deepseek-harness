# enterprise-intake：由协调人答复所有者的请求并提出队列的下一批工单

[English](README.md) | 中文

`pnpm run enterprise:intake` 运行的 [program](../../../../../packages/improvement/program/README.md)，在所有者提交了尚无工单答复的[请求](../../../../../data/enterprise/requests/README.md)时，或在[工单队列](../../../../../data/enterprise/tickets/README.md)见底时启动：每个请求占一个部门，把它变成恰好一张工单；[花名册](../../../../../data/enterprise/README.md)中每位负责补充的 Program Departments 协调人也占一个部门，阅读自己的包族并提交至多 `--max-tickets` 张拟议工单；每个部门都由一位协调人担任，并由准入（admission）度量，即决定哪些拟议工单进入队列的确定性规则。[`scripts/enterprise-intake.ts`](../../../../../scripts/enterprise-intake.ts) 是命令本身，[`scripts/enterprise-intake-admission.ts`](../../../../../scripts/enterprise-intake-admission.ts) 承载这些规则，关于[协调人受理](../../../../../.agents/notes/implemented/architecture/2026-09-28-coordinators-intake.md)与[所有者请求](../../../../../.agents/notes/implemented/architecture/2026-09-28-owner-requests.md)的 Agent Note 记录受理方为何如此构建。

## 一次受理做什么

1. 读取所有者的请求：`data/enterprise/requests/` 下除 README 这一对文件之外的每个 Markdown 文件，按文件名顺序，保留尚无工单答复的那些；当一张工单的 `source.path` 就是某个请求的文件时，这张工单即答复了该请求。第一个非空行不是 `# <title>` 的请求当即以这一原因被拒，不占任何部门。
2. 统计开放工单：`data/enterprise/tickets/` 下的每张工单，只要它在 `data/enterprise/ledger.jsonl` 中最新的工单行既没有写明已发布的提交，也没有写明 `reject` 结论，就是开放的；台账不存在时，所有工单都是开放的。数量达到或超过 `--min-open`（默认 8）时队列无需补充；若同时也没有带标题的请求在等待，它在自己的记录目录下写入 `outcome: "nothing-needed"` 的 `result.json`，并以 0 退出。
3. 选定部门，两类部门互不相干：每个等待中的请求一个部门，按文件名顺序至多 `--max-requests` 个（默认 2），由协调人从开放工单最少的那位起轮流担任；开放工单低于 `--min-open` 时，每位负责补充的协调人一个部门，即 `--coordinators` 点名的席位，或开放工单最少的 `--count` 位（默认 2）。一位协调人名下计入它所拥有的、或其 scope 或 source 位于其包族内的每张开放工单，数量相同时按花名册顺序排列。
4. 把已提交的 tip 克隆到 scratch 目录，再为同一提交添加第二个 worktree，作为运行检查的干净检出，并为它安装依赖（`--install`，默认 `pnpm install --offline --frozen-lockfile`）。两者都不含 `data/`，只保留 `data/enterprise/`（`--exclude`），program 从这个克隆添加的每个 worktree 也同样不含这些目录。
5. 通过 [`driver.ts`](driver.ts) 运行 program，请求的部门排在最前，每个部门都在组合的路由上运行，以组合中的上限为预算。请求的部门以 `request-<文件名>` 为键，以 [`requestObjective`](../../../../../scripts/enterprise-intake.ts) 写出的目标创建，目标中逐字附上请求原文；它在 `.intake/<key>.json` 提交一张工单，其席位是请求所涉代码或文档所属的那个席位，其 source 是请求的文件及其标题行，其优先级为 `0`。协调人的部门以 [`coordinatorObjective`](../../../../../scripts/enterprise-intake.ts) 写出的目标创建，把拟议工单提交在 `.intake/<seat>.json`。每个部门都由一项检查认证：对它提交的文件运行 `enterprise-intake.ts admit`，请求的部门另以 `--request` 指明该请求；准入至少接纳一张拟议工单时即通过。拟议工单全部被拒的部门会得知原因，并多得一轮。整合合并各拟议文件，并以干净的工作树为门槛。
6. 把每个部门已提交的拟议工单再准入一次，请求的部门在前，协调人的部门随后按席位顺序，使编号与重复在部门之间一并判定，并把每张被接纳的工单写入队列。未获认证的部门没有工单被接纳。
7. 写出自己的记录，其中写明它所处理的每个请求的结果，并为触达过路由的每个部门追加一行职能行。

## 准入

一张拟议工单只有在下列规则按此顺序全部成立时才被接纳；被拒的拟议工单不占编号，因此被接纳的工单无间隔地接续队列编号。

| 规则 | 拒绝代码 |
|---|---|
| 它位于其部门前 `--max-tickets` 张拟议工单之内；对请求的部门而言，它是第一张。 | `over-limit` |
| 它答复某个请求，当且仅当它的部门就是该请求的部门：请求的部门提交的工单，其 `source` 是该请求的文件及其标题行，其 `priority` 为 `0`；其他部门都不得以请求作为 source。 | `request` |
| 赋予队列的下一个编号后，[`validateTickets`](../../../../../scripts/enterprise-tickets.ts) 在所有已排队工单旁接受它。 | `invalid` |
| 它的 `seat` 拥有它的 `scope`：在 `source` 覆盖每个 scope 条目的花名册席位中，覆盖前缀最长的那些。`README.md` 形式的 source 覆盖其所在目录，目录覆盖它自身，文件只覆盖它自己。 | `owner` |
| 没有任何开放或已发布的工单、也没有同一次受理中更早接纳的工单，与它有相同的 `source.path` 和 `source.anchor`。 | `duplicate` |
| 它带有自己的检查：除 `pnpm run typecheck`、`pnpm run doc-sync` 和 `--coverage` 运行之外的验收命令；按队列规则，后三者在改动前后都通过。 | `no-own-check` |
| 它自己的每项检查在干净检出中以 `bash -c` 运行，都在 `--check-timeout-ms`（默认 120000）之内以非零状态退出。 | `passes-before`、`timeout` |

每项检查在自己的进程组中运行，其环境中去掉了名称含 `KEY`、`SECRET`、`TOKEN` 或 `PASSWORD` 的每个变量以及整组 `GIT_CONFIG_*`；改动了干净检出的检查会被记录，并在下一项检查前重置该检出。准入时不运行守护命令：引擎在验证已实现的工单时会运行每条验收命令。

## 用量上限

[`route-wall.ts`](route-wall.ts) 与 program 一起组合。任何会话中第一个以 LLM seam 的 `QUOTA` 失败结束的回合（Claude Code 路由给产品用量上限提示的分类）都会把整个进程隔断：之后的每一步都在请求组装之前被拒绝，该会话的 goal 以 `route-limit` 阻塞，program 把它记为该部门的阻塞代码。被拒绝截断的部门还会对其已提交内容再做一次验证；其后的每个部门都在第一步就被阻塞，没有任何请求触达路由。随后受理方接纳已认证部门提交的内容，记录这次拒绝以及提示中写明的重置时刻，并以 3 退出。

## 记录与台账

每次受理都会写出 `data/enterprise/intake/<UTC date>-<hhmmss>-<suffix>/`：

| 文件 | 内容 |
|---|---|
| `result.json` | 目标提交、开放工单数、结果（`nothing-needed`、`ran`、`route-limit`）、program 的 id 与结果、无人作出的 `decisions`（规格冻结与发布，各自点名机器主体 `daliesk-enterprise-intake` 与 `decidedBy: "the enterprise intake, run <id>"`，覆盖计划的 SHA-256）、所处理的每个请求的部门及其结果、每位负责补充的协调人的状态、token、秒数、被接纳的编号与拒绝、路由上限，以及各会话 id |
| `<key>.json` | 一个部门，请求的部门为 `request-<name>.json`，负责补充的协调人的部门为 `<seat>.json`：它提交的拟议工单，以及每条结论连同运行过的自有检查、其退出码与输出尾部 |
| `sessions/<session id>.jsonl` | program 的每份会话日志：台账、各部门、整合 |

请求的 `result` 为 `admitted` 时附上答复它的 `ticket`；为 `refused` 时附上 `reason`，即准入给出的每条原因，或部门结束时没有提交任何工单，或第一行不是 `# <title>`；为 `unanswered` 时，表示它的部门在完成之前就被截断，且其已提交内容没有因自身原因被拒。被拒或未获答复的请求会由下一次受理再次处理，因此所有者修改被拒的请求后就会得到一次新的尝试；`pnpm run enterprise:requests` 读回这些结果。

每个文件写出前都会遮蔽形似凭据的字符串，`result.json` 按模式统计遮蔽次数。触达过路由的每个部门在 `data/enterprise/ledger.jsonl` 中得到一行，写明担任该部门的协调人：`{ "type": "function", "at", "shift", "seat", "division", "function": "intake", "target": { "commit" }, "outcome", "evidence": { "path" }, "seconds" }`，其中 `outcome` 在它有工单被接纳时为 `pass`，在该部门完成之前就被截断（用量上限、预算耗尽）时为 `error`，其余为 `fail`；`at` 是它的会话结束的时刻；`evidence.path` 是它的 `<key>.json`；`shift` 是 `--shift` 的值或受理方自己的 id。在第一个请求之前就被隔断的部门不得到任何一行。

## 两种组合

[`cordis.yml`](cordis.yml) 是无密钥的一半：各部门运行在 [`intake-llm.ts`](intake-llm.ts) 注册的 `cli-mock` 路由上，它读取一份脚本，为每个部门键指定要提交的 [`scripted/`](scripted) 下的拟议文件，或要用来拒绝的产品用量上限提示。[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) 是真实的一半：禁用脚本路由，插入操作者本人的 Claude Code 安装并以中等 effort 使用 `sonnet`，每个部门的上限提高到 4,000,000 token、1,500 秒。

## 无密钥运行

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/enterprise-intake.e2e.ts
```

e2e 位于 [`examples/headless-agent/tests/enterprise-intake.e2e.ts`](../../enterprise-intake.e2e.ts)。它在由 [`seed/`](seed) 生成的仓库上运行该命令，seed 含两位协调人的花名册与只有一张工单的队列：一次使用 `--min-open 1`，此时什么都不需要；一次使用两位协调人，各接纳一张工单，并拒绝一张检查已经通过的拟议工单和一张重复已排队工单 source 的拟议工单；一次使用 `--min-open 1` 与四个请求，此时无需补充，但会答复前两个带标题的请求，以优先级 `0` 接纳其中一张，因优先级拒绝另一张，拒绝没有标题行的那个请求，把第四个留给之后的受理，并通过 `pnpm run enterprise:requests` 读回这四个状态；一次让第一位协调人被用量上限提示拒绝，运行随即停止，第二位协调人没有发出任何请求。

## 真实运行

在 tip 已提交的检出中，装好并登录 `claude` CLI 后：

```sh
pnpm run enterprise:intake -- --count 2 --max-tickets 3 --scratch "$SCRATCH"
```

它把被接纳的工单、记录和台账行写入该检出，并在未给出 `--keep` 时删除自己的 scratch 目录；提交它们是操作者的行为。

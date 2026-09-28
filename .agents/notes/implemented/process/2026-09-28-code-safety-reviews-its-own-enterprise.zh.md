# Agent Note: The Code Safety division reviews its own enterprise's code

Status: implemented

[English](2026-09-28-code-safety-reviews-its-own-enterprise.md) | 中文

## Problem

Code Safety 部门占企业 147 个席位中的 43 个，而它此前运行过的每一次评审读的都是故意留有漏洞的公开应用——[OWASP NodeGoat 与 dvja](../../../../data/code-safety/README.md)——并对照该应用自己的已记载缺陷列表打分。那些评审都改变不了本仓库里的任何东西：发现描述的是别人的代码，部门的工作止于一份报告。一个让席位在本仓库上履行真实职能的企业，需要它的安全部门去读企业自己交付的代码，并且让部门在那里确认的发现成为企业自己的某个席位去修复、由[工单引擎](../../../../data/enterprise/tickets/README.md)去验证的工作。

本仓库带来了公开目标从未带来的三个问题。它没有基准真值，因此发现的数量无从对照。它大到无法一次评审完：program driver 拒绝超过 5,000 个文件的目标，必须选出一个切片，并像公开目标那样把它钉住。而一条被确认的发现需要一个队列所接受的负责人——对包代码而言，就是 `source` 覆盖该文件的那个 Harness Core 管理员席位。

## Decision

部门对自己企业的第一次评审，读仓库攻击面中一个有边界的切片：把它钉成一个目标，在带有预埋 canary 的副本上评审；每条发现都对照代码分拣，每条被确认的发现都成为一张工单，交给拥有该文件的管理员。

- **目标是四个外部 agent subagent provider。** [`targets/dsh-subagent-providers.target.json`](../../../../data/code-safety/targets/dsh-subagent-providers.target.json) 钉住 `subagent-claude-code`、`subagent-codex`、`subagent-acp` 与 `subagent-dsh-sdk`——每个包的 `src/`、`package.json` 与 `README.md`，`599da7580` 处的 24 个文件——并记下 program driver 自己的规则对这棵树算出的锁定摘要。切片由三条标准共同选出：这段代码运行不是 harness 写的代码，并解析那个进程跨进程边界写回来的内容；每个文件在花名册里都有一个 Harness Core 管理员席位；对它的一次评审能在约三十分钟内完成。[targets README](../../../../data/code-safety/targets/README.md) 说明了范围、它留在外面的东西，以及如何复现这次运行。
- **召回率从 canary 读出。** [`seed-defects.mjs`](../../../../data/code-safety/tools/seed-defects.mjs) 可以向 TypeScript 植入：四个目录条目锚定在从外部进程线协议消息里读出的值上，或锚定在模块级常量上（日志注入、`eval`、`RegExp` 构造、带硬编码回退值的令牌），每一行植入代码都由 TypeScript 解析器检查为独立成句的一条语句；副本不带 `.git`，因此没有哪个部门能从 `git diff` 读到植入的行。按目标文件的 seed 植入了八个 canary，每类两个；整个运行期间，答案被压缩存放在 scratch 目录树之外。同一项工作还修正了 seeder 的答案：只要有一处后来才被接受的插入落在同一文件更靠上的位置，它就会给出站点的原始行号。
- **运行采用交付的组合，只跑一次。** 在带种子的副本上执行 `pnpm run code-safety`，使用 Claude Code overlay、`sonnet`、六个默认部门，以及摘要为 `0ec2cc9b…` 的知识包（第三轮迭代保留的清单），从本分支一个干净的 HEAD 运行。[`record-run.mjs`](../../../../data/code-safety/tools/record-run.mjs) `--seeded` 像记录 NodeGoat 运行那样记录它，并把答案、seed manifest 与打分结果加进记录，与其余文件一起计算摘要。
- **每条发现都对照钉住的修订版本处的代码分拣**为已确认、误报或 canary；分拣表在 targets README 里。
- **每条被确认的发现成为一张工单**——分拣在读代码时自己发现的缺陷也一样，标明它来自分拣而不是某条发现——采用 [`scripts/enterprise-tickets.ts`](../../../../scripts/enterprise-tickets.ts) 所校验的格式，归属于 `source` README 位于该文件所在包内的那位管理员，引用该发现的 `path:line`，范围限定在该包，并以管理员新增的一个聚焦 spec 作为验收——它复现缺陷，因此在修复落地之前一直失败——外加该包的覆盖率运行与类型检查。一个超出一张工单的修复，成为针对其第一步的工单，并在工单里写明。
- **台账记录每个席位的职能。** `data/enterprise/ledger.jsonl` 为 [roster-evidence 归属规则](../../../../scripts/roster-evidence.ts)把本记录的会话归到的每个席位各写一条 `function` 记录：每个部门的 integrator 席位，以及 program lead。

## Alternatives considered

**评审整个仓库。** 从构造上就被拒绝：driver 会锁定目标下的每一个文件，拒绝超过 5,000 个文件的树，而抽样锁定会把某个部门在样本之外改过的文件报告为未改动。即使在限额之内，评审整棵树也要运行数小时，并且对其中大部分只能浅读。

**harness feed 服务器、MCP 工具服务器或 ACP 服务器。** 它们都解析或服务不可信的输入，但没有哪个 Harness Core 管理员的 `source` 覆盖 `scripts/harness-feed.ts`、`packages/mcp/` 或 `packages/acp/`，因此在队列的现状下，那里被确认的发现不会有席位来负责修复。等有席位拥有它们之后，它们就是下一批目标。

**评审不带种子的树，只从分拣结果读召回率。** 分拣说明的是有多少条发现是真的，而不是评审漏掉了多少个真实缺陷；没有 canary，一份干净的报告与一次什么也没看见的评审读起来是一样的。canary 的代价是它们引来的那些发现——这次是十一条中的七条——换来的是客户在没有基准真值时也能读懂的那一个数字。

**用 JavaScript 目录植入。** 目标里没有 `.js` 文件，也没有任何 `req.*` 读取；JavaScript 条目找不到任何站点。TypeScript 条目在这段代码真正拥有的输入上镜像 JavaScript 的缺陷类别：外部进程写回来的值。

**把每个复现提交为一个失败的测试。** 共享分支上的失败测试会让每一个运行测试套件的检查都失败，直到修复落地。工单在任务里携带复现，其验收运行管理员新增的那个 spec 文件，因此检查在修改之前失败、之后通过，而树里从不会出现一个红色的测试。

## Consequences

**部门读了自己企业交付的代码，并得到一个没有基准真值也站得住的读数。** 这次运行让六个部门与 integration 全部通过认证，审查器通过，1,390 秒内发布了 11 条发现。分拣没有确认其中任何一条：七条引用的是植入的代码行，四条陈述某个被精确钉住的依赖比 registry 上的最新版本旧，而没有任何安全公告针对这些被钉住的版本，仓库的 lockfile 又在切片之外。为分拣而阅读代码时，发现了评审漏掉的东西：在 Windows 上，Codex provider 在委派会话的工作区里启动裸名称 `cmd.exe` 与 `codex`，Claude Code 的批处理垫片启动裸名称 `cmd.exe`，而 libuv 启动进程时会先在该目录里查找裸文件名，然后才查找 PATH（CWE-427）。这个缺陷就是本次评审交给队列的工作，即 [T-0040](../../../../data/enterprise/tickets/T-0040.json) 与 [T-0041](../../../../data/enterprise/tickets/T-0041.json)；它也是 canary 读数无法显示的一次真实漏报，因为没有哪个 canary 模拟这一类缺陷。

**canary 让每一份发现列表更嘈杂，也让一个数字变得可读。** canary 发现绝不能变成工单，所以分拣首先剔除它们；十一条发现中有七条是 canary。作为交换，评审有了一个召回率读数：8 中 6，95% 区间 [0.409, 0.929]。

**八个 TypeScript canary 中有三个没有植入任何可达的缺陷。** TypeScript 线协议条目锚定的是一个声明以及读取它的那个对象，而不是值的类型；有三处站点持有的值已经被代码收窄为对象，`String()` 对它只会得到常量 `[object Object]`。injection 部门把这三处都读过，并正是以这个理由把它们排除，因此原始读数低估了评审：在五个携带子进程可控值的 canary 上，它读出 5 中 5，95% 区间 [0.566, 1.0]。一次要按字面接受其读数的 TypeScript seeding，需要一个能证明该值是字符串的锚点；在目录拥有这样的锚点之前，TypeScript 读数要同时写明这两个数字。

**不含 lockfile 的切片会把版本陈旧变成发现。** dependencies 部门无法对 24 个文件运行 `npm audit`，于是把四个被钉住的版本报告为过时；四条都是误报。钉住本仓库某个切片的目标，应当把 lockfile 中与切片依赖相关的条目纳入范围，或者告诉该部门 lockfile 在哪里。

**归属决定了什么值得评审。** 如今只有 Harness Core 管理员所拥有的包代码才能变成工单，因此 `packages/` 之外暴露最多的那些面——feed 服务器、MCP 工具服务器、ACP 服务器——要等到有席位拥有它们。

**这次运行没有越出它的目标。** 没有哪个部门读过其他运行的发现、被植入文件的原版或答案；data 部门为寻找自己的报告契约执行的 `find /` 列出了整台主机上的路径，而它只读了自己工作树里的副本；dependencies 部门在目标的父目录里寻找 lockfile，只找到了带种子的副本。

## Verification

- `node data/code-safety/tools/seed-defects.cases.mjs` 与 `pnpm exec vitest run scripts/code-safety-seeding.spec.ts scripts/code-safety-redaction.spec.ts` 通过；那个让后被接受的站点落在先被接受的站点之上的用例，在 seeder 修正行号之前的版本上失败。
- `pnpm run code-safety -- /home/user/enterprise-scratch/dsh-subagent-providers/repo --out .code-safety/dsh-self-review --model sonnet` 从 `0e9b0cb26`、在干净的树上运行了一次：program `program-cc53a346…`，24 个文件锁定于 `a2da9923…`，结果 `released`，审查器退出码 0，1,390 秒。
- `node data/code-safety/tools/record-run.mjs .code-safety/dsh-self-review 2026-09-28-dsh-self-review --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml --seeded /home/user/enterprise-scratch/dsh-subagent-providers` 写出了记录：15 个文件、8 份会话日志、从 secrets 会话中脱敏了一个示例云密钥、知识摘要 `0ec2cc9b…`，以及 8 中 6 的 seeded 读数。
- `node data/code-safety/tools/seeded-recall.mjs data/code-safety/2026-09-28-dsh-self-review data/code-safety/2026-09-28-dsh-self-review/seeded.ground-truth.json` 打印出 8 中 6、[0.409, 0.929]，漏掉的是 `SEED-006` 与 `SEED-007`。
- `data/enterprise/ledger.jsonl` 中的七条 `function` 记录，写明的正是 `scripts/roster-evidence.ts` 的 `attributeRun` 为本记录的八个会话给出的席位，每条的结果都是 `pass`，并以记录中的一个路径作为证据。
- `pnpm exec vitest run scripts/enterprise-tickets.spec.ts` 在含有 T-0040 与 T-0041 的队列上通过；每张工单自己的检查（`resolution-spec`、`no-bare-codex`、`batch-shim-spec`、`no-bare-cmd`）在提交工单时所针对的树上失败，而它们所列的覆盖率运行在那里通过。

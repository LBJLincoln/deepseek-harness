# Agent Note: 约束企业班次的验收命令与检查

Status: implemented

[English](2026-09-29-enterprise-shift-containment.md) | 中文

## Problem

一次针对[企业班次](2026-09-28-enterprise-shift-engine.md)的安全评审，在无人值守班次运行工单的方式中发现了三处缺口。工单的验收命令由模型在[准入](2026-09-28-coordinators-intake.md)时写下，并以 `bash -c` 运行三次：在部门的工作树里、在程序的合并头上，以及在引擎于克隆自身检出中进行的重新认证里，而引擎正是从这个检出推送的。准入只检查每条自有检查在干净顶端上失败，对命令本身是什么一无所查，因此工单可以携带 `git push`、`curl` 或 `gh`，引擎也会运行它。重新认证派生检查时、离线安装运行其生命周期脚本时，都使用引擎的完整环境，而在操作者的主机上，这个环境带有 `GH_TOKEN`、`GITHUB_TOKEN`、云服务密钥、`GIT_ASKPASS` 与代理变量。Claude Code 路由覆盖层为 `--implementer subagent` 的部门预先批准了 `Bash(pnpm exec:*)`，而 `pnpm exec` 能运行任何已安装的二进制，其中包括 `tsx -e` 与 `node -e`。

## Decision

**验收命令只能采用一组封闭的形式。** [`scripts/enterprise-acceptance.ts`](../../../../scripts/enterprise-acceptance.ts) 按 bash 的方式对命令行做词法分析，只接受这样的命令行：若干命令以 `&&`、`||` 与 `|` 连接，每条命令前可以有一个 `!`，每个词都是字面量——没有 `$`、反引号、`~`、未加引号的通配符或花括号、重定向、子 shell、`;`、`&`、注释或换行——且没有一个是绝对路径或含 `..` 段。每条命令必须是以下之一：对队列所列根脚本的 `pnpm run <script>`、`pnpm exec vitest run …`、`pnpm exec tsc …`、`grep …`、`test …`，或不带 `--output`、`--ext-diff`、`--textconv` 的 `git diff …`；无密钥种子所用的开放队列另外允许对仓库文件运行 `node <file>` 与 `sh <file>`。本仓库的队列列出的是 `typecheck`、`doc-sync`、`lint`、`test:snapshot` 与各个 `verify-*` 脚本：它的根目录还带有 `enterprise`、`enterprise:publish`、`release:publish` 与 `dsh`，它们会推送、发布或启动一个智能体，因此“任意根脚本”不是一种形式。这些形式是队列策略的 `acceptanceForms` 字段，与重型片段和生成路径并列。

**准入与引擎都执行这些形式。** 准入以稳定的代码 `acceptance-form` 拒绝验收违反这些形式的提案，这一步位于 `invalid` 之后、任何命令运行之前，协调员的目标也列出了这些形式。引擎在选择之后再检查一次，因为队列文件可能在准入之后改变：违反这些形式的选中工单得到一条工单行，`department.outcome: "blocked"`、没有检查、原因以 `refused: acceptance <check id>:` 开头；程序只由其余选中的工单组成，一张也不剩时则不运行。`blocked` 是每个台账读取方都已理解的结果，因此这种拒绝无需在台账字段集里新增取值；这一行计为一次尝试，于是被拒的工单排到所有未尝试过的工单之后，而不会在每个班次都占用一个名额。

**引擎自己派生的进程使用白名单环境。** 重新认证中的验收、linter 与文档运行，以及每次离线安装，都以 [`checkEnvironment`](../../../../examples/headless-agent/tests/fixtures/enterprise-shift/shift.ts) 运行：`PATH`、`HOME`、`NODE_*`、`npm_config_*`、`NPM_CONFIG_*`、`PNPM_*` 与 `COREPACK_*` 变量、重型运行所取的 `ENTERPRISE_HEAVY_LOCK`，以及无密钥 e2e 的种子 postinstall 追加写入的 `DSH_E2E_INSTALL_LOG`——再经准入现有的 `scrubbedEnvironment` 过滤，因此形似凭据名的 `npm_config__authToken` 也会被丢弃，并去掉每个代理变量。离线安装也在其列，因为它们运行检出中的生命周期脚本，而部门可能修改过这些脚本。部门的标准与程序的集成本来就经由组合的 shell 运行，其子进程接缝施加仓库唯一的共享清理（`scrubbedParentEnv`：名字中带有 `KEY`、`PASSWORD`、`SECRET` 或 `TOKEN` 的每个变量，以及每个 `DSH_*` 变量），因此那里没有再加第二道清理：e2e 现在给引擎一个形似凭据名的变量，种子的重型检查遇到它就会失败，而 `T-0001` 仍在其部门中通过认证，并经过重新认证发运。

**subagent 的授权指名二进制。** 覆盖层预先批准的是 `Bash(pnpm exec vitest:*)` 与 `Bash(pnpm exec tsc:*)`，取代 `Bash(pnpm exec:*)`。已记录的班次会话中运行过的每条 `pnpm exec` 都是 `vitest`（214 次 `vitest run`、2 次 `vitest related`），只有一次 `eslint` 例外，而本仓库并未安装它；`tsc` 是验收形式可运行的另一个二进制，因此部门仍能运行交给它的每条验收命令。

**README 写明哪些没有受到约束。** [夹具 README](../../../../examples/headless-agent/tests/fixtures/enterprise-shift/README.md#what-is-confined-and-what-is-not) 在这些形式与环境所约束的内容之外，列出了：没有任何机制控制部门或检查的网络出口；组合 shell 的清理按名字进行，因此 `GIT_ASKPASS`、代理变量以及以其他名字存放的凭据会到达部门的 shell 与程序的检查；`HOME` 会到达每个检查，主机放在那里的 git 凭据助手或 SSH 密钥也随之可达；推送改写能挡住误推，但部门的 `git config` 可以撤销它，而重新认证所在的检出没有这种改写；读屏障的普查把 `dsh-bash-local` 记为 `unenforced`，`isolationClaim: none` 让它照常运行，因此 shell 能读取主机用户能读取的一切；这些形式约束的是命令行，而不是它运行的测试文件与根脚本，部门可能在其 scope 之内写入了它们。

## Alternatives considered

**`pnpm run` 允许任意根脚本。** 候选形式是 `pnpm run <root script>`。根目录列有会推送（`enterprise`）、发布（`enterprise:publish`、`release:publish`）或启动智能体会话（`dsh`）的脚本，指名其中之一的工单会通过这种形式，因此队列改为列出它的门禁。

**允许内部命令都合法的命令替换。** 有三张已排队工单以 `test "$(grep -l … | wc -l)" = 2` 统计匹配的行数。当 `$(…)` 的内容能按这些形式解析时就放行，可以保住这几张工单，但词法分析器每放行一种展开，就多一处后续规则必须正确的地方，而同样的检查可以写成每个文件一条 `grep -q`。因此这些工单被报告出来等待改写，而不是放宽形式。

**把这些形式放进 `validateTickets`。** 校验器已经针对已提交的队列运行，也在引擎的 `readQueue` 中运行，后者遇到任何无效工单都会抛出。有四张已排队工单违反这些形式，那样每个班次都会停在选择阶段；逐张拒绝能让队列的其余部分照常工作，并记录这四张为何不行。

**也对组合 shell 施加白名单。** 一个基于 `dsh-bash-local` 的夹具执行器可以把白名单环境交给每条命令，包括部门自己的 shell，从而拿走它的 `GIT_ASKPASS` 与代理变量。这会在无人值守企业的两个周期之间改变每个路由部门的 shell 能做的事，因此留给操作者决定；README 写明了这一缺口。

## Consequences

四张未关闭工单带有这些形式之外的验收命令，每当班次选中它们时都会被拒绝，每次都有一条指出该命令的台账行：`T-0025`、`T-0028` 与 `T-0034` 通过 `$(…)` 统计匹配的行数，`T-0031` 用 `node -e` 读取一个 JSON 值。每一张都可以由操作者或后续的准入改写成允许的形式——统计改为每个文件一条 `grep -q <text> <file>`，上限改为对 `scripts/doc-budgets.manifest.json` 的一条 `grep -qE`。[`scripts/enterprise-acceptance.spec.ts`](../../../../scripts/enterprise-acceptance.spec.ts) 把这四张固定为已提交队列中仅有的被拒工单，因此改写或新增一张违反形式的工单都会在那里显现。

## Verification

[`scripts/enterprise-acceptance.spec.ts`](../../../../scripts/enterprise-acceptance.spec.ts) 接受每一种形式，拒绝 `git push`、`curl`、`gh`、命令替换、展开、分隔符、重定向、检出之外的路径，以及串接或管道接入不被允许的命令，并按这些形式检查每一张已提交的工单。[`scripts/enterprise-intake-admission.spec.ts`](../../../../scripts/enterprise-intake-admission.spec.ts) 在串接推送的提案的任何检查运行之前，以 `acceptance-form` 拒绝它。[`enterprise-shift.spec.ts`](../../../../examples/headless-agent/tests/enterprise-shift.spec.ts) 覆盖引擎的拒绝，并表明在 `checkEnvironment` 下派生的检查既看不到 `GH_TOKEN` 也看不到 `GIT_ASKPASS`，仍能看到重型锁。[`enterprise-shift.e2e.ts`](../../../../examples/headless-agent/tests/enterprise-shift.e2e.ts) 运行种子中验收串接了 `git push` 的 `T-0006`：一次与三张被处理的工单同班，一次单独运行，此时不运行程序而推送拒绝；每个班次都携带那个形似凭据名的变量；若换成一个名字里不含凭据字样的变量，`T-0001` 会在其部门的检查中失败，这正是 README 写明的按名字清理的缺口。在操作者的主机上，本仓库的一次全新离线安装、一张工单的覆盖率运行（`pnpm exec vitest run packages/llm/llm-retry/ --coverage …`）、`pnpm run typecheck` 与 `pnpm run doc-sync` 在 `checkEnvironment` 下均通过，因此重新认证中的重型运行在没有引擎环境的情况下照常工作。

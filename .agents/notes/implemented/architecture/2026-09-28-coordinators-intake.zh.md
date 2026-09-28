# Agent Note: Program Departments 协调人是企业的受理方

Status: implemented

[English](2026-09-28-coordinators-intake.md) | 中文

## Problem

企业的[工单队列](../../../../data/enterprise/tickets/README.md)由人手撰写：两次手写受理提交了 `T-0001` 到 `T-0037`，引擎按计划处理开放工单。因此一个整夜无人值守运行的企业，一旦把队列处理完就无事可做，除了人以外没有谁会再写工单。[花名册](../../../../data/enterprise/README.md)中的十个 Program Departments 协调人席位各自定义在一个包族之上（`packages/jobs/` 到 `packages/boot/`），却没有属于自己的职能。无人值守时由智能体提交的工单，只有在撰写者之外还有别的东西检查它时才值得提交：已经通过的验收检查什么也证明不了，重复开放工单的工单会让一个班次白做两遍，编号出现间隔的队列过不了校验器，而持续调用一条已在用量上限处停下的订阅路由的运行，会把这道上限记成工作（[路由上限 note](2026-09-27-route-limit-halts-the-run.md)）。

## Decision

**协调人就是受理方。** `pnpm run enterprise:intake`（[`scripts/enterprise-intake.ts`](../../../../scripts/enterprise-intake.ts)）统计开放工单，即已排队、且按引擎的工单行规则既未发布也未被拒的工单；数量达到或超过 `--min-open`（默认 8）时，它记录无需受理。低于该值时，它选定被点名的协调人，或开放工单最少的 `--count` 位，克隆已提交的 tip，为同一提交添加一个干净且装好依赖的检出，并运行一个 [program](../../../../packages/improvement/program/README.md)，由 [enterprise-intake fixture](../../../../examples/headless-agent/tests/fixtures/enterprise-intake/README.md) 驱动：每位协调人在组合的路由上各占一个部门（Claude Code overlay 以 `sonnet` 运行，每个部门的上限为 4,000,000 token），每个部门都被要求阅读自己的包族，并以队列的确切模式把至多 `--max-tickets` 张工单提交到 `.intake/<seat>.json`。

**准入是每个部门的验证者，并在部门之间再运行一次。** [`scripts/enterprise-intake-admission.ts`](../../../../scripts/enterprise-intake-admission.ts) 只在以下条件全部成立时接纳一张拟议工单：它在数量上限之内；队列的校验器以下一个空闲编号接受它；它的席位拥有它的 scope；没有任何开放或已发布的工单、也没有本次受理中更早接纳的工单，与它有相同的 source 路径和锚点；它自己的每项验收检查在干净检出上都以非零状态退出。一个部门唯一的检查是对它提交的文件运行 `enterprise-intake.ts admit`，至少接纳一张拟议工单时即通过，因此拟议工单全部被拒的部门会在 program 的指令中读到每条原因，并多得一轮。program 结束后，受理方按部门顺序把每个部门提交的文件再准入一次，由此在部门之间判定编号与重复，拒绝未获认证部门的全部拟议工单，并只写出被接纳的工单。被拒的拟议工单不占编号，因此队列从构造上就没有间隔。

**拥有一个 scope 的席位，是其 source 覆盖它的最具体的席位。** `README.md` 形式的 source 覆盖其所在目录，目录覆盖它自身，文件只覆盖它自己；在覆盖每个 scope 条目的席位中，前缀最长的那些拥有它。`packages/core/agent/` 下的改动由其 Harness Core 包管家拥有；某位协调人包族下的改动由该协调人拥有，因为没有任何包管家的 source 覆盖这十个包族中的任何一个，这也是手写受理对 `T-0025`、`T-0029` 和 `T-0034` 已经采用的规则。

**准入时不运行队列的守护命令。** 按队列自己的规则，`pnpm run typecheck`、`pnpm run doc-sync` 与包的 `--coverage` 运行在改动前后都通过，因此它们拒绝不了工单自有检查拒绝不了的任何东西；引擎在验证已实现的工单时会运行每条验收命令。每项自有检查以 `bash -c` 在自己的进程组中运行，受 `--check-timeout-ms` 限制，环境中没有任何以凭据命名的变量，也没有 `GIT_CONFIG_*` 这一组变量；改动了干净检出的检查会被记录并重置。

**用量上限会把整个进程隔断。** fixture 的 [`route-wall.ts`](../../../../examples/headless-agent/tests/fixtures/enterprise-intake/route-wall.ts) 读取路由上限 note 放在 LLM seam 上的分类：第一个以 `QUOTA_EXCEEDED_CODE` 结束的回合之后，之后的每一步都在请求组装之前于 `agent/pre-step` 被拒绝，该会话的 goal 以 `route-limit` 阻塞，program 把它记为该部门的阻塞代码。拒绝之后没有任何请求触达路由；受理方接纳已认证部门提交的内容，记录这次拒绝以及提示中写明的重置时刻，并以 3 退出。

**每次运行都留下记录和职能行。** `data/enterprise/intake/<UTC date>-<id>/` 下的记录包含 `result.json`、每位协调人一个的 `<seat>.json`（含其拟议工单、结论与检查输出），以及每份会话日志，其中形似凭据的字符串都已遮蔽。部门触达过路由的每位协调人在 `data/enterprise/ledger.jsonl` 中得到一行职能行，字段集与企业各职能共用：它有工单被接纳时为 `pass`，它的部门被截断时为 `error`，其余为 `fail`。

## Alternatives considered

**各部门直接把工单写入 `data/enterprise/tickets/`。** 两个部门无法从同一个队列编号而不相撞，被拒的工单会留下校验器拒绝的间隔；program 的整合还会把两者合并成相互冲突的文件。拟议工单放在部门自己的文件中、由准入编号，队列编号就只取决于被接纳的内容。

**部门只做结构性检查，准入放到 program 之后。** program 会认证一个拟议工单全部被拒的部门，协调人永远不会知道原因。以准入作为验证者，program 自己的指令会把每条拒绝带回去再给一轮，代价是每个部门的检查要运行两次。

**只有每张拟议工单都被接纳时才认证部门。** 一张不完善的拟议工单就会耗掉每个部门的一轮以及用量窗口，而受理方本可以直接拒绝它；至少接纳一张，正是职能行中 `pass` 的含义。

**只有角色为 `steward` 的席位才能拥有工单。** 没有任何包管家覆盖任何一位协调人的包族，因此每位协调人针对自己包族的工作都会被拒绝，而队列中已经有由协调人拥有的工单。

**运行每条验收命令，包括守护命令。** `pnpm run typecheck` 会重新构建 host 库，一次 coverage 运行在企业共享的机器上要花数分钟，而按队列规则两者在改动之前都通过，因此运行它们拒绝不了任何东西。由此放弃的是手写受理对 coverage 集合的证明：一张写错集合的协调人工单会在引擎的验证中失败，而不是在准入时。

**在第一次拒绝时销毁应用。** program 的拆除会等待进行中的那一轮，而 Loader 树的其余部分却在它周围被销毁，尚未启动的部门也会没有任何记录。在 `agent/pre-step` 拒绝步骤，让每个部门都通过 program 自己的台账结束，以记录中写明的代码阻塞。

**等待重置。** 与路由上限 note 相同，重置时刻被记录而不是被等待；下一个计划周期会再次运行受理。

**完整检出。** 仓库已提交的数据约有一 GB，而一次运行同时持有克隆、干净检出、每个部门一个 worktree 以及整合的 worktree；这些检出都不含 `data/`，只保留准入要读取的 `data/enterprise/`，而 git 会给从克隆添加的每个 worktree 相同的稀疏模式。

## Consequences

队列在见底时会自行补充：每个发现开放工单少于 `--min-open` 的计划周期，至多为每位选定的协调人花费一次模型会话，受组合的 token 上限与两轮所限，并只提交准入接受的工单。Program Departments 各席位通过职能行获得占用，它们的工单由 source 覆盖它们的席位拥有，对这十个包族而言就是协调人自己。企业台账在引擎的工单行之外多了第二种行类型，因此它的每个读者都必须跳过职能行。

准入证明的是工单自有的每项检查在改动之前失败；它无法证明该检查在正确的改动之后通过、工单规模确实很小，或者检查失败的原因正是它所声称的原因：需要凭据的检查会在去掉凭据的检出上失败，从而被接纳。这些仍由引擎的验证及其独立评审把关。一份记录包含其运行的每份会话日志，因此一次真实运行会提交几百 KB 到几 MB 的日志。

## Verification

[`scripts/enterprise-intake-admission.spec.ts`](../../../../scripts/enterprise-intake-admission.spec.ts) 固定了台账状态的读取、覆盖与归属、协调人的选定、守护命令的分类、每个拒绝代码以及被拒拟议工单不占编号、单次受理内的重复、未认证部门的拒绝、校验器能读回的工单文件布局、凭据遮蔽、去除凭据后的环境，以及检查运行器的输出、重置与超时。[`scripts/enterprise-intake.spec.ts`](../../../../scripts/enterprise-intake.spec.ts) 固定了命令的选项及其校验、协调人的目标、计划中的准入检查、台账结果与职能行的字段集。[`examples/headless-agent/tests/enterprise-intake.e2e.ts`](../../../../examples/headless-agent/tests/enterprise-intake.e2e.ts) 在一个预置仓库上无密钥地运行该命令：无需受理的退出、一次为每位协调人各接纳一张工单并拒绝一张检查已经通过的拟议工单和一张重复已排队 source 的拟议工单的受理，以及在用量上限处停止、下一个部门没有发出任何请求。第一次真实运行记录在 [`data/enterprise/intake/2026-09-28-181210-eedd/`](../../../../data/enterprise/intake/2026-09-28-181210-eedd/result.json) 下：它在 37 张开放工单的队列上以 `--min-open 38` 运行，选定了名下没有开放工单的 jobs 与 workflow 两位协调人，并各接纳一张拟议工单，编号为 `T-0038` 与 `T-0039`；workflow 协调人的第一份文件因 scope 不是数组而被拒，program 的指令把这条原因带进了下一轮，那一轮的文件被接纳。两个部门分别花费 1,150,660 和 2,249,656 token、历时 180 秒和 231 秒，program 已发布。

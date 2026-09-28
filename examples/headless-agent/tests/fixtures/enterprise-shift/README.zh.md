# enterprise-shift：包管家处理自己的工单

[English](README.md) | 中文

企业的一个班次：这台引擎从 [`data/enterprise/tickets/`](../../../../../data/enterprise/tickets/README.md) 取出未关闭的工单，让每一张在自己的 git 工作树与会话里经由[程序工作流](../../../../../packages/improvement/program/README.md)完成，由一位独立评审员对结果作出裁定，把获批的修改装配到开发分支上，在那里重新认证，再连同班次的台账行与记录一起推送。[`driver.ts`](driver.ts) 是引擎，[`shift.ts`](shift.ts) 是它的纯函数半边，`pnpm run enterprise -- shift`（[`scripts/enterprise.ts`](../../../../../scripts/enterprise.ts)）是在操作者的 Claude Code 路由上发起一个班次的命令。[Agent Note](../../../../../.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md) 记录了这些决策。

## 一个班次做什么

1. **克隆。** 以 `git clone --branch <branch> --single-branch` 把远端克隆到 `<scratch>/repo`，git 能借用时就从本地仓库借用对象（`--reference-if-able`；浅克隆的本地仓库什么也借不出，此时克隆会抓取全部对象）。克隆时的分支顶端是每个工作树的基准修订；`remote.origin.pushurl` 被设为一个不可达的值，因此经由 `origin` 推送的部门什么也推不到。
2. **选择。** 读取并校验克隆中的队列（[`scripts/enterprise-tickets.ts`](../../../../../scripts/enterprise-tickets.ts)）；其 `data/enterprise/ledger.jsonl` 里最近一行已发运或被评审驳回的工单视为已关闭；`--next <n>` 按队列顺序取前 `n` 张未关闭工单（尝试次数最少者优先，因用量上限而停机不算一次尝试；其次按优先级；再让各部门轮流；最后按 id），`--tickets <id,...>` 取指定的几张。
3. **程序。** 一份程序规格：每张工单一个部门（键为 `t-nnnn`，即小写的工单 id）、`implementing` 预设、以工单预算为其上限，以及一份标准——工单的验收命令，其后跟引擎自己的检查：`engine-committed`（分支在基准之后至少有一次提交）、`engine-scope`（排除每个 scope 前缀后的 `git diff --name-only` 列不出任何路径）、`engine-whitespace`（`git diff --check`），以及对于策略写明了文档关卡的队列（本仓库的策略写明 `pnpm run verify-translation-pairing`）的 `engine-documentation`：只要 diff 触及 Markdown 文档就运行该关卡，否则不运行即通过；整合与重新认证也对合并后与装配后的修改运行同一关卡。目标写明工单、花名册中的席位、任务、scope、验收命令，并把部门指向 `CLAUDE.md` 与包 README。程序启动前，每个工作树都已添加并离线安装（仓库带锁文件时执行 `pnpm install --offline --frozen-lockfile`），因此验收命令面对的是已安装的工作区。程序自身的整合合并每个已认证的部门，并在合并后的头上重跑每张工单的验收。
4. **评审。** 每个已认证的部门都在一个从未见过它的会话里接受评审：全新的 id、没有父会话也没有种子、`reviewing` 预设（`role: judge`）、所有全局工具都被限制掉（`tools.restrict({ allow: [] })`，因为部署的工具是全局行，而拥有 shell 的评审员能读到部门的工作树）、`<scratch>/review/` 下一个属于它自己的空工作目录，以及三条消息——常设指令、工单、证据（`git diff <base> <revision>`、分支各提交的信息与每项检查的输出，各有上界）。回答中的第一行 `verdict: approve|reject` 决定结论；两者都没写的回答视为驳回。
5. **装配。** 获批的部门按工单顺序 squash 到基准上，每张工单一次提交，作者与提交者都是 `Claude <noreply@anthropic.com>`（克隆的 `user.name` 与 `user.email`，各部门的提交也共用它们），提交信息写明班次（`Shift: Daliesk shift <id>`）、工单、席位、程序 id、两个会话，并以 `Co-Authored-By: <部门所用的模型>` 与 `Claude-Session:` 两行结尾。引擎自己的提交带 `--no-verify`：修改已由工单的验收认证，而克隆中的 git 钩子是贡献者的，由离线安装为各部门装上。当所有部门都获批时，装配出的树必须等于程序已认证的合并树；随后每张已装配工单的验收都在克隆自身的检出里、在装配出的树上再跑一遍。squash 冲突、摘要不一致或验收失败都导致什么也不发运，并记录原因。
6. **发运。** 台账行与记录在装配的提交之后提交。带 `--push` 时先抓取远端顶端：若它移动了，就把装配的提交变基到新顶端上、在那里重新认证，并围绕它们的新哈希重写台账；变基冲突则什么也不发运，但仍推送台账。推送是对分支的一次快进更新，在顶端持续移动时最多尝试三轮。什么也没发运的班次同样推送它的台账行与记录。
7. **停机。** 第一个失败携带 LLM 接缝 `QUOTA` 码的 `turn/end`——即路由的用量上限通知，按[接缝的分类](../../../../../.agents/notes/implemented/architecture/2026-09-27-route-limit-halts-the-run.md)——会以 `route-limit` 阻塞该部门的目标，于是它的尝试在没有验证运行的情况下结束；之后的每个部门都在第一个被拒的回合上阻塞；不评审、不装配、不发运；每张未完成工单的台账行写 `halted: limit (resets at <instant>)`；驱动以 3 退出。

## 台账与记录

`data/enterprise/ledger.jsonl` 每班次每工单新增一行：`{ type: "ticket", at, shift, ticket, seat, division, programId, implementer, model, department: { outcome, sessionId }, checks: [{ id, ok }], review: { verdict, sessionId }, integration: { outcome }, shipped: { commit } | null, reason, tokens, seconds }`。`department.outcome` 取 `certified`、`failed`、`blocked`、`abandoned`、`pending` 或 `halted`；`review.verdict` 取 `approve`、`reject` 或 `none`；`integration.outcome` 取 `merged`、`skipped`、`conflict`、`checks-failed`、`digest-mismatch` 或 `not-shipped`。工单最近一行为已发运或已驳回即告关闭；其余任何一行都让它留给后续班次。引擎只读工单行：没有 `type` 的行算作工单行，其他任何 `type` 的行——企业职能的 `function` 行与之共用这个文件——都被跳过。

`data/enterprise/shifts/<UTC 日期>-<班次 id>/` 存放 `result.json`（班次、程序报告、每张工单的台账行连同评审员的理由、停机信息）、`manifest.json`（基准、分支、组合、每个文件的 SHA-256）以及班次每个会话的 `sessions/<会话 id>.jsonl`——程序台账、每个部门、每次评审、整合。写入记录的每个字节都会剪除形似凭据的字符串，并在 `result.json` 中计数。

## 两份组合

[`cordis.yml`](cordis.yml) 是无密钥的一半：每个会话都运行在 [`enterprise-llm.ts`](enterprise-llm.ts) 的 `cli-mock` 路由上，其部门按 [`seed/`](seed/) 中的工单编排：`T-0001` 交付，`T-0002` 交付了错误的输出，`T-0003` 交付但被脚本化评审员驳回，`T-0004` 还写了 scope 之外的路径，`T-0005` 在提交前移动了远端顶端；`DSH_TEST_ENTERPRISE_LIMIT=1` 让每个部门回合都以 `QUOTA` 码与一个写明的重置时间失败。[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) 是真实的一份：禁用脚本化路由，插入操作者的 Claude Code 安装，以 `DSH_ENTERPRISE_MODEL`（默认 `sonnet`）作为每个会话的模型，并组合子智能体接缝，使 `--implementer subagent` 能把每个部门委派给 Claude Code 本身。

## 无密钥运行

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/enterprise-shift.e2e.ts
```

[`enterprise-shift.e2e.ts`](../../enterprise-shift.e2e.ts) 从 `seed/` 播种一个裸远端，并针对它跑四个班次：`T-0001,T-0002,T-0004`（一张发运，一张验收失败，一张 scope 检查失败；远端得到工单提交与班次提交）、`T-0003`（已认证、被驳回、未发运、在台账中关闭）、`T-0005`（顶端移动，班次变基、重新认证并发运）以及两张工单上的上限停机。[`enterprise-shift.spec.ts`](../../enterprise-shift.spec.ts) 覆盖选择、编译出的标准、结论行、提交信息与剪除；[`scripts/enterprise.spec.ts`](../../../../../scripts/enterprise.spec.ts) 覆盖命令行、锁与清扫。

## 真实运行

```sh
DSH_ENTERPRISE_SCRATCH=/path/outside/the/repository pnpm run enterprise -- shift --next 2 --push
```

该命令需要已安装并登录的 `claude` CLI、一个已安装的工作区（克隆从同一个存储离线安装）以及对 `origin` 的推送权限。`--tickets <id,...>` 指定工单而非 `--next`，`--implementer subagent` 把部门委派给 Claude Code，`--model <id>` 选择产品模型，`--branch <name>` 指定开发分支之外的分支，`--keep` 保留克隆，`--composition <path>` 指定另一份组合。包装器写出 `<scratch>/<班次 id>/run.log`，驱动的会话日志位于 `<scratch>/<班次 id>/.sessions/`；推送失败的克隆会被保留并在 stderr 上点名，其余克隆在班次结束时删除，满一天的克隆在下一个班次启动时清扫。

该命令可安全地无人值守定时运行。`<scratch>/shift.lock` 写明正在运行的班次的 pid；该 pid 存活期间第二个班次拒绝启动（退出码 4），而已死亡班次留下的锁会被替换。在最后那一次推送之前没有任何东西到达远端，因此被中断的班次让分支保持原样，下一次运行从分支所携带的台账中选择工单。退出码：跑到终点的班次为 0（无论是否发运），每一轮推送都失败为 2，在路由上限处停机为 3，被锁拒绝为 4。

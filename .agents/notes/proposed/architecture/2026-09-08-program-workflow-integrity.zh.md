# Agent Note: 计划工作流的完整性——证书覆盖提交、被围起来的集成、可恢复的集成

Status: proposed

[English](2026-09-08-program-workflow-integrity.md) | 中文

## Problem

[`dsh-program`](../../../../packages/improvement/program/README.md) 的第一次真实计划运行交付了它的发布，而它的记录——[`data/proving-ground/2026-09-08-self-assessment-program-artefacts`](../../../../data/proving-ground/2026-09-08-self-assessment-program-artefacts/manifest.json)——为此需要三次操作者干预。每一次都是工作流上的一个漏洞，而不是操作者犯的错。

**一个部门在工作树之上被认证，而它交付的分支是空的。** 该部门写了 `assessment.md`，它的检查在磁盘上的文件上通过，计划把它记为 `certified`。它写的任何东西都从未被提交，于是对该分支的 `git merge --no-ff` 什么也没带过来，集成自己的检查以 "missing assessment.md" 失败。随后集成 agent 花了 22 步试图满足一个关于任何分支都不持有的文件的检查，操作者停下运行、手工提交了该部门的工作树，并重新启动了计划。证书宣称的是一棵树；而被交付的只有提交。

**集成没有被围起来，并改写了某个部门的文件。** 在那次手工提交之前，第一次集成尝试在自己的工作树旁边找到了部门工作树，并在第 20 步用一个 python 脚本改写了 `assessment.md` 的若干句子。该部门在 UTC 11:47:50 认证的文本之所以留存，只是因为记录从部门会话自身的写入与编辑调用中重建了它（`assessment.certified.md`）；计划发布的文件（`assessment.md`）携带的是集成 agent 的编辑。一个能写入部门工作树的集成，会把每一份部门证书变成对一棵别人此后可能改动过的树的宣称。

**被中断的集成无法恢复。** `driveIntegration` 在派生 id `departmentSessionId(programId, INTEGRATION_KEY)` 上创建它的会话。在操作者重启后，`resume()` 到达 `close()`、继而 `integrate()`，后者第二次创建了那个 id，而持久化拒绝了它：`cannot publish session "program-…-@integration": persisted state already owns this identity`（[`resume-refusal.log`](../../../../data/proving-ground/2026-09-08-self-assessment-program-artefacts/resume-refusal.log)）。操作者把第一个集成会话挪到 `sessions-superseded/` 之下，才让计划得以完成。一个集成被中途杀死的计划，不手工编辑持久化根目录就无法完成。

## Proposal

三条规则，全部落在已经拥有账本的那个服务里。

**证书覆盖的是一次提交。** `attempts()` 在运行任何检查之前先在工作区读 `git status --porcelain`。非空状态意味着这次尝试什么也不测量：它花掉自己的一轮，发出根因为 `the worktree carries work that no commit on this branch carries` 的 directive，并递给该会话一个列出 porcelain 行、告诉它未提交的工作不算交付的 `<uncommitted_work>` 回合。轮次上限对这些尝试的约束与对失败检查的约束完全一致，因此一个始终不提交的会话以 `failed` 结束，而不是认证一份集成无法合并的东西。这条规则放在 `attempts()` 而不是部门路径里，于是集成会话在它自己的工作树上同样受此约束。

**记录陈述被认证的是什么。** 一个被认证的部门在它的 `program/goal` 上记录 `revision`（`git rev-parse HEAD`）与 `tree`（`git rev-parse HEAD^{tree}`），二者作为一个 `CertifiedTree` 一起放在运行状态中，因此任何一半都不能脱离另一半存在。协调时保留账本已记录的内容，只有账本什么也没记时才去读工作树——那是一个死在部门证书与其记录之间的进程。合并之前，集成把每个分支头与已记录的修订版对照，并拒绝已经移动的分支，记录点名两个修订版的 `program/integration { failed }`：一个在认证之后移动过的部门，不是被认证的那个。集成工作树已经包含的分支——那正是被中断的集成留下的——通过 `git merge-base --is-ancestor` 跳过，而不是再合并一次。

**集成像 cell 一样被封住。** 当组合了 `readBarrier` 时，`driveIntegration` 在集成期间注册 `denyFor(agent.session, <workspaceRoot>/<programId>)`，并在集成结束时释放它——与[封闭 cell](2026-09-08-sealed-cell-workspace.md) 为一次环境运行所做的注册相同，理由也相同。被拒绝的目录是该计划的工作树根：barrier 在被拒绝的严格祖先之下把会话自己的工作区授予它，而每个部门工作树都是集成工作树在该根内的同级，因此一次注册就覆盖每个部门工作树，且不触及集成自己的那个。不再逐部门追加拒绝，因为 `worktreePath` 铸出的布局使父目录拒绝恰好精确。两条收尾记录都携带 `denied`，没有 barrier 的组合记录为空，于是日志陈述了集成够不到什么。`isolation` 保持 `none`：这道拒绝值多少取决于所组合的执行器强制了什么，而这正是该声明已经说的话。

**被中断的集成会被接管。** 一次协调若发现账本最后一条集成记录是 `running` 且持久化已持有该集成会话，就通过 `ctx.agents.resume` 恢复该会话、恢复它的目标，并从它自己的日志所记录的验证运行之后的那次尝试继续——于是轮次上限覆盖整个集成，而不是覆盖驱动过它的每个进程。仍然成立的那条 `running` 记录就是本次通过所拥有的；不追加第二条，本包自己的不变式也不接受第二条。一条其进程死在会话存在之前的 `running` 记录，会在同一条记录之下打开该会话；而一个不携带可恢复目标的会话以 `PROGRAM_INTEGRATION_UNRESUMABLE` 记为 `failed`。

## Alternatives considered

**认证检查所看到的那棵树，并替部门提交它。** 计划会在记录证书之前提交工作树持有的任何东西。这样去掉了拒绝和多出来的一轮，也把计划变成了交付物的作者：分支上会带着一个没有任何部门写过的提交，由一个其全部宣称就是从不写入工作树的服务做出。知道什么该进提交的是部门；能告诉它工作尚未交付的是计划。

**记录树摘要，并让集成合并分支当前指向的任何东西。** 单有 `tree` 能告诉读者两份证书交付了相同的文件，但没有任何东西拒绝一个已经移动的分支：集成会合并新的头，并认证一个没有任何部门证书覆盖的合并修订版。在合并处拒绝，才使部门记录成为承重的。

**逐个显式拒绝部门工作树。** 每个部门一次 `denyFor`、在各自认证时注册，拒绝的是同样的路径，却需要在部门仍在陆续认证时维护逐部门的注册。工作树根是任何会话存在之前就已知的一条路径，并且它也覆盖部署放在工作树旁边的其他东西。只有在集成工作树的父目录不是工作树根的布局下，逐部门拒绝才有意义，而 `worktreePath` 不会铸出那种布局。

**给恢复的集成一个新的会话 id。** 一个带后缀的 id——`@integration-2`——会让本次通过去创建而不是恢复，并丢掉被中断那次尝试自己的日志：轮次上限会按进程重新开始，早先尝试的运行会待在没有任何账本记录点名的会话里，而“每个 key 一个会话”将不再是派生身份的性质。恢复保留了账本已经公布的那个 id。

**让集成重新合并每个分支，依赖 git 的行为。** 对已合并分支执行 `git merge --no-ff` 以零退出且不合并任何东西，因此跳过对正确性并非必需。改为询问 `git merge-base --is-ancestor` 是把意图陈述出来，而不是依赖那个行为，并且它让一次被恢复的集成的命令日志里不留下什么也没做的合并。

## Acceptance criteria

- 工作树不干净的部门不被认证：该次尝试不运行任何检查，部门会话的 directive 点名未提交的工作，下一个回合是携带 porcelain 行的 `<uncommitted_work>` 块。部门提交之后它得到认证，且 `program/goal` 记录携带该提交与它的树。始终不提交的部门在轮次上限处以 `failed` 结束，其日志中没有证书。
- 集成拒绝分支头不再等于所记录修订版的部门分支，记录点名两者的 `program/integration { failed }`，且不合并任何东西；集成工作树已经包含的分支被跳过而不是再合并一次。
- 在组合了 read barrier 的情况下，集成会话在集成期间被拒绝该计划的工作树根，注册在集成结束时被释放，两条收尾记录都在 `denied` 中携带该路径；没有 barrier 的组合记录为空列表。
- 在 [`examples/headless-agent/tests/fixtures/program/`](../../../../examples/headless-agent/tests/fixtures/program/cordis.yml) 之上，一个由 Loader 启动的无密钥组合运行一个计划：其部门先写后提交，其集成修复一个没有任何部门分支能满足的合并头；集成对某个部门工作树文件的 `read` 追加一条点名 `fs` 能力的 `read-barrier/denied`，被认证的部门记录携带 40 位十六进制的修订版与树，而已发布计划的合并修订版是集成自己的一次提交。
- 在同一 fixture 中，一次在集成对合并头的首轮运行之后被杀死的启动，之后由另一次启动在它已经拥有的 id 上接管该集成：计划得以发布，其账本在 `certified` 记录之前恰好携带一条 `running` 记录，且存在一个 `@integration` 成员会话。

## Risks

- **留下未被忽略的未跟踪文件的部门会卡住。** porcelain 状态就是规则的全部，因此检查产生而仓库未忽略的构建产物会被读作未提交的工作并烧掉轮次上限。部署自己的忽略规则是唯一的杠杆；spec 无法陈述例外。
- **这道封锁只与它之下的执行器一样强。** `denyFor` 绑定的是在打开路径的操作中拒绝读取的那些能力。在 barrier 旁边组合了未受限 shell 的部署，会让那个接缝仍能够到部门工作树——被记录的那次运行做的正是这件事——而记录上的 `denied` 列表照样会点名该目录。想让封锁被强制执行的地区，应组合[封闭 cell](2026-09-08-sealed-cell-workspace.md) 点名的沙箱受限执行器。
- **移动过的分支会终结计划，而不是重新认证它。** 有意移动部门分支的操作者——被记录的那次运行所做的恢复——现在得到的是失败的集成而不是一次合并。重新启动计划会从该部门自己的日志协调它并认证新的头，这条路径比操作者当时走的更长，也更真实。

# Agent Note: 程序——多目标软件交付的持久账本

Status: proposed

[English](2026-09-06-program-ledger.md) | 中文

## Problem

实验室的第二个目标——通过 harness 实现最好的智能体软件创造——是一个程序：一项客户交付物被分解为许多目标，每个目标由一个部门在自己的会话、工作区、preset、隔离级别与预算中运行，在合并后的 head 上集成，并且只在该 head 的证书之上发布。harness 按设计每个会话运行一个目标（`ctx.goals` 保持一个当前目标），环境运行器每个 cell 运行一个目标，班次驱动器运行由 cell 组成的计划；没有任何东西把一项交付物映射到它所分解出的目标，记录哪个部门在哪个修订版上拥有哪个目标，在不重复也不遗漏部门的前提下重启一项半完成的交付物，或者把合并后的 head 作为一个整体签发证书。[四目标笔记](2026-09-05-four-goal-workflows.md)把这命名为程序账本（W2 阶段 5）与集成目标（阶段 8），二者均为提议中，其推进项 11 把持久编排推迟给一个尚不存在的日志式工作流引擎。已发表的对应物是一个已上市的多目标运行器，其验证契约在功能被分解之前编写；[竞争基线笔记](2026-09-06-competitive-baselines.md)把该账本列入最有价值的五项增补之一。这种实践已经存在于本仓库自身的开发中：每个 agent 每个工作树一个目标，每次合并前跑门禁，在合并后的 head 上做一遍集成。本笔记把这种实践变成一个以会话日志为记录的插件。

## Proposal

一个位于 `packages/improvement/program` 的 `@deepseek-ai/dsh-program` 插件，与 fleet 和班次驱动器并列——它共享它们"每单元一个会话"的账本模式——提供 `ctx.programs`。一个程序是一份冻结的规格、一个持有 `program/*` 事件的程序会话、每个目标一个按运行器创建 cell 的方式创建的部门会话、每个部门一个从程序基础修订版建出的工作树，以及一个其证书即程序证书的集成会话。部门会话是其自身状态的权威；程序会话是重启时读取的索引，每个账本事件都在它所记录的事实持久化之后追加。

### 规格及其身份

`ProgramSpec` 是 `{ objective, baseRevision, goals, integration, signoff? }`。每个目标是 `{ key, objective, preset, isolation, budget, dependsOn, checks }`：`key` 是程序内唯一的小写短横线身份，`preset` 是所声明角色为 `implementer` 的已交付 preset 的 id，`isolation` 是一个 `CertificateIsolation`，`budget` 是预算策略的按会话上限（`maxTotalTokens`、`maxWallMs`、`maxCostEur`），`dependsOn` 是构成有向无环图的目标 key 列表，`checks` 是在任何部门启动之前为该目标编译好的 `StandardCheck` 列表。`integration` 是 `{ checks, gates }`：对合并后的 head 运行的标准，以及必须与之一同通过的 shell 门禁（仓库自己的 lint、test 与 doc-sync 命令）。`signoff` 是 `{ artefactSha256 }`，即程序的签名所背书的产物；`Config.requireSignoff` 决定在部门启动之前程序会话是否必须携带一条针对该产物的 `signoff/recorded`，客户区的组合把它设为真。`programSpecDigest(spec)` 是对目标按 key 排序后的规范化规格的 SHA-256 十六进制摘要；程序 id 是 `program-<digest>`，因此同一份冻结规格启动两次是同一个程序，对一个会话已存在的程序再次 `start` 是恢复它而不是分叉它。

### 账本

程序会话携带：`program/start { programId, specSha256, spec, baseRevision, signoff? }`；每次状态变化时的 `program/goal { programId, key, status, sessionId?, workspace?, revision?, reason? }`，`status` 取 `pending | running | blocked | certified | failed | merged | abandoned`，`revision` 是记录该状态时部门分支的 head，`reason` 是阻塞代码或失败文本；`program/integration { programId, status, mergedRevision?, sessionId? }`，`status` 取 `running | certified | failed`；后续进程接手程序时带有按状态调和计数的 `program/resume { programId, statuses }`；以及 `program/end { programId, outcome, mergedRevision? }`，`outcome` 取 `released | failed | abandoned`。每个部门会话在创建时携带一个 `program/member { programId, key }` stamp，即运行器 `environment/run` stamp 的对应物，因此 scorekeeper 无需索引即可折叠一个程序的会话。账本中的每个状态都可推导：`certified` 跟随部门日志中的 `verification/certificate`，`blocked` 跟随进入阻塞阶段的 `goal/change`，`merged` 跟随父提交包含部门分支 head 的合并提交，`failed` 跟随被清除的目标或超过轮次上限而没有证书就结束的会话。

### 部门

`dependsOn` 全部为 `merged` 的目标作为部门启动：程序从基础修订版在分支 `program/<programId>/<key>` 上于 `<workspaceRoot>/<programId>/<key>` 添加一个 git 工作树，通过 `ctx.agents.create` 创建部门会话，`meta.cwd` 指向该工作树并以其声明的角色挂载该目标的 preset，在组合了屏障时保留读取屏障根目录，追加 `program/member`，以目标的 objective 与配置的轮次上限创建目标，作为验证者从 `checks` 编写该目标的标准，并向部门会话追加带该目标预算的 `budget/caps`。预算策略增加这一个事件：它对某个会话执行的上限是配置上限在会话存在 `budget/caps` 时被其收紧后的结果，像它读取的其他一切一样从日志折叠，因此部门无法超出其目标的花费，而模型什么也看不见。同时最多运行 `Config.maxConcurrentGoals` 个部门；目标进入阻塞阶段的部门记录 `program/goal { status: blocked, reason }` 并等待操作者通过目标域恢复，带证书完成的目标记录带分支 head 的 `certified`，超过上限而没有证书就结束的目标记录 `failed`。程序绝不写入部门的工作树。

### 集成与发布

当每个目标都 `certified` 时，程序从基础修订版创建集成工作树，按依赖顺序以合并提交合并各部门分支，并在该工作树上以 `integration.checks` 为标准启动集成会话，其目标是让合并后的 head 通过标准与 `gates`；一次首轮尝试即通过检查的干净合并不需要任何模型轮次，而有冲突的合并正是集成部门的目标所为。其证书被记录为 `program/integration { status: certified, mergedRevision }`，每个部门目标转为 `merged`。`program/end { outcome: released, mergedRevision }` 只跟随该证书，以及程序会话上的发布 `signoff/recorded`——`requireSignoff` 在收尾处读取它，正如程序打开时读取规格冻结那样。

### 恢复

`ctx.programs.resume()` 在应用的 ready 事件上以及按需运行：它列出已持久化的会话，加载每个有 `program/start` 而无 `program/end` 的程序会话，从各部门会话的日志（阶段、证书、从工作树读取的分支 head）调和每个目标，追加带计数的 `program/resume`，通过目标域的 resume 恢复会话存在且目标活跃但已解除武装的部门，为依赖已合并的 `pending` 目标启动部门，并且绝不为已有会话的 key 创建第二个会话。会话存在而工作树缺失的部门以该原因记为 `failed`，因为分支是证书所引用的证据。程序的 token 上限（可选的 `spec.tokenCeiling`）在每次启动时从每个成员会话的用量折叠，如同班次驱动器缩减计划的上限，因此重启的程序不会因为忘记已花费的部分而超出上限。

### 组合

该插件需要 `agents`、`sessions`、`sessionPersistence`、`goals`、`completionStandards`、`shell` 与 `agentPresets`；可选地读取 `readBarrier`。`verify-village-composition` 把组合了 `dsh-program` 的组合计为区组合，因此它必须携带预算策略、持久化与检查点策略。Config：`workspaceRoot`、`requireSignoff`、`maxConcurrentGoals`、`maxGoalRounds`、`branchPrefix`。

### 切片 1 至 3 落地时的差异

- **目标在依赖 `certified` 时启动，而不是 `merged` 时。** `merged` 跟随唯一一次整合，而整合需要每个目标都已认证，因此要求依赖 `merged` 才能启动后继目标会让任何带依赖的程序死锁。`merged` 仍是已认证整合所记录的状态。
- **程序既是各部门的验证方，也驱动它们的尝试。** 它创建每个目标，像环境运行器那样把它停用，投递目标描述，通过 shell 运行标准中的检查，记录该次运行，并在两次尝试之间下达指令；`maxGoalRounds` 既是目标的上限，也是尝试次数的界。恢复的部门会先取用目标域自身的 resume 边——这是本进程重新接管它的持久记录——然后服务再次将其停用，因此所组合的目标轮次驱动器仍是操作者自行恢复时所走的路径。
- **两项本 note 未列出的组合事实。** `agentDefaultModel` 是必需的注入，因为部门会话需要一条模型路由；`Config.evidenceMaxChars` 限定所记录的证据长度，因为验证域会拒绝超过它自己 `maxTextChars` 的文本。
- **`workspaceRoot` 就是那个仓库。** 本 note 只指明了生成 worktree 的目录，却没有指明持有 `baseRevision` 的仓库；落地的字段是程序交付进入的 git 仓库，`<workspaceRoot>/<programId>/<key>` 位于其下。
- **整合是一个 key，其门禁是检查。** 整合 worktree 与会话使用 `@integration`，任何小写短横线目标 key 都无法占用它；`integration.gates` 的每一项都会成为整合标准中的一条 `gate-<n>` 检查，因此证书覆盖门禁，而占用此类 id 的整合检查会在规格校验时被拒。整合会话挂载花名册的默认预设，并声明 `none` 隔离级别。
- **摘要排除 `signoff`。** 它指名的是签名所背书的产物，而不是程序运行的内容，因此同一组目标在两个产物上被签署仍是同一个程序。
- **台账先声明再报告。** `program/start` 之后为每个目标写一条 `pending` 记录，核对时也会为台账从未记录过的目标补上声明，因此某个 key 的第一条记录总是 `pending`，伴随件据此校验其后的每一次状态迁移。当整合 worktree 根本无法创建时，`program/integration` 可以直接以 `failed` 进入。
- **部门会话 id 由推导得出**，形如 `<programId>-<key>`，这让"任何 key 都不会有第二个会话"成为身份的性质，而不是某次查找的结果。
- **屏障预留不落盘任何东西。** 运行目录被预留，以便屏障把该部门记为实现方，但检查脚本并不写入其中，因此声明高于 `none` 的隔离级别的目标会被验证域拒绝，除非该会话自身的普查能证明该声明。
- **`abandoned` 有了产生者。** 达到 `tokenCeiling` 的程序，或在某个待办目标启动之前就结束的程序，会把这些目标记为 `abandoned`；因上限而停止的程序以 `abandoned` 而不是 `failed` 结束。

## Alternatives considered

**以工作流引擎脚本作为编排器。** 暂时否决：worker 线程引擎不做日志记录，程序随进程一起死亡；四目标笔记第 11 项的日志式引擎日后可以承载这个循环而无需改动账本事件。

**一个会话内多个目标。** 否决：每个会话一个当前目标是目标域的设计，而部门需要自己的工作区、preset、隔离级别、预算与屏障保留；并行发生在会话之间。

**所有部门共用一个工作区。** 否决：部门会互相冲突，而独立分支向基础修订版的合并正是共享树会跳过的那个集成测试。

**由编排模型自由编写的计划。** 否决：四目标笔记从编译好的标准推导计划；程序的目标及其检查在第一个部门启动之前就冻结在规格摘要中，这正是让同一交付物可复现的东西。

**会话旁的账本文件。** 否决，理由与班次驱动器相同：一个持久化、回放、会话查询工具与不变量伴随件都不知道的第二权威。

## Acceptance criteria

- 一个基于临时 git 仓库、由 Loader 启动的 e2e 通过模拟模型运行一个含依赖的双目标程序：两个部门工作树在各自分支上、每个部门一份证书、`program/goal` 转换 `pending → running → certified → merged`、一次带证书的集成合并，以及 `program/end { outcome: released }`；scorekeeper 的导出显示每个成员会话及其 `program/member` stamp。
- 同一夹具在第一个部门的证书持久化之后被杀死并在同一持久化根目录上重启，从日志调和出 `certified`，追加 `program/resume`，只启动待运行的目标，不为任何 key 创建第二个会话，并以 released 结束。
- `requireSignoff: true` 拒绝没有签核记录的 `start`，也拒绝没有签核记录的发布，各带一条钉住的错误；规格摘要在目标重排下稳定，并随任何检查、预算或依赖而变化。
- 预算策略越界的部门记录 `program/goal { status: blocked, reason: budget-exhausted }`，程序不启动其依赖方；恢复时工作树缺失的部门以该原因记为 `failed`。
- 不变量伴随件拒绝先于 `program/start` 的 `program/goal`、非法的状态转换、先于 `program/integration { certified }` 的 `merged`，以及没有已认证集成的 `program/end { released }`，每条各有一个失败夹具；预算策略的伴随件拒绝放宽已配置上限的 `budget/caps`。
- 没有预算策略、持久化或检查点策略的 `dsh-program` 组合以点名程序的消息未能通过 `verify-village-composition`。

## Rollout

1. 已落地。`dsh-program`：规格摘要、程序会话与 `program/*` 事件、带工作树与 `program/member` 的部门、恢复、不变量伴随件、带杀死与重启的双目标 e2e、README 对、重新生成的目录。
2. 已落地。预算策略中的 `budget/caps`：事件、收紧折叠、伴随件规则，以及由程序写入它。
3. 已落地。集成：按依赖顺序的合并、集成会话、`program/integration`、发布。第 4 项中的 `verify-village-composition` 规则随它一并落地，因为没有带上限预算策略的程序组合，正是上限与各部门配额所依赖的前提。
4. 下游：scorekeeper 从 `program/member` 得到的 `program` 事实组、班次驱动器能把程序作为时段排程。
5. 已落地。治理：两处 `requireSignoff` 把关都从程序会话读取 `signoff/recorded`——打开时读 `spec-freeze`，以 released 结束之前读 `release`——针对 `spec.signoff` 所指名的产物，由调用方通过 `ctx.signoffs` 记录（[可归属决定笔记](2026-09-06-attributable-decisions.md)）。仍需：验证仪器的 `standard_author` 从冻结的规格编写程序的检查。
6. 之后，日志式工作流引擎承载该循环；账本事件不变。

## Risks

- **来自服务的 git 操作。** 工作树、分支与合并通过组合的 shell 在沙箱策略下运行；程序只触碰自己的工作树，除通过合并其分支之外绝不触碰部门的树，而脏的集成树使集成目标失败而不是被清理。
- **恢复时的轮次上限。** 被恢复的部门保留其已接纳的轮次，因此频繁重启的程序会更早耗尽上限；账本把这以带原因的 `failed` 呈现出来。
- **并行花费。** 部门并发地花费；目标预算限定每一个，程序上限限定总和，在每次启动时从日志折叠。
- **长程序与日志大小。** 程序自身的日志保持很小（每次转换一个事件）；部门日志才是工作所在，scorekeeper 像读取任何会话一样读取它们。
- **签名只被记录，未被认证。** 把关读取的是部署方身份提供方给出的主体；没有任何东西验证该 id 指名的就是签署者本人，因此 `requireSignoff` 证明的是存在一条针对正确产物的记录，而不是它出自某个特定的人。

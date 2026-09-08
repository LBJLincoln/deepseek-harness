# @deepseek-ai/dsh-program

[English](README.md) | 中文

程序（program）：把一份客户交付物拆解为多个目标后的持久账本。一个程序由冻结的规格、一个持有 `program/*` 事件的程序会话、每个目标一个部门会话与一个 git worktree，以及一个整合会话构成——发布所依据的正是该整合会话对合并后 head 的证书。每一条账本事件都在它所记录的事实持久之后才追加，因此重启后的进程会从各部门自己的日志与 worktree 出发对每个目标做核对，绝不会重复运行同一个部门，绝不会重复运行同一次整合，也绝不会在没有证书的情况下发布。证书覆盖的是一次提交：只有在工作树干净时会话才会被认证，账本记录它所认证的修订版与树，而整合只在部门分支仍指向该修订版时才合并它。一个部门要么由本服务驱动的 harness agent 配备，要么经由 subagent 缝合面由外部编码智能体配备——本服务记录它的每次尝试，并为它留下的树签发证书。设计依据见 [program-ledger](../../../.agents/notes/proposed/architecture/2026-09-06-program-ledger.md)、[external-implementer](../../../.agents/notes/proposed/architecture/2026-09-06-program-external-implementer.md) 与 [workflow-integrity](../../../.agents/notes/proposed/architecture/2026-09-08-program-workflow-integrity.md) 三篇 Agent Note。

## 配置

```yaml
- id: program
  name: '@deepseek-ai/dsh-program'
  config:
    workspaceRoot: /var/lib/dsh/delivery
    requireSignoff: true
    maxConcurrentGoals: 3
    maxGoalRounds: 8
    branchPrefix: program
    evidenceMaxChars: 2000
```

| 字段 | 含义 |
|---|---|
| `workspaceRoot`（必填） | 程序交付进入的 git 仓库。每个 worktree 都在它下面按 `<workspaceRoot>/<programId>/<key>` 生成，因此部署应把它指向一份检出，程序的分支即从其中的 `baseRevision` 起步。它必须是所组合 shell 无需引号即可承载的绝对路径，插件在加载时检查这一点。 |
| `requireSignoff`（必填） | 程序会话是否必须在部门启动之前与程序发布之前携带 `signoff/recorded`。客户区会设置它；两处拒绝都携带 `PROGRAM_SIGNOFF_REQUIRED`。 |
| `maxConcurrentGoals`（必填） | 同一程序中同时运行的部门数。依赖会进一步收紧它：只有当某目标依赖的每个目标都已认证，该目标才会启动。 |
| `maxGoalRounds`（必填） | 创建每个部门目标与整合目标时所用的轮次上限，也是本服务在把某部门记为 `failed` 之前所驱动的验证尝试次数。 |
| `branchPrefix`（必填） | 每个 worktree 的分支命名空间：`<branchPrefix>/<programId>/<key>`。为小写短横线格式的 git ref 段。 |
| `evidenceMaxChars`（必填） | 每条已记录检查证据与每条指令细节的上限。请保持在验证域 `maxTextChars` 之内，超长文本会被它拒绝。 |

该服务需要 `agents`、`agentDefaultModel`、`agentPresets`、`completionStandards`、`goals`、`sessions`、`sessionPersistence` 与 `shell`；当组合了 `readBarrier` 时，它为每个成员会话预留读屏障的运行目录，并对整合会话拒绝该程序的工作树根；当程序委派其部门时，它读取 `subagents`。`verify-village-composition` 把组合本包的配置算作区（district）配置，因此该配置还必须带有设了上限的预算策略、一个会话持久化后端和检查点策略。

## 服务契约

`ctx.programs.start(spec)` 校验并冻结规格、解析其预设，然后驱动该规格所标识的程序：会话尚不存在的程序被开启，会话已存在的程序被核对而不是分叉，账本已带有收尾记录的程序则原样报告。`ctx.programs.resume()` 会核对持久化根目录中每一个账本没有收尾记录的程序并把它继续下去；插件在 Loader 树稳定后运行一次，操作者或驱动器也可以再次调用。两个入口都走同一条队列，因此任何程序都不会被两趟处理同时驱动。

`programSpecDigest(spec)` 是对规范化规格取的 SHA-256 十六进制：目标描述、基线版本、token 上限、解析后的 `implementer`、按 key 排序的目标（每个目标的依赖也已排序），以及整合的检查与门禁（按撰写顺序）。`signoff` 被排除在外——它指名的是程序签名所背书的产物，而不是程序运行的内容，因此同一组目标在两个产物上被签署仍是同一个程序。`program-<digest>` 既是程序 id，也是程序会话的 id，还是每个部门会话 id（`<programId>-<key>`）的前缀，正是这一点让"每个 key 只有一个会话"成为身份的性质，而不是某次查找的结果。

### 两个签名

在 `requireSignoff: true` 下，打开程序时从程序会话读取 `signoff/recorded { transition: 'spec-freeze' }`，发布时在 `program/end { outcome: released }` 之前读取 `signoff/recorded { transition: 'release' }`；两者都必须背书 `spec.signoff.artefactSha256` 所指名的摘要，而本服务从不写入任何一条。调用方通过 `ctx.signoffs`（[`@deepseek-ai/dsh-signoff`](../../governance/signoff/README.md)）把它们记录到 `programIdFor(programSpecDigest(resolveProgramSpec(spec)))` 所寻址的会话上——由于程序 id 就是规格摘要，这个会话在程序存在之前就可以推导出来。`start` 会延续那份日志而不是替换它，于是签名与账本留在同一个会话中。缺少发布签名的程序会在收尾处拒绝并保持打开：下一次遍历会从各部门重建它，并在签名被记录后发布。

`resolveProgramSpec(spec)` 会在任何东西开始运行之前拒绝一份规格：key 不是小写短横线格式或被声明两次、依赖自身、依赖未知的 key 或重复声明同一依赖、依赖成环、预算字段不是有限非负数、目标没有任何检查、检查 id 重复、整合既没有检查也没有门禁，以及整合检查占用了门禁所拥有的 `gate-<n>` id。

## 账本

该服务为每个程序创建一个会话并向其追加，每一步都做 flush，因此中途死亡的进程留下的记录仍然如实。

| 事件 | 何时写入 | 载荷 |
|---|---|---|
| `program/start` | 在任何部门存在之前 | `programId`、`specSha256`、冻结的 `spec`、`baseRevision`、`implementer`，以及规格指名了产物时的 `signoff`——被背书的产物摘要 |
| `program/goal` | 每次状态变化一次，在其所记录事实持久之后 | `programId`、`key`、`status`，以及该状态所携带的 `sessionId`、`workspace`、`revision` 与 `tree`，或 `reason` |
| `program/integration` | 合并 worktree 就绪时，以及它认证或失败时 | `programId`、`status`（`running`、`certified`、`failed`）、`mergedRevision`、`sessionId`、`denied`、`reason` |
| `program/resume` | 后续进程接手该程序时 | `programId` 以及对规格中每个目标核对后的各状态计数 |
| `program/end` | 程序结束时 | `programId`、`outcome`（`released`、`failed`、`abandoned`），已发布者还带 `mergedRevision` |
| `program/member` | 创建时，写在部门会话或整合会话中而不是账本里 | `programId` 与该会话所负责的 `key` |
| `program/delegation` | 一次委派尝试的子代运行结束之后，写在部门会话中 | `goalKey`、`attempt`、`provider`、`runId`、`stopReason`，以及该次运行留下的 `structured` 结果或 `usage` |

目标在还没有部门时是 `pending`，有部门在工作时是 `running`，等待操作者通过目标域恢复时是 `blocked`，自身日志已带证书时是 `certified`，其分支被已认证的整合覆盖后是 `merged`，没有证书就结束时是 `failed`，程序在它启动前就结束时是 `abandoned`。`certified` 记录会陈述所交付内容的两半——来自 `git rev-parse HEAD` 的 `revision` 与来自 `git rev-parse HEAD^{tree}` 的 `tree`——而协调保留账本已记录的内容、不再去读工作树，因此一个在证书之后移动过的分支，读者与整合都能看出差异。[持久化目录](../../../docs/persistence-catalog.md) 收录了每个载荷的声明。

## 部门

当某目标所依赖的每个目标都已认证，它就作为部门启动。服务在 `<branchPrefix>/<programId>/<key>` 上从基线版本添加一个 git worktree，通过 `ctx.agents.create` 创建部门会话（`meta.cwd` 指向该 worktree，并挂载该目标的预设），在组合了屏障时预留读屏障运行目录，用 `program/member` 为会话打上标记，追加带该目标预算的 `budget/caps`，按配置的轮次上限创建目标，并用它的 `checks` 撰写该目标的标准——然后把该部门记为 `running`。

服务本身就是部门的验证方。它把目标描述作为一个用户回合投递，通过以该 worktree 为根的 shell 执行器运行标准中的检查，并记录该次运行；通过的运行会认证、完成目标，并以该证书所引用的提交与树记录 `certified`。失败的运行会下达一条指令并再投递一个回合，最多 `maxGoalRounds` 次尝试；始终无法认证的部门被记为 `failed`，而目标进入阻塞阶段的部门——例如预算越限——则以阻塞代码记为 `blocked` 并留给操作者。服务从不写入部门的 worktree：分支 head 上的内容全部是部门自己提交的。

工作树不干净的尝试根本不会被测量。检查运行之前，`git status --porcelain` 必须为空——没有改动、没有暂存、没有未被忽略的未跟踪文件——因为整合合并的是分支，而任何提交都不携带的文件不算交付。在脏工作树上的尝试会花掉自己的一轮，发出根因为 `the worktree carries work that no commit on this branch carries` 的指令，并递给该会话一个列出 porcelain 行、要求它提交的 `<uncommitted_work>` 回合；轮次上限对这些尝试的约束与对失败检查的约束完全一致。同一条规则也适用于整合会话在它自己工作树上的情形。

## 两种实现者

`spec.implementer` 决定由谁写代码。`{ kind: 'route' }` 是 `resolveProgramSpec` 具体化的默认值，即上文那个 harness agent：本服务经由 LLM 缝合面逐轮驱动它。`{ kind: 'subagent', provider, label? }` 则改为委派：部门的开启方式完全相同——worktree、会话、preset、`program/member`、`budget/caps`、目标、标准——随后每一次尝试都是一次 `ctx.subagents.start(provider, …)`，其 prompt 在第一次尝试时是目标的 objective，在之后各次是被驱动的部门本会收到的同一段检查失败文本。由于部门会话的 `cwd` 就是该 worktree，每个已交付的 provider 都从中推导子代的工作目录，程序无需传递路径。等待该次运行的结果后追加并冲刷 `program/delegation`，释放该次运行，随后部门的检查就在子代留下的树上运行。轮次上限约束委派尝试正如它约束轮次；而整合始终经由模型路由驱动：让合并后的 head 通过，是本 harness 自己的修复工作。

当 `ctx.subagents` 未被组合、或没有该名字的 provider 时（`PROGRAM_IMPLEMENTER_UNAVAILABLE`，并指名该 provider），以及当目标声称高于 `none` 的隔离级别而 provider 在本进程之外运行其子代时（`PROGRAM_IMPLEMENTER_ISOLATION`），被委派的部门在其 worktree 存在之前就被拒绝。第二条规则正是该级别的含义：高于 `none` 的隔离是一项关于会话自身的读屏障普查对其执行器所证明之事的主张，而本进程的任何执行器都没有中介过另一进程中的子代。进程内 provider 加入父代既有的组合、保持同一份普查与角色，因此可以保留部署的隔离级别。两条拒绝都把该目标以对应原因记为 `failed`。

**一份委派证书证明了什么：** 程序经由 shell 执行器、在部门 worktree 中、在外部智能体留下的树上运行了目标的检查，并把该次运行与证书记录在部门自己的会话里。这就是全部主张。它不证明关于这棵树如何产生的任何事：对进程外 provider 而言，本日志里不存在实现者的任何模型可见历史，部门的轨迹不含任何步骤，而 `usage` 只对本进程发布过、且其自身会话日志核算了 token 的子代才被记录。由于 `implementer` 处于摘要之内，同一组目标的两种配备方式就是两个程序——正是这一点让二者的比较成为关于树的证书之间的比较，而不是转录之间的比较。

## 整合与发布

一旦每个目标都已认证，服务就在 `<workspaceRoot>/<programId>/@integration`——一个任何小写短横线目标 key 都无法占用的 key——从基线版本添加整合 worktree，记录 `program/integration { running }`，并按依赖顺序处理各部门分支。分支头不再等于账本为该部门记录的修订版时会被拒绝：整合记录点名两个修订版的 `failed`，因为移动过的分支不是该程序认证过的东西。整合 worktree 已经包含的分支——被中断的整合留下的正是这种——会被跳过而不是再合并一次；其余分支用 `git merge --no-ff` 合并。

随后它在该 worktree 上创建整合会话，其标准由 `integration.checks` 后接 `integration.gates` 中每一项对应的一条 `gate-<n>` 检查撰写而成，因此整合证书既覆盖检查也覆盖门禁。检查在任何模型回合之前运行，因此一次干净且通过的合并根本不需要模型回合；合并后不通过的 head 正是整合目标要处理的情况。证书会记录 `program/integration { certified, mergedRevision }`，每个目标转入 `merged`，随后是 `program/end { released, mergedRevision }`。合并失败与始终不通过的合并 head 都会记录 `program/integration { failed, reason }` 并让程序以 `failed` 结束。

整合会话在运行期间是被围住的。当组合了 `readBarrier` 时，服务注册 `denyFor(session, <workspaceRoot>/<programId>)`：屏障在被拒绝的祖先之下把会话自己的工作区授予它，而每个部门 worktree 都是整合 worktree 在该根内的同级，因此一次注册就覆盖每个部门 worktree，且不触及整合自己的那个。两条收尾记录都用 `denied` 携带所注册的内容（没有屏障的组合为空），注册在整合结束时释放。`isolation` 保持 `none`：这道拒绝值多少取决于所组合执行器强制了什么，而这正是证书的隔离声明已经陈述的内容。

## 恢复

`resume()` 列出持久化的会话，加载每个有 `program/start` 而没有 `program/end` 的程序会话，并从各部门自己的日志与 worktree（而不是账本）出发核对每个目标：不存在部门会话的是 `pending`；worktree 已消失的是 `failed`，因为分支正是其证书所引用的证据；日志中带有证书的是 `certified`，取账本已为它记录的提交与树——账本什么也没记时才取 worktree 的 head，那是一个死在证书与其记录之间的进程；目标处于阻塞的是 `blocked`；其余为 `running`。核对发现的每一个状态都会被记录，账本从未记录过的目标也会在此补上声明，然后由 `program/resume` 陈述各状态计数。仍在运行的部门通过 `ctx.agents.resume` 与目标域自身的 resume 就地恢复；依赖已认证的待办目标则被启动。由于部门会话 id 由程序 id 与 key 推导而来，任何 key 都不会得到第二个会话。

账本留在 `running` 的整合会被接管，而不是重新打开。它的会话 id 由程序 id 推导而来，因此第二次 `create` 会被持久化拒绝，被中断的整合将永远无法完成：当持久化已持有该会话时，本次通过用 `ctx.agents.resume` 恢复它、恢复它的目标，并从它自己日志所记录的验证运行之后的那次尝试继续，于是轮次上限覆盖整个整合而不是每个进程。仍然成立的那条 `running` 记录就是本次通过所拥有的——不追加第二条，账本自身的状态迁移也不接受第二条——而不携带可恢复目标的会话以该原因记为 `failed`。进程死在会话存在之前的 `running` 记录，会在同一条记录之下直接打开该会话。

被委派部门的 `program/delegation` 记录是该日志的一部分，它们携带的最高 attempt 就是恢复后的一遍所要继续的起点，因此已经结束的尝试永不会被跑第二次。不变量伴生插件对每个部门会话维持同一关系：一条 `program/delegation` 跟在同一 key 的 `program/member` 之后，且携带的 attempt 严格大于该会话已记录的每一个 attempt。

程序可选的 `spec.tokenCeiling` 会在每次启动部门时，从带有其 `program/member` 标记的所有会话的用量折叠得出。已耗尽上限的程序不再启动任何部门，把从未启动的目标记为 `abandoned`，并以 `abandoned` 结束。

## Git 操作

每条 git 命令都通过所组合的 shell 在该执行器所施加的策略下运行：创建 worktree 时在 `workspaceRoot` 中执行，合并、读取状态与读取版本时在 worktree 内执行。程序在自己的前缀下创建 worktree 与分支，把部门分支合并进自己的整合 worktree，并读取 `HEAD`、`HEAD^{tree}`、`git status --porcelain` 与 `git merge-base --is-ancestor`。它从不提交，从不向任何 worktree 写入文件，也从不触碰 `<branchPrefix>/<programId>/` 之外的分支。路径与版本在进入命令行之前会先按"无需引号"的字符集校验，因为 shell 引用规则依赖方言，而本服务并不知道所组合 shell 的方言。

## 模型体验

无。账本不贡献任何系统提示、工具 schema 或上下文块，任何 `program/*` 事件都不会进入模型请求；部门会话中一切面向模型的效果都归目标描述、标准与所组合的预设所有，而本包为模型写下的唯一文本，是它的验证方在两次尝试之间投递的那个用户回合——一次运行的 `<checks_failed>` 失败项，或它拒绝测量的工作树的 `<uncommitted_work>` porcelain 行。被委派部门的 prompt 是同一段文本，只是经由 subagent 缝合面投递给子代，而不是投递给部门自己的模型；那段文本记录在何处是子代的事，`program/delegation` 只记录该次运行的结果。

#### KV 缓存影响

按部门相互独立：每个部门与整合各自是一个会话、各有自己的请求历史，本包既不扩展也不改写其中任何一个。它投递的每个回合都是追加在末尾的普通用户消息，因此部门自身的前缀在多次尝试之间保持可复用。被委派的部门根本不发出请求，因此它没有前缀；每次子代运行自身的缓存归该 provider 管。

## 已知限制与待办

- **记分员尚未折叠程序** —— `program/member` 标记正是为它而写，但目前还没有任何事实分组读取它，因此程序的开销与认证率仍需从账本和成员会话中人工读取。
- **签名只被记录，未被认证** —— `requireSignoff` 依据的是一条 `signoff/recorded`，其主体由部署方的身份提供方给出；无论是本包还是 `@deepseek-ai/dsh-signoff`，都不验证该 id 指名的就是签署者本人。
- **发布签名只在收尾处读取** —— 规格冻结已签署但发布未签署的程序，会在拒绝之前跑完每个部门及其整合，因此被拒绝的那次遍历要付出整个程序的工作量；没有任何东西更早索取发布签名。
- **每个进程一次只跑一个程序** —— 每趟处理都走同一条队列，因此并发启动的两个程序会被依次驱动。程序内部的并发由 `maxConcurrentGoals` 限定。
- **被阻塞的部门需要操作者** —— 账本记录阻塞代码后就停下；没有任何机制会重新武装被阻塞的目标，因此带有这种部门的程序会以 `failed` 结束，直到有人通过目标域恢复该目标并再次启动该程序。
- **部门声明隔离级别却不落盘自己的检查** —— 运行目录被预留，以便屏障把该会话记为实现方，但检查脚本并不落盘到那里，因此声明高于 `none` 的隔离级别的目标会被验证域拒绝，除非该会话自身的普查能证明该声明。
- **恢复后的部门保留已计入的轮次** —— 轮次上限是目标的属性，因此频繁重启的程序会更快耗尽各部门的上限；账本会以 `failed` 让这一点可见。
- **被委派子代的花费在上限之外** —— `spec.tokenCeiling` 折叠的是携带 `program/member` 的会话，而被委派的子代要么是一个未打标记的独立会话，要么完全在另一个进程里。委派记录上的 `usage` 陈述本地发布的子代花了多少；没有任何东西约束外部智能体自己的账单。
- **一次委派尝试只有一个 prompt 与一个结果** —— 没有任何机制在尝试中途引导子代，因此 `n` 的轮次上限买到的是 `n` 次机会而非 `n` 条消息；委派给外部智能体的程序会想要更小的上限与更大的单次尝试范围。
- **进程外判定读取的是所宣告的能力** —— 隔离拒绝询问缝合面的 `runsOutOfProcess`，它把不宣告任何由父方强制的启动期能力的 provider 视为在别处运行子代，而每一个已交付的进程外后端正是为此这样宣告；桥接后端的 `harnessTools` 与产品后端的 `model` 都不计入，因为两种情况下模型都仍在别处运行。若将来有后端在另一进程中运行子代却宣告了某项由父方强制的能力，就会击穿该判定，规则届时必须迁移到缝合面上的显式标记。
- **整合的封锁只与它之下的执行器一样强** —— `denyFor` 绑定的是在打开路径的操作中拒绝读取的那些能力，也就是 fs 门与沙箱受限的 shell。在屏障旁边组合了未受限执行器的部署，会让那个接缝仍能读写部门 worktree，而屏障的普查会把它记为 `unenforced`；无论如何拒绝都会记录在 `program/integration` 上，因此读者看到的是所注册的内容，而不是某台主机能绕过什么。
- **在证书之后移动过的部门会终结程序** —— 整合拒绝该分支并记录原因，也没有任何东西会重新运行该部门去认证它现在指向的内容。有意移动分支的操作者需要重新启动该程序，那会从部门自己的日志协调它并认证新的 head。
- **干净工作树规则读的是一个状态，而不是一份策略** —— porcelain 状态就是判定依据，因此工作树中携带仓库自身忽略规则未覆盖的文件（例如某个检查产生的构建产物）会被当作未提交的工作而拒绝，且 spec 无法陈述例外。
- **一个程序对所有目标使用同一个实现者** —— `implementer` 是程序级的，因此一个程序无法一个目标手工配备、另一个目标委派配备；比较两种配备方式就是比较两个程序 id。
- **department 不点名模型，因此既不转发也不记录** —— 冻结规格的 `implementer` 只携带 `kind`、`provider` 与 `label`，于是被委派的 department 跑的是该 provider 默认的任意模型，而 `program/delegation` 既不记录子进程跑了哪个模型，也不记录它报告的开销。seam 三者都已承载（[启动请求上的 `model`，结果上的 `reportedModel`/`reportedUsage`/`reportedCostUsd`](../../subagent/subagent/README.md#capabilities)），[环境运行器](../environment-runner/README.md#the-two-implementers) 也已转发并记录它们；要给规格一个模型，就得扩展被冻结的规格及其摘要，那会改变每一个既有的 program id。

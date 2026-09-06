# @deepseek-ai/dsh-program

[English](README.md) | 中文

程序（program）：把一份客户交付物拆解为多个目标后的持久账本。一个程序由冻结的规格、一个持有 `program/*` 事件的程序会话、每个目标一个部门会话与一个 git worktree，以及一个整合会话构成——发布所依据的正是该整合会话对合并后 head 的证书。每一条账本事件都在它所记录的事实持久之后才追加，因此重启后的进程会从各部门自己的日志与 worktree 出发对每个目标做核对，绝不会重复运行同一个部门，也绝不会在没有证书的情况下发布。设计依据见 [program-ledger Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-program-ledger.md)。

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
| `requireSignoff`（必填） | 没有 `signoff` 记录的程序是否可以启动部门或发布。客户区会设置它；两处拒绝都携带 `PROGRAM_SIGNOFF_REQUIRED`。 |
| `maxConcurrentGoals`（必填） | 同一程序中同时运行的部门数。依赖会进一步收紧它：只有当某目标依赖的每个目标都已认证，该目标才会启动。 |
| `maxGoalRounds`（必填） | 创建每个部门目标与整合目标时所用的轮次上限，也是本服务在把某部门记为 `failed` 之前所驱动的验证尝试次数。 |
| `branchPrefix`（必填） | 每个 worktree 的分支命名空间：`<branchPrefix>/<programId>/<key>`。为小写短横线格式的 git ref 段。 |
| `evidenceMaxChars`（必填） | 每条已记录检查证据与每条指令细节的上限。请保持在验证域 `maxTextChars` 之内，超长文本会被它拒绝。 |

该服务需要 `agents`、`agentDefaultModel`、`agentPresets`、`completionStandards`、`goals`、`sessions`、`sessionPersistence` 与 `shell`；当组合了 `readBarrier` 时，它会预留读屏障的运行目录。`verify-village-composition` 把组合本包的配置算作区（district）配置，因此该配置还必须带有设了上限的预算策略、一个会话持久化后端和检查点策略。

## 服务契约

`ctx.programs.start(spec)` 校验并冻结规格、解析其预设，然后驱动该规格所标识的程序：会话尚不存在的程序被开启，会话已存在的程序被核对而不是分叉，账本已带有收尾记录的程序则原样报告。`ctx.programs.resume()` 会核对持久化根目录中每一个账本没有收尾记录的程序并把它继续下去；插件在 Loader 树稳定后运行一次，操作者或驱动器也可以再次调用。两个入口都走同一条队列，因此任何程序都不会被两趟处理同时驱动。

`programSpecDigest(spec)` 是对规范化规格取的 SHA-256 十六进制：目标描述、基线版本、token 上限、按 key 排序的目标（每个目标的依赖也已排序），以及整合的检查与门禁（按撰写顺序）。`signoff` 被排除在外——它是对规格的背书，而不是对程序运行内容的陈述，因此同一组目标由两位负责人签署仍是同一个程序。`program-<digest>` 既是程序 id，也是程序会话的 id，还是每个部门会话 id（`<programId>-<key>`）的前缀，正是这一点让"每个 key 只有一个会话"成为身份的性质，而不是某次查找的结果。

`resolveProgramSpec(spec)` 会在任何东西开始运行之前拒绝一份规格：key 不是小写短横线格式或被声明两次、依赖自身、依赖未知的 key 或重复声明同一依赖、依赖成环、预算字段不是有限非负数、目标没有任何检查、检查 id 重复、整合既没有检查也没有门禁，以及整合检查占用了门禁所拥有的 `gate-<n>` id。

## 账本

该服务为每个程序创建一个会话并向其追加，每一步都做 flush，因此中途死亡的进程留下的记录仍然如实。

| 事件 | 何时写入 | 载荷 |
|---|---|---|
| `program/start` | 在任何部门存在之前 | `programId`、`specSha256`、冻结的 `spec`、`baseRevision`，以及提供了签署记录时的 `signoff` |
| `program/goal` | 每次状态变化一次，在其所记录事实持久之后 | `programId`、`key`、`status`，以及该状态所携带的 `sessionId`、`workspace`、`revision` 或 `reason` |
| `program/integration` | 合并 worktree 就绪时，以及它认证或失败时 | `programId`、`status`（`running`、`certified`、`failed`）、`mergedRevision`、`sessionId`、`reason` |
| `program/resume` | 后续进程接手该程序时 | `programId` 以及对规格中每个目标核对后的各状态计数 |
| `program/end` | 程序结束时 | `programId`、`outcome`（`released`、`failed`、`abandoned`），已发布者还带 `mergedRevision` |
| `program/member` | 创建时，写在部门会话或整合会话中而不是账本里 | `programId` 与该会话所负责的 `key` |

目标在还没有部门时是 `pending`，有部门在工作时是 `running`，等待操作者通过目标域恢复时是 `blocked`，自身日志已带证书时是 `certified`，其分支被已认证的整合覆盖后是 `merged`，没有证书就结束时是 `failed`，程序在它启动前就结束时是 `abandoned`。[持久化目录](../../../docs/persistence-catalog.md) 收录了每个载荷的声明。

## 部门

当某目标所依赖的每个目标都已认证，它就作为部门启动。服务在 `<branchPrefix>/<programId>/<key>` 上从基线版本添加一个 git worktree，通过 `ctx.agents.create` 创建部门会话（`meta.cwd` 指向该 worktree，并挂载该目标的预设），在组合了屏障时预留读屏障运行目录，用 `program/member` 为会话打上标记，追加带该目标预算的 `budget/caps`，按配置的轮次上限创建目标，并用它的 `checks` 撰写该目标的标准——然后把该部门记为 `running`。

服务本身就是部门的验证方。它把目标描述作为一个用户回合投递，通过以该 worktree 为根的 shell 执行器运行标准中的检查，并记录该次运行；通过的运行会认证、完成目标，并以该证书所引用的分支 head 记录 `certified`。失败的运行会下达一条指令并再投递一个回合，最多 `maxGoalRounds` 次尝试；始终无法认证的部门被记为 `failed`，而目标进入阻塞阶段的部门——例如预算越限——则以阻塞代码记为 `blocked` 并留给操作者。服务从不写入部门的 worktree：分支 head 上的内容全部是部门自己提交的。

## 整合与发布

一旦每个目标都已认证，服务就在 `<workspaceRoot>/<programId>/@integration`——一个任何小写短横线目标 key 都无法占用的 key——从基线版本添加整合 worktree，记录 `program/integration { running }`，并按依赖顺序用 `git merge --no-ff` 合并各部门分支。随后它在该 worktree 上创建整合会话，其标准由 `integration.checks` 后接 `integration.gates` 中每一项对应的一条 `gate-<n>` 检查撰写而成，因此整合证书既覆盖检查也覆盖门禁。检查在任何模型回合之前运行，因此一次干净且通过的合并根本不需要模型回合；合并后不通过的 head 正是整合目标要处理的情况。证书会记录 `program/integration { certified, mergedRevision }`，每个目标转入 `merged`，随后是 `program/end { released, mergedRevision }`。合并失败与始终不通过的合并 head 都会记录 `program/integration { failed, reason }` 并让程序以 `failed` 结束。

## 恢复

`resume()` 列出持久化的会话，加载每个有 `program/start` 而没有 `program/end` 的程序会话，并从各部门自己的日志与 worktree（而不是账本）出发核对每个目标：不存在部门会话的是 `pending`；worktree 已消失的是 `failed`，因为分支正是其证书所引用的证据；日志中带有证书的是 `certified`，其分支 head 从 worktree 读出；目标处于阻塞的是 `blocked`；其余为 `running`。核对发现的每一个状态都会被记录，账本从未记录过的目标也会在此补上声明，然后由 `program/resume` 陈述各状态计数。仍在运行的部门通过 `ctx.agents.resume` 与目标域自身的 resume 就地恢复；依赖已认证的待办目标则被启动。由于部门会话 id 由程序 id 与 key 推导而来，任何 key 都不会得到第二个会话。

程序可选的 `spec.tokenCeiling` 会在每次启动部门时，从带有其 `program/member` 标记的所有会话的用量折叠得出。已耗尽上限的程序不再启动任何部门，把从未启动的目标记为 `abandoned`，并以 `abandoned` 结束。

## Git 操作

每条 git 命令都通过所组合的 shell 在该执行器所施加的策略下运行：创建 worktree 时在 `workspaceRoot` 中执行，合并与读取版本时在 worktree 内执行。程序在自己的前缀下创建 worktree 与分支，把部门分支合并进自己的整合 worktree，并读取 `HEAD`。它从不提交，从不向任何 worktree 写入文件，也从不触碰 `<branchPrefix>/<programId>/` 之外的分支。路径与版本在进入命令行之前会先按"无需引号"的字符集校验，因为 shell 引用规则依赖方言，而本服务并不知道所组合 shell 的方言。

## 模型体验

无。账本记录的是各部门交付了什么，它自身不写入任何模型可见的输入；部门会话中一切面向模型的效果都归目标描述、标准与所组合的预设所有，任何 `program/*` 事件都不会进入模型请求。

#### KV 缓存影响

按部门相互独立：每个部门与整合各自是一个会话、各有自己的请求历史，本包既不扩展也不改写其中任何一个。它投递的那个回合是追加在末尾的普通用户消息，因此部门自身的前缀在多次尝试之间保持可复用。

## 已知限制与待办

- **记分员尚未折叠程序** —— `program/member` 标记正是为它而写，但目前还没有任何事实分组读取它，因此程序的开销与认证率仍需从账本和成员会话中人工读取。
- **签署是断言而非证明** —— `requireSignoff` 依据的是调用方提供的记录，没有可归属的主体。等治理线的 `signoff/recorded` 事件出现后，它才会成为证明。
- **每个进程一次只跑一个程序** —— 每趟处理都走同一条队列，因此并发启动的两个程序会被依次驱动。程序内部的并发由 `maxConcurrentGoals` 限定。
- **被阻塞的部门需要操作者** —— 账本记录阻塞代码后就停下；没有任何机制会重新武装被阻塞的目标，因此带有这种部门的程序会以 `failed` 结束，直到有人通过目标域恢复该目标并再次启动该程序。
- **部门声明隔离级别却不落盘自己的检查** —— 运行目录被预留，以便屏障把该会话记为实现方，但检查脚本并不落盘到那里，因此声明高于 `none` 的隔离级别的目标会被验证域拒绝，除非该会话自身的普查能证明该声明。
- **恢复后的部门保留已计入的轮次** —— 轮次上限是目标的属性，因此频繁重启的程序会更快耗尽各部门的上限；账本会以 `failed` 让这一点可见。

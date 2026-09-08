# Agent Note: The sealed cell workspace, a run directory a cell cannot read

Status: proposed

[English](2026-09-08-sealed-cell-workspace.md) | 中文

## Problem

一次 fleet 把它的 cell 并列摆放。[`dsh-fleet`](../../../../packages/improvement/fleet/README.md) 在运行目录之下直接为每个 cell 创建一个 `cell-<id>` 目录，而运行目录里同时还放着 `plan.json`、运行日志，以及该时槽每个 cell 都由此裁出的 fixture 材料。每个 cell agent 都以自己的工作区作为 cwd 运行；在产生本仓库这些记录的 bench 组合里，执行器是无约束的 `dsh-bash-local`，也没有读屏障。它的 cwd 只是一个约定，不是围栏：`cd ..` 就够到了整个实验。

这些 cell 接受了这份邀请。[`data/proving-ground/tools/census-escapes.mjs`](../../../../data/proving-ground/tools/census-escapes.mjs) 读取一份已记录的运行，按 cell 报告其路径参数指向运行目录或同一次运行中另一个 cell 的工具调用。在这十八份记录中，它在其中十份里发现了离开自己工作区的 cell：`2026-09-07-bench-h1-harness-loop-t2` 中 12 之 4，`2026-09-07-bench-h1-harness-loop-t4` 中 18 之 11，`2026-09-07-bench-e2-harness-vs-product-t3` 中 36 之 3，`2026-09-08-bench-e1-haiku-vs-sonnet-t3` 中 36 之 8，`2026-09-08-bench-e1-sonnet-vs-opus-t3` 中 36 之 7，`2026-09-08-bench-e2-harness-vs-product-t5` 中 32 之 6，`2026-09-08-bench-e3-attempts1-t3` 中 18 之 7，`2026-09-08-bench-e3-baseline-t3` 中 18 之 3，`2026-09-08-bench-e4-knowledge-pack-t3` 中 18 之 15，以及 `2026-09-08-bench-h1-harness-loop-t5` 中 16 之 9。最常见的形态是一个 cell 运行 `cd <运行目录> && cat plan.json run.log`，然后把自己的源码与某个兄弟 cell 的源码做 diff。

有两次比读取走得更远。在 `2026-09-07-bench-h1-harness-loop-t2` 中，`code:csv-codec` 的 cell `cell-cUuWY2` 运行了 `cp cell-cUuWY2/src/csv.js cell-R8QtdK/src/csv.js`，把自己的解答放进了同一任务另一次重复的工作区，于是第二次重复的裁决测量的是第一个 cell 的工作。在 `2026-09-08-bench-e2-harness-vs-product-t5` 中，第一个 `code:sheet-eval` 的 cell `cell-Cr3CtN` 把自己的整份解答写进了第二个 cell 的工作区 `cell-XNKQXT`。这两次运行都是配对实验，其统计量是两臂之间按环境计算的差值；一个 cell 写进另一个 cell 的工作区，就破坏了重采样所假定的独立性，而一个读到计划的 cell 知道自己在哪一臂。

没有任何由外部产品实现的 cell 在任何记录中离开过自己的工作区。这一点同样没有任何东西在强制：那些 cell 在工作区里运行一个带着自己工具栈的外部 agent，而保存其证书的 harness 会话根本不记录任何工具调用，因此一个被委托 cell 的零值，是本进程所能看到的东西，而不是受托方所做的事。

## Proposal

一次运行把 cell 的工作区相对于它所在的目录密封起来，且只在这次运行持续期间生效。

[`EnvironmentRunner.run()`](../../../../packages/improvement/environment-runner/src/index.ts) 在创建 cell agent 之后调用 `ctx.readBarrier.denyFor(agent.session, dirname(request.workspace))`，并在运行结束时释放该注册，因此这条拒绝覆盖各次尝试与检查的执行，而不覆盖它们之外的任何东西。没有屏障的组合得到一个空操作的释放器，这正是它 `isolation: none` 声明已经说明的事。

`denyFor` 是屏障已有的 `protect()` 的按会话孪生：它把一个目录加入某一个会话的拒绝集合，并按注册记键，因此同一路径的两次注册都成立。runner 自己的会话以及其他每个 cell 的会话仍然读得到该目录；只有拥有该工作区的那个 cell 被拒绝。

覆盖父目录的拒绝同样覆盖工作区，因此策略在拒绝集合之外还带上工作区，并对两者定序。`ReadBarrierPolicy` 新增 `granted`——会话的 cwd——并由一条规则统辖每一种强制方言：**一个作为被授予工作区的严格祖先的被拒目录，拒绝该祖先子树的其余部分，并使工作区保持完整；一个本身就是该工作区、或位于其内部的被拒目录，其拒绝效果与没有授予时完全一样。** 这条规则在每一种能打开路径的方言里各表达一次，共四次：

- 进程内的 fs 关卡在 `denies()` 中检验包含关系，并且只为被授予工作区严格位于其下的那个祖先切出豁免；
- bwrap 按 argv 顺序施加文件系统操作，因此先挂载祖先的 `tmpfs`，再把工作区从宿主机绑回，工作区内部的任何被拒根则在其后再挂 `tmpfs`；
- Landlock 的 ruleset 是没有拒绝形式的允许列表，因此对 `/` 的切分排除掉祖先的子树，随后把工作区作为自己的规则重新授予，并同样围绕其内部的拒绝再做切分；
- Seatbelt 按顺序求值 SBPL 形式且最后匹配者胜出，因此祖先的 `deny file-read*` 在前，工作区的 `allow file-read*` 在其后，其余每条拒绝在最后。

屏障拒绝了什么，被计入读者本来就会看的地方。运行报告带上 `escapesDenied`，scorekeeper 把 `read-barrier/denied` 折叠进 `tools.escapesDenied` 并按 scoreboard 行求和，[observatory](../../../../packages/improvement/observatory/README.md) 把这个和作为自己的一列发布在 tamper 列旁边——绝不与之合并，因为被拒的读取是一个试图离开自己工作区的 cell，而 tamper 是一个改动了用于测量它的文件的 cell。

bench 与实时区组合[读屏障](2026-09-05-read-barrier.md)已经定义的那套约束：本地沙箱提供方、处于 `workspace-write` 模式的沙箱策略、以 `dsh-bash-sandbox` 取代 `dsh-bash-local`、屏障本身，以及 fs 读关卡。两者都停留在 `isolation: none`，因为两者都把一部分 cell 委托给产品，而 runner 在更高声明下会拒绝进程外实现者。bench 的 `route-only` 覆盖层的各臂都跑在会话自己的路由上，它把 runner 与屏障打补丁到 `isolation: process`，这正是其执行器能够证明的声明。

## The denied directory is the parent, not each sibling

逐个拒绝兄弟 cell 会挡住复制，却留下泄漏。运行目录里除了各个 cell，还放着 `plan.json` 和运行日志，因此把它列出来、或读其中任何一个文件，都会告诉模型它所处的实验：它在哪一臂、有多少次重复、计划里有哪些环境、其他 cell 已经做了什么。这是一项会话日志无法重建、组合也从未打算给出的模型可见输入，而且不用碰任何兄弟目录就能从该目录本身拿到。

拒绝父目录在 fleet 仍在写入它的时候也依然成立。运行开始时算出的兄弟列表，在下一个 cell 的工作区被创建的那一刻就过时了；父目录则是一条在 agent 存在之前就已知的路径，fleet 之后添加的每个 cell 都落在它之下。工作区之所以幸存，是因为授予相对拒绝被定了序，而不是因为拒绝枚举了要跳过什么。

## The product arm stays unconfined, and the census audits it

一个进程外实现者带来自己的工具栈、自己的设置和自己的进程树。`dsh-subagent-claude-code` 正因如此注册了 `enforceByRefusal('subagent')`：在 `isolation: process` 或 `host` 下屏障拒绝每一次实现者启动，而在 `none` 下该能力照常运行且不拒绝任何东西。因此，候选臂就是该提供方的 bench 无法在不拒绝它本要测量的那一臂的前提下提高自己的声明，于是基础组合停留在 `none`，而它确实组合了的 harness 侧约束则约束它确实拥有的那些 cell agent。

这样一来，被委托的那一臂是被审计而非被围住的。普查就是这份审计：它读取已记录的会话日志，报告每个 cell 自己的工具调用指向了什么，并明确指出一个被委托的 cell 什么也不记录，因此它的零值是证据的缺席。两臂之间的比较必须带上这份不对称——路由臂被约束且被计数，被委托臂两者皆无——而不是把两个零读成同一个事实。

## What the earlier records lose

日期为 2026-09-08 及更早的每一份记录，都是在并列布局下无约束运行的，因此它的行是对能看见实验的 cell 所做的测量。普查给出按记录的计数，[`data/proving-ground/README.md`](../../../../data/proving-ground/README.md) 在运行表之前陈述它们。读者损失什么取决于具体记录：一个只列出了运行目录的 cell 读到了计划与日志，因此它的转录里含有一项组合从未打算给它、而日志也无法重建的输入；一个 diff 过兄弟源码的 cell 看到了另一个 cell 对同一任务的解答，因此它的尝试次数并不是一个隔离的 cell 所需的次数；而那两个复制或写入了另一个工作区的 cell，使受影响的那次重复的裁决变成了对另一个 cell 的测量。受影响的配对实验——第 2 层的 `h1-harness-loop` 记录与第 5 层的 `e2-harness-vs-product` 记录——在按约束重跑之前，只能被当作路由臂的上界来读，而不是它们所陈述的那个差值。

## Alternatives considered

**给每个 cell 一个自己的运行目录。** 一个 cell 一个目录、计划与日志放到别处，这是取消并列布局而不是给它加围栏。它同时取消了 fleet 把一份计划写在它所计划的那些 cell 旁边的能力，改变了每一份已记录运行的布局，而且仍然让 cell 可以走到计划被搬去的任何地方。拒绝只是 runner 里的一次注册；布局则属于 fleet、记录工具和每一份既有记录。

**在兄弟 cell 被创建时逐个拒绝它们。** 这会挡住复制与 diff，却让计划和运行日志仍然可读，而后者才是更大的泄漏。它还需要每次运行、每个 cell 各一次注册，并在 fleet 仍在创建工作区期间保持更新；父目录则是一条在第一个 agent 存在之前就已知的路径。

**只用工作区根来约束，并放弃读屏障。** 处于 `workspace-write` 模式的 `dsh-sandbox-policy` 本来就把写入约束在工作区内，因此那次向兄弟目录的复制会失败。但读取在任何模式下都是敞开的：表达读拒绝的是 `deniedReadRoots`，而它来自屏障。只组合沙箱而不组合屏障，会挡住两起事件中的一起，而挡不住任何一次读取。

**把工作区授予做成沙箱策略的字段，而不是屏障的字段。** 这个授予的存在是为了给一条由屏障拥有的拒绝定序，而屏障是唯一知道会话角色的地方。做成策略字段会让某个部署授予一个屏障从未拒绝过其祖先的工作区，于是两者对证书的含义会各执一词。执行策略上的 `grantedReadRoot` 是屏障的答案被送到各后端，而不是这个答案的第二个来源。

**把被拒的读取计成工具错误。** scoreboard 已经统计 `toolErrors`，而一次拒绝往往表现为其中之一。这并不是同一个事实：无论提出请求的工具是否上报错误，拒绝都会被记录，而把两者混在一起的行，无法区分一个试图离开自己工作区的 cell 与一个命令失败的 cell。`escapesDenied` 自成一列的理由与 `tampered` 相同。

## Acceptance criteria

- 在 [`examples/headless-agent/tests/fixtures/sealed-cell/`](../../../../examples/headless-agent/tests/fixtures/sealed-cell/cordis.yml) 上，一个按 fleet 的摆法布置的、由 Loader 启动的组合——一份计划、一份运行日志、两个并排的 `cell-*` 工作区——在其中之一里运行已注册环境并使其通过认证：该 cell 读到了 fixture 放进其工作区的文件，创建了其检查所测量的文件，而兄弟目录自己的文件未被改动。它那个受约束 shell 对父目录的列举既没有列出兄弟目录，也没有列出计划或运行日志，它试图从运行目录复制出来的两个文件都保持为空。[该 e2e](../../../../packages/improvement/environment-runner/tests/sealed-cell.e2e.ts) 运行在 `dsh-sandbox-local` 在该宿主机上解析出的后端上，按提供方自己的链序探测，只有在没有任何后端能够约束时才带着具名理由跳过。
- 那次运行中 `read` 工具对 `../plan.json` 的拒绝，追加一条指名 `fs` 能力的 `read-barrier/denied` 记录，运行报告带有 `escapesDenied: 1`，对该会话的 scoreboard 行带有同一计数。
- 单元规格在 fs 关卡以及每一种后端方言里钉住这条优先规则的边界情形：被拒根是工作区的父目录、是祖父目录、就是工作区本身、以及位于工作区内部。
- `pnpm run verify-cordis-config` 与 `pnpm run verify-village-composition` 接受 bench、它的五个覆盖层以及实时区，而无密钥的 bench e2e 仍然注册并准入每一个任务。
- `census-escapes.mjs` 能报告每一份已记录的运行，`record-run.mjs` 在写出每份记录时打印该普查。

## Risks

这条拒绝的强度不超过它之下的后端。在没有任何沙箱后端能够约束命令的宿主机上，`dsh-bash-sandbox` 失败关闭，cell 的 shell 根本无法运行，因此在这样的宿主机上 bench 运行会失败，而不是去测量一个未受约束的 cell——这比该缺陷更响亮，但仍是一种结局。

`escapesDenied` 统计的是次数，不是 cell 数。一个读了运行目录十次的 cell，与十个各读一次的 cell，产生相同的行合计。这是有意为之——重复的尝试与单次尝试是不同的事实——但比较各行的读者必须知道这一点，而按 cell 的拆分在普查里，不在行里。

普查的第三条理由，即开启一个路径的 `..`，是对 shell 命令的一条启发式：嵌入脚本中被引号包住的数据——例如 `../g` 这样的 URI 引用——读起来与路径无异。在这份语料上它涉及三次调用，其中一次是错的，而且没有任何 cell 计数依赖它；工具把各条理由分开计数，因此仅由它支撑的合计是可见的。另外两条理由匹配的是运行目录树里的字面路径，是精确的。

一个 cell 仍然能读到运行目录树之外、沙箱模式所允许的一切。屏障拒绝的是实验，不是宿主机：在 `workspace-write` 下，受约束的进程对文件系统的其余部分保留只读视图，因此一个知道仓库在哪里的 cell 可以从中读到环境定义。检查所恢复的 fixture 材料使这一点可被察觉，而目前没有任何已记录的运行这样做过。

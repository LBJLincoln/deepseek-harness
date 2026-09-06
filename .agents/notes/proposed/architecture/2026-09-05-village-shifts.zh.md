# Agent Note: 班次——Daliesk Village 的常驻驱动器

Status: proposed

[English](2026-09-05-village-shifts.md) | 中文

## Problem

[Daliesk Village 笔记](2026-09-05-daliesk-village.md)描述了一个持续运行的实验室，而它的零号班次之所以要有人值守，是因为仓库里没有任何东西能把一个计划运行一次以上，或者在重启后存活。`ctx.fleet.run(plan)` 在一个进程里执行一个计划并返回一份报告；进程在计划中途死亡时，已运行的 cell 只以无人索引的会话日志形式留存，从未启动的 cell 被遗忘，而重启后再次运行同一计划的进程会铸造一个新的 group，并为已经有会话的 cell 再产生一个会话。[四目标笔记](2026-09-05-four-goal-workflows.md)在其推进项 11 中把缺失的部分命名为持久编排——cell 按 header hash × 环境 × 重复序号幂等，并能从已持久化的子会话恢复——而 Village 笔记的推进项 3 让无人值守班次依赖于它。在 fleet 与无人值守班次之间横着四个缺口：班次没有持久身份，因此重启后无法区分被恢复的计划与新计划；没有按 cell 的持久记录，因此恢复必须从每一份会话日志重建；没有节奏，因此没有东西启动下一个班次，也没有东西阻止同一区的两个班次重叠；没有跨班次的花费窗口，因此 fleet 的按计划上限是供应商事故与一夜之间花光一个月推理预算之间唯一的屏障。

## Proposal

推进项 1 与 2 期间敲定了三处细节。`ctx.fleet.run` 增加了一个从计划自身枚举中挑选的可选 `cells` 选择，因为 `FleetPlan` 是一个笛卡尔积而被恢复的班次的待运行集合不是——没有它，被恢复的 cell 会以重复序号零运行，并在其 group 中被重复计数。一个区的计划点名自己的模型路由，而不是回落到组合的默认路由，因为驱动器要枚举自己的 cell 才能算出待运行集合并为计划取摘要，而一个会随另一个插件当前选择而移动的摘要什么也冻结不了。驱动器通过 `ctx.get('environments')` 读取环境注册表而非声明它，从而把 Loader 依赖保持在 `fleet`、`sessions` 与 `sessionPersistence`；够不到注册表的时段以 `SHIFT_INVALID_PLAN` 被拒绝。

一个位于 `packages/improvement/shifts` 的 `@deepseek-ai/dsh-shifts` 插件，提供 `ctx.shifts`：一个建立在 fleet 之上的持久循环，冻结每个班次的身份，把班次记录在它自己的会话日志里，通过只运行从未启动的 cell 来恢复被中断的班次，并拒绝会超出其所在区花费窗口的班次。会话事件日志仍是唯一权威：班次账本是班次会话中的一组 `shift/*` 事件，cell 从其会话本已携带的 `environment/run` stamp 恢复，驱动器不在内存中持有任何重启所需的东西。

### 班次身份

`shiftDigest(plan)` 是对 `{ version, district, environments, models, repetitions, tokenCeiling }` 的 SHA-256 十六进制摘要，其中环境 id 在冻结时对注册表解析完过滤器之后按码元排序，路由保持列出顺序，做法沿袭 `dsh-experiments` 的 `planDigest`；`workspaceRoot`、节奏与花费窗口是部署选择，不进入摘要。一个班次实例是 `shift-<digest>-<scheduledAt>`，后者是以 epoch 毫秒计的时段时间，因此两个进程计算同一时段会得到同一身份而无需计数。班次 id 是每个 cell stamp 上的 `group`，于是一个班次的会话像 `experiment-<digest>-<arm>` 归组一个 arm 那样被持久地归组，scorekeeper 的按 group pass@k 不需要新字段。

### 班次账本

驱动器为每个时段创建一个会话（如同运行器为每个 cell 创建一个），并向其追加：`shift/start { shiftId, digest, plan, scheduledAt }`，原样携带冻结的计划；每个 cell 的结果到手后追加 `shift/cell { shiftId, cell, sessionId, outcome }`，`outcome` 为带 `certified` 标志的 `reported`、带 fleet 错误码的 `error`，或恢复时发现的孤儿对应的 `interrupted`；后续进程接手班次时追加 `shift/resume { shiftId, done, pending }`；时段被拒绝时追加 `shift/skipped { digest, scheduledAt, reason }`，`reason` 取 `spend-window | overlap`，此时该时段的会话只持有这一个事件而没有 `shift/start`；以及 `shift/end { shiftId, outcome, spend, cells }`，`outcome` 取 `completed | ceiling | stopped`，`spend` 是 fleet 报告的 token 总和，`cells` 是按结果的计数。每个事件都在它所记录的事实持久化之后追加，绝不提前。欧元成本不是班次字段：scorekeeper 依据 Village 笔记"成本是已记录的事实，否则不发布"的规则从 `usage/priced` 事件折叠它。

### 幂等 cell 与恢复

一个 cell 由其班次 id、环境、模型路由与重复序号标识，这些都在 `environment/run` stamp 上。启动时，驱动器通过 `ctx.sessionPersistence.list()` 列出已持久化的会话，加载每个日志中有 `shift/start` 而无 `shift/end` 的班次会话，并为每个这样的班次计算待运行 cell：计划的 cell 减去已有 `shift/cell` 条目的 cell，再减去其 stamp 存在于创建时间不早于该班次会话的某个会话中的 cell（header 的 `createdAt`，把扫描范围限定在比班次年轻的会话）。会话存在却从未结束的 cell 是孤儿：它被记录为 `outcome: interrupted` 的 `shift/cell`，且绝不在同一重复序号下再次运行，因为同一 cell 的第二个会话会在 pass@k 中重复计数并掩盖崩溃；崩溃是被测 harness 的一种结果，保持为一个错误行。被恢复的班次以同样的 group 与 district、并以计划的 token 上限减去该班次已有全部会话折叠出的用量，通过 `ctx.fleet.run` 运行待运行 cell，然后追加 `shift/end`。fleet 增加一个只读观察的 Cordis 事件 `fleet/cell { group, district, cell, outcome }`，在每个 cell 的结果被记录后发出，因此账本按 cell 而非按计划写入；只要账本落后，按 stamp 的扫描仍是权威。

### 节奏与花费窗口

Config：`workspaceRoot`；`districts`，一个 `{ district, plan, cadence: { intervalMs }, spendWindow?: { windowMs, maxTokens } }` 的列表；`startImmediately`。每个区同一时刻只有一个班次在途；一个区的下一个时段是从账本读出的上一个 `shift/start.scheduledAt` 加 `intervalMs`，因此重启既不漂移也不重复时段；没有进程运行期间错过的时段不留记录也不补跑，空洞可由时段算术看出；在该区上一个班次仍在运行时到达的时段以 `shift/skipped { reason: overlap }` 拒绝。班次启动前，驱动器把该区 `windowMs` 之内各时段的 `shift/end.spend` 折叠起来；一次会在窗口已耗尽的情况下开始的启动追加 `shift/skipped { reason: spend-window }` 且不创建任何 cell 会话。按 cell 的上限仍属预算策略，按计划的上限仍属 fleet；窗口是 Village 笔记预算一节所要求的、跨计划的第三层。

### 进程与监督

驱动器在应用的 ready 事件上启动循环，在销毁时停止：在途的 fleet 运行通过其信号取消，在途 cell 按运行器的方式结束，它们的会话成为下一个进程所记录的孤儿。宿主级监督者——`Restart=always` 的 systemd 单元或容器重启策略——重启进程；README 随附单元文件与 Village 笔记五种状况（编排器崩溃、越过重试预算的全路由故障、磁盘写满、班次计时器死亡、工具调用挂起）的值守手册，并说明账本使哪些状况可见（前两种与计时器，通过没有 `shift/end` 的 `shift/start` 以及没有近期时段的区）、哪些不可见（磁盘与挂起的调用）。通过 Loader 组合需要 `fleet`、`sessions` 与 `sessionPersistence`；`verify-village-composition` 已经覆盖班次组合，因为它组合了 fleet。

## Alternatives considered

**围绕 fleet 脚本的 cron 任务。** 否决：无状态；重启或第二次调用会在新 group 下重跑整个计划，而且没有任何东西记录某个时段被跳过及其原因。

**运行在 worker 线程引擎上的工作流引擎程序。** 暂时否决：当前引擎不做日志记录，因此程序随进程一起死亡；四目标笔记的第 11 项把日志式引擎与程序账本配对，而本驱动器是这样的引擎日后可以承载、且无需改动账本事件的最小持久循环。

**在同一重复序号下重跑被中断的 cell。** 否决：孤儿会话已经携带 stamp，因此 scorekeeper 会在一个 group 中看到同一 cell 的两个会话；崩溃是 harness 的结果，属于错误列，而中断 cell 很多的班次本身就是一项发现。

**会话日志旁的账本文件。** 否决：这是持久化、回放、会话查询工具与不变量伴随件都一无所知的第二个权威；班次会话复用了它们全部。

**放在 cell 会话里的账本条目。** 否决：因花费窗口而拒绝的时段将完全没有记录，而且 cell 会话属于运行器。

## Acceptance criteria

- 一个由 Loader 启动的 e2e 通过驱动器运行一个双区组合，在第一个 cell 的会话持久化之后终止进程，在同一持久化根目录上重启它，被恢复的班次保持其 group，追加带有正确待运行集合的 `shift/resume`，只运行没有会话的 cell，把孤儿记录为 `interrupted`，而记分板为每个 cell 显示一行、孤儿显示为错误，绝不出现重复的环境、路由与重复序号。
- `shiftDigest` 在环境重排下稳定，并随重复次数、路由、区或 token 上限而变化；`plan` 重新摘要得到另一个值的 `shift/start` 使不变量伴随件失败。
- 不变量伴随件拒绝先于其 `shift/start` 的 `shift/cell`、同一班次中同一 cell 的两个 `shift/cell` 条目，以及先于 `shift/start` 的 `shift/end`，每条各有一个失败夹具。
- 一个 token 的花费窗口产生 `shift/skipped { reason: spend-window }` 且没有 cell 会话；班次运行期间到达的时段产生 `shift/skipped { reason: overlap }`。
- fleet 的 `fleet/cell` 事件在结果被记录后每个 cell 恰好触发一次，在 fleet 现有的 e2e 中断言。
- README 对携带单元文件、值守手册，以及说明此处没有任何东西进入模型请求的 Model Experience 一节；Village 笔记的推进项 3 指向本笔记。

## Rollout

1. 已落地。Fleet：只读观察的 `fleet/cell` 事件及其单元与 e2e 断言，外加推进项 2 通过 `ctx.fleet.run` 运行一个计划的子集所需的 `cells` 选择。
2. 已落地。`dsh-shifts`：摘要、班次会话与 `shift/*` 事件、按账本与 stamp 扫描的恢复、节奏、花费窗口、不变量伴随件、带杀死与重启的 Loader 启动 e2e、README 对、重新生成的持久化目录。README 还承载推进项 4 的单元文件、容器示例与值守手册，因此运维人员在门禁消息存在之前就能从该包读到它们。
3. Scorekeeper：`shiftFacts`（从账本得到的每班次一行）与 `ScoreboardRow` 的 `district` 列，关闭 Village 笔记的 TODO。
4. 监督：班次组合缺少持久化时点名驱动器的 `verify-village-composition` 消息；单元文件、容器示例与值守手册已随推进项 2 落地。
5. 之后，四目标笔记的日志式工作流引擎承载该循环；账本事件不变。

## Risks

- **恢复时的扫描成本。** 有数千个会话的持久化根目录会使 stamp 扫描变慢；把范围限定在班次会话之后创建的会话使其与一个班次成比例，而 `fleet/cell` 条目使扫描成为例外。
- **时钟。** 节奏读取宿主时钟；时钟跳变会移动一个时段但绝不重复一个，因为由账本裁决。
- **事故中的孤儿。** 令 cell 在运行中途死亡的供应商故障会抬高错误列；fleet 的路由熔断器按计划限制它，花费窗口按区限制它，而各行按设计保持真实。
- **磁盘。** 工作区保留已有；日志保留没有，因此运行数月的部署需要在零号班次开始前为会话日志制定保留计划。
- **推进项 1 期间的两种描述。** 在 scorekeeper 折叠账本之前，fleet 报告与账本都描述一个班次；重启读取的是账本。

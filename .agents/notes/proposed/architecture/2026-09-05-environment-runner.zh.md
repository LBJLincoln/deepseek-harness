# Agent Note：环境运行器

Status: proposed

[English](2026-09-05-environment-runner.md) | 中文

## Problem

没有任何东西运行环境。[轨迹导出笔记](2026-09-05-trajectory-export-and-environment-registry.md)落地了改进闭环的两端：注册表持有带验证器的任务，导出器把已完成的会话变成带奖励的记录。两端之间，实现者必须收到任务，验证者必须从环境的检查编写完成标准，在实现者停下后执行这些检查、记录运行，并且只在有证书时才完成 goal。如今只有 `drive-verification` 测试夹具在执行这些步骤：手工地、在一个已配置根 agent 的 `agent/pre-step` 内、用硬编码结果代替真正执行的检查。

每次运行都需要自己的会话。一条轨迹就是一个会话；headless bundle 与夹具每个进程只驱动一个根 agent，于是评估 N 个环境要花 N 个进程与 N 次启动，而每个会话的工作区都是进程的工作目录。要在一个组合内跑通闭环，需要每次运行一个新会话，并根植于每次运行各自的工作区。

隔离是只有部署方才能做出的声明。证书记录运行所处的隔离级别，而在进程内执行检查的代码无法观察实现者是否能够触及验证者的标准或夹具。

## Proposal

在 `improvement/` 组中加入 `@deepseek-ai/dsh-environment-runner`（`ctx.environmentRuns`）：面向检查为命令行的环境的自动验证者。

**每次运行一个会话。** `run({ environment, workspace, model?, repetition?, group?, signal? })` 从 `ctx.environments` 读取定义，当任务声明了 `task.fixture`（一个已存在的绝对目录）时把它覆盖到 `workspace` 上并对其文件求哈希，然后通过 `ctx.agents.create` 创建一个新 agent：`meta.cwd = workspace`，使用请求的模型路由或组合的 `agentDefaultModel` 选择，以及与 headless bundle 相同的 `installModelSelection` setup。bash 工具从会话头的 `cwd` 解析默认工作目录，因此实现者在本次运行的工作区内工作，无需重新根植任何能力。每次运行可指定的模型路由使一个进程能够服务整个模型矩阵。

**stamp 先行。** 在任何其他内容进入日志之前，运行器追加 `environment/run` 事件：环境 id 与 kind、留出标志、提示词、夹具与检查的内容哈希、repetition 与 group、模型路由，以及声明的隔离级别。stamp 是会话与其环境之间的持久链接；轨迹折叠读取它，导出器据此扣留留出会话，策展者据其内容哈希去污染。词汇与严格解码器位于 `dsh-environments`，因为 stamp 描述的是环境领域，且读取它的消费方不止一个。

**在第一个 token 之前建立 goal 与标准。** 在 stamp 之后，运行器创建 goal（`objective` 即任务提示；轮次上限来自配置或 goal 服务默认值）并立即将其解除武装，这样即便组合了 goal-round driver 也不会自行继续该 goal：尝试由运行器拥有。随后它逐字用环境的检查编写标准。实现者不会通过运行器收到检查。本切片尚未完成读取屏障：组合了日志读取工具或与执行器共享文件系统的实现者 preset 仍能触及标准，因此本运行器的证书强度等于部署方的隔离声明，不多不少；作为文件系统权威的屏障是下一个切片。

**运行器就是验证者。** 每次尝试到达整个 agent 空闲后，运行器通过 `ctx.shell` 执行当前标准的每个活动检查：先 `resolve({ command: check.run, workdir: workspace, timeoutMs })`，再 `run(spec)`。退出码为 `0` 且未超时、未中止即为 `pass`；其余皆为 `fail`。证据是退出事实加上 stdout 与 stderr 的有界尾部。每次验证之前，运行器会再次覆盖夹具，使实现者对验证者所有文件的改动绝不会到达检查，并对工作区求摘要。`recordRun(agent, ref, isolation, results, { executor: 'runner', treeHash })` 持久记录每一次运行，随后提交一张证书或返回失败子集。已认证：运行器通过 `ctx.goals.complete` 完成 goal，验证守卫予以准许。未认证：运行器记录一条 directive（`rootCause` 给出失败检查的数量；`detail` 携带失败证据，绝不包含检查 id、结果陈述或命令），并在仍有尝试余额时，把 directive 放进 `<validation_failed>` 块中作为后续用户轮次排队。

**隔离是配置。** `isolation` 是必填且无默认值的 `Config` 字段：`none`、`process` 或 `host`，恰好取部署方能够为之辩护的值。实现者与验证者共享文件系统的本地组合是 `none`；检查与夹具位于另一账户或主机上的运行是 `host`。运行器把配置值写入每一张证书。

**报告与记录。** `run()` 在刷写会话后返回环境 id、会话 id、与追加时完全一致的 stamp、每次尝试一条记录及其检查结果与工作区摘要、运行是否认证、认证时的证书，以及累计的模型用量。持久记录是会话日志本身：stamp、`goal/change`、五个 `verification/*` 事件（含每次尝试一条 `verification/run`——无论通过与否的结果、该标准内的尝试序号、执行者，以及检查所读工作区的摘要）与消息。导出器把它折叠为一行奖励依据为 `certificate`、`attempts` 计数即这些运行、`environment` 字段即该 stamp 的 `dsh-trajectory/1`；运行器恰好写入一条自己的会话事件。

**配置。** `isolation`（必填）；`maxAttempts`（正整数，默认 1：一次实现者轮次加一次验证即为单次评估，更多则是部署选择）；`maxGoalRounds`（可选，交给 goal 创建；缺省时使用 goal 服务默认值）；`checkTimeoutMs`（可选的每检查覆盖值，由执行器封顶）；`evidenceMaxChars`（正整数，默认 2000，是每条证据字符串与 directive detail 的上界；不得超过验证服务的 `maxTextChars`，否则 `recordRun` 会大声拒绝结果）。

## Alternatives considered

**驱动组合的根 agent。** 每个环境一个进程且没有每次运行的工作区：那是夹具的形状，不是运行器的。

**让 goal-round driver 继续尝试。** 轮次会一直持续到模型宣告完成，而守卫在没有证书时拒绝完成，于是验证永远不会在轮次之间运行。运行器解除 goal 武装并在每次空闲时验证。

**通过 `ctx.subprocess` 执行检查。** 这绕过了执行器的凭据清洗、超时封顶、沙箱策略与输出边界。`ctx.shell` 才是拥有命令执行的 seam。

**由模型验证者运行程序性检查。** `run` 为程序性描述（`inspect the assistant text`）的检查需要评审者，而评审者属于监督 seam。本运行器执行命令行；程序性检查会以非零退出大声失败，证据如实说明，环境作者应编写命令检查。

**推断隔离。** 进程内没有任何东西能观察部署的隔离。默认为 `none` 会悄悄贬低隔离部署的每一张证书，默认为 `host` 则是撒谎。

**以 system 或 tool 消息发送 directive。** 后续轮次正是人类验证者会使用的通道；用户轮次保持了导出器与 round driver 已经理解的会话形状。

## Acceptance criteria

- 对单个检查通过的环境运行 `run()`，返回 `certified: true`、一次尝试、携带配置隔离级别的证书、处于 `complete` 阶段的 goal，以及首个事件为 `environment/run` stamp 的已持久化会话；导出的轨迹奖励为 `1`、依据为 `certificate`，并以 `environment` 携带该 stamp。
- 对检查失败的环境运行 `run()`，恰好在 `maxAttempts` 次尝试后返回 `certified: false`，每次尝试一条 directive，且每个后续轮次都以用户消息携带 directive；导出的轨迹奖励为 `0`、依据为 `certificate`。
- 对留出环境的会话导出时，除非请求设置了 `includeHeldOut`，否则扣留该行并计入 `heldOut`；同一环境两次运行的内容哈希相同，而提示词、夹具或某条检查改变时哈希不同。
- 超时、被中止或因信号终止的检查为 `fail`，证据说明原因，且没有任何证据超过 `evidenceMaxChars`。
- 未知的环境 id、相对或缺失的工作区或夹具目录、替换了 goal 的实现者、以及丢失的标准，各自以稳定的 `EnvironmentRunError` 代码拒绝；前三种在 agent 存在之前就拒绝。
- 每次运行之后，无论成功或失败，agent 句柄都被释放、会话都被刷写；一个由 Loader 启动的组合在一个进程内把两个环境作为两个会话运行。

## Rollout

1. 本笔记、`dsh-environments` 中的 `environment/run` stamp、该包、基于 headless 夹具的 Loader 启动 e2e，以及带留出扣留的会话轨迹导出。
2. 作为文件系统权威的读取屏障（实现者执行器无法读取的验证者根目录、工具守卫、不含日志读取工具的实现者 preset）；运行器原生的每次运行重复次数以支持分组采样。
3. `/environments` 与 `/trajectories` 命令；待注册表发出注册事件后的 `environment` 组件适配器。
4. 按环境的拒绝采样导出与按组件的奖励统计（轨迹导出笔记的第 3 阶段）。

## Risks

在 `isolation: none` 下，检查以实现者的权限在同一工作区内运行；需要可辩护证书的部署应在另一账户或主机上运行验证者，并相应配置 `isolation`。

覆盖到非空工作区的夹具会覆盖同名文件。运行器拒绝不是目录的工作区，但不要求它为空，因为任务可以合理地从既有检出开始。

证据把命令输出带入会话日志，进而带入导出的轨迹；导出器不是脱敏层（见轨迹导出笔记的 Risks）。

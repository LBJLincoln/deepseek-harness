# Agent Note: The external-agent bridge

Status: proposed

[English](2026-09-06-external-agent-bridge.md) | 中文

## Problem

[`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) 通过固定版本的官方 Agent SDK，在委派 Session 的工作区里启动一次 Claude Code 运行，并且只返回最终答案。期间外部智能体执行的每一次操作都属于那个产品：它用自己的工具栈直接读写工作区，所做的一切都不经过本仓库的[读屏障](2026-09-05-read-barrier.md)、[文件系统策略](../../../../packages/fs/fs/README.md)、[审批接缝](../../../../packages/interaction/user-approval/README.md)、[预算策略](2026-09-05-budget-policy.md)，也不进入会话日志。该 Provider 的 README 已把这写成限制（“仅最终文本 —— 推理、中间消息、工具流量、用量、stderr 与工作区差异都留在产品内部”），读屏障 note 则写出了它的后果：进程外 Provider 只能靠拒绝启动来执行策略，因为本进程装设的任何围栏都够不到外部智能体的读取。

这就是黑盒的全部代价。一次委派，其子智能体在本仓库从未施加过的策略下修改了文件，父会话日志中留下的结果便无法重建 —— 而这正是**模型可见 ⟺ 已记录**所禁止的。[读屏障 note](2026-09-05-read-barrier.md) 从另一侧记录了同一件事：四个进程外 Provider “启动一个自带工具栈、没有任何本仓库策略的外部智能体”，因此 `implementer` 会话在 `none` 之上的隔离声明下会彻底拒绝它们，而不是去约束它们。

反方向已经存在。[`dsh-mcp-client`](../../../../packages/mcp/mcp-client/README.md) 把外部 MCP 服务器的工具以 `mcp__<server>__<name>` 注册到 `ctx.tools` 上，于是一个外来能力经由本仓库自己的注册表、策略和日志抵达本仓库的模型。反过来的箭头则不存在：本仓库无法把自己的工具集交给一个外部模型。

## Proposal

把工具注册表作为一台 MCP 服务器提供给外部智能体，并且除此之外什么都不给它。外部产品保留自己的模型、自己的提示词组装和自己的循环；本仓库保留这些产生的每一次操作。

### `@deepseek-ai/dsh-mcp-tool-server` —— Service Definition 及其唯一 Provider

`packages/mcp/mcp-tool-server/` 处的新包注册 `ctx.mcpToolServer`。它为**一个**本仓库智能体构建一台官方 [`@modelcontextprotocol/sdk`](../../../../packages/mcp/mcp-tool-server/README.md) `McpServer`，其工具清单恰好是该智能体经 `ctx.tools` 所见的工具，其调用处理器则通过 `ctx.tools.execute()` 在该智能体上执行每一次调用。它是 `dsh-mcp-client` 的镜像：同一套 `mcp__<server>__<name>` 公开命名，读向相反。

`instance(agent, options)` 返回一个 `McpToolServerHandle`，携带 Agent SDK 接受的进程内服务器配置（`{ type: 'sdk', name, instance }`）、已暴露工具名的快照，以及 `dispose()`。工具身份在创建时取快照而非实时跟踪：本次运行的工具面就是外部模型在首次 `tools/list` 中被告知的那一套，而一套在其脚下改变的集合会让持久的 `bridge/start` 记录变成错的。

处理器正是本仓库权威真正生效的地方。它先追加 `tool/call`，再等待 `ctx.tools.execute({ callId, name, arguments, agent, signal })`，然后追加 `tool/result`，并把执行器渲染出的内容作为 MCP 结果返回。这一次调用承载了整条流水线：`tools/pre-execute`（审批、权限、计划模式）、注册表守卫（其中包括读屏障的权限守卫）、`tools/execute` 包装器（工具调用超时）、工具自身派发的文件系统策略、`tools/post-execute`，以及定义自有的内容投影。该智能体作用域看不见的工具根本不会注册到服务器上；即便被点名，它在执行器处仍会以 `UNKNOWN_TOOL` 失败 —— 决定由做出它的操作执行，而不是由工具清单执行。

**这次运行是子会话的一个 turn。** `tool/call` 与 `tool/result` 是 step 作用域事件：[会话不变式](../../../../packages/core/session/src/invariant.ts)要求二者各自指名当前打开的 turn 与 step。因此 handle 恰好拥有一个 turn：创建时追加 `turn/start` 与 `step/start`，销毁时追加 `step/end` 与 `turn/end`。它所服务的智能体是为一次桥接运行创建、且无人另行驱动的子智能体，所以不会有循环拥有的 turn 与之冲突；handle 上的 `serves` 指名该智能体，同一智能体上的第二个并发 handle 在创建处即被拒绝。这是执行器的调用得以持久化的唯一结构，同时也是诚实的结构：外部智能体的一次运行**就是**授权它的那个本仓库会话的一个 turn。

`serve(agent, options)` —— 同一台服务器经 SDK 的 Streamable HTTP 传输在回环端口上提供，配以每次运行的 bearer token，供接收 MCP 端点而非进程内实例的 Codex 与 ACP Provider 使用 —— 被**推迟**。它需要一个 HTTP 监听器、一次 token 比对、每会话的传输记账，以及自己的拒绝测试；这些都不与进程内那一面共享，而桥接的首个消费者并不使用它。包 README 在 Known Limitations 下写明这一点。

销毁会关闭传输、关闭 turn，并让此后每一次调用失败：在 turn 关闭后仍运行的处理器会在其 step 之外追加一个 step 作用域事件。

### 接缝能力：`harnessTools`

`SubagentCapabilities` 新增 `harnessTools`，`SubagentStartRequest` 新增 `harnessTools?: { only: true }`。服务在不具备该能力的 Provider 上以既有的 `UNSUPPORTED_CAPABILITY` 错误拒绝请求，与 `outputSchema` 的拒绝完全一致 —— 同一条“大声失败、不静默降级”的规则，在 `start` 运行之前检查。

该选项是对象而非布尔值，因为 `only: true` 是语义而不是开关：一旦请求它，子模型的工具面**就是** Provider 在父级血统下创建的一个子本仓库智能体的工具集，**除此之外别无他物**。Provider 按进程内 driver 的方式组合该子智能体 —— 父级 preset join、委派作用域声明、被委派的策略覆盖、解析出的深度、父级 cwd、经 `ctx.tools.restrict()` 兑现的 `toolFilter` —— 其会话即本次运行的持久记录。该对象日后新增的成员（部分工具面、具名子集）便是加宽，而不是重新定义。

### 桥接模式下的 `subagent-claude-code`

不带 `harnessTools` 时，Provider 的行为与今天完全一致，连 SDK 选项都不变：这是新增的一个模式，不是替换。

请求 `harnessTools` 时，它先创建子本仓库智能体与会话，把 `mcpToolServer.instance(child)` 作为名为 `dsh` 的 SDK 服务器挂上，并把外部智能体的工具面钉死：

| 选项 | 取值 | 原因 |
|---|---|---|
| `tools` | `[]` | 产品自带的内置工具一个都不要。 |
| `mcpServers` | `{ dsh: <instance> }` | 本仓库注册表，进程内。 |
| `allowedTools` | `['mcp__dsh__*']` | 本仓库工具无需产品侧提示即可运行。 |
| `canUseTool` | 拒绝 `mcp__dsh__` 之外的每个名字 | 真正的执行。`allowedTools` 是提示抑制清单，不是围栏。 |
| `strictMcpConfig` | `true` | 不接受来自工作区、用户设置或插件的 MCP 服务器。 |
| `settingSources` | `[]` | 不读项目设置、hooks、CLAUDE.md 或 agent frontmatter。 |
| `persistSession` | `false` | 与黑盒模式相同。 |
| `maxTurns` | 存在时取自 `agentOptions` | 调用方的轮次上限抵达外部循环。 |

`canUseTool` 才使工具面成为围栏而非提示：`tools: []` 与 `allowedTools` 决定模型被**告知**了什么，而仍然点名别处的模型会在将要运行它的操作处被该回调拒绝。

SDK 消息流以三个包自有的仅日志事件折叠进子会话，由 `subagent-claude-code/src/types.ts` 中的 `SessionEventMap` 合并声明：

- `bridge/start { provider, tools }` —— 每次运行一条，指名 Provider 与实际提供的工具名。
- `bridge/assistant { text, usage? }` —— 每条助手消息一条，仅文本块。工具调用不在此重复：执行器已把每一次记为 `tool/call`/`tool/result` 对，第二份副本会成为同一事实的第二个来源。
- `bridge/end { stopReason, usage? }` —— 每次运行一条，携带接缝自己的停止原因。

它们仅进日志：`deriveMessages()` 忽略它们，因此外部模型的文本永不重新进入任何本仓库模型的上下文。最终答案仍按既有的 `SubagentResult` 契约返回，保持不变。

### 黑盒模式自己的权限策略

桥接模式在本仓库执行器处回答每一次工具调用，从而消掉了产品的权限询问。黑盒模式仍然有它，而在宿主机原生设置下，产品默认的模式会在写文件之前询问 —— 于是无人值守的黑盒子级会报告自己没有权限，而不是把活干完。`subagent-claude-code` 的两个配置字段让它可部署：`permissionMode`，取锁定版本 SDK 的那几个值，在**两种**模式下都传递，默认不设置；以及 `allowedTools`，只作用于黑盒模式的自动批准清单，因为桥接模式的允许清单与拒绝回调就是那道围栏，部署清单不得把它加宽。`bypassPermissions` 还会额外设置 SDK 的 `allowDangerouslySkipPermissions`，因为在 `cordis.yml` 里指名该模式的部署**就是**那个标志所要求的意图。

因此在 `isolation: none` 下无人值守的 implementer 运行在 `acceptEdits` 或 `bypassPermissions` 上 —— 它把产品自身的约束交了出去，而这恰恰是桥接模式用本仓库的约束所替代的那一个。

### 桥接模式对读屏障改变了什么、没改变什么

本切片让拒绝原封不动：两种模式下 `assertOutOfProcessAllowed` 都先运行，因此 `process` 或 `host` 声明下的 `implementer` 会话无论是否索要本仓库工具都会被拒绝。

尽管如此，桥接模式是日后放宽它的前提。在 `harnessTools: { only: true }` 下，外部模型执行的每一次读取都是经本进程执行器的 `read` 或 `grep`，而 `fs/read-intent` 与屏障的工具守卫已在那里拒绝 —— 于是子智能体可以注册 `enforce('subagent')`，普查也就能为它记下 `denied-at-executor`，那正是 `process` 隔离所要的证据。

仍然阻止放宽的是外部进程本身。该 CLI 无约束运行：它不被 `ctx.sandbox.confine()` 包裹，它继承了一个工作目录和一个文件系统，也没有任何东西阻止它用自己的运行时而非一次 MCP 调用去打开被拒目录 —— 本仓库围住的是它提供的工具，不是它启动的进程。堵上这一点需要把该进程纳入沙箱接缝，并由后端表达 `deniedReadRoots`，那是针对 `dsh-subprocess` 与 `dsh-sandbox-local` 的另一个切片，不是本切片的推论。

## Alternatives considered

**代理产品自己的工具，而不是替换它们。** 用 `canUseTool` 拦截 Read/Write/Bash 并改由本仓库重跑，可以保留产品的提示词与工具描述原样。它在最要紧的那个操作上失败：`canUseTool` 只能允许或拒绝，被允许的调用仍以产品的策略运行产品的实现，被拒绝的调用则让模型无路可走。提供本仓库自己的工具，是模型所发出的调用**就是**本仓库所执行的调用的唯一安排。

**一开始就用 stdio 或 HTTP 给外部智能体一台 MCP 服务器。** 进程外传输正是 Codex 与 ACP 将要需要的，也是通用答案。它同时是严格更多的表面 —— 监听器、token、传输生命周期 —— 而首个消费者直接接受进程内实例。进程内那一面先落地，HTTP 那一面写成推迟的工作而不是造一半。

**通过解析 SDK 消息流记录外部智能体的工具流量。** 该流携带 `tool_use` 块，因此 Provider 可以在不执行任何东西的情况下记录它们。那是记录产品做了什么而不授权它：没有审批、没有文件系统策略、没有守卫，也无从拒绝。桥接存在的理由恰恰是观察不等于权威。

**复用 `tool/code-dispatch` 而不是 `tool/call`/`tool/result`。** 那两个事件不是 step 作用域的，因而不需要 turn。它们也是 `run_code` 传输自己的词汇，携带桥接调用并不具备的 `rootCallId` 与父调用，渲染它们的 UI 会把本仓库的工具调用呈现成 Code Mode 子派发。桥接调用是智能体的一次普通工具调用，因此采用普通的事件对以及该事件对所要求的 turn。

**让子本仓库智能体自己的循环驱动这个 turn。** 由循环打开的 turn 需要一次模型请求，而桥接模式的全部要点正是模型在外部。handle 拥有一个 turn，既让日志良构，又不必虚构一次从未发生的请求。

**实时跟踪工具集并发送 `tools/list_changed`。** MCP 支持它，`dsh-mcp-client` 在另一方向上也消费它。此处该集合是本次运行自身的契约：它被记录在 `bridge/start` 中，是外部模型据以规划的东西，而运行中途的改变会让那条记录描述一个模型从未拥有过的工具面。

**布尔值 `harnessTools: true`。** 它读起来像“也暴露本仓库工具”，而这恰恰是该能力**不**表示的意思。`{ only: true }` 在调用点写明排他性，并为日后的非排他成员留下位置。

## Acceptance criteria

- 在具备该能力的 Provider 上，`ctx.subagents.start('claude-code', { …, harnessTools: { only: true } })` 会在父级血统下创建一个子本仓库智能体；同一请求在不具备该能力的 Provider 上，会在任何进程启动之前以 `SubagentError('UNSUPPORTED_CAPABILITY')` 被拒。
- 在 `examples/headless-agent/tests/fixtures/agent-bridge/` 上由 Loader 启动的组合中，一个经内存传输的官方 MCP `Client` 列出恰好是子智能体所见的工具、调用其中之一，并且子会话日志在一个打开的 turn 与 step 内携带 `tool/call`/`tool/result` 对 —— 证明该调用抵达了本仓库执行器而非某个桩。
- 同一 fixture 证明拒绝发生在执行器处：子智能体作用域中不存在的工具名被拒，且 handle 在 `dispose()` 之后拒绝每一次调用。
- Provider 的单元测试钉住桥接模式所传的 SDK 选项（`tools: []`、`allowedTools`、`strictMcpConfig`、`settingSources`、`maxTurns`），证明 `canUseTool` 拒绝非 `mcp__dsh__` 名字，并断言 `bridge/start`、`bridge/assistant`、`bridge/end` 按此顺序出现在子会话日志中。
- 黑盒模式不变：既有的 Provider 测试原样通过。

## Risks

handle 打开的 turn 是由智能体循环之外的东西写下的持久结构。当被服务的智能体是桥接自己的子智能体时它是正确的；若某个组合把 `instance()` 交给一个由别处驱动的智能体，它便会与活跃循环的 turn 计数失步。handle 指名它所服务的智能体，并拒绝该智能体上的第二个并发 handle；违反其余前提的部署得到的是子会话日志上一次大声的不变式失败，而不是一次静默的失败。

外部进程仍不受约束。桥接模式围住的是工具而不是进程，因此一个用自己的运行时而非一次 MCP 调用去读文件的产品，处在本 note 所加一切之外 —— 这正是读屏障的拒绝原地不动的原因。

子会话记录外部智能体的文本，但不记录它的推理或系统提示词。`bridge/assistant` 携带 SDK 报告为助手文本的内容；产品隐藏的思考、它组装的提示词以及它自己的上下文，从本进程无法观察，因此子会话日志的读者看到外部智能体说了什么、做了什么，但永远看不到为什么。

为本仓库自己的模型撰写的工具描述会抵达一个外来模型。它们是面向模型、针对本部署提示词调校过的散文，另一个模型可能读出不同意思；桥接既不改描述也不改 schema，因此这种不匹配以普通的工具使用错误显现，而不是无声的分歧。

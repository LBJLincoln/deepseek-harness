# @deepseek-ai/dsh-subagent-claude-code

[English](README.md) | 中文

本包（package）注册固定的 `claude-code` subagent 提供方。每次接受运行请求后，它都会在发起委托的会话工作区中调用官方 Claude Agent SDK，通过共享子进程服务解析原生 `claude` 可执行文件，提交一个自包含的文本任务，并通过共享的 [`dsh-subagent`](../subagent/README.md) 结果约定仅返回最终答案。

## 启动与所有权

`start(request)` 只接受非空的文本块序列，并根据父会话确定子级 cwd。它会创建一个私有 `AbortController`，调用官方 SDK 的 `query()`，并仅在 SDK 的 `spawnClaudeCodeProcess` 钩子已经提供由 [`dsh-subprocess`](../../subprocess/subprocess/README.md) 管理的活动 CLI 句柄后发布此次运行。若在发布前发生失败或取消，它会关闭 query、终止所有已取得的进程树并等待其退出，然后拒绝 `start()` 调用。

SDK 接收由文本块原样拼接成的任务。提供方会完整迭代 SDK 消息流，而且只接受满足以下条件的 `result` 消息：其 `subtype: "success"`、`is_error: false` 且 `result` 非空白，之后迭代器还须正常结束。所有 SDK 错误子类型、标记为错误的成功消息、缺失答案、迭代器失败、协议失败或进程失败都映射为 `error`；该提供方不会产生 `max-tokens` 或 `refusal`。

本地取消会在结果竞态中胜出并映射为 `aborted`。`dispose()`（资源释放）具有幂等性：它会中止此次运行、请求 SDK query 关闭、调用共享的进程树逐级终止机制，并等待整棵进程树退出。SDK 的优雅关闭只表达协议意图；进程是否完全停稳仍以子进程句柄为准。结果失败与独立的清理失败仍彼此分离。

在 spawn 任何进程之前，`start()` 会询问已组合的 [read barrier（读屏障）](../../verification/read-barrier/README.md)：这个进程外子 agent 是否允许运行。对部署声称 `process` 或 `host` 隔离的 implementer 会话，会以 `SubagentError` 的 `READ_BARRIER_REFUSED` 拒绝，因为外部 agent 自带工具栈，本进程安装的任何围栏都触及不到它的读取；在 `none` 声明下不拒绝任何启动。提供方会向 read barrier 登记该拒绝，因此 scope 普查会报告 `subagent`。

该拒绝对两种模式都生效，桥接模式也不例外。桥接模式使放宽它变得可以设想 —— 在它之下，外部模型执行的每一次读取都是经本进程执行器的一次本仓库工具调用，而屏障在那里已经拒绝 —— 但这并不充分：CLI 进程本身不受约束，它可以用自己的运行时而非一次 MCP 调用去打开被拒路径。约束该进程是针对沙箱接缝的另一项工作。

## 原生设置与交互

在桥接模式之外，提供方故意省略 SDK 的 `settingSources` 选项。因此，官方 SDK 会相对于父会话 cwd 读取宿主机常规的用户、项目和本地 Claude 设置，包括原生账户状态与产品配置。提供方既不复制也不过滤这些文件，也不会创建或修改登录状态。桥接模式则改传 `settingSources: []`，因为一条添加了工具或 hook 的工作区设置会重新打开桥接模式正要关上的那面；身份验证不受影响，因为 SDK 解析账户与该选项无关。

每次 query 都设置 `persistSession: false` 并禁用 `AskUserQuestion`。提供方不设置 elicitation 或对话回调，因此无人值守交互会经 SDK 失败，而不会等待本提供方不负责的用户界面。提供方唯一会设置的 `canUseTool` 是桥接模式自己的工具围栏，它不询问任何人：它只凭工具名做决定。

## 桥接模式：只有本仓库的工具集

携带 `harnessTools: { only: true }` 的请求让同一个产品面对一套完全不同的工具面。提供方在父级血统下创建一个子本仓库智能体 —— 父级 cwd、父级 preset 组合、被委派的沙箱与审批策略、解析出的委派深度 —— 通过 [`dsh-mcp-tool-server`](../../mcp/mcp-tool-server/README.md) 把该智能体的工具注册表作为名为 `dsh` 的 SDK 服务器提供出去，并把外部模型钉在它上面：

| SDK 选项 | 取值 | 原因 |
|---|---|---|
| `tools` | `[]` | 产品自带的内置工具一个都不要。 |
| `mcpServers` | `{ dsh: <进程内实例> }` | 本仓库注册表，就在本进程内。 |
| `allowedTools` | `['mcp__dsh__*']` | 本仓库工具无需产品侧权限提示即可运行。 |
| `canUseTool` | 拒绝 `mcp__dsh__` 之外的每个名字 | 真正的围栏。`allowedTools` 决定什么被自动批准，而不是什么可以被调用。 |
| `strictMcpConfig` | `true` | 不接受来自工作区、用户设置或插件的 MCP 服务器。 |
| `settingSources` | `[]` | 不读项目设置、hooks、CLAUDE.md 或 agent frontmatter。 |
| `maxTurns` | 已设置时取自 `agentOptions.maxTurns` | 调用方的轮次上限抵达外部循环。 |

因此外部模型发出的每一次工具调用，都是子智能体上一次普通的本仓库执行：由审批接缝授权、被注册表守卫过滤、受工具调用超时约束，并记为惯常的 `tool/call`/`tool/result` 事件对。最终答案仍按共享结果契约返回，`SubagentRun.localAgent` 就是已发布的子智能体，其 id 即运行 id。

固定版本的 SDK 会警告：`allowedTools` 中的裸条目会在 `canUseTool` 运行之前自动批准。这正是预期的分工：被提供的本仓库工具无需产品侧提示，而其他每个名字都落到该回调上并在那里被拒绝。

### 子会话记录了什么

`src/types.ts` 声明三个仅进日志的事件，它们都不会进入任何本仓库模型的上下文：

| 事件 | 载荷 | 时机 |
|---|---|---|
| `bridge/start` | `provider`、`tools`（外部模型所见的名字） | 一次，在服务器挂上之后。 |
| `bridge/assistant` | `text`、可选 `usage` | 每条带文本的助手消息一次。工具调用不在其中：执行器已把每一次记为持久事件对。 |
| `bridge/end` | `stopReason`、可选 `usage` | 一次，在运行落定或被释放时。 |

整次运行是该子会话的一个 turn，因为持久的工具事件对是 step 作用域的；[`dsh-mcp-tool-server`](../../mcp/mcp-tool-server/README.md) 拥有那个 turn，并在销毁时关闭它。

日志**不**持有外部模型隐藏的推理、它组装的系统提示词或它自己的上下文：这些从本进程都无法观察。子会话日志的读者看到外部智能体说了什么、做了什么，但永远看不到为什么。

## 能力与上下文

本提供方声明 `harnessTools` 而不声明其他任何可选的启动时能力，并报告 `inheritsParentContext: false`。`harnessTools` 是进程外子 agent 唯一能够兑现的启动时特性，因为是本仓库组合了那个提供其工具的子智能体，而不是要求产品去执行什么。`outputSchema`、`maxDepth`、`toolFilter` 与 `persona` 在两种模式下仍被共享服务为本提供方拒绝。

不带 `harnessTools` 时，Claude Code 会接收独立文本任务和父会话 cwd，但不会接收父会话的对话、角色设定、工具筛选器、深度策略或结构化输出约定。每次运行都拥有独立的 SDK query、取消控制器、CLI 进程和不持久化的产品会话。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `env` | `{}` | 显式指定的 SDK/CLI 环境，叠加在由共享机制清除凭证后的父环境之上。 |
| `disposeGraceMs` | `3000` | 共享进程树责任方各终止层级之间的宽限期，单位为毫秒且须为正有限值，并不得大于仓库共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)；随后资源释放会等待整棵进程树退出。 |
| `permissionMode` | 不设置 | 产品自身的权限模式，两种模式下都生效，取值为锁定版本 SDK 的那几个（`default`、`acceptEdits`、`bypassPermissions`、`plan`、`dontAsk`、`auto`）；其他取值在加载时即被拒绝。不设置则沿用产品自身的默认值。 |
| `allowedTools` | `[]` | 产品在**黑盒**模式下自动批准的工具名；为空则沿用产品自身的默认值。桥接模式忽略它，并保持自己的允许清单与拒绝回调。 |

在宿主机原生设置下，产品默认的权限模式会在写文件之前询问，因此无人值守的黑盒子级会报告自己没有权限而不是把活干完。所以在 `isolation: none` 下无人值守的 implementer 需要 `acceptEdits`（文件编辑）或 `bypassPermissions`（全部，且提供方会为它配上 SDK 所要求的 `allowDangerouslySkipPermissions`）。二者都把产品自身的约束交了出去 —— 而这恰恰是桥接模式所替代的：在那里本仓库在自己的执行器处逐次授权，因此根本不涉及产品侧的权限决定。

生产环境从子进程执行世界清除凭证后的 `PATH` 解析 `claude`，再应用显式 `env` 条目，并把所得路径作为 `pathToClaudeCodeExecutable` 交给 SDK。在 Windows 上，解析到的 `.cmd` 或 `.bat` 路径会作为带引号、仅供本次 spawn 使用的环境值交给 `cmd.exe /v:off` 展开一次，因此合法路径中的元字符仍只是数据。锁定版本的 SDK 随后把固定命令行选项放在 cmd 的命令尾部；这些选项不含 cmd 元字符，也并不是普通的 Windows argv。原生设置与身份验证继续是权威来源。本插件不安装另一份 CLI、不选择模型、不创建产品主目录、不执行登录，也不探测账户。具有凭证特征的环境变量会在显式 `env` 覆盖生效前被清除，因此供子进程使用的 API 密钥或 token 必须在该配置中显式提供。除非被覆盖，`ANTHROPIC_BASE_URL` 等非凭证端点变量以及 `PATH` 和 `HOME` 等普通环境变量仍会被继承。

随附 profile 会在宿主上加载一次该提供方，而且在工具被调用前不会启动 Claude 进程。完整 Agent Preset 携带下列工具行并设置 `disabled: true`；复制一个 preset 后删除该字段，即可只向由该副本组装的 agent 暴露 `subagent_claude_code`。自定义宿主组装仍可直接使用两条配置行。

```yaml
- id: subagent-claude-code
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: claude-code
    toolName: subagent_claude_code
    enableRunInBackground: false
    maxDepth: provider-managed
```

## 产品兼容性与证据

运行时依赖精确锁定为 `@anthropic-ai/claude-agent-sdk@0.3.220`。生产运行使用原生 `claude` 安装。无密钥真实产品测试使用由 SDK 分发的 Claude Code 2.1.220 CLI 作为确定性 fixture（测试前置数据），并通过同一套原生可执行文件解析路径与 Windows batch shim 路径运行；这项测试不声称兼容每个独立安装的版本。Loader 组合证明两个产品包能够共存且不会启动任一产品。

限定于项目所有者身份的分发授权涵盖官方 SDK 及每个 SDK 版本声明的官方 CLI／平台载荷。[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) 会披露当前可选载荷闭包，但不会认定其中声明的条款属于宽松许可；其他无关的非宽松运行时依赖仍会使第三方声明门禁失败。

## 模型体验

### 子级请求

#### 模型看到的内容

Claude Code 子级会在一个全新的 SDK query 中接收独立文本任务。它的工作区是父会话 cwd；其模型、系统指令、工具、权限和身份验证来自宿主机原生 Claude 设置与产品安装。在 `harnessTools: { only: true }` 之下，工具改为来自子本仓库智能体的注册表，宿主机的设置、hooks、项目文件与 MCP 服务器都被排除 —— 只有模型和身份验证仍属于产品。

#### 对 token 的影响

子级需为独立的 Claude Code 上下文和 query 承担 token 开销。子级 token 不会进入父级上下文。

#### 对 KV Cache 的影响

这与父请求缓存相互独立。能否复用只取决于 Claude Code 自身的模型、指令、工具、原生设置和全新 query。

### 父级工具结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，父级模型只会看到符合严格成功条件的 Claude Code 最终答案，或者在结果未完成时看到消费方给出的原样错误。Claude Code 的推理、工具活动、中间消息、stderr、工作区差异、用量信息和产品标识符均不会复制到父会话。

#### 对 token 的影响

父级输入只会增加工具结果中保留的最终答案或错误内容。本提供方自身不添加父级工具 schema。

#### 对 KV Cache 的影响

仅追加：新的工具结果接在可复用的父请求前缀之后。

## 已知限制与后续工作

- **每次运行均新建一个 query 和一个进程**：不支持续接、恢复、池化、进度流或产品会话持久化。
- **宿主设置有意保持权威**：项目和用户设置可以改变模型、工具与行为；本提供方不提供经过筛选或与宿主环境隔离的生产模式。
- **产品安装与账户状态仍由原生机制管理**：`claude` 缺失或不兼容、配置错误或身份验证失败都会呈现为启动错误或运行错误；本插件不提供安装程序或登录流程。
- **SDK 平台 CLI 仍在安装闭包内**：生产环境会忽略它，改用宿主提供的 `claude`，但当前 SDK 的可选依赖仍会安装，并提供无密钥兼容性 fixture。移除该载荷属于独立的产品安装闭包后续项。
- **没有人工交互路径**：`AskUserQuestion` 被禁用，其他交互回调也不存在，因此需要新审批或输入的任务会失败而不会挂起。
- **桥接模式之外仅返回最终文本**：不带 `harnessTools` 时，推理、中间消息、工具通信、用量信息、stderr 和工作区差异仍只保留在产品内部。桥接模式记录工具通信、助手文本与用量；推理和产品自己的提示词在两种模式下都无法观察。
- **除 `harnessTools` 外没有可选的共享能力**：对于本提供方，共享服务会拒绝输出 schema、子任务角色设定、工具筛选和 harness 深度强制约束。`toolFilter` 在桥接模式下是有意义的，但同样被拒：能力标志按提供方而非按模式声明，因此声明它也会让黑盒模式接受它，而在那里它会被静默忽略。
- **桥接模式需要组合工具服务器**：未组合 [`dsh-mcp-tool-server`](../../mcp/mcp-tool-server/README.md) 却请求 `harnessTools` 的部署会在启动时以 `SubagentError` 的 `BRIDGE_UNAVAILABLE` 被拒绝，因为提供方无法提供一个不存在的注册表。
- **被桥接的进程不受约束**：桥接模式围住的是交给外部模型的工具，而不是它运行所在的进程。
- **没有按实际经过时间触发的超时或副作用回滚**：长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。

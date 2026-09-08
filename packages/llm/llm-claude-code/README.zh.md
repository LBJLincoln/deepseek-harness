# @deepseek-ai/dsh-llm-claude-code

[English](README.md) | 中文

用运维方已完成认证的 Claude Code 安装来提供 harness 的 LLM 缝（seam），于是没有 API key 的主机同样可以让每一种 harness 角色——implementer agent、validator、judge、program department、workflow worker、进程内 subagent——跑在该订阅上。

该路由上每一次 `generate()` 都是通过官方 Agent SDK 向该安装发起的一次查询（query）。harness 的 system prompt 成为查询的 system prompt，会话成为查询的 prompt 文本，harness 工具则成为查询挂载的进程内 MCP 服务器的原生工具——于是模型用它受训所用的工具机制来规划。回复中的文本与工具调用成为缝的 `StreamChunk` 协议。产品自身不执行任何工具、也不读取工作区，因此每一次工具调用都回到 harness 的 agent loop，在 harness 自己的工具、会话日志、读取屏障（read barrier）、预算策略与审批下执行。

默认情况下，一个 harness 会话的各个步骤共用一个产品会话：每一步只用最新一轮把它 resume，于是安装从自己的 prompt 缓存中读取会话前缀，而不是重新收到它。循环仍归 harness 所有——一次 `generate()` 仍是一次模型响应，每一次工具调用仍由 harness 执行。

包根导出 Cordis 插件契约、`ClaudeCodeAdapter` 以及二者使用的请求/响应辅助函数；SDK 是本包的运行时依赖，而不是缝的依赖。

## 配置

```yaml
- id: llm-claude-code
  name: '@deepseek-ai/dsh-llm-claude-code'
  config:
    provider: claude-code    # required; the route registered on ctx.llm
    displayName: Claude Code # optional; the route name when omitted
    models:                  # required; a request naming any other model fails with UNKNOWN_MODEL
      - id: default          # the id harness requests select
        name: Claude Code default
        contextWindow: 200000 # optional; what the token meter and compaction threshold read
      # productModel names what the installation is asked to run; omit it and
      # the installation runs whatever it is configured to run.
      - id: fast
        productModel: <a model id this installation accepts>
    env:                     # optional; explicit entries over the scrubbed parent environment
      CLAUDE_AGENT_SDK_CLIENT_APP: deepseek-harness/1
    effort: high             # optional; low | medium | high | xhigh | max
    thinking:                # optional; adaptive | enabled (with budgetTokens) | disabled
      type: adaptive
    queryTimeoutMs: 300000   # optional; maximum idle interval between messages of one query
    disposeGraceMs: 3000     # optional; CLI process-tree termination grace
    sessionContinuity: per-session  # optional; per-session | per-query
    resumableSessionLimit: 64       # optional; product sessions kept resumable at once
    retryPolicy:             # optional; omission uses bounded normal defaults
      mode: normal
```

`provider` 必填且没有默认值：路由名是组合对“该安装在哪个缝键上作答”的声明，两个并列配置的安装必须能够各自命名。

`models` 同样必填且没有默认值。harness 无法向安装查询其订阅所授权的模型，因此目录属于运维方配置。`ctx.llm.listModels(provider)` 返回这些条目，`ctx.llm.resolveModelInfo(provider, id)` 返回带 `contextWindow` 的精确条目；与目录仅供参考的带密钥适配器不同，请求指定未登记的模型会在任何查询开始之前以 `LlmError('UNKNOWN_MODEL')` 失败。每个条目声明 `inputModalities: ['text']`，因此图像内容作为已声明的负向能力被拒绝。条目可选的 `productModel` 作为产品的 `model` 选项传给安装；省略它就不下发该选项，这正是希望由安装自身默认模型作答的部署所需的配置。

`effort` 与 `thinking` 对该路由上的每个请求原样传入查询。它们是路由级而非请求级的，因为该路由不发布任何推理档位：设置 `GenerateOptions.reasoningEffort` 的请求会在缝处以 `UNSUPPORTED_REASONING_EFFORT` 失败。

`queryTimeoutMs` 限定的是一次查询中消息之间的间隔，而不是答案本身的时长。查询要求下发部分助手事件，这些事件在安装仍在工作时到达，因此看门狗在进展证据上重新计时，只有在安装静默时才到期。到期抛出 `LlmError('TIMEOUT')`；更早的调用方中止抛出 `ABORTED`。

`sessionContinuity` 选择一步发送什么。在默认的 `per-session` 下，一个 harness 会话的各步共用一个产品会话，每一步只发送该会话尚未持有的那一轮，于是安装从自己的 prompt 缓存中读取前缀。在 `per-query` 下，每一步把整段会话发给自己的一次查询，不持久化任何东西也读不回任何东西；一次十步的探针在这种方式下量到 114,439 缓存写入 token 且无缓存读取，而 resume 时是写入 14,606、读取 69,212。当某个安装的 resume 表现异常，或者不能接受向运维方的配置目录写入转录时，选 `per-query`。

`resumableSessionLimit` 限定路由同时保持可 resume 的产品会话数量。它既是内存上界，也是清理策略：驱逐最久未用的那个会删除它的转录，而这正是会话永不结束的 harness 进程所依赖的。默认值 64 为当前消费方中扇出最宽的场景——Proving Ground bench 的 18 个 cell——留出了并行运行数次的余量。

## 一次请求如何渲染

渲染是缝所交付请求的纯函数，而该请求本身派生自会话日志，因此本包发送的一切都可由日志重建。进入查询的有三样东西：

- **system prompt。** `GenerateOptions.system` 成为查询的自定义 system prompt，取代产品自身的预设而非追加其后。没有 system prompt 的请求发送一个空串，同样取代该预设。
- **prompt 文本。** 先是一行阅读指引，然后是按日志顺序的整段会话。每个元素都由 `dsh-` 前缀的标签框定：`<dsh-user>`、带每次请求调用嵌套 `<dsh-tool-call id name>` 的 `<dsh-assistant>`、每条结果一个 `<dsh-tool-result id status>`，以及会话内部出现的 system 消息所用的 `<dsh-system>`。属性值会转义；当任何被渲染内容自身含有该前缀时，整次渲染改用第一个空闲的编号前缀（`dsh2-`、`dsh3-`……），因此没有任何消息会被读成框架。
- **工具。** `GenerateOptions.tools` 成为名为 `dsh` 的进程内 MCP 服务器的工具，经 MCP 低层处理器提供，因此每条 harness 描述与 JSON Schema 原样抵达模型——与 `request/header` 所记录的字节相同。查询挂载该服务器，并且只允许它所提供的名字，限定为 `mcp__dsh__<tool>`。不带工具的请求不构建服务器，也不允许任何名字。

该服务器不执行任何东西。它的处理器用一句固定文本回应每次调用，因为产品会在查询结束前运行它刚请求的那次调用；真正的调用随后由 harness 执行，与其他每一个 provider 完全一致。产品自身的工具保持关闭（`tools: []`），文件系统设置同样关闭（`strictMcpConfig: true`、`settingSources: []`），权限模式从不提问且拒绝未预先批准的一切。harness 的取消信号驱动 SDK 的 abort controller，SDK 拉起的 CLI 交由 `ctx.subprocess` 接管，由它拥有该进程树与终止阶梯。

查询的轮次上限是一条助手消息，这正是“一次 `generate()` 等于一次模型响应”的保证。发起工具调用的回复会触及该上限——产品作答、运行所提供的调用，就再没有剩余轮次——SDK 将其报告为携带该回复的 `error_max_turns`。对本路由而言，这是发起工具调用的答案的正常终止，而非失败。

## 一步如何抵达安装

`per-query` 下的一步把上面那整段 prompt 发给一次不持久化任何东西的查询。`per-session` 下的一步只在尚无产品会话持有该会话时才这么发送；否则它 resume 持有该会话的那一个，并发送产品自身答案之后的那些带框元素——标签相同，但不带阅读指引、也不带 `<{ns}-conversation>` 外层，因为它们所属的会话已经在那个产品会话里打开着。

只有当产品会话所持有的正是 harness 日志所持有的那段会话时，resume 才是正确的，而路由逐步证明这一点。它随每个产品会话记录：该会话被发送过请求中的多少条消息，以及对为这些消息所发送的一切取的 SHA-256 摘要——system prompt、所提供的工具定义、模型 id，以及这些消息的带框元素。下一步从自己的请求重算该摘要，并且只有在请求已超出该记录、把产品的答案作为紧随其后的那条消息携带、不携带产品未曾写下的更多助手消息，且摘要相符时才 resume。压缩、被插入的消息、变更的 system prompt 或工具集，以及回退的重试，各自都会让其中一项不成立，于是以新的产品会话跑一次全新查询。不带 `sessionId` 的请求——手工构造的一次性请求——没有可续的会话，始终是全新的。

一步走了哪条路径记录在答案上：finish chunk 以适配器 replay state 的形式携带 `{ continuity, productSessionId, fallback? }`，缝将其原样记入 `assistant/chunk`，并在组装后的 `assistant/message` 上再记一次。`fallback` 说明 `per-session` 路由为何仍跑了全新查询——`no-session-id`、`no-record`、`history-rewound`、`answer-missing` 或 `prefix-changed`。

resume 需要 `persistSession: true`，因此安装会在运维方自己的配置目录下写入该产品会话的转录。路由在某条记录离开表时删除它所创建的对应转录：不匹配后被替换、超出 `resumableSessionLimit` 被驱逐、某一步未交付答案后被丢弃，或插件卸载时被释放。路由未曾创建的转录绝不触碰，而存储拒绝删除时只会留下一个文件，不会让该步骤失败。

## 返回什么

查询的助手消息变为 chunk 流：其 text 块合并后非空时作为一个 text 块，随后按发布顺序每个 `tool_use` 块一个 tool-call 块，然后是用量，最后是 finish（回复发起了调用则为 `tool-calls`，否则为 `stop`）。一条 API 消息可能拆成数条助手消息、每块一条，因此两者都跨整次查询读取。thinking 块被忽略。调用名会剥去 `mcp__dsh__` 限定——直接使用 harness 原名的回复同样接受——其参数是 API 已解析输入的再序列化，正是缝端到端携带的形式。调用 id 按响应铸造为 `<result uuid>-<序号>`，因此在会话内唯一，并对回应它的工具结果保持稳定。token 计数直接映射——产品本就把未缓存输入与缓存读写分开上报，这正是缝自身的不相交约定。

回复调用了本次请求未提供的名字属于 provider 失败，绝不静默丢弃：`MALFORMED_RESPONSE`。助手消息既无文本又无调用的查询是 `EMPTY_RESPONSE`，默认重试策略会重试它。

## 错误

目录未声明的模型为 `UNKNOWN_MODEL`，图像内容为 `UNSUPPORTED_CONTENT`，二者都发生在任何查询之前。主机在 subprocess 缝的 PATH 上没有 `claude` 时为 `MISSING_EXECUTABLE`。空闲到期与调用方取消分别为 `TIMEOUT` 与 `ABORTED`。回复不可用为 `MALFORMED_RESPONSE` 与 `EMPTY_RESPONSE`，查询结束却未发布结果为 `STREAM_CLOSED`。不携带答案的结果依据它上报的全部 code、terminal reason、stop reason 与消息分类：先经缝的共享分类器给出 `CONTEXT_WINDOW_EXCEEDED` 与 `QUOTA`，再按结果子类型给出——没有工具调用却触及轮次上限为 `MAX_TURNS`，预算上限为 `QUOTA`，结构化输出重试耗尽为 `MALFORMED_RESPONSE`，执行期间失败为 `PRODUCT_ERROR`，而产品自己标记为失败的成功结果为 `TRANSPORT`，它携带的是产品自身请求的 API 失败，值得重试。SDK 以抛出而非发布结果的方式报告的失败成为 `TRANSPORT`，其消息中带有渲染后的 cause 链；结果发布之后的抛出会被丢弃，因为结果才是该次查询对自身的交代——除非是 harness 停止了该查询，此时 `TIMEOUT` 与 `ABORTED` 优先于产品已发布的任何内容。

## Model Experience

### 查询 prompt

#### What the model sees

该安装的模型把 harness 的 system prompt 原样读作自己的 system prompt——外面套着产品自己的一层外壳，本包既不撰写也无法查看它，这是此处唯一一项会话日志无法重建的模型可见输入——然后读到会话本身，其中下面的 `{ns}` 是标签前缀（内容未与之冲突时为 `dsh`），消息文本、调用 id 与参数来自会话。全新的一步以携带阅读指引与全部元素的一段 prompt 文本交付它；被 resume 的一步只把最新的元素交付进产品会话已经持有的转录中，另有该会话记作上一次调用工具结果的那句固定文本，它早于 harness 运行真正的调用——那是本包的常量，放在日志自身的工具调用所决定的位置上，并被随后作为本步骤 `<{ns}-tool-result>` 出现的真实结果取代。在会话之外，模型把本次请求的 harness 工具看作名为 `mcp__dsh__<tool>` 的原生工具，各自携带未经改动的 harness 描述与 JSON Schema，并像请求任何工具那样请求一次调用：每一步一个 API 轮次，无需遵守 prompt 协议，也无需把参数编码成 JSON 字符串。

##### 指引原文

```markdown
Answer the last turn of the conversation below. Elements tagged `<{ns}-…>` are the harness's framing; everything between them is the conversation.
```

#### Token effect

输入随历史增长的方式与带密钥路由完全一致，另加固定的框架标签，以及全新一步上的那一句指引。被 resume 的一步只发送最新一轮的元素，因此该路由每步传输的是那一轮而非整段会话；模型读到的内容两种方式下相同。工具 schema 每次请求都作为原生工具定义发送，与带密钥路由一致。产品自身的外壳还会增加一部分本包不度量的固定开销。

#### KV Cache effect

在 `per-session` 下，会话是安装可以读回的稳定前缀：一次十步的探针会话报出 69,212 缓存读取 token 对 14,606 写入，而每步发送整段会话时是写入 114,439、读取为零。每一个开启新产品会话的步骤——一段会话的第一步，以及 `continuity` 记录所指明的每一次回退——都会重新写入自己的整段前缀。在 `per-query` 下，没有任何一步复用前缀。两种模式下，产品上报的缓存读写都原样透传到缝的用量中。

### 回复

#### What the model sees

本包不添加任何内容。回复中的文本与工具调用成为 agent loop 记录并组装的 harness 内容块，harness 产出的工具结果在下一次请求的会话中作为 `<{ns}-tool-result>` 元素返回。

#### Token effect

生成的 token 遵循该路由所配置的 effort 与 thinking 策略；只有 loop 保留的块会影响后续输入。

#### KV Cache effect

保留的响应块追加到下一次请求的会话中。在 `per-session` 下，产品会话已经持有它写下的那个答案，因此这种增长延长的是可复用前缀而不是改变 prompt；在 `per-query` 下，它改变下一个 prompt，且什么都不会被复用。

## Known Limitations and Deferred Work

- **每一步仍要付一次全新的进程启动** —— resume 复用的是会话，不是进程。一次在同样十步上持有单个流式查询的探针量到相同的缓存读取占比，进程启动只有一次而非十次、墙钟少约 26%，但被持有的查询会在创建时冻结 system prompt、挂载的工具与模型，而 `GenerateOptions` 是按请求携带它们的（[Agent Note](../../../.agents/notes/proposed/architecture/2026-09-08-claude-code-route-session-continuity.md)）。
- **harness 进程遗弃的产品会话会比它活得更久** —— 路由在记录离开表时删除它所创建的转录，但在两步之间被杀死的进程会为每段存活会话在运维方的配置目录里留下一份转录。路由不会为孤儿去扫那个目录，因为它没有创建过的转录可能是运维方自己的工作。
- **被 resume 的会话携带 harness 日志所没有的排队调用文本** —— 产品把所提供服务器的固定回答记作上一次调用的工具结果，因此被 resume 的模型会在 harness 真正的结果之前读到它。它是插入在日志的工具调用所决定位置上的常量，而非自由文本，但它确实是一段由本包重建、而非从日志读出的模型可见字符串。
- **产品的 system prompt 外壳无法由会话日志重建** —— system prompt 由 harness 撰写，但安装会用本包既不写入也看不到的文本将其包裹，因此 `request/header` 记录了除该外壳之外的一切。
- **`maxTokens`、`temperature`、`topP`、`seed` 与 `stop` 被丢弃** —— 产品的查询选项没有对应项，而缝的契约是：线路上没有对应字段的适配器丢弃该字段。
- **不发布任何推理档位** —— `effort` 与 `thinking` 是路由级配置，因此 `agent/request` 无法像在带密钥路由上那样逐步改变推理档位。
- **产品会在轮次上限终止查询前运行一次所提供的调用** —— 其处理器不执行任何东西、只返回一句固定文本，但产品仍要花掉这次往返；请求了多次调用的回复，其全部调用都会在查询结束前以同样方式被回应。
- **没有 settings 缝热更新** —— 路由事实在加载时解析一次，不同于按请求重读 `ctx.settings` 区块的带密钥适配器。补上它需要一个 settings 命名空间以及带密钥适配器所用的原子路由替换。

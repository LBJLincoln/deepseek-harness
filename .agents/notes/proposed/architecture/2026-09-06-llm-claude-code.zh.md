# Agent Note: the LLM seam served by a local Claude Code installation

Status: proposed

[English](2026-09-06-llm-claude-code.md) | 中文

## Problem

harness 在 LLM 缝（seam）上与模型无关，但已发布的两个 provider 都需要 API key：[`dsh-llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md) 解析 `DEEPSEEK_API_KEY`，[`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) 为每条已配置路由解析一份凭据。因此，一台没有 key、却有运维方已完成认证的 Claude Code 安装的主机，无法通过该缝运行任何 harness 角色。

那个安装已经能够进入 harness，但只能经由 subagent 缝：[`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) 把一整个委派任务交给它。于是该任务执行期间，harness 拥有的一切都够不着了：产品自行挑选工具、自行访问文件、跑自己的循环、开自己的会话，而 harness 只看到一个不透明的答案。运维方的订阅本身并不要求这种取舍——缺的只是一个会说 LLM 缝的 provider。

## Proposal

新增 `@deepseek-ai/dsh-llm-claude-code`：一个 LLM 缝上的 Service Provider，其每一次 `generate()` 都是通过固定版本的官方 Agent SDK（`@anthropic-ai/claude-agent-sdk`）向运维方安装发起的一次无状态查询——与 subagent provider 已在使用的依赖和进程归属完全相同。

一个插件实例在 `ctx.llm` 上注册一条路由。路由名是必填且无默认值的 `Config` 字段，模型目录同样是必填配置：harness 无法向安装查询其订阅所授权的模型，只有运维方说得出。与目录仅供参考的带密钥适配器不同，请求指定未登记模型会在任何查询开始前以 `UNKNOWN_MODEL` 失败，因为这里的未登记 id 没有可透传的含义。目录条目可选的 `productModel` 就是查询请求安装运行的模型；省略它就不下发该选项，由安装运行自身配置的模型。

每次请求渲染为两项查询输入。harness 的 system prompt 成为查询的自定义 system prompt，取代产品自身的预设。会话与 harness 工具定义成为一段 prompt 文本：一行阅读指引、一个工具区，然后按日志顺序排列的每条消息，由 `dsh-` 前缀标签框定并对属性值转义。当被渲染内容自身含有该前缀时，整次渲染改用第一个空闲的编号前缀，因此没有任何消息会被读成框架。答案以结构化输出 `{ content, toolCalls: [{ name, arguments }] }` 的形式索取，其中 `arguments` 是 JSON 字符串——正是缝端到端携带的形式。

于是产品什么也不执行。`tools: []`、`mcpServers: {}`、`strictMcpConfig: true`、`settingSources: []` 与 `persistSession: false` 只留给它一个 prompt 和一份 schema；权限模式从不提问且拒绝未预先批准的一切。每次工具调用都作为缝的 chunk 返回，由 harness 的 agent loop 在 harness 自己的工具、会话日志、读取屏障、预算策略与审批下执行——这正是把它放在 LLM 缝而非 subagent 缝的全部意义。

SDK 拉起的 CLI 通过 subagent provider 所用的同一套自定义 spawn 投影交给 `ctx.subprocess`，于是进程树、环境清洗与终止阶梯都归 harness 所有。harness 的取消信号驱动 SDK 的 abort controller。

### 轮次上限

查询请求 `maxTurns: 2`，按助手消息计数。使“一次 `generate()` 等于一次模型响应”的，是不提供任何工具：产品可以说话，然后交付结构化答案，但永远无法在两轮之间行动。上限取二而非一，是因为交付本身要花掉一条助手消息——一轮的上限会拒绝所有在交付之前还说了话的回复，而那是大多数。它固定而非可配置，因为它属于产品的结构化输出协议，而不属于某个部署。

### 记录了什么

渲染是缝所交付消息的纯函数，而这些消息本身派生自会话日志，因此本过程撰写的每一项模型可见输入都可由日志重建——[可重建性](../../implemented/architecture/2026-07-05-reconstructable-requests.md)这一性质原样成立。

有一项输入在此之外：产品会用自己的一层外壳包裹所提供的 system prompt，本包既不撰写也无法查看。`request/header` 记录 harness 发送的一切，唯独不含该外壳。这是该路由弱于带密钥适配器的唯一之处，也是“驱动一个产品而非一个 API”的固有属性。

### 让查询保持存活

一次查询在首个 token 之前要花上数秒。`includePartialMessages: true` 让产品在工作期间发布部分助手事件，正是这些事件为 provider 自己的空闲看门狗重新计时，于是 `queryTimeoutMs` 限定的是静默的安装而不是答案的时长——与带密钥适配器的 `streamIdleTimeoutMs` 姿态一致。

这些 partial 不会作为 chunk 转发给缝。`StreamChunk` 协议没有与块无关的心跳：`BlockAssembler` 会为任何 delta 打开一个 partial 块，因此一个空文本 delta 会在每个纯工具调用响应里塞进一个多余的空文本块，并为每个 partial 记录一条 `assistant/chunk`。代价是该路由的首 token 时间等于整体作答时间，统计投影会如实报告这一点。

## Alternatives considered

**蹦床方案：让产品自己的循环经由进程内 MCP 服务器调用 harness 工具。** 另一个切片正在把它建为 subagent 缝中的桥，那才是它该在的地方：它让被委派的任务用上 harness 的工具，同时产品保留自己的循环、会话与多步控制。放到 LLM 缝上则形状不对。`generate()` 是一次模型响应，而一次蹦床式查询会在其背后跑完一整个嵌套 agent loop——harness 从未记为自身步骤的工具调用、session-budget guard 从未计入的预算、interaction 缝从未见过的审批，以及一份不再解释该响应的 `request/header`。让这个 provider 保持无状态，才使每种 harness 角色都能原样工作：循环仍归 harness，于是读取屏障、plan 模式状态、压缩阈值与重试策略都保持它们在带密钥路由上的含义。

**扩展 `dsh-subagent-claude-code` 而不是新增一个包。** subagent provider 应答的是另一份 Service Definition——它启动并结算一次委派运行——其能力、取消与结果词汇都属于 subagent 缝。共用一个包等于为省一个依赖而把两个缝的契约焊在一起；两者确实共享 SDK 的版本固定与自定义 spawn 投影，这份重复是刻意且已标注的，因为两个包都不得依赖对方。

**用自由文本索取工具调用，而不是结构化输出。** 这能省掉 schema 以及产品交付它所花的那一轮，但从散文里解析工具调用正是缝的原始 JSON 参数契约所要避免的失败，而格式错误的调用将与一个答案无从区分。结构化输出让缺失或不可读的答案成为一次带编码的 provider 失败，而绝不是一个空轮次。

**对只读工作，让产品读取工作区并运行自己的工具。** 每轮更便宜，也是错的：harness 的读取屏障、观察策略与审批正是工具结果值得信任的原因。一条有时绕开它们的路由，会使会话日志无法完整交代 agent 到底做了什么。

## Acceptance criteria

- 从经真实 Loader 启动的 `cordis.yml` 出发，在 SDK 的 `query` 被 mock 的情况下，`ctx.llm` 端到端服务所配置的路由：路由完成注册，一次请求返回 text 与 tool-call chunk，SDK 请求拉起的 CLI 走已挂载的 subprocess 缝。
- 单元规格在 `src/` 上保持逐文件 100% 覆盖，涵盖含工具调用与结果的多轮会话渲染、工具区、含工具调用的结构化输出解析、错误映射、取消、空闲到期、未知模型拒绝以及配置校验。
- 一个选择性开启的 e2e（`DSH_E2E_CLAUDE_CODE=1`）以该路由组合 `examples/headless-agent` 并驱动真实安装：agent 通过 harness 自己的 bash 与编辑器工具创建文件并读回，工作区文件在 agent 之外被验证。
- 该路由不附带 keyless 快照。快照工装重放录制的 provider 记录，而该路由的 provider 是一个本地进程，其答案未被录制；补上它意味着录制 SDK 消息流，那是另一个切片。在此之前，由 Loader 启动的 e2e 与选择性开启的真实运行充当证据。

## Risks

**每轮的时延与成本。** 每一轮都要付产品的启动加一次完整作答，而整段会话每轮重新发送且跨轮没有 prompt 缓存，因此长会话每一步都付全额输入。有 key 的部署仍应优先选择带密钥路由；本路由是为没有 key 的主机而存在的。

**产品的外壳。** 模型实际读到的 system prompt，是被一层本包看不到也记录不了的外壳包裹着的 harness prompt。对 prompt 敏感的行为——在带密钥路由上由快照钉住的 system prompt 变更——在这里只被部分交代。

**配额。** 这些查询花的是运维方的订阅，而产品上报的限流状态本路由尚未作为缝的用量暴露出来。耗尽订阅的运行表现为一次产品错误，由 harness 按常规策略重试。

**轮次上限的脆弱性。** 上限是两条助手消息。产品侧的结构化输出重试会超出它并表现为一次失败的查询；若这种情况常见，该调整的是这个数值，而不是这套设计。

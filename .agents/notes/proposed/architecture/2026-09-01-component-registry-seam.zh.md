# Agent Note: 组件注册表 — 让每个插件可寻址、可调用、可评分

Status: proposed

[English](2026-09-01-component-registry-seam.md) | 中文

## 问题

模型可调用的表面按类别各自独立且互不相通。工具通过 `ctx.tools` 调用，skill（技能）通过基于 `ctx.skills` 的 `skill` 工具调用，agent（智能体）通过基于 `ctx.subagents` 的 `subagent` 工具调用，工作流通过 `workflow` 与 `ralph` 工具调用，MCP 服务器则通过 `dsh-mcp-client` 挂载其工具来调用；上下文提供方、preset、组合包与知识来源完全没有可调用的身份。没有任何注册表能列举一个组合能做什么，也没有任何身份能跨越类别。

没有任何东西伴随一个插件的整个生命周期。谱系（一个合成插件派生自哪个插件）、来源（人工筛选还是合成）与证据（插件参与时会话获得了哪些证书）都无处存放，因此[验证 seam](2026-08-29-verification-improvement-oversight-seams.md)按 agent 折叠出的分数无法延伸到这些 agent 所使用的插件。

运行时自我改进止步于会话边界。[`tool-cordis`](../../../../packages/extensions/tool-cordis/README.md) 允许 agent 在进程内存中定义并运行一个插件，且其动态包按设计不能被自动晋升；合成的插件没有通往共享目录的路径，因此 Hermes Agent 为 skill 运行的循环（用后撰写、用中迭代、筛选核心）与 Darwin Gödel Machine 为 harness 重写保留的档案在这里都没有载体。

一个 agent 舰队是组合的组合：一个部门是由 agent 构成的 preset 组合，一个 agent 是由工具、skill 与上下文插件构成的组合。没有一套贯穿这些层级的寻址方案，排行榜、评审团与晋升策略就无法指名它们所评分的对象。

## 提案

新增一个组件注册表[能力 seam](../../implemented/architecture/2026-06-13-capability-seams.md)。组件是组合中的一个可寻址单元：一个插件，或插件提供的成员，例如工具、skill、subagent 提供方、工作流、MCP 服务器、上下文提供方、preset 或组合。注册表记录身份、类别、来源、谱系、成员关系以及模型触达该组件的方式；它不执行任何东西。

**Service Definition（`dsh-components`，`ctx.components`）。** `ComponentDescriptor` 携带带品牌类型的 `ComponentId`、取自可合并扩展的 `ComponentKindMap` 的 `kind`（每个生产方包通过声明合并声明自己的类别，因此注册表本身不附带任何类别）、`name`、`description`、所属包、`provenance`（`curated` 或 `synthesized`）、可选的 `lineage` 父级 id、可选的 `members`（子组件 id，使组合本身成为组件）、可选的 `invoke` 指针（`{ tool, arguments }`：模型以固定参数调用以触达该组件的现有工具），以及类别专属的 `detail`。`register()` 返回其释放器并对重复 id 大声拒绝；`list(kind?)` 与 `get(id)` 负责读取。注册是组合期的效果，不是持久的会话事实。

**生产方：每个 seam 一个适配器包。** 每个适配器把其 seam 的实时注册表镜像为组件，并通过该 seam 自己的事件保持同步。`dsh-components-subagents` 把 [`ctx.subagents`](../../../../packages/subagent/subagent/README.md) 中的每个提供方注册为 `agent-provider` 组件，并跟随 `subagent/provider-added` 与 `subagent/provider-removed`。该组件不携带 `invoke` 指针：`subagent` 工具按提供方各自挂载在可配置的名称下且不接受 `provider` 参数，而 subagent seam 不暴露哪个工具实例绑定到哪个提供方；待工具适配器连同提供方绑定一起镜像 tool-subagent 实例后，路由才会出现。后续适配器对工具、skill、工作流、MCP 服务器、LLM 提供方、上下文提供方与 preset 做同样的事。一个 preset 组合注册为 `composition` 组件，其 `members` 是它挂载的组件；这正是舰队所需的递归：部门、agent preset，然后是工具、skill 与上下文。

**消费方。** `/components`（`dsh-command-components`）面向人按类别渲染库存，附带来源与谱系。后续的 `component_invoke` 工具分派组件的 `invoke` 指针，使模型在原生工具之外通过一次调用触达任何类别，Code Mode 则把它收敛为一个绑定。验证、改进与监督 seam 以组件 id 作为证书、分数与审计的主体：证书记录哪些组件参与其中，因此分数按组件折叠，正如按 agent 折叠一样。

**晋升。** 合成组件以 `provenance: 'synthesized'` 注册，`lineage` 指向它派生自的组件——无论是 `tool-cordis` 动态包还是 agent 撰写的 skill——并在自身会话中立即可用。它只能通过改进 seam 的晋升进入共享目录：它参与的会话产生了验证证书、环境注册表的评估通过、用户批准；晋升记录保留谱系，使后续合成可以从任一祖先分支，而不只是从当前最优者分支。本 seam 中没有任何东西会自动晋升。

## 舰队规模下的递归

一个组织是部门的组合；一个部门是 `composition` 组件，其成员是 agent preset 组件；一个 agent preset 是 `composition`，其成员是工具、skill、上下文与模型提供方组件；每个成员都是插件。同一份描述符描述每个层级，对组合执行 `invoke` 即从该 preset 启动一个 subagent。排行榜在每个层级按组件 id 折叠证书，因此部门、agent、skill 与工具按同一规则评分，评审团也以同一套 id 指名其对象。

## 备选方案

**让 `ctx.tools` 成为通用注册表。** 工具定义是带作用域可见层的模型侧 schema 表面；组件包含不可调用的类别，并需要谱系与来源。工具是组件的一种类别，保持原位。

**把 MCP 当作通用总线。** MCP 是位于 harness 权限模型之外的进程与协议边界；经它触达的工具若不重新包装，就会失去进程内审批、沙箱策略与「请求已记录」不变量。MCP 服务器是一种类别，不是总线。

**在每个 seam 内部各自放置谱系与来源字段。** 同一组字段的五份副本会漂移，且评分与评审团没有跨类别身份可用。

**动态包一通过自身测试就自动晋升。** Darwin Gödel Machine 的事件与 Anthropic 的作弊分类表明自撰写的测试可被规避；晋升需要证书、留出评估与审批。

**用知识图谱数据库充当注册表。** 注册表是从实时 seam 镜像而来的组合期真相；持久事实（晋升记录、证书）依托会话事件与存储领域，而不是一个新数据库。

**由每个生产方包手工注册组件。** 通过适配器镜像 seam 自身的注册表能与该 seam 的事件保持同步，且不给先于注册表存在的 seam 增加任何义务。

## 验收标准

- `dsh-components` 交付 Service Definition 与进程内注册表；一个无密钥测试证明重复 id 被拒绝，且释放一次注册会移除该组件。
- `dsh-components-subagents` 镜像挂载时存在的每个提供方以及之后的每一次 `subagent/provider-added` 与 `subagent/provider-removed` 变化，释放该适配器会移除其组件。
- `/components` 通过命令注册表渲染分组库存，且不写入任何会话事件。
- 组合组件列出其成员，且在 Loader 启动的组合中对其执行 `component_invoke` 会从该 preset 启动一个 subagent。
- 一个既无证书也无审批的合成组件，会被一个演练晋升路径的测试拒绝进入共享目录。
- 每个阶段都按[测试政策](../../../../docs/testing.md)通过可运行示例交付无密钥快照场景。

## 落地阶段

1. 注册表 seam、subagent 提供方适配器与 `/components` 命令。
2. 面向工具、skill、工作流、MCP 服务器、LLM 提供方、上下文提供方与 preset 的适配器；`composition` 类别；`component_invoke` 工具。
3. 晋升：来自 `tool-cordis` 与 skill 撰写的合成来源、作为组件证据的证书、改进 seam 的评估、审批，以及谱系档案。

## 风险

镜像漂移：漏掉一次 seam 事件的适配器会展示一个已不存在的组件。适配器绑定 seam 自身的事件并通过效果注册，释放测试覆盖两个方向的变化。

两个可调用表面：`component_invoke` 与原生工具并存可能分散模型注意力。原生工具保持主要地位；统一调用服务于没有自身工具的类别，正如 Code Mode 已经把多个 schema 收敛为一个绑定。

身份稳定性：id 由类别与 seam 自身的稳定名称派生，从不来自挂载顺序，因此重新挂载会产生同一个 id。

晋升规避：重复提交相同内容、模仿格式与伪装意图同样适用于插件；晋升路径复用验证 seam 的隔离与监督 seam 的跨谱系评审。

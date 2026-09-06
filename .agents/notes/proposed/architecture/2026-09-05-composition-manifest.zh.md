# Agent Note: 内容寻址的身份与组合清单事件

Status: proposed

[English](2026-09-05-composition-manifest.md) | 中文

## Problem

harness 中的每一个身份指向的都是一个位置，而不是位置里的字节。`ComponentId`"由它的 kind 与拥有它的 seam 的稳定名称推导而来，绝不来自挂载顺序"（[`dsh-components`](../../../../packages/components/components/README.md)），skill（技能）由它的 kebab-case 名称寻址，prompt 段落与工具由它们的注册名寻址，preset 由它的目录名寻址，插件由它的包名寻址。就地修改一个 skill 的正文不会改变上述任何一个地址，于是排行榜无法把修改前的代际与修改后的代际分开，回滚没有更早的地址可以返回，去污染检查也没有可以作为键的东西——这正是[四目标工作流 note](2026-09-05-four-goal-workflows.md) 在它被否决的"单一可变知识存储"备选方案中记录的失败，也是它的原则 P5 明令禁止的。

没有任何持久记录说明一个会话实际让哪些组件在场。`request/header` 事件承载每个 epoch 组装出的系统提示词文本与工具 schema，这足以重放一次请求，却不足以指名是什么产生了它：它不承载组件身份、provenance、lineage 或注册表层级；通过 `skill` 工具加载的 skill 正文以工具结果进入转录，永远不会进入 header；而通过 [`tool-cordis`](../../../../packages/extensions/tool-cordis/README.md) 挂载、且没有注册任何工具的动态包在其中完全不可见。组件注册表本身是随进程消亡的组合期状态，[组件注册表 seam note](2026-09-01-component-registry-seam.md) 已经明确这样陈述。

有四个消费方卡在这个缺口上。[`dsh-scorekeeper`](../../../../packages/improvement/scorekeeper/README.md) 没有发布 `composition_hash`、`component_ids` 或 `skills_used` 字段，因为没有事件提供它们。W4 阶段 1 的不变式——skill 结果的摘要若不在清单中即失败——没有可供核对的清单。轨迹导出器可以扣下一个 held-out 环境，却无法把一个 curated 组合与一个 agent（智能体）在会话中途变异过的组合区分开，于是一个合成的 skill 正文可以不加声明地进入训练集。而 W4 阶段 9 的知识 ledger 没有可供其条目对照的地址，而正是这种对照让"一条在清单中没有对应出现的 ledger 条目从不算作曾经在场"成为可执行的规则而非愿望。

## Proposal

**一个摘要函数，一种地址形式。** [`dsh-components`](../../../../packages/components/components/README.md) 新增 `ComponentDigest`（来自 `dsh-brand` 的 `Branded<'ComponentDigest'>`）与两个纯函数：`componentDigest(kind, canonical)` 返回 `` `${kind}\n${JSON.stringify(canonical)}` `` 的小写 SHA-256 十六进制值，`componentAddress(id, digest)` 返回 `` `${id}@${digest}` ``。kind 被包含在被哈希的字节内，因此两个规范值恰好相同的 kind 绝不会共享同一个地址。摘要在任何被存储或被比较的位置都是完整的 64 个十六进制字符，与 [`dsh-environments`](../../../../packages/improvement/environments/README.md) 中的 `environmentContentHashes` 一致；为卡片或表格截短它是一种呈现选择，永远不会进入日志或 ledger。`ComponentDescriptor` 新增必填的 `digest: ComponentDigest` 与必填的 `digestBasis: 'content' | 'registration'`。落地后的实现把 `canonical` 定型为 `ComponentCanonical`——一个 JSON 值——因此生产者无法把 `JSON.stringify` 会丢弃的值交给哈希；`componentAddress` 返回普通字符串：地址是被铸造与被比较的，从不跨越需要品牌类型守卫的边界。

**每个生产者拥有自己的规范值。** 注册表不发布任何按 kind 的规范化逻辑，理由与它不发布任何 kind 相同：每个生产者通过声明合并声明自己的 `ComponentKindMap` 成员，并导出把它规范化的纯函数，于是后来新增的 kind 无需改动注册表或清单写入方。下面的表格固定了本 note 引入的每个 kind 的规范值。落地后导出的函数是该 kind 的摘要而非其裸规范值——`agentProviderDigest(provider)`，以及 skill 行已经点名的 `skillDigest(definition)`——因此需要重算地址的消费者调用生产者，而不是照着表格重建规范值。

**注册表变为分层。** `ComponentRegistry` 曾是一个扁平 `Map`，因此无法回答"这个 agent 看到了什么"。它改用 `dsh-scope` 的 `ScopedLayers`，与 [`ctx.tools`](../../../../packages/core/tools/README.md) 和 [`ctx.skills`](../../../../packages/skill/skill/README.md) 今天的做法完全一致：`register()` 归档到调用上下文的作用域中，`list({ kind, scope })` 把全局层与查看作用域的链合并，最近的层的条目赢得同名 id。经由某个作用域读回的描述符携带 `layer: 'global' | 'agent'`——胜出的注册位于全局层时为 `global`，位于该 agent 作用域链的某一层时为 `agent`。更深的链仍读作 `agent`，因为子 agent 在自己的会话里写自己的清单。id 按层唯一，因此同一层内的重复 id 仍抛出 `COMPONENT_DUPLICATE_ID`，而不同层中的同一 id 构成遮蔽。

派生出的 `layer` 承载在 `ComponentView` 上——一个扩展 `ComponentDescriptor` 的独立读取类型——而不是描述符上的可选字段：生产者注册描述符，无法自行断言所在层，而读取方总能拿到一个。`get(id, { scope })` 接受与 `list({ kind, scope })` 相同的查看作用域，即 `dsh-skill` 已经用于其两个读取的 `SkillViewOptions` 形态。注册表不发布任何变更通知——理由见下面被否决的 `components/change` 备选——因此 `ScopedLayers` 的变更回调是一个有说明的空操作。

**清单写入方只读一个注册表。** 位于 `packages/components/components-manifest/` 的 `@deepseek-ai/dsh-components-manifest` 注入 `agents` 与 `components`，仅此而已。在 `agent/pre-step` 上它先调用 `next()`，为调用中的 agent 重算 `ctx.components.list({ scope: agent })`，把得到的 `compositionSha256` 与该会话日志中最后一条 `composition/manifest` 事件比较，仅在两者不同时通过 `agent.session.append()` 追加一条新事件——正是 [`dsh-budget-policy`](../../../../packages/guard/budget-policy/README.md) 已经在步骤开启前用于折叠与追加的形状。选择重算而非增量跟踪，正是让它在 HMR 释放、创建后才挂载的 preset 以及作用域遮蔽这三种顺序下都保持正确的原因：写入方不持有任何这三者可能失效的订阅状态。

**其他每个 seam 都通过适配器抵达清单。**[组件注册表 note](2026-09-01-component-registry-seam.md) 确立的"每个 seam 一个适配器包"规则，正是让写入方不必读取自己不拥有的注册表的原因，而每个适配器跟随它自己 seam 的变更通知：`dsh-components-tools` 跟随 `tools/change`，`dsh-components-prompt` 跟随 `system-prompt/change`，`dsh-components-skills` 跟随 `skill` 工具的 `tools/result`，`dsh-components-presets` 跟随 `agent-preset/selected` Cordis 事件，已发布的 `dsh-components-subagents` 则已经跟随 `subagent/provider-added` 与 `subagent/provider-removed`。有一个 seam 今天什么都不发出：`tool-cordis` 背后的动态 Cordis 运行器在一个包被定义、运行、停止或移除时不报告任何变更，因此 `dsh-cordis-host-runner` 新增一个不过滤的 `cordis/dynamic-changed(agent, pluginId)` Cordis 事件——`@mode emit`，不按作用域过滤，因此不适用作用域扫描元数据——并由 `dsh-components-packages` 跟随它。

**skill 在其正文被加载后才算在场，而不是被列出后。** `ctx.skills.list()` 返回不含正文的摘要，因此把每个可发现的 skill 都注册进来，将需要每步为每个目录条目加载一次正文，而且寻址的仍是摘要而非知识。因此 `dsh-skill` 导出针对已加载定义的 `skillDigest(definition)`，`skill` 工具的规范输出值新增 `digest` 字段（不出现在 `renderSkillContent` 中，因此面向模型的文本不变，并在 `tool/result` 中持久化），`SkillInvocationSource` 也新增同一字段，使用户显式的 `/name` 注入同样有记录。`dsh-components-skills` 通过 `exec.agent.ctx` 从这两种持久记录中的任一种注册一个 `skill` 组件，绝不重新解析已渲染的 `<skill_content>` 块。可达但从未加载的 skill 不进入清单；它们所来自的目录已经作为 `skill-catalog` 消息来源持久化。

**第 2、3 片的落地差异。** 五处偏离，每一处都是代码所允许的最小改动。`tool` 的规范值不含输出 schema：`ToolSchema`——`ctx.tools.schemas(scope)` 投影出的、也是模型收到的内容——是名称、描述与参数 schema，而规范输出声明从不对模型可见，因此要把它纳入寻址就需要注册表在 wire schema 之外一并投影它。`prompt-section` 适配器需要一次提示注册表此前未暴露的注册读取，因此 `SystemPrompt` 新增 `sections(scope?)`，按装配顺序返回合并后的注册项，每个 `text` 原样保留。`preset` 适配器需要一次挂载的 trust、组合文件路径与已解析行，而 `PresetMount` 都不携带，因此 `dsh-agent-presets` 在其上记录 `trust`、`path` 与 `tree`；`config` 无法通过无损 JSON 边界的行贡献 `null`，与缺失配置完全相同。该适配器还在 `agent-preset/selected` 之外于 `agent/created` 上进行调和，因为以部署默认值起步的会话不会提交选择事件，而名册也不发布挂载通知——`livePresetMounts()` 通过剪除来报告被拆除的挂载，因此依据该读取进行调和本身就是移除。此外，`user` trust 的预设以 `provenance: 'synthesized'` 记录：名册记录的是预设被发现时所在的根，从不记录其作者，而本地编写的组合与 shell 访问权同级。

**清单 payload 的落地比本 note 所述更窄。** 它只携带 `version`、`components` 与 `compositionSha256`。`reason` 所命名的取值只有第 4、5 片才能产生，`dynamicPackagesMounted` 与 `synthesized` 汇总的是第 5 片引入的类别，而 `presetId` 会让写入方读取它并不拥有的注册表——写入方只注入 `agents` 与 `components`，需要在用预设的消费者读取 `components` 中的 `preset` 条目即可。每个字段都随产生其输入的那一片一同到来。

## What each kind hashes

| Kind | 规范值 | 依据 | 生产者 |
|---|---|---|---|
| `skill` | 来自已加载 `SkillDefinition` 的 `[name, description, whenToUse ?? null, invocation.modelInvocable, invocation.userInvocable, metadata ?? null, content]` | content | `dsh-components-skills`，经由 `dsh-skill` 的 `skillDigest()` |
| `prompt-section` | `PromptSection.text` 为字符串时是 `[name, order, complete === true, text]`；它是按每次组装求值的提供者时是 `[name, order, complete === true, null]` | content，否则 registration | `dsh-components-prompt` |
| `tool` | `ctx.tools.schemas(agent)` 投影出的面向模型 `ToolSchema`：名称、描述、参数 schema、输出 schema，按注册表自身的字段顺序 | content | `dsh-components-tools` |
| `preset` | `[id, trust, rows]`，其中 `rows` 是 `include` 解析后该 preset 的组合，每行为 `[id, name, config, disabled]`，且每个解析为路径的 `name` 都改写为相对 preset 目录的路径 | content | `dsh-components-presets` |
| `plugin` | `[packageName, version, patchLayerSha256]`，version 来自解析出的包清单，`patchLayerSha256` 是在场 bundle 的 `cordis.patch.yml` 有序行的 SHA-256 | content | `dsh-components-packages`，经由 `ctx.loader.entries()` |
| `dynamic-package` | 来自 `ctx.dynamicCordisRunner.inspectPlugin(agent, pluginId)` 的 `[pluginId, packageId, hostSource, clientSource]` | content | `dsh-components-packages` |
| `agent-provider` | `[provider]` | registration | `dsh-components-subagents` |

摘要从不覆盖查看作用域、工作目录、挂钟时间、绝对路径（`SkillDefinition.path`、`SkillResourceBase` 的目录、`AgentPreset.path`）、发现用的 `source` 或 `rank`、提供者名称，或任何注册表按每次组装计算出的值。因此，在不同根目录下发现同一个 skill 的两台主机，以及经由不同提供者重新注册的同一份正文，寻址结果相同；而 skill 正文、工具参数描述、静态 prompt 段落或 preset 行中任何一个字节的改变都会移动摘要。`registration` 依据的摘要寻址的是注册本身而非模型看到的字节，这对于文本是组装的函数的段落而言是诚实的陈述；已渲染的字节仍留在它们本来所在的位置，即 `request/header`。

## The `composition/manifest` event

`dsh-components-manifest` 向 `@deepseek-ai/dsh-session/types` 中的 `SessionEventMap` 声明合并一个成员。它是**纯日志**的，且不携带 `@mode` 标签：会话日志事件没有派发模式，它搭乘单一的 `session/event` emit，而 `gen-persistence-catalog` 会直接拒绝该标签——仓库的 `@mode` 与载荷 `@param` 规则管辖的是本 note 新增的那个 Cordis 总线事件，而不是这一个。它是**读取时必需**的，不带信封的 `ignorable: true` 标记，因为下文每个消费方都把一次拒绝挂在它上面：否则一个无法解释该类型的构建，会为一个它无法证明未被隔离的会话折叠出记分板行并写出导出行（[版本机制](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md)）。它的载荷字段各自携带自己的 JSDoc，以便[生成的目录](../../../../docs/persistence-catalog.md)记录它们：

- `kind: 'composition/manifest'` 与 `version: 1`，即环境 stamp 同样携带的自声明载荷版本。
- `reason`：这条清单为何被写出——`'session-start'`、`'preset-mounted'`、`'skill-loaded'`、`'tools-changed'`、`'prompt-changed'` 或 `'package-mounted'`，由自上一条清单以来哪些 kind 发生变化决定。
- `presetId`：该 agent 运行所依据的 preset，经 `resolveSessionPreset()` 解析；部署未组合任何 preset 时缺省。
- `components`：在场的每个组件一条条目，按 `id` 排序，每条为 `{ id, digest, kind, provenance, lineage?, layer, digestBasis }`。
- `compositionSha256`：对有序 `id@digest` 地址以换行连接后的 SHA-256——去重键，也是记分板行想要的 `composition_hash`。
- `dynamicPackagesMounted`：是否存在 kind 为 `dynamic-package` 的条目。
- `synthesized`：`provenance` 为 `synthesized` 的每条条目的 id，顺序相同。

四目标 note 的草稿列出了一个 `seq` 字段；信封已经携带 `seq`，因此载荷不重复它。第一条清单在会话的第一条 `request/header` 之前追加，因为 `agent/pre-step` 在步骤组装其请求之前运行，而 preset 到那时已经稳定——创建之后选定的 preset 会在会话仍为空白时提交 `agent-preset/selected`。此后每一次在场集合的变化都会在下一步产生下一条不同的清单，而那一步正是该变化能够抵达的第一个模型请求。

## Quarantine

当一个会话最新的清单报告 `dynamicPackagesMounted` 或非空的 `synthesized` 时，它被隔离；当它的日志根本没有任何清单时同样被隔离：一个无法证明什么在场的会话，与一个挂载了 agent 自己编写的代码的会话同样不可用。[`dsh-scorekeeper`](../../../../packages/improvement/scorekeeper/README.md) 的 `SessionFacts.identity` 新增一个从最新清单折叠出的 `composition` 分组——`compositionSha256`、条目数量、`presetId`、`dynamicPackagesMounted` 与 `synthesized`——外加 `skillsUsed`，即该会话任何一条清单指名过的每个 `skill` 条目的 `id@digest` 地址。它的 `./invariant` 伴生插件在今天检查的三条关系之外新增一条：对于携带摘要的每一条 `skill` 工具 `tool/result`，在该事件 `seq` 之前或同处必须有某条 `composition/manifest` 指名一个带该摘要的 `skill` 组件，而摘要不出现在任何清单中的结果会被报告为记录与自身日志不一致。[`dsh-trajectories`](../../../../packages/improvement/trajectories/README.md) 在 `TrajectoryExportRequest` 上新增 `includeQuarantined?: boolean`，并在 `TrajectoryExportReport` 上新增 `quarantined` 计数，与 `includeHeldOut` 和 `heldOut` 对称：缺省时导出拒绝每一个被隔离的会话，并把它计入该计数而不是无声丢弃。互补的那种隔离——Harness Engineer 的提案触及评估方拥有的路径——属于 W1 阶段 7，仍留在那里。

## The knowledge ledger

位于 `packages/improvement/archive/` 的 `@deepseek-ai/dsh-archive`（`ctx.archive`）在 [`ctx.storage.domain`](../../../../packages/storage/storage-domain/README.md) 之上持有跨会话记录，通过一份记录 schema 为 zod 的 `defineDomain` 规格，路由到部署所配置的任一后端。两张表：`variants`，以 `HarnessVariant` id（基线提交加补丁集哈希）为键，字段由四目标 note 固定——`parent`、`operator`、`patch`、`scores`、`evaluations[]`、`children[]`、`status`、`proposer`；以及 `generations`，以 `id@digest` 为键，带 `componentId`、`digest`、`kind`、`provenance`、`lineage`（父代的地址，根代缺省）、`evidenceSessions[]`、`results` 与 `status`。一次变异铸造一条新行而不是改写既有行，因此一个代际的字节与它的地址永不背离。

`status` 为 `alive`、`dominated`、`promoted` 或 `deprecated`。`alive` 表示已评估或新铸造且仍可被父代采样；`dominated` 表示在每个被测量的单元格上都输给了同一 lineage 的另一个代际，仍可被采样与审计，永不删除，这正是四目标 note 被否决的"只保留最优"备选方案所要保住的档案语义；`promoted` 携带把它移入 curated 源码的那条 `PromotionDecision`；`deprecated` 是部门记分板在成对的"在场对不在场"增量于所配置的运行次数内始终小于等于零之后写下的状态。lineage 在两端都被存储——子代上的 `lineage` 供向上追溯的审计者使用，父代上的 `children[]` 供采样器的 `1/(1+children)` 权重使用——而状态变化追加一次修订而不是移除一行。

ledger 的 `./invariant` 伴生插件拥有清单对 ledger 的关系，这是[包不变式规则](../../../../packages/AGENTS.md)所要求的、针对可变数据与权威事件流的断言：对于每一条代际行，`evidenceSessions` 中指名的每个会话都必须携带一条 `composition/manifest`，其 `components` 中含有那个确切的 `id@digest`。一条指名了没有对应出现的证据会话的行会被报告，且从不算作曾经在场，于是一次晋升不可能建立在该组件实际并未被组合进去的会话之上。

## Alternatives considered

**从 `request/header` 推导清单。** header 已经记录每个 epoch 组装出的系统提示词与每个工具 schema，因此在它之上折叠不需要新事件。这被否决，因为 header 承载的是已渲染的文本而非身份：provenance、lineage 与层级都缺席，已加载的 skill 正文永不进入其中，而一个不注册任何工具的动态包不会改变它——恰恰是隔离必须抓住的那三种情形。

**让注册表只停留在组合期，不新增会话事件。** `ctx.components` 已经是那份清单，因此消费方可以在运行时读取它。这被否决，因为这里的每个消费方都在事后读取已持久化日志——记分板折叠它们，导出器从它们写出，ledger 不变式对照它们检查——而组合期真相随进程消亡。

**每会话一条清单，在创建时写出。** 单条记录更小、也更容易折叠。这被否决，因为一次 skill 加载、一次 preset 切换与一次动态挂载都会在会话中途改变在场集合，而创建时的记录恰恰会为隔离本该标记的那些会话报告一个干净的组合。

**哈希每个组件已渲染的贡献。** 哈希模型实际收到的内容，会把摘要与转录中的字节绑定在一起。这被否决，因为渲染依赖工作目录、挂钟时间与查看作用域，于是两台主机上两个完全相同的组合会寻址到不同结果，去污染将以噪声为键；`request/header` 已经拥有已渲染的字节，而清单拥有身份。

**把按 kind 的规范化放进清单写入方。** 写入方内部的一个 kind 分支可以省去每个 seam 一个适配器。这被否决，因为写入方将不得不知道每一个 kind，而这正是 `ComponentKindMap` 的声明合并所消除的耦合，并且下游新增的 kind 将根本无法被摘要。

**用每个组件单调递增的版本计数器代替内容地址。** `skill@3` 这样的标签更短、也更便于人读。这被否决，理由与四目标 note 的"单一可变知识存储"备选方案相同：计数器是被撰写而非被推导的，于是精炼同一份正文的两台主机对数字并不一致，从祖先恢复的正文会拿到一个新数字而不是它原有的地址，而且没有消费方能够拿标签去核对字节。

**新增 `components/change` 事件并配一个增量写入方。** 仿照 `tools/change` 可以让写入方在步骤之间维护清单，而不是重算它。这被否决，因为重算只是每步一次注册表读取与一次哈希，且不可能出错，而增量写入方必须在 HMR 释放、preset 重新挂载与作用域遮蔽下都保持正确；本 note 中没有任何消费方需要变更通知，因此在出现一个之前不新增该事件。

**把 ledger 做成会话事件而非存储。** 把代际记录进日志可以把一切保留在同一个平面上。这被否决，因为 ledger 跨越会话并且比其中任何一个都活得更久，也因为清单对 ledger 的不变式需要两个平面才成其为真正的检查：一条本身就是会话事件的条目，无法被它所引用的会话事件所反驳。

## Acceptance criteria

- 位于 `examples/headless-agent/tests/fixtures/composition-manifest/` 的一个由 Loader 启动的组合，在会话的第一条 `request/header` 之前追加一条 `composition/manifest`；该事件指名 preset id，为在场的每个组件携带一条带 `digest`、`provenance`、`layer` 与 `digestBasis` 的条目，且其 `compositionSha256` 等于从已持久化日志中有序 `id@digest` 地址重算出的值。
- 在同一 fixture 中，agent 调用一次 `skill` 工具；随后出现第二条清单，`reason: 'skill-loaded'`，新增一条 `skill` 条目，其摘要等于对该正文的 `skillDigest()`，且 `compositionSha256` 不同。一个什么都没改变的步骤不追加第三条事件。
- 该 fixture 在不同临时工作区根目录与不同 `DSH_HOME` 值下的两次运行产生逐字节相同的 `compositionSha256`，证明绝对路径、发现根目录与时间戳都在每个摘要之外。
- `examples/headless-agent/tests/fixtures/composition-manifest-mutation/` 以同一组合运行两次，两次之间改变 skill 正文的一个字节；恰好有一条条目的摘要不同，`compositionSha256` 不同，其余每条条目都未改变。
- `examples/headless-agent/tests/fixtures/composition-manifest-quarantine/` 组合 `tool-cordis`，定义并运行一个动态包，并证明下一条清单报告 `dynamicPackagesMounted: true` 且该包的 id 出现在 `synthesized` 中；随后轨迹导出扣下该会话并把它计为 `quarantined`，而同一次导出带上 `includeQuarantined` 时会写出它。
- 一个针对合成日志的无密钥单元测试证明记分板不变式会报告摘要不出现在任何在先清单中的 `skill` 工具结果，并在某条清单指名它之后接受同一结果；第二个测试证明一个完全没有清单的会话折叠为被隔离的记录而不是干净的记录。
- `packages/improvement/archive/tests/` 中的一个无密钥单元测试证明 ledger 不变式会报告证据会话中没有其 `id@digest` 清单出现的代际行，并在这样的出现存在之后接受该行。
- `examples/headless-agent` 所拥有的持久化日志快照套件记录组合了清单写入方的那个场景的清单事件；该事件是纯日志的，不改变任何面向模型的文本，因此所需的覆盖是持久化日志而不是重新录制转录（[测试策略](../../../../docs/testing.md)）。

## Rollout

1. **已落地。** `dsh-components`：`ComponentDigest` 品牌类型、`componentDigest()` 与 `componentAddress()`、`ComponentDescriptor` 上必填的 `digest` 与 `digestBasis`，以及带 `list({ kind, scope })` 与派生 `layer` 的 `ScopedLayers` 分层。更新 `dsh-components-subagents`（`agent-provider` 的规范值 `[provider]`，基准为 `registration`）与 `dsh-command-components`（发起调用的 agent 成为查看作用域；其渲染行仍不给出摘要或层，因为没有任何可运行示例组合了 `/components`，而渲染变更欠一份无密钥快照）、[`docs/subsystems/components.md`](../../../../docs/subsystems/components.md) 以及三个包 README。
2. **已落地。** 组合期适配器及其规范值：`packages/components/` 下的 `dsh-components-tools`、`dsh-components-prompt` 与 `dsh-components-presets`，各自跟随它所属 seam 已有的变更事件。新增 `SystemPrompt.sections(scope?)` 以及 `PresetMount` 上的 `trust`、`path` 与 `tree` 字段。
3. **已落地。** `dsh-components-manifest`：`composition/manifest` 声明、带 `compositionSha256` 去重的 `agent/pre-step` 写入方、重新生成的 `known-event-types.ts` 与持久化目录、覆盖相邻清单及其地址的不变式伴随插件，以及 `composition-manifest` fixture。
4. skill 代际：`dsh-skill` 中的 `skillDigest()`、`skill` 工具规范值与 `SkillInvocationSource` 上的 `digest` 字段、`dsh-components-skills`，以及变异 fixture。
5. 动态包：`dsh-cordis-host-runner` 上的 `cordis/dynamic-changed`、经由 `ctx.loader.entries()` 与动态运行器的 `dsh-components-packages`，以及隔离 fixture。
6. 隔离消费方：`SessionFacts` 上的 `composition` 分组与 `skillsUsed`、记分板不变式关系，以及 `dsh-trajectories` 中的 `includeQuarantined` 与 `quarantined` 计数。
7. `dsh-archive`：领域规格、`variants` 与 `generations` 两张表、四种状态及其转换、两端存储的 lineage 边，以及清单对 ledger 的不变式。

## Risks

`registration` 依据的摘要无法察觉一个按组装求值的 prompt 段落产出内容的变化，因此两次动态段落不同的运行共享同一个地址。`request/header` 承载那些字节，需要它们的比较必须去读它；仅以清单为键的排行榜会把这两者混在一起。

`plugin` 摘要以包名与版本为键，而这里每个 workspace 包的版本都是 `0.0.1`，因此一次源码修改不会移动它。`HarnessVariant` 的基线提交加补丁集哈希才是寻址 harness 源码的东西，仅以插件摘要为键的比较会把同一个包的多个代际混在一起。

清单指名的是组件，而不是它们的传递性影响。一个远端工具描述在未重新注册的情况下发生变化的 MCP 服务器，或一个正文引用的文件发生了变化的 skill，都保持原有摘要；只有规范值覆盖到的东西才被寻址。

读取时必需意味着一个不认识 `composition/manifest` 的构建会拒绝含有它的日志。这是有意的取舍——另一种可能是一个构建无声地把被隔离的会话当作干净会话——而它之所以负担得起，只因为根 [AGENTS.md](../../../../AGENTS.md) 中的预发布立场。

一个每步都变动可见工具集的组合会每步写出一条清单。按 `compositionSha256` 去重使稳定组合恰好只有一条事件，而变动中的组合确实是在为模型可调用范围的真实变化付费，但一个按步开关的作用域限制会用没有消费方加以区分的事件把日志撑大。

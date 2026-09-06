# @deepseek-ai/dsh-components-skills

[English](README.md) | 中文

把本组合已加载的每个 skill 正文镜像为组件注册表里的 `skill` 组件，并在 skill 注册表报告目录变更时为这些 skill 重新寻址。

## 配置

```yaml
- id: skills
  name: '@deepseek-ai/dsh-skill'
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-skills
  name: '@deepseek-ai/dsh-components-skills'
```

该适配器不接受配置，并要求 `ctx.agents`、`ctx.components`、`ctx.skills` 与 `ctx.tools`。

## 约定

一个 skill 在其正文被加载后才算在用，而不是被列出后：`ctx.skills.list()` 返回不含正文的摘要，因此目录条目指的是会话尚未收到的知识。适配器因此从每次加载的记录中取出已加载 skill 的名称——模型驱动加载来自 `skill` 工具已结算的 `tools/result`，用户显式 `/name` 加载来自 `skill-invocation` 消息来源——再通过 `ctx.skills` 重新读取该正文，并用 `skillDigest()` 为其寻址。它从不重新解析已渲染的 `<skill_content>` 块，也从不从记录上读取地址，因此无需让任何摘要出现在模型可见的工具结果上。未指明 skill 的记录，以及注册表无法解析的名称，都不会注册任何内容。

每个组件的 id 为 `skill:<name>`，类别为 `skill`，`provenance: 'curated'`，`digestBasis: 'content'`，`invoke: { tool: 'skill', arguments: { name } }`，`detail: { skillName }`。除摘要外的每个字段都是名称的函数，因此两条加载路径为同一代产生完全相同的描述符。`skillComponentId(name)` 为消费方构造该 id。

`skills/change` 是不带差异的无过滤失效通知，因此每次通知都会重放产生每个在用代的那次查找：就地编辑的正文以其新地址在同一 id 下重新注册；注册表不再解析的 skill 离开库存；读取失败时保留其现有代并通过上下文 logger 报告。每次读取都是异步的，因此在适配器 fiber 释放之后、或在更晚的加载或重放已取代它之后才结算的读取不改变任何内容。释放适配器 fiber 会移除它注册的全部组件。

`skill` 的规范值属于 [`dsh-skill`](../../skill/skill/README.md)，它导出作用于已加载定义的 `skillDigest(definition)`；本适配器从自己的读取计算该地址，而不信任别处交来的地址。

## 模型体验

无，因为适配器只注册组件元数据；被加载的 skill 正文仍像以前一样通过 `skill` 工具结果与用户显式注入抵达模型。

#### KV Cache 影响

无；适配器既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **可达的 skill 不等于已寻址的 skill** — 目录已公布但没有任何步骤加载过的 skill 不在库存中，因此想知道一个会话*可能*用过什么的消费方改读 `skill-catalog` 消息来源。
- **每个作用域一次读取** — 适配器归入其挂载上下文所在的层，因此挂载在宿主上的适配器把每个 agent 的加载都记入全局层；需要按 agent 划分 skill 库存的部署要通过各 agent 的组合分别挂载它。
- **寻址滞后于触发它的事件** — 每次注册都是一次异步正文读取，因此与一次加载或 `skills/change` 同一 tick 写出的清单仍可能遗漏该代或指向上一代；新地址由下一步的清单携带。
- **每次加载都是人工筛选来源** — agent 写入发现根目录的 skill 正文，其加载方式与人工筛选的完全相同，而 skill seam 不记录作者；合成正文的来源需要由写入路径自行声明。

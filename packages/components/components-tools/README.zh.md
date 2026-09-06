# @deepseek-ai/dsh-components-tools

[English](README.md) | 中文

把某个作用域可见的工具镜像为组件注册表里的 `tool` 组件，并跟随注册表自身的 `tools/change` 通知，使库存跟踪模型实际可调用的内容。

## 配置

```yaml
- id: tools
  name: '@deepseek-ai/dsh-tools'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-tools
  name: '@deepseek-ai/dsh-components-tools'
```

该适配器不接受配置，并要求这两个服务同时存在。

## 约定

适配器按自身上下文的作用域读取 `ctx.tools.schemas(scope)`：挂载在宿主行上时镜像全局层，通过 agent 预设的上下文挂载时把该 agent 的可见集合镜像进那个 agent 的层。每个组件的 id 为 `tool:<name>`，类别为 `tool`，`provenance: 'curated'`，`invoke: { tool: <name> }`，`detail: { toolName }`；`toolComponentId(name)` 为消费方构造该 id。

`tools/change` 不携带差异，因此每次通知都会重新计算可见集合并进行调和：schema 未变的工具保留其注册，已变更的在同一 id 下被替换，离开该作用域的工具——被注销、被限制屏蔽，或被某种呈现模式折叠——会被释放。释放适配器 fiber 会移除它注册的全部组件。

本适配器在自己的 `ComponentKindMap` 声明旁拥有 `tool` 的规范值：完全按 `ctx.tools.schemas()` 投影的模型可见 schema——名称、描述与参数 schema，采用注册表自身的字段顺序——由 `toolDigest(schema)` 寻址，`digestBasis: 'content'`。参数描述改动一个字节即会移动摘要；注册表按次组装计算的任何值都不会进入摘要。

## 模型体验

无，因为适配器只注册组件元数据；每个被镜像工具的一切模型可见影响由该工具自身的注册负责。

#### KV Cache 影响

无；适配器既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **地址中不含输出 schema** — `ToolSchema` 是模型实际收到的内容，只携带名称、描述与参数，因此规范输出声明改变但模型可见内容未变的工具会保持其摘要不变。若要把输出纳入地址，需要注册表在 wire schema 之外一并投影它。
- **每个作用域一次读取** — 适配器镜像的是它被挂载的那个上下文的作用域；既想要全局集合又想要某个 agent 自身集合的部署要挂载适配器两次，每个上下文一次，两处注册按层相互遮蔽。
- **每个工具都是人工筛选来源** — 如今工具都是已组合的插件；运行时注册的合成工具需要其生产方自行声明来源与谱系。

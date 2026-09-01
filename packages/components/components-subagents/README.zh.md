# @deepseek-ai/dsh-components-subagents

[English](README.md) | 中文

把注册在 `ctx.subagents` 中的每个 subagent 提供方镜像为组件注册表里的 `agent-provider` 组件，并跟随该 seam 自身的 `subagent/provider-added` 与 `subagent/provider-removed` 事件，使库存跟踪实时注册表。

## 配置

```yaml
- id: subagents
  name: '@deepseek-ai/dsh-subagent'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-subagents
  name: '@deepseek-ai/dsh-components-subagents'
```

该适配器不接受配置，并要求这两个服务同时存在。

## 约定

挂载时，适配器为 `ctx.subagents.list()` 中的每个名称注册一个组件；之后在 `subagent/provider-added` 时注册、在 `subagent/provider-removed` 时释放，忽略重复的添加或未知的移除。每个组件的 id 为 `agent-provider:<provider>`，类别为 `agent-provider`，`provenance: 'curated'`，其 `invoke` 指针指向带固定 `provider` 参数的 `subagent` 工具，`detail: { provider }`。释放适配器 fiber 会移除它注册的全部组件。`agentProviderComponentId(provider)` 为消费方构造该 id。

## 模型体验

无，因为适配器只注册组件元数据；被镜像提供方的一切模型可见影响由 subagent 工具负责。

#### KV Cache 影响

无；适配器既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **仅镜像名称** — 组件 detail 只携带提供方名称；提供方能力（`outputSchema`、`depthLimit`、`toolFilter`、`persona`）在有消费方需要之前不会被镜像。
- **每个提供方都是人工筛选来源** — 如今提供方都是已组合的插件；运行时注册的合成提供方需要其生产方自行声明来源与谱系。

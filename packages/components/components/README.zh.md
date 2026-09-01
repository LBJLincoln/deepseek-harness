# @deepseek-ai/dsh-components

[English](README.md) | 中文

组件注册表：组合期的库存，收录每个可寻址单元——一个插件，或插件提供的成员，例如工具、skill（技能）、subagent 提供方、工作流、MCP 服务器、上下文提供方、preset 或组合——及其类别、来源、谱系、成员关系，以及模型为触达它而调用的工具。注册表不执行任何东西。设计依据由[组件注册表 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md)承载。

## 配置

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
```

该服务不接受配置；生产方与消费方在其旁边组合。

## 服务约定

`ctx.components.register(descriptor)` 存储一份 `ComponentDescriptor`，并返回恰好移除这次注册、且不会移除同一 id 下后续注册的释放器；重复 id 会抛出代码为 `COMPONENT_DUPLICATE_ID` 的 `ComponentError`。注册是效果：生产方把释放器保留在自己的 fiber 之下，使释放时移除该组件。`get(id)` 与 `list(kind?)` 按注册顺序返回游离副本；调用方无法通过它们改动已存储的成员列表。

描述符携带带品牌类型的 `ComponentId`、取自可合并扩展的 `ComponentKindMap` 的 `kind`（每个生产方通过对 `@deepseek-ai/dsh-components/types` 做声明合并来声明自己的类别与 detail 类型；本包不声明任何类别）、`name`、`description`、所属包、`provenance`（`curated` 或 `synthesized`）、可选的 `lineage` 父级 id、供组合使用的可选 `members`、指明触达该组件的现有工具与固定参数的可选 `invoke` 指针，以及类别专属的 `detail`。

## 扩展点

生产方是镜像某个 seam 实时注册表并跟随该 seam 自身事件的适配器包；`@deepseek-ai/dsh-components-subagents` 是第一个。消费方读取库存：`@deepseek-ai/dsh-command-components` 面向人渲染它，验证、改进与监督 seam 则以组件 id 作为证书、分数与审计的主体。

## 模型体验

无，因为注册表只持有组合期库存，不注册任何面向模型的内容；任何渲染用途由消费方负责。

#### KV Cache 影响

无；注册表既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **仅限组合期** — 注册表不持有持久记录；晋升记录与按组件的证据在改进 seam 的晋升切片中依托会话事件与存储领域。
- **不做分派** — `invoke` 指针是供消费方使用的数据；跟随它的 `component_invoke` 工具是后续的消费方。
- **类别随生产方到来** — 没有组合任何适配器的程序会把 `ComponentKind` 视为 `string`，且库存为空。

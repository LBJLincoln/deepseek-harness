# @deepseek-ai/dsh-components-prompt

[English](README.md) | 中文

把某个作用域解析到的 system-prompt section 镜像为组件注册表里的 `prompt-section` 组件，并跟随提示注册表自身的 `system-prompt/change` 通知。

## 配置

```yaml
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-prompt
  name: '@deepseek-ai/dsh-components-prompt'
```

该适配器不接受配置，并要求这两个服务同时存在。

## 约定

适配器按自身上下文的作用域读取 `ctx.systemPrompt.sections(scope)`：挂载在宿主行上时镜像全局层，通过 agent 预设的上下文挂载时把该 agent 解析到的 section 镜像进那个 agent 的层。每个组件的 id 为 `prompt-section:<name>`，类别为 `prompt-section`，`provenance: 'curated'`，不带 `invoke` 指针，`detail: { order, complete, static }`；`promptSectionComponentId(name)` 为消费方构造该 id。

`system-prompt/change` 不携带差异，因此每次通知都会重新读取已解析的 section 并进行调和：未变的 section 保留其注册，已变更的在同一 id 下被替换，离开该作用域的会被释放。释放适配器 fiber 会移除它注册的全部组件。

本适配器在自己的 `ComponentKindMap` 声明旁拥有 `prompt-section` 的规范值：注册文本为字符串时是 `[name, order, complete === true, text]`，为按次组装求值的提供方时是 `[name, order, complete === true, null]`，由 `promptSectionDigest(section)` 寻址。`promptSectionDigestBasis(section)` 对存储文本报告 `content`，对提供方报告 `registration`——对于模型可见字节由组装决定的 section，这是诚实的说法。那些字节仍留在它们本来的位置，即 `request/header`。

## 模型体验

无，因为适配器只注册组件元数据；被镜像的 section 仍与此前完全一样，通过 `ctx.systemPrompt.assemble()` 抵达模型。

#### KV Cache 影响

无；适配器既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **提供方文本的 section 寻址的是其注册** — 动态 section 渲染出不同文本的两次运行共享同一个地址，而在名称、order 与完整性都相同的情况下用另一个提供方替换原提供方也不会移动摘要。需要渲染后字节的比较应读取 `request/header`。
- **仅镜像 section** — prompt context、变量与工具提供方同属该注册表的注册项，但不被镜像；每一类都需要自己的规范值以及读取它的消费方。
- **每个作用域一次读取** — 适配器镜像的是它被挂载的那个上下文的作用域；既想要全局集合又想要某个 agent 自身集合的部署要挂载适配器两次，每个上下文一次，两处注册按层相互遮蔽。

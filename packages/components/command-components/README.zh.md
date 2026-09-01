# @deepseek-ai/dsh-command-components

[English](README.md) | 中文

面向人的只读 `/components` 命令，按类别渲染组合的组件库存，每行附带组件的来源、谱系、成员数量以及触达它的工具。注册表仍是唯一的写入方；本适配器只做读取。

## 配置

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
- id: command-components
  name: '@deepseek-ai/dsh-command-components'
```

命令通过 `ctx.commands` 全局注册，并要求组件注册表；没有命令适配器的组合只是永远不会调用它。

## 命令

`/components` 不接受参数。没有已注册组件时打印空库存提示；否则打印总数，然后按首次出现顺序逐个类别打印其数量与每个组件一行：id、描述、来源，以及存在时的 `from <lineage>`、`<n> members` 与 `via <tool>`。被拒绝的参数或空库存都不会写入会话事件。

## 模型体验

### 人类 `/components` 视图

#### 模型看到的内容

无。斜杠输入与渲染的库存不进入模型请求，命令也不写任何会话事件。

#### Token 影响

零直接 token 影响；命令既不增加也不移除模型可见内容。

#### KV Cache 影响

无；命令发现与直接输出从不触碰请求前缀。

## 已知限制与暂缓事项

- **设计上只读** — 注册保留在生产方适配器；人工注册语法会创造出没有任何 seam 镜像的组件。
- **仅纯文本库存** — 按类别过滤、适配器专属徽标与 Web 客户端面板仍是未来的 UI 工作。
- **已发布应用中仅 Web 命令适配器** — headless、ACP 自动化与 JSON-RPC 适配器不消费 `ctx.commands`；这些调用方直接读取 `ctx.components`。

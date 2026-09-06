# @deepseek-ai/dsh-components-manifest

[English](README.md) | 中文

把某个 agent 当前在用的每个组件记录为持久的 `composition/manifest` 会话事件，使产生该会话模型请求的东西仅凭其日志即可重建。

## 配置

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-manifest
  name: '@deepseek-ai/dsh-components-manifest'
```

该插件不接受配置，并要求 `ctx.agents` 与 `ctx.components`。单独组合时它记录的是空组合；把组件放进注册表供其记录的是 [`packages/components/`](../README.md) 下的各适配器。

## 约定

在 `agent/pre-step` 上，写入方先调用 `next()`——使读取覆盖整条 pre-step 链敲定的结果——然后重新计算 `ctx.components.list({ scope: agent })`，仅当其 `compositionSha256` 与该会话日志中最后一条清单不同时才追加一条 `composition/manifest` 事件。去重由日志导出，因此稳定的组合恰好记录一条事件，恢复的会话不会重新发出任何事件，而被后续策略拒绝的步骤仍会记录当时在用的组合。

采用重新计算而非增量跟踪，正是让该记录在生产方的 HMR 释放、创建后才挂载的预设以及作用域遮蔽这三种情形下都保持正确的原因：写入方不持有任何可能被这些顺序作废的订阅状态。

payload 携带 `version`、每个组件一条的 `components` 条目——`id`、`digest`、`kind`、`digestBasis`、`provenance`、可选的 `lineage`，以及胜出注册所在的注册表 `layer`——按 `id@digest` 地址排序，并以 `compositionSha256` 覆盖恰好这一有序地址列表（以换行连接）。`buildCompositionManifest(views)` 构造它，`lastCompositionManifest(events)` 从日志中折叠出最新一条，`compositionSha256(addresses)` 重算哈希，`isComponentAddress(address)` 检验某个地址是否可供各代之间的比较使用。

该事件是读取时必需的：不认识 `composition/manifest` 的构建会拒绝包含它的日志，因为另一种做法是把自己无法命名的组合当作已知组合来对待。

## 模型体验

无，因为清单仅进日志；它命名的是产生模型输入的东西，不会向任何请求增加内容。

#### KV Cache 影响

无；写入方既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **命名组件本身，而非其传递性影响** — 远端工具描述变化但未重新注册的 MCP 服务器，或正文引用的文件发生变化的 skill，都会保持其摘要不变。只有各类别规范值覆盖到的内容才被寻址。
- **每次组合变化一条清单，无论多小** — 每步都在改动可见工具集合的组合会每步写一条事件。那确实是模型可调用内容的真实变化，但按步切换的作用域限制会让日志膨胀出目前没有消费方加以区分的事件。
- **暂无隔离字段** — payload 不携带 `reason`、`presetId`、`dynamicPackagesMounted` 或 `synthesized` 汇总；每一项都等待产生其输入的那一片，在此之前需要它们的消费方从 `components` 自行导出。

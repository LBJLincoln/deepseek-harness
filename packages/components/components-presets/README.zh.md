# @deepseek-ai/dsh-components-presets

[English](README.md) | 中文

把每个常驻的 agent 预设挂载镜像为组件注册表里的 `preset` 组件，并按该挂载实际安装的组合来寻址。

## 配置

```yaml
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: standard
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-presets
  name: '@deepseek-ai/dsh-components-presets'
```

该适配器不接受配置，并要求这两个服务同时存在。

## 约定

名册不发布挂载通知，而它的权威读取——`livePresetMounts()`——会剪除 fiber 已消失的每条子树记录。因此适配器在挂载时以及会话组合发生变化的两处边界上依据该读取进行调和：`agent/created`，在 agent 工厂的 setup 装好加入关系之后发出；以及 `agent-preset/selected`，在空白会话切换预设时提交。每个组件的 id 为 `preset:<id>`，类别为 `preset`，不带 `invoke` 指针，`detail: { trust, rows }`；`presetComponentId(id)` 为消费方构造该 id。`system` 预设随部署一同发布，来源为 `curated`；`user` 预设由本地编写——出自人或 agent——记录为 `synthesized`。释放适配器 fiber 会移除它注册的全部组件。

本适配器在自己的 `ComponentKindMap` 声明旁拥有 `preset` 的规范值：`[id, trust, rows]`，其中 `rows` 是完成 `include` 解析后的挂载组合，每行表示为 `[id, name, config, disabled]`，由 `presetDigest(mount)` 寻址，`digestBasis: 'content'`。行的 `name` 若是绝对路径，会被改写为相对于预设目录的路径，这样在不同根目录下挂载同一组合的两台主机地址相同；`config` 缺失或无法通过无损 JSON 边界的行贡献 `null`。

## 模型体验

无，因为适配器只注册组件元数据；预设各行安装的组合的一切模型可见影响由这些行自身负责。

#### KV Cache 影响

无；适配器既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **在加入时调和，而非在拆除时调和** — 被拆除后不再有 agent 创建或预设选择的常驻挂载，会一直列出到下一次调和为止。常驻挂载存活到整棵树拆除为止，因此该窗口在实践中是有界的；名册上的挂载通知可以关闭它。
- **`!!js` 行配置与缺失配置合流** — 两者都贡献 `null`，因此仅在某个 JSON 编码无法保留的配置上不同的两个组合地址相同。
- **trust 代替作者信息** — 名册记录的是预设被发现时所在的根，而非由谁编写，因此每个 `user` 预设都被记录为合成来源，且不携带指向其复制来源预设的谱系。

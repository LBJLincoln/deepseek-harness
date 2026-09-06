# components/ — 组合中的每个可寻址单元

[English](README.md) | 中文

用一个注册表回答一个组合包含什么、模型如何触达其中每个部分：插件与插件提供的成员携带稳定 id、内容地址、类别、来源、谱系、成员关系与可调用路径，归入全局层或某个 agent 自己的层。生产方是镜像某个 seam 实时注册表并拥有自身类别规范值的适配器；消费方为人、模型以及为组件评分的各个 seam 读取库存。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`components/`](components/README.md) | 组件注册表：描述符、类别、谱系、可调用路径 | `ctx.components` |
| [`components-tools/`](components-tools/README.md) | 把可见工具镜像为 `tool` 组件 | — |
| [`components-prompt/`](components-prompt/README.md) | 把 system-prompt section 镜像为 `prompt-section` 组件 | — |
| [`components-presets/`](components-presets/README.md) | 把常驻 agent 预设挂载镜像为 `preset` 组件 | — |
| [`components-skills/`](components-skills/README.md) | 把已加载的 skill 正文镜像为 `skill` 组件 | — |
| [`components-packages/`](components-packages/README.md) | 把 Loader 条目与运行期编写的包镜像为 `plugin` 与 `dynamic-package` 组件 | — |
| [`components-subagents/`](components-subagents/README.md) | 把 subagent 提供方镜像为 `agent-provider` 组件 | — |
| [`components-manifest/`](components-manifest/README.md) | 把在用组合记录为 `composition/manifest` 事件 | — |
| [`command-components/`](command-components/README.md) | 面向人的 `/components` 库存 | — |

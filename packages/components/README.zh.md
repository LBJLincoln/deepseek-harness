# components/ — 组合中的每个可寻址单元

[English](README.md) | 中文

用一个注册表回答一个组合包含什么、模型如何触达其中每个部分：插件与插件提供的成员携带稳定 id、内容地址、类别、来源、谱系、成员关系与可调用路径，归入全局层或某个 agent 自己的层。生产方是镜像某个 seam 实时注册表并拥有自身类别规范值的适配器；消费方为人、模型以及为组件评分的各个 seam 读取库存。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`components/`](components/README.md) | 组件注册表：描述符、类别、谱系、可调用路径 | `ctx.components` |
| [`components-subagents/`](components-subagents/README.md) | 把 subagent 提供方镜像为 `agent-provider` 组件 | — |
| [`command-components/`](command-components/README.md) | 面向人的 `/components` 库存 | — |

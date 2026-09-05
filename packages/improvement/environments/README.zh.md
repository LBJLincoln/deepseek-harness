# @deepseek-ai/dsh-environments

[English](README.md) | 中文

环境注册表：带可执行验证器的任务在组合期的清单。每个环境声明任务陈述与夹具、以验证 seam 的完成标准词汇表达的检查、是否为评估留出、所属方与来源。注册表不执行任何东西；[轨迹导出 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) 承载设计理由。

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
```

该服务不接受配置；生产方与消费方在其旁边组合。

## Service contract

`ctx.environments.register(definition)` 存储一个 `EnvironmentDefinition`，并返回恰好移除该次注册、且不会移除同一 id 下后续注册的 disposer。对已注册的 id 抛出代码为 `ENVIRONMENT_DUPLICATE_ID` 的 `EnvironmentError`，对空检查列表抛出 `ENVIRONMENT_NO_CHECKS`，对两个检查共用一个 id 抛出 `ENVIRONMENT_DUPLICATE_CHECK`。注册是 effect：生产方把 disposer 保存在自己的 fiber 下，释放即移除该环境。`get(id)` 与 `list(filter?)` 按注册顺序返回分离副本；`filter` 按 `kind` 与 `heldOut` 选择，调用方无法通过返回值改动已存储的检查列表。

一个定义携带带品牌的 `EnvironmentId`、来自可合并扩展的 `EnvironmentKindMap` 的 `kind`（每个生产方通过在 `@deepseek-ai/dsh-environments/types` 上做声明合并来声明其 kind 与 detail 类型；本包不声明任何 kind）、`name`、`description`、`task`（`prompt` 加可选的工作区 `fixture`）、验证者据以编写任务完成标准的 `checks`、`heldOut` 标志、所属包、`provenance`（`curated` 或 `synthesized`）、可选的 `lineage` 父 id，以及特定于 kind 的 `detail`。

## Extension points

生产方从精选套件或合成过程注册环境；消费方是把任务挂载为会话的环境运行器、按留出状态过滤训练数据的轨迹导出器，以及把环境列为组件的组件注册表适配器。

## Model Experience

无。注册表持有组合期任务定义，不注册任何面向模型的内容；挂载环境的运行器拥有全部模型可见效应。

#### KV Cache effect

无；注册表既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **没有运行器**——本包不把环境挂载为会话；由 `checks` 编写完成标准、运行 agent 并记录运行的运行器是改进 seam 的下一个切片。
- **夹具只是名字**——`task.fixture` 是运行器解析的标识符；注册表不验证其存在。
- **kind 随生产方到来**——未组合任何生产方的程序把 `EnvironmentKind` 视为 `string`，清单为空。

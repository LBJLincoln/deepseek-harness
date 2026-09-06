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

`ctx.environments.register(definition)` 存储一个 `EnvironmentDefinition`，并返回恰好移除该次注册、且不会移除同一 id 下后续注册的 disposer。对已注册的 id 抛出代码为 `ENVIRONMENT_DUPLICATE_ID` 的 `EnvironmentError`，对空检查列表抛出 `ENVIRONMENT_NO_CHECKS`，对两个检查共用一个 id 抛出 `ENVIRONMENT_DUPLICATE_CHECK`，对既非工作区相对路径也未规范化的不可变路径抛出 `ENVIRONMENT_INVALID_IMMUTABLE`。注册是 effect：生产方把 disposer 保存在自己的 fiber 下，释放即移除该环境。`get(id)` 与 `list(filter?)` 按注册顺序返回分离副本；`filter` 按 `kind` 与 `heldOut` 选择，调用方无法通过返回值改动已存储的检查列表或不可变集合。

一个定义携带带品牌的 `EnvironmentId`、来自可合并扩展的 `EnvironmentKindMap` 的 `kind`（每个生产方通过在 `@deepseek-ai/dsh-environments/types` 上做声明合并来声明其 kind 与 detail 类型；本包不声明任何 kind）、`name`、`description`、`task`（`prompt`、可选的工作区 `fixture` 与可选的 `immutable` 集合）、验证者据以编写任务完成标准的 `checks`、`heldOut` 标志、所属包、`provenance`（`curated` 或 `synthesized`）、可选的 `lineage` 父 id，以及特定于 kind 的 `detail`。

## The immutable set

`task.immutable` 列出 fixture 提供、实现者不得撰写的工作区相对路径——测试、参考输出，以及任何覆盖上去的检查脚本。每一项都是以 `/` 分隔的相对路径，不含空段、`.` 段或 `..` 段，不含反斜杠与盘符前缀，指向一个文件或一棵目录树；重复项与其他任何形式都在注册时被拒绝，因为检查方拥有的集合决定一次运行是否算数，注册表无法解析的路径绝不能进入本应度量它的那次运行。[环境运行器](../environment-runner/README.md)在第一个轮次之前以及每次验证时，都会连同验证者自己的目录一起对这些路径求摘要，并把改动了它们的尝试记录为 `tampered`。

## 加权用例

一个检查可以采样候选程序的行为，而不是归结为一个退出码。这样的检查携带日志所记录的 [`cases` 引用](../../verification/verification/README.md#weighted-cases)，并在其旁携带该引用所摘要的 `caseBodies`；注册表存储并游离化两者，[环境运行器](../environment-runner/README.md#weighted-cases-and-the-reservation)把正文写入验证者的预留目录，并按每个用例运行一次候选程序。注册按定义当时的样子求哈希，不对正文作任何校验：撰写才是判定用例是否可用的操作，因此与其正文不符的引用会在 `completionStandards.author()` 处、在实现者的第一个轮次之前使本次运行失败。

## Run stamp

`environment/run` 会话事件是会话与其所运行环境之间的持久链接。运行器在运行的第一个轮次之前追加一条 `EnvironmentRunStamp`：环境 id 与 kind、`heldOut` 标志、内容哈希、该次运行在批次内从零开始的 `repetition` 与可选的 `group`、该次运行所属的可选 `district`、模型路由，以及部署方声明的隔离级别。`environmentContentHashes(environment, fixtureSha256?)` 确定性地计算提示词、检查清单与合并后的 `contentSha256` 摘要；`checksSha256` 覆盖每个检查的树作用域、用例引用与用例正文，因此改动一个用例就会改变合并摘要，而合并摘要正是策展者用来与留出环境比对的去污染键。不带用例的检查恰好对每个检查一直携带的三个字段求摘要。`decodeEnvironmentRun(value)` 在日志边界校验持久载荷：无关的值返回 `undefined`，畸形的 stamp 抛出异常，因此折叠永远不会读到半截 stamp。

## Extension points

生产方从精选套件或合成过程注册环境；消费方是把任务挂载为会话并写入运行 stamp 的环境运行器、读取 stamp 以归属会话、并扣留留出会话与部署方所扣留的区的轨迹导出器，以及把环境列为组件的组件注册表适配器。

## Model Experience

无。注册表持有组合期任务定义，不注册任何面向模型的内容；挂载环境的运行器拥有全部模型可见效应。

#### KV Cache effect

无；注册表既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **不执行任何东西**——环境运行器（`@deepseek-ai/dsh-environment-runner`）把环境挂载为会话、由 `checks` 编写标准、执行检查并写入运行 stamp；本包只持有词汇。
- **夹具是运行器解析的路径**——`task.fixture` 指向运行器覆盖并哈希的绝对目录；注册表不验证其存在。
- **没有注册事件**——适配器与观察者尚无法跟随注册；stamp 记录的是运行了什么，而不是注册了什么。
- **kind 随生产方到来**——未组合任何生产方的程序把 `EnvironmentKind` 视为 `string`，清单为空。

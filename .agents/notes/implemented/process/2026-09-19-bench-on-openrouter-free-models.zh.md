# Agent Note：在 OpenRouter 的免费开放权重模型上跑 bench

状态：implemented

[English](2026-09-19-bench-on-openrouter-free-models.md) | 中文

## 问题

[开放权重路由笔记](2026-09-19-bench-on-an-open-weight-route.md)让 bench 距离"在操作者的 Claude Code 订阅之外跑一次"只差一把 key，也让 RLVR 语料仍然为空：`data/proving-ground/` 下的每条记录都产生于只允许评估用途的条款之下。操作者提供了那把 key —— 一个 OpenRouter 账户，其免费层以零费用提供一组不断轮换的开放权重模型，受一条账户级限制约束：每分钟二十次请求、每天一千次请求。要让一个计划跑在它上面，有两件事必须先成立；要让它的对话记录算数，还有一件。

组合必须不改代码就能点名该路由，并在限制之下存活。pi-ai 的内置目录里带有 `openrouter`，所以 [`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) 会为这个名字的路由继承端点和 `openai-completions` 协议，并允许 profile 替换模型列表；但免费 id 每周都在变，目录只认识其中一部分，而一个撞上每分钟限制的 cell 会以适配器默认的两次、相隔几百毫秒的重试让模型请求失败 —— 对于一个以分钟计量的限制，这是错误的形状。一个在共享限制上同时跑两个 cell 的 fleet，也需要一个上限：当提供方停止应答时它最多烧掉多少个 cell。

对话记录必须携带允许训练的条款。基础组合固定 `agreementId: proving-ground-bench`、`purposes: [evaluation]`，而 curator 会扣留条款未点名导出所请求用途的会话；在这些条款下跑一次，无论模型权重多开放，都只会多一条仅供评估的记录。

## 决定

`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml` 是基础组合加四个补丁。它插入一个 `llm-pi-ai` 条目，只有一条路由 `openrouter`，其 `apiKeyEnv` 为 `OPENROUTER_API_KEY`，其 `models` 列表点名八个免费 id，并附上 OpenRouter 在 2026-09-19 为它们公布的上下文与输出尺寸（`deepseek/deepseek-v4-flash-0731:free`、`nvidia/nemotron-3-super-120b-a12b:free`、`nvidia/nemotron-3-ultra-550b-a55b:free`、`qwen/qwen3.8-27b:free`、`google/gemma-4-31b-it:free`、`poolside/laguna-s-2.1:free`、`nex-agi/nex-n2.5-pro:free`、`thinkingmachines/inkling:free`；每一个都声明支持工具调用，这是 harness 循环所要求的）。它的重试策略是适配器的 `normal` 模式，八次重试，退避从三秒到三十秒，所以被每分钟限制拒绝的请求会等过去，而不是让这次尝试失败。fleet 补丁同时跑两个 cell，路由断路器设为连续四个出错 cell：一个 cell 每步发一次请求，推理模型的一步要几十秒，所以两个 cell 远低于每分钟二十次，而停止应答的提供方最多花掉四个 cell。data-use 补丁固定 `agreementId: proving-ground-openrouter-free`、`purposes: [training, evaluation]`，基础组合的 client、驻留地、保留期与脱敏 profile 不变；条款约束的是本仓库对会话日志的使用，至于某个模型的许可证是否允许其输出作为训练数据，由构建数据集时逐模型决定，而不是由组合决定。三个村规条目与每个叠加层一样被重述。

key 是引用，启动 shell 就是全部的凭证平面：驱动直接调用 `boot()`，所以不会读仓库的 `.env`，变量要在运行 `pnpm run bench` 的 shell 中导出。无 key 时，`pnpm run bench -- fleet h1-fleet-openrouter-smoke-t2 --overlay with-openrouter` 会在任何 cell 之前退出，报 `MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "openrouter"; its profile resolves OPENROUTER_API_KEY, which is not set …`，走的是上一篇笔记加入的预检。`data/transcripts/tools/collect-claude-code-session.mjs` 与 `data/proving-ground/tools/build-dataset.mjs` 里的凭证扫描器新增了 `openrouter-key` 模式，匹配 `sk-or-v1-` 前缀 —— OpenAI 风格的模式因为 `or` 后面的连字符而匹配不到它；带有这种 key 的对话记录或轨迹会在写入之前被拒绝。

六个计划点名该路由，district 都是 `bench-openrouter`：`h1-fleet-openrouter-smoke-t2`（一个模型跑两个点名的第 2 层环境，各一次，在把额度投入之前先标定每个 cell 的请求数）、`h2-openrouter-free-t2`（DeepSeek 的 flash 模型、120B 级的 Nemotron、27B 的 Qwen 跑六个非保留的第 2 层环境，各一次）、`h2-openrouter-agentic-t2`（三个面向 agentic 编码的模型跑同样六个环境）、`h1-fleet-openrouter-deepseek-t2`（推理修复之后单跑 DeepSeek 模型）`h1-fleet-openrouter-nex-smoke-t2`（在第一个拿到认证的模型上跑两个 cell，loop 的第一个队列），以及 `e10-openrouter-nex-vs-laguna-t2`（把 agentic fleet 里认证了每个 cell 的两个模型组成十二对的冻结配对，第一对没有订阅臂的配对，以 `openrouter-pairs` 入队、尚未运行）。在最初的记录之后，该路由还设置了 `compat.requiresThinkingAsText: true`，于是前一步的推理会被回放到 `content` 里（[它的笔记](../architecture/2026-09-19-reasoning-replayed-as-text-through-gateways.md)）。

## 运行显示了什么

五份记录和一行台账，全在 2026-09-19（[README](../../../../data/proving-ground/README.md) 逐一记着）：

- **路由端到端是通的。** 工具调用、推理、用量、尝试阶梯、上限、读取屏障、普查、导出：免费层上的每个 cell 都产生了与订阅 cell 一样的会话日志，而 loop 的第一次迭代无人插手地记录了其中一个。
- **最初的启动一个都没认证，原因有三种。** DeepSeek 的 flash 模型在读取上打转了四十步，因为网关丢弃了它用来做计划的 `reasoning` 字段（[修复](../architecture/2026-09-19-reasoning-replayed-as-text-through-gateways.md)）；Nemotron 120B 模型的每一次尝试都输给了适配器不重试的上游过载，现已归为 `SERVER`；Qwen 模型的上游共享池在每一次重试中都返回 429。
- **两个 harness 缺陷修好之后，agentic fleet 在六个非保留的第 2 层环境上认证了 18 之 16**：Nex N2.5 Pro 6 之 6，poolside Laguna S 2.1 6 之 6（只有一个在第二次尝试），Nemotron 3 Super 120B 6 之 4，以各三次尝试错过了 csv-codec 与 glob-match。中等产品模型在 h1 记录里以三分之一的步数认证了同样六个环境的 12 之 12；免费模型够得着这一层，只是更慢。DeepSeek 模型在推理以文本回放后重跑，能在步骤之间保住计划，却仍在三个 cell 里不写一次就结束尝试，随后重跑被叫停：传输缺陷已修好，剩下的是模型对这套工具面的处理。
- **语料存在，而且很小。** 会话带着允许训练的条款；第一个 `--purpose training` 数据集（[`2026-09-19-openrouter-free-v1`](../../../../data/proving-ground/datasets/2026-09-19-openrouter-free-v1/README.md)）装着 22 条轨迹，18 条已认证、4 条是测得的失败，来自六个第 2 层任务上的四个免费模型，这是在 `terms` 字段之前导出的两份记录由当前折叠重新导出之后的结果。许可证当天在 Hugging Face hub 上读过：DeepSeek V4 Flash 为 MIT，Qwen3.8-27B 为 Apache-2.0，Nemotron 3 Super 采用 NVIDIA 自己的开放模型许可；Nex 与 poolside 的许可证没有读过，在准入时把关它们的轨迹。
- **额度塑造了这一天。** 到 12:20 UTC，一千次每日请求里的 834 次已在五支 fleet 上花掉；一个 cell 每步一次请求，推理模型的一步要一分钟，所以一支十八个 cell 的第 2 层 fleet 就是一次八十分钟、三百次请求的运行。

## 考虑过的替代方案

- **像 `with-openai-gateway` 那样手工声明路由。** 否决：pi-ai 内置的 `openrouter` 条目已经带有端点、协议以及其 URL 所蕴含的 `openrouter` 推理分发格式，手工声明的路由只会重述它们，并在 pi-ai 更新时漂移。叠加层只陈述目录无法知道的东西：今天存在哪些免费 id、它们有多大。
- **一次只跑一个 cell。** 考虑过并测量过：第一个 cell 每步一次请求、大约每分钟三次，所以串行 fleet 只用了每分钟限制的七分之一，而每个 cell 要十分钟。两个 cell 把墙钟时间减半，仍低于限制的三分之一；更多则会在快模型上撞到每分钟限制，让退避变成运行的节奏。
- **保留基础组合的仅评估条款，训练的事以后再说。** 否决：条款的 pin 只能收窄、绝不能放宽，所以为评估创建的会话事后不能变成训练数据；这个决定必须在第一个 cell 之前写进组合。叠加层以自己的 agreement id 作出了这个决定，于是两套语料能凭各自会话携带的条款区分开。
- **列出所有免费模型。** 否决：当天有二十二个免费 id，其中两个不支持工具调用，好几个是同一家族的变体；一条路由恰好服务它列出的模型，所以列表就是计划可能点名的那八个。再加一个就是一个带尺寸的条目。
- **在 fleet 里限流。** 否决：fleet 没有请求的概念，只有 cell，而限制是按请求计的。速率限制属于路由的重试策略，断路器覆盖重试无法处理的失败。

## 后果

- bench 真的跑在了一条开放权重路由上，用的是免费额度，只需一个标志和一个环境变量；没有该变量时会大声拒绝。
- 路由的模型列表是一个快照：OpenRouter 的免费集合会变，点名了提供方已撤下的 id 的计划，会在第一个 cell 的第一次请求时以提供方自己的错误失败，而不是在此之前。预检检查的是 key，不是目录。
- 这个叠加层上的 fleet 花的是共享的每日额度，所以同一天启动的两个计划会争抢它；计划的 cell 数按一天加一次重跑来定，而在运行中途耗尽额度的计划会产生每次尝试都因限流拒绝而失败、而非出错的 cell，断路器不会拦下这种情况。
- 这条路由上的会话是仓库里第一批条款允许训练的会话。它们只有在读取这些条款的用途过滤之下才可进入数据集，而模型的许可证仍需在准入时逐模型检查。

# Agent Note: Running the Proving Ground bench on an open-weight route

Status: implemented

[English](2026-09-19-bench-on-an-open-weight-route.md) | 中文

## Problem

`data/proving-ground/` 中的每一条 Proving Ground 记录都产生自操作者自己的 Claude Code 订阅。由此引出两件事，而它们都不是再加一份计划就能解决的。

harness 宣称能运行任何 LLM，`llm` 接缝也正是为此而建，但从来没有什么端到端地检验过这一说法：bench 的基础组合只挂载一个适配器 `@deepseek-ai/dsh-llm-claude-code`，而每一份已入库的计划都点名它那三个产品模型之一。一个 bench cell——目标、受限工具、验证循环、尝试阶梯——在别的路由上是否成立，一直是从组合推出的论证，而不是观察到的事实。

该订阅的条款只允许把它的对话记录用于评测。因此 `data/proving-ground/datasets/` 下的 RLVR 数据集不得包含这份语料中的任何东西，而在其上做一次数据集折叠，就是在折叠一份不得用于训练任何东西的数据。只有跑在数据使用条款允许训练的路由上的运行才能提供那份语料，而此前并不存在任何一个组合能让操作者拿一把密钥指过去、把它产出来。

把 bench 指向一条无密钥的路由，还比毫无用处更糟。在组合了 `@deepseek-ai/dsh-llm-deepseek` 而 `DEEPSEEK_API_KEY` 未设置的情况下，一份十二个 cell 的 fleet 在四秒内跑完：每个 cell 都铸出工作区、写下盖章、撰写自己的标准、在一个还没上线就失败的模型请求上耗尽三次尝试，然后报告未认证。这次运行产出六行认证率为 `0.00`、花费为零 token 的排行榜，并且在 `run.log`、`status.json` 与排行榜中任何一处都没有点名那条缺失的凭据——只有每个 cell 自己的会话日志里有。读这份输出的人，分不出缺密钥与一个把每道题都做砸的模型。

## Decision

`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-deepseek.cordis.yml` 是基础组合，加上一条插入的 `@deepseek-ai/dsh-llm-deepseek` 条目，点名 `apiKeyEnv: DEEPSEEK_API_KEY` 与一个单模型 catalog。基础组合的产品路由继续与它并存，这正是让一次冻结配对把产品 arm 与开放权重 arm 放进同一次运行的前提。`overlays/with-openai-gateway.cordis.yml` 是 `@deepseek-ai/dsh-llm-pi-ai` 的同一形状：一条手工声明的 `gateway` 路由，`api: openai-completions`，一个操作者必须替换的占位 `baseURL`，以及一个模型条目——一份供复制的模板，没有属于它自己的计划。

两份计划点名开放权重路由：`plans/h1-fleet-deepseek-t2.json`（第 2 层 fleet，district `bench-h1`，种子 1，与可比计划相同的策略版本）与 `plans/e8-deepseek-vs-sonnet-t3.json`（冻结配对，第 3 层，两次重复，种子 1，基线 `claude-code`/`sonnet` 对候选 `deepseek-official`/`deepseek-v4-flash`）。两者在 `plans/README.md` 中都是 "not recorded"：它们可运行，但没有运行过。

`ctx.llm.checkRoute(provider)` 就是那次无密钥运行无从提出的接缝之问——「这条路由能被派发吗？」，并且在不派发的前提下作答。`LlmRuntime` 对无人持有的路由抛出 `NO_ADAPTER`，否则委派给持有它的适配器，而 `LlmAdapter.checkRoute` 的默认实现接受它持有的每一条路由。DeepSeek 与 pi-ai 适配器用其 `stream` 在发出第一个字节之前所解析的东西、且仅此而已来覆盖它：当前的连接快照与该快照的凭据。不做网络 I/O，不校验模型 id。该检查接受的路由，仍可能在第一次请求上失败。

[fleet](../../../../packages/improvement/fleet/README.md#service-contract) 在准备一份计划时提出这个问题，就在它早已执行的实现者预检旁边，针对计划中任何一个 cell 可能跑上的每一条路由——计划自身的各条路由，以及每一个点名了另一条路由的阶梯档位——每个 provider 一次，在第一个 cell 被枚举之前、第一个工作区被铸出之前。因此 `llm` 成为 `FleetService` 的一项声明注入。实验经 `fleet.runPaired` 继承这次拒绝，后者在任一 arm 的第一个 cell 之前就准备好两份计划，于是候选无密钥的冻结配对会在零个 cell 被铸出的情况下被拒绝，而不是把基线 arm 花掉再折叠出 `inconclusive`。

无密钥时，`pnpm run bench -- fleet h1-fleet-deepseek-t2 --overlay with-deepseek` 现在以非零退出，并给出 `MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service …, or export DEEPSEEK_API_KEY in the launching environment`，且什么也没有铸出。

## What the overlay does and does not prove

它证明了组合能够加载，证明了一份计划可以点名一条开放权重路由，也证明了密钥缺席时 bench 会大声地、零代价地拒绝。它对那条路由能得多少分一概没有证明：还没有任何一个 cell 在它上面跑过。`with-openai-gateway` 叠加层证明的更少——它的 `baseURL` 是占位符，因此它是一份能通过 `verify-cordis-config` 的、可复制编辑的模板，而不是任何人到达过的路由。

缺的是一把密钥，以及把它花出去的算力。在这样的运行出现之前，`data/proving-ground/` 中没有任何一条记录可以进入 RLVR 语料，而它的 README 在描述数据集的地方就把这一点写明，而不是把这处缺席留给读者去推断。

## Alternatives considered

- **让那十二个 cell 失败，再去读会话日志。** 否决：这种失败不只是吵闹，它在操作者阅读的那一层上根本看不见。每个 cell 自己的日志确实记下了 `MISSING_CREDENTIAL`，但 fleet 报告把失败的模型请求折叠成一个未认证的 cell，而这与一个真的在失败的模型所产生的行完全相同，并且运行日志任何一处都没有点名那条凭据。这正是仓库规则所禁止的「悄悄跳过缺失的指涉对象」，只不过打扮成了一次测量。
- **凭据引用解析不到值时，在插件加载处拒绝。** 否决：`dsh-llm-deepseek` 刻意以无密钥状态注册，好让 catalog 保持可浏览，并让首次运行的上手流程是「浏览模型、存入密钥、再次发起提示」，中间无需重启。密钥在启动之后经 settings 或凭据接缝到达是受支持的状态，而让加载失败会为了服务一个无人值守的调用方，破坏每一个交互式界面上的这条路径。
- **扩展 `EnvironmentRunner.checkImplementer` 以覆盖路由。** 否决：该方法是 `run()` 自身所执行的那些拒绝的一次空跑，而 `run()` 并不拒绝一条无密钥的路由——失败发生在下面好几层，在 agent 循环内部。把一个新的拒绝折进去会让两者不再对应，而且会让这个方法对每一个调用方都变成异步的。
- **去问端点。** 否决：端点探测每条路由要花一次请求，需要属于自己的超时策略与失败分类，回答的又不是这个预检在问的问题。缺少凭据在任何请求存在之前就已成定局；端点是否应答则不然，而假装在计划期就裁定它，会把一次短暂的服务中断变成一份被拒绝的计划。
- **把预检放进 bench 自己的 driver 里。** 否决：那样它只对 `pnpm run bench` 成立，对别的一概不成立——一次轮值、一本计划账本，或任何其他 fleet 调用方，都会继续产出没有任何东西跑过的排行榜。这个拒绝属于枚举那些 cell 的计划者。
- **点名 pi-ai 的 `deepseek` catalog 路由，而不是 `deepseek-official`。** 就本叠加层而言否决：两个适配器刻意持有不同的路由名，好让一个组合能同时挂载两者，而直连 fetch 的那个适配器是本仓库端到端拥有其线格式的那一个。pi-ai 这条路径仍然可达，`with-openai-gateway` 就是演示它的地方。

## Consequences

- 持有密钥的操作者，用一个 flag 加一个环境变量就能把 bench 跑在开放权重路由上；没有密钥时，拒绝是即时的、零代价的，并且点名该导出什么。
- 每个 fleet 调用方为每份计划的每条不同路由付出一次凭据解析。它不触网，而它所保护的那份计划要贵上几个数量级。
- `FleetService` 现在需要 `llm`。挂载 fleet 却没有 LLM 服务的组合会在挂载处失败，而不是在第一个 cell 处；本仓库中的每一个组合都已经挂载了一个。
- 「harness 能运行任何 LLM」这一说法仍未被测量检验。叠加层把它从「不可达」挪到「差一把密钥」，这比「已证实」是一个更小的说法，而 README 写明了成立的是哪一个。
- 现在有两个适配器带着 `checkRoute` 覆盖实现，它们必须持续与各自的 `stream` 所解析的东西保持一致。只给其中一个加上新的凭据路径，会让预检接受一条随后被请求拒掉的路由——其失效模式是误放行，退化成今天的行为，而不是退化成错误的拒绝。

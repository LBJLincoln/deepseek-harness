# Proving Ground bench：计划 fixtures

[English](README.md) | 中文

Proving Ground bench（`examples/headless-agent/tests/fixtures/proving-ground-bench/`）的已入库计划文件。用 `pnpm run bench -- fleet <name>`（`models` 数组）或 `pnpm run bench -- experiment <name>`（`baseline`/`candidate` 配对）运行其中一个；`pnpm run bench -- plans` 会从每个文件现场解析并打印同样的信息。"叠加层"一列是该计划所需、位于 `../overlays/` 下的组合，不需要叠加层时写 `base`（即该 fixture 自己的 `cordis.yml`）。使用 `with-deepseek` 叠加层的计划需要在启动它的 shell 中导出 `DEEPSEEK_API_KEY`，使用 `with-openrouter` 的则需要 `OPENROUTER_API_KEY`；其余每个计划都跑在操作者自己安装的 Claude Code 上。"已记录运行"一列给出该计划在 `data/proving-ground/` 下产生的目录名，仅在按名称能明确对应时给出；`not recorded` 表示尚无这样的目录。

| 计划 | 比较对象 | 层 | Arms / 模型 | 种子 | 叠加层 | 已记录运行 |
| --- | --- | --- | --- | --- | --- | --- |
| `e0-calibration-sonnet-t2` | `sonnet` 对自身（噪声基线） | 2 | 基线 `sonnet` 对候选 `sonnet` | 1 | base | not recorded |
| `e1-haiku-vs-sonnet-t3` | 模型层级：sonnet 对 haiku | 3 | 基线 `sonnet` 对候选 `haiku` | 1 | base | `2026-09-08-bench-e1-haiku-vs-sonnet-t3` |
| `e1-sonnet-vs-opus-t3` | 模型层级：sonnet 对 opus | 3 | 基线 `sonnet` 对候选 `opus` | 1 | base | `2026-09-08-bench-e1-sonnet-vs-opus-t3` |
| `e2-harness-vs-product-sonnet-t2` | harness 循环对产品循环 | 2 | 基线 route `sonnet` 对候选 product-loop `sonnet` | 1 | base | not recorded |
| `e2-harness-vs-product-sonnet-t3` | harness 循环对产品循环 | 3 | 基线 route `sonnet` 对候选 product-loop `sonnet` | 1 | base | `2026-09-07-bench-e2-harness-vs-product-t3` |
| `e2-harness-vs-product-sonnet-t5` | harness 循环对产品循环 | 5 | 基线 route `sonnet` 对候选 product-loop `sonnet` | 2 | base | `2026-09-08-bench-e2-harness-vs-product-t5` |
| `e3-attempts-t5` | 尝试上限：三级阶梯对一级阶梯 | 5 | 基线 `sonnet` 阶梯×3 对候选 `sonnet` 阶梯×1 | 2 | base | `2026-09-08-bench-e3-attempts-t5`, `2026-09-19-bench-e3-attempts-t5` |
| `e5-downshift-t5` | 强模型启动之后再降级 | 5 | 基线 `opus` 阶梯×3 对候选 `opus`→`haiku`,`haiku` | 2 | base | `2026-09-08-bench-e5-downshift-t5` |
| `e5-drop-candidate-t5` | 单独的丢弃臂，作为一次 fleet | 5 | fleet `haiku`→`opus`,`opus`，实现者 `spawn` | 2 | with-spawn | `2026-09-08-bench-e5-drop-candidate-t5` |
| `e5-drop-frozen-t5` | 保留对话记录对丢弃对话记录，冻结配对 | 5 | 基线 `haiku`→`opus`,`opus`（route）对候选同一阶梯，实现者 `spawn` | 2 | with-spawn | `2026-09-18-bench-e5-drop-frozen-t5`（部分：容器重启前跑完 32 个 cell 中的 25 个） |
| `e5-handoff-drop-t5` | 保留对话记录对丢弃对话记录，首次冻结尝试 | 5 | 基线 `haiku`→`opus`,`opus`（route）对候选同一阶梯，实现者 `spawn` | 2 | with-spawn | `2026-09-08-bench-e5-handoff-drop-t5` |
| `e5-handoff-tax-t5` | 交接税：全程强模型对先弱后强 | 5 | 基线 `opus` 阶梯×3 对候选 `haiku`→`opus`,`opus` | 2 | base | `2026-09-08-bench-e5-handoff-tax-t5` |
| `e6-cascade-share-t5` | 有界廉价一级的级联：全程强模型对先弱后强，廉价一级限于 cell 上限的 0.2 | 5 | 基线 `opus` 阶梯×3 对候选 `haiku`（份额 0.2）→`opus`,`opus` | 2 | base | `2026-09-18-bench-e6-cascade-share-t5` |
| `e7-attempts-5-t5` | 尝试上限：中等模型五级对三级 | 5 | 基线 `sonnet` 阶梯×3 对候选 `sonnet` 阶梯×5 | 2 | attempts-5 | `2026-09-19-bench-e7-attempts-5-t5`, `2026-09-19-bench-e7-attempts-5-t5-2` |
| `e8-deepseek-vs-sonnet-t3` | 产品路由对开放权重路由 | 3 | 基线 `claude-code`/`sonnet` 对候选 `deepseek-official`/`deepseek-v4-flash` | 1 | with-deepseek | not recorded |
| `e8-sonnet-vs-opus-t6` | 模型层级：在最大模型尚未被度量过的多文件层上比较 | 6 | 基线 `sonnet` 对候选 `opus` | 2 | base | not recorded |
| `e9-preset-craft-vs-plain-t5` | Agent 组合：同一路由上工艺技能 preset 对普通 preset | 5 | 基线 `sonnet` preset `bench` 对候选 `sonnet` preset `bench-craft` | 2 | with-presets | `2026-09-19-bench-e9-preset-craft-vs-plain-t5` |
| `e10-openrouter-nex-vs-laguna-t2` | 两个免费开放权重 agentic 模型组成的冻结配对，第一对没有订阅臂的配对 | 2 | 基线 `openrouter`/`nex-agi/nex-n2.5-pro:free` 对候选 `openrouter`/`poolside/laguna-s-2.1:free`，district `bench-openrouter` | 1 | with-openrouter | not recorded |
| `h1-fleet-deepseek-t2` | 跑在开放权重路由上的 harness 循环 fleet | 2 | fleet `deepseek-official`/`deepseek-v4-flash`，district `bench-h1` | 1 | with-deepseek | not recorded |
| `h1-fleet-harness-loop-sonnet-t2` | harness 循环 fleet | 2 | fleet `sonnet`，district `bench-h1` | 1 | base | `2026-09-07-bench-h1-harness-loop-t2` |
| `h1-fleet-harness-loop-sonnet-t4` | harness 循环 fleet | 4 | fleet `sonnet`，district `bench-h1` | 1 | base | `2026-09-07-bench-h1-harness-loop-t4` |
| `h1-fleet-harness-loop-sonnet` | harness 循环 fleet，不筛选层级 | all | fleet `sonnet`，district `bench-h1` | 1 | base | not recorded |
| `h1-fleet-openrouter-deepseek-t2` | 免费路由上的 DeepSeek flash 模型跑一个层，推理以文本回放 | 2 | fleet `openrouter`/`deepseek/deepseek-v4-flash-0731:free`，district `bench-openrouter` | 1 | with-openrouter | `2026-09-19-bench-h1-openrouter-deepseek-t2-partial`（部分：跑完 6 个 cell 中的 3 个后停止） |
| `h1-fleet-openrouter-nex-smoke-t2` | 免费路由上第一个拿到认证的模型跑两个点名的环境，也是 loop 的第一个队列 | 2 | fleet `openrouter`/`nex-agi/nex-n2.5-pro:free`，district `bench-openrouter` | 1 | with-openrouter | `2026-09-19-bench-h1-fleet-openrouter-nex-smoke-t2`（loop 的第一次迭代） |
| `h1-fleet-openrouter-smoke-t2` | 免费开放权重路由，跑两个点名的环境 | 2 | fleet `openrouter`/`deepseek/deepseek-v4-flash-0731:free`，district `bench-openrouter` | 1 | with-openrouter | `2026-09-19-bench-h1-openrouter-smoke-t2` |
| `h1-fleet-product-loop-sonnet` | 产品循环 fleet，不筛选层级 | all | fleet `sonnet`，实现者 product-loop，district `bench-h1` | 1 | base | not recorded |
| `h2-haiku-vs-sonnet-t2` | 模型层级：haiku 对 sonnet（native-tools 之前的策略） | 2 | 基线 `haiku` 对候选 `sonnet` | 1 | base | not recorded |
| `h2-openrouter-agentic-t2` | 同一层上的三个面向 agentic 编码的免费开放权重模型 | 2 | fleet `openrouter`/`nvidia/nemotron-3-super-120b-a12b:free`、`poolside/laguna-s-2.1:free`、`nex-agi/nex-n2.5-pro:free`，district `bench-openrouter` | 1 | with-openrouter | `2026-09-19-bench-h2-openrouter-agentic-t2` |
| `h2-openrouter-free-t2` | 同一层上的三个免费开放权重模型 | 2 | fleet `openrouter`/`deepseek/deepseek-v4-flash-0731:free`、`nvidia/nemotron-3-super-120b-a12b:free`、`qwen/qwen3.8-27b:free`，district `bench-openrouter` | 1 | with-openrouter | `2026-09-19-bench-h2-openrouter-free-t2-partial`（部分：跑完 18 个 cell 中的 4 个后停止） |
| `h2-sonnet-vs-opus-t3` | 模型层级：sonnet 对 opus（native-tools 之前的策略） | 3 | 基线 `sonnet` 对候选 `opus` | 1 | base | not recorded |
| `h3-attempts1-sonnet-t5` | 尝试上限：单次尝试的 fleet 臂 | 5 | fleet `sonnet`，district `bench-h3` | 2 | attempts-1 | not recorded |
| `h3-baseline-sonnet-t5` | 尝试上限：基线 fleet 臂 | 5 | fleet `sonnet`，district `bench-h3` | 2 | base | `2026-09-19-bench-h3-baseline-sonnet-t5` |
| `h4-craft-sonnet-t5` | 知识：挂载三个工艺技能 | 5 | fleet `sonnet`，district `bench-h4` | 2 | with-craft-skills | `2026-09-08-bench-h4-craft-skills-t5` |
| `held-out-sonnet-all` | 保留环境的可靠性估计 | held-out | fleet `sonnet`，district `bench-held-out` | 3 | base | `2026-09-08-bench-held-out-sonnet-all` |

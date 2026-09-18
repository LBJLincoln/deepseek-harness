# Proving Ground bench：计划 fixtures

[English](README.md) | 中文

Proving Ground bench（`examples/headless-agent/tests/fixtures/proving-ground-bench/`）的已入库计划文件。用 `pnpm run bench -- fleet <name>`（`models` 数组）或 `pnpm run bench -- experiment <name>`（`baseline`/`candidate` 配对）运行其中一个；`pnpm run bench -- plans` 会从每个文件现场解析并打印同样的信息。"叠加层"一列是该计划所需、位于 `../overlays/` 下的组合，不需要叠加层时写 `base`（即该 fixture 自己的 `cordis.yml`）。"已记录运行"一列给出该计划在 `data/proving-ground/` 下产生的目录名，仅在按名称能明确对应时给出；`not recorded` 表示尚无这样的目录。

| 计划 | 比较对象 | 层 | Arms / 模型 | 种子 | 叠加层 | 已记录运行 |
| --- | --- | --- | --- | --- | --- | --- |
| `e0-calibration-sonnet-t2` | `sonnet` 对自身（噪声基线） | 2 | 基线 `sonnet` 对候选 `sonnet` | 1 | base | not recorded |
| `e1-haiku-vs-sonnet-t3` | 模型层级：sonnet 对 haiku | 3 | 基线 `sonnet` 对候选 `haiku` | 1 | base | `2026-09-08-bench-e1-haiku-vs-sonnet-t3` |
| `e1-sonnet-vs-opus-t3` | 模型层级：sonnet 对 opus | 3 | 基线 `sonnet` 对候选 `opus` | 1 | base | `2026-09-08-bench-e1-sonnet-vs-opus-t3` |
| `e2-harness-vs-product-sonnet-t2` | harness 循环对产品循环 | 2 | 基线 route `sonnet` 对候选 product-loop `sonnet` | 1 | base | not recorded |
| `e2-harness-vs-product-sonnet-t3` | harness 循环对产品循环 | 3 | 基线 route `sonnet` 对候选 product-loop `sonnet` | 1 | base | `2026-09-07-bench-e2-harness-vs-product-t3` |
| `e2-harness-vs-product-sonnet-t5` | harness 循环对产品循环 | 5 | 基线 route `sonnet` 对候选 product-loop `sonnet` | 2 | base | `2026-09-08-bench-e2-harness-vs-product-t5` |
| `e3-attempts-t5` | 尝试上限：三级阶梯对一级阶梯 | 5 | 基线 `sonnet` 阶梯×3 对候选 `sonnet` 阶梯×1 | 2 | base | `2026-09-08-bench-e3-attempts-t5` |
| `e5-downshift-t5` | 强模型启动之后再降级 | 5 | 基线 `opus` 阶梯×3 对候选 `opus`→`haiku`,`haiku` | 2 | base | `2026-09-08-bench-e5-downshift-t5` |
| `e5-drop-candidate-t5` | 单独的丢弃臂，作为一次 fleet | 5 | fleet `haiku`→`opus`,`opus`，实现者 `spawn` | 2 | with-spawn | `2026-09-08-bench-e5-drop-candidate-t5` |
| `e5-drop-frozen-t5` | 保留对话记录对丢弃对话记录，冻结配对 | 5 | 基线 `haiku`→`opus`,`opus`（route）对候选同一阶梯，实现者 `spawn` | 2 | with-spawn | not recorded |
| `e5-handoff-drop-t5` | 保留对话记录对丢弃对话记录，首次冻结尝试 | 5 | 基线 `haiku`→`opus`,`opus`（route）对候选同一阶梯，实现者 `spawn` | 2 | with-spawn | `2026-09-08-bench-e5-handoff-drop-t5` |
| `e5-handoff-tax-t5` | 交接税：全程强模型对先弱后强 | 5 | 基线 `opus` 阶梯×3 对候选 `haiku`→`opus`,`opus` | 2 | base | `2026-09-08-bench-e5-handoff-tax-t5` |
| `h1-fleet-harness-loop-sonnet-t2` | harness 循环 fleet | 2 | fleet `sonnet`，district `bench-h1` | 1 | base | `2026-09-07-bench-h1-harness-loop-t2` |
| `h1-fleet-harness-loop-sonnet-t4` | harness 循环 fleet | 4 | fleet `sonnet`，district `bench-h1` | 1 | base | `2026-09-07-bench-h1-harness-loop-t4` |
| `h1-fleet-harness-loop-sonnet` | harness 循环 fleet，不筛选层级 | all | fleet `sonnet`，district `bench-h1` | 1 | base | not recorded |
| `h1-fleet-product-loop-sonnet` | 产品循环 fleet，不筛选层级 | all | fleet `sonnet`，实现者 product-loop，district `bench-h1` | 1 | base | not recorded |
| `h2-haiku-vs-sonnet-t2` | 模型层级：haiku 对 sonnet（native-tools 之前的策略） | 2 | 基线 `haiku` 对候选 `sonnet` | 1 | base | not recorded |
| `h2-sonnet-vs-opus-t3` | 模型层级：sonnet 对 opus（native-tools 之前的策略） | 3 | 基线 `sonnet` 对候选 `opus` | 1 | base | not recorded |
| `h3-attempts1-sonnet-t5` | 尝试上限：单次尝试的 fleet 臂 | 5 | fleet `sonnet`，district `bench-h3` | 2 | attempts-1 | not recorded |
| `h3-baseline-sonnet-t5` | 尝试上限：基线 fleet 臂 | 5 | fleet `sonnet`，district `bench-h3` | 2 | base | not recorded |
| `h4-craft-sonnet-t5` | 知识：挂载三个工艺技能 | 5 | fleet `sonnet`，district `bench-h4` | 2 | with-craft-skills | `2026-09-08-bench-h4-craft-skills-t5` |
| `held-out-sonnet-all` | 保留环境的可靠性估计 | held-out | fleet `sonnet`，district `bench-held-out` | 3 | base | `2026-09-08-bench-held-out-sonnet-all` |

# Proving Ground bench: plan fixtures

English | [中文](README.zh.md)

Checked-in plan files for the Proving Ground bench (`examples/headless-agent/tests/fixtures/proving-ground-bench/`). Run one with `pnpm run bench -- fleet <name>` (a `models` array) or `pnpm run bench -- experiment <name>` (a `baseline`/`candidate` pair); `pnpm run bench -- plans` prints this same information parsed live from each file. "Overlay" is the composition under `../overlays/` the plan needs, or `base` for the fixture's own `cordis.yml`. "Recorded run" names the directory under `data/proving-ground/` the plan produced, matched by name where that mapping is unambiguous; `not recorded` means no such directory exists yet.

| Plan | Compares | Tier | Arms / models | Seed | Overlay | Recorded run |
| --- | --- | --- | --- | --- | --- | --- |
| `e0-calibration-sonnet-t2` | `sonnet` against itself (noise floor) | 2 | baseline `sonnet` vs candidate `sonnet` | 1 | base | not recorded |
| `e1-haiku-vs-sonnet-t3` | model tier: sonnet vs haiku | 3 | baseline `sonnet` vs candidate `haiku` | 1 | base | `2026-09-08-bench-e1-haiku-vs-sonnet-t3` |
| `e1-sonnet-vs-opus-t3` | model tier: sonnet vs opus | 3 | baseline `sonnet` vs candidate `opus` | 1 | base | `2026-09-08-bench-e1-sonnet-vs-opus-t3` |
| `e2-harness-vs-product-sonnet-t2` | harness loop vs product loop | 2 | baseline route `sonnet` vs candidate product-loop `sonnet` | 1 | base | not recorded |
| `e2-harness-vs-product-sonnet-t3` | harness loop vs product loop | 3 | baseline route `sonnet` vs candidate product-loop `sonnet` | 1 | base | `2026-09-07-bench-e2-harness-vs-product-t3` |
| `e2-harness-vs-product-sonnet-t5` | harness loop vs product loop | 5 | baseline route `sonnet` vs candidate product-loop `sonnet` | 2 | base | `2026-09-08-bench-e2-harness-vs-product-t5` |
| `e3-attempts-t5` | attempt cap: three rungs vs one | 5 | baseline `sonnet` ladder×3 vs candidate `sonnet` ladder×1 | 2 | base | `2026-09-08-bench-e3-attempts-t5` |
| `e5-downshift-t5` | downshift after the strong model starts | 5 | baseline `opus` ladder×3 vs candidate `opus`→`haiku`,`haiku` | 2 | base | `2026-09-08-bench-e5-downshift-t5` |
| `e5-drop-candidate-t5` | the drop arm alone, as a fleet | 5 | fleet `haiku`→`opus`,`opus`, implementer `spawn` | 2 | with-spawn | `2026-09-08-bench-e5-drop-candidate-t5` |
| `e5-drop-frozen-t5` | kept vs dropped transcript, frozen pair | 5 | baseline `haiku`→`opus`,`opus` (route) vs candidate the same ladder, implementer `spawn` | 2 | with-spawn | `2026-09-18-bench-e5-drop-frozen-t5` (partial: 25 of 32 cells before a container restart) |
| `e5-handoff-drop-t5` | kept vs dropped transcript, the first frozen attempt | 5 | baseline `haiku`→`opus`,`opus` (route) vs candidate the same ladder, implementer `spawn` | 2 | with-spawn | `2026-09-08-bench-e5-handoff-drop-t5` |
| `e5-handoff-tax-t5` | handoff tax: strong alone vs cheap-then-strong | 5 | baseline `opus` ladder×3 vs candidate `haiku`→`opus`,`opus` | 2 | base | `2026-09-08-bench-e5-handoff-tax-t5` |
| `e6-cascade-share-t5` | cascade with a bounded cheap rung: strong alone vs cheap-then-strong, the cheap rung held to 0.2 of the cell's caps | 5 | baseline `opus` ladder×3 vs candidate `haiku` (share 0.2)→`opus`,`opus` | 2 | base | `2026-09-18-bench-e6-cascade-share-t5` |
| `h1-fleet-harness-loop-sonnet-t2` | harness-loop fleet | 2 | fleet `sonnet`, district `bench-h1` | 1 | base | `2026-09-07-bench-h1-harness-loop-t2` |
| `h1-fleet-harness-loop-sonnet-t4` | harness-loop fleet | 4 | fleet `sonnet`, district `bench-h1` | 1 | base | `2026-09-07-bench-h1-harness-loop-t4` |
| `h1-fleet-harness-loop-sonnet` | harness-loop fleet, no tier filter | all | fleet `sonnet`, district `bench-h1` | 1 | base | not recorded |
| `h1-fleet-product-loop-sonnet` | product-loop fleet, no tier filter | all | fleet `sonnet`, implementer product-loop, district `bench-h1` | 1 | base | not recorded |
| `h2-haiku-vs-sonnet-t2` | model tier: haiku vs sonnet (pre-native-tools policy) | 2 | baseline `haiku` vs candidate `sonnet` | 1 | base | not recorded |
| `h2-sonnet-vs-opus-t3` | model tier: sonnet vs opus (pre-native-tools policy) | 3 | baseline `sonnet` vs candidate `opus` | 1 | base | not recorded |
| `h3-attempts1-sonnet-t5` | attempt cap: the one-attempt fleet arm | 5 | fleet `sonnet`, district `bench-h3` | 2 | attempts-1 | not recorded |
| `h3-baseline-sonnet-t5` | attempt cap: the baseline fleet arm | 5 | fleet `sonnet`, district `bench-h3` | 2 | base | not recorded |
| `h4-craft-sonnet-t5` | knowledge: three craft skills mounted | 5 | fleet `sonnet`, district `bench-h4` | 2 | with-craft-skills | `2026-09-08-bench-h4-craft-skills-t5` |
| `held-out-sonnet-all` | held-out reliability estimate | held-out | fleet `sonnet`, district `bench-held-out` | 3 | base | `2026-09-08-bench-held-out-sonnet-all` |

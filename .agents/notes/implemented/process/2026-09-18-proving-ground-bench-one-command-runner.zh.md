# Agent Note: One command for the Proving Ground bench

Status: implemented

[English](2026-09-18-proving-ground-bench-one-command-runner.md) | 中文

## Problem

Proving Ground bench（`examples/headless-agent/tests/fixtures/proving-ground-bench/`）过去只能靠手打的命令运行，例如 `node_modules/.bin/tsx .../experiment-driver.ts .../overlays/with-spawn.cordis.yml plan.json`，从操作者手动建的一个临时目录里启动，针对的还是一份放在仓库之外的计划文件。这样一份计划既进不了 pull request 的审阅，第二个人也复现不了它，除非先自己弄清楚这份计划的形状要用哪个驱动、`spawn` 实现者或尝试上限的 overlay 要选哪个、运行的会话存储又该放在哪里。

## Decision

程序跑过的每一份计划都作为 fixture 入库到 `examples/headless-agent/tests/fixtures/proving-ground-bench/plans/*.json`，从操作者的工作副本逐字节复制而来，并配一份 `plans/README.md`（连同它的中文对照）说明每份计划比较的是什么、它的层、arms 与种子、需要哪个 overlay，以及它在有记录时产生的是哪次记录。

`scripts/proving-ground.ts` 就是这一条命令，以 `pnpm run bench -- <subcommand> …` 运行。`plans` 与 `environments` 列出可用的东西。`fleet`/`experiment` 解析一份计划（按已入库的名字或按路径）和一个可选的 `--overlay` 名字（对应 `overlays/*.cordis.yml`），建立 `.proving-ground/runs/<plan>-<UTC timestamp>/`（已加入 .gitignore）或给定的 `--out`，把计划复制过去存为 `plan.json`，往 `run.log` 追加一行 banner，再从那个目录原样运行既有的 `fleet-driver.ts`/`experiment-driver.ts`，把它们的输出实时打到终端并同时写进日志。`fold`、`record`、`summarize`、`census` 与 `admit` 把各自的参数原样转发给既有的 `fold-driver.ts` 和 `data/proving-ground/tools/*.mjs`。`plans`、`environments`、`fleet`、`experiment` 与 `admit` 上的 `--fixture <name>` 会改为针对另一个 bench fixture 的 `plans/`、`overlays/`、`cordis.yml` 与准入脚本来解析同样的名字，另一个就是 [polyglot bench](../../proposed/architecture/2026-09-22-polyglot-bench-public-comparability.md)；驱动对每个 fixture 都是这个 fixture 的驱动，因为它们读取的是交给它们的组合。这个脚本只管路径解析、参数校验、banner 和进程执行；没有任何驱动、工具或评分逻辑搬进它里面，所以一份临时的计划文件或手写的组合仍然可以像以前一样，直接调用驱动来运行。

`environments --tier`/`--held-out` 只是把 `registry-driver.ts` 自己打印的 JSON 收窄到该参数问的那个汇总字段，因为驱动的汇总里只有按层与按 held-out 的计数，没有按环境列出层或 heldOut 的清单可供过滤；两个参数一起给出时，各自独立报告两个计数，而不是二者的交集——没有哪个字段能回答交集。

## Alternatives considered

- **让每个驱动自己实现这些 CLI 便利（按名字找计划、`--overlay`、一个默认的输出目录）。** 拒绝：同样的路径解析与 banner 逻辑就会在 `fleet-driver.ts`、`experiment-driver.ts`、`fold-driver.ts` 以及四个 `data/proving-ground/tools/*.mjs` 脚本里各自重复一份、各自维护一份，而一个包装脚本能把它统一放在一处，每个驱动仍然完全是它自己 `boot()` 调用原来期望的样子。
- **给 registry 列表加上按环境的层与 heldOut 明细，好让 `--tier`/`--held-out` 能过滤 `ids`。** 就这次改动而言拒绝：这会为了一个 CLI 上的便利，去扩大 `registry-driver.ts` 自己的输出——而这个输出也是那个 keyless 的 registry 冒烟测试所断言的对象；驱动已经打印的汇总计数已经回答了这两个参数真正问的问题——有多少个——用不着去动那份输出。
- **把运行目录留在 fixture 目录树下、交给 git 跟踪，而不是放进一个被 git 忽略的 `.proving-ground/`。** 拒绝：一个运行目录装的是会话日志、一份 observatory 页面和导出文件，这正是 `data/proving-ground/` 自己的记录流程（`record-run.mjs`）该管的事；把临时的运行塞进一个被跟踪的 fixture 目录，会让每一次本地运行都挂在 `git status` 里，直到它被记录或者手动删掉为止。

## Consequences

- 只要有一个已登录的 `claude` CLI 并装好该产品，一个人就能运行 `pnpm run bench -- fleet <plan>` 或 `pnpm run bench -- experiment <plan>`，不用别的准备，也不需要 `DEEPSEEK_API_KEY`；`data/proving-ground/README.md` 的“运行 bench”一节写出了这些命令。
- 程序测量过的每一份计划现在都能像其他 fixture 一样比对差异、接受审阅；加一份新计划也用同样的办法，作为一份已入库的 JSON 文件加进去，`plans/README.md` 也随之多一行。
- 这个包装脚本是继每个驱动自己的头部注释之后，第二个说明计划文件字段与 overlay 选择规则的地方；`bench plans` 与 `plans/README.md` 都读同一份 JSON，而不是各自手写一遍，这正是让两份描述不至于走样的原因。

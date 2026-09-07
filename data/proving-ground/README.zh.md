# Proving Ground 运行记录

[English](README.md) | 中文

真实 Proving Ground 运行的记录：该区对一个实现者（implementer）在已注册环境上的经认证测量，完全按 harness 折叠和导出的原样保存。一个运行目录就是一次 fleet 计划的输出：cell 会话日志、导出的会话事实、经 curator 把关的 trajectory 导出、observatory 快照与页面、驱动器的报告，以及带有每个文件摘要的 manifest。运行目录中的任何内容在运行之后都不再编辑；下表由这些文件读出。

## Layout

```
data/proving-ground/
  <date>-<implementer>-run-<n>/
    manifest.json        repository head, composition, implementer, session ids, per-file bytes and SHA-256
    result.json          the driver's report: fleet report, delegation records, export reports, observatory document
    facts.jsonl          scorekeeper facts, one per cell session
    trajectories.jsonl   curator-gated trajectory export, one per exported session
    observatory.json     the observatory snapshot the page was rendered from
    observatory.html     the rendered observatory page
    sessions/            the cell session logs, one JSONL file per cell, named by session id
```

## 运行一次

一次运行是 `examples/headless-agent/tests/fixtures/` 下的一个由 Loader 启动的组合，从仓库之外的一个空目录驱动；驱动器在那里创建会话存储，并把导出写在它旁边。第一次运行使用了下面的组合，以宿主机自己的 Claude Code 安装和账户作为每个 cell 的实现者：

```sh
mkdir -p /tmp/proving-ground-run && cd /tmp/proving-ground-run
REPO=/path/to/deepseek-harness
TSX_TSCONFIG_PATH=$REPO/tsconfig.json node --import $REPO/node_modules/tsx/dist/esm/index.mjs $REPO/examples/headless-agent/tests/fixtures/village-claude-implementer/driver.ts $REPO/examples/headless-agent/tests/fixtures/village-claude-implementer/cordis.yml > stdout.jsonl
```

然后记录它：该工具把导出、每份会话日志和驱动器的结果复制到一个新的运行目录，写出带有仓库 head、组合、从运行 stamp 读出的实现者以及每个文件摘要的 `manifest.json`，并拒绝覆盖已记录的运行；之后再在下表中加一行：

```sh
node data/proving-ground/tools/record-run.mjs /tmp/proving-ground-run 2026-09-06-claude-code-run-2 --composition examples/headless-agent/tests/fixtures/village-live/cordis.yml
```

实时区（`examples/headless-agent/tests/fixtures/village-live/`）以同样方式从其驱动器运行所在的目录记录，每个时槽一个运行目录：班次账本会话与 cell 会话并排落地，`result.json` 保存驱动器的状态。

## 一行证明了什么

一个被委托的 cell 的证书证明：runner 在任何工作开始之前就编写了标准，在外部 agent 留下的目录树上从 fixture 恢复了不可变路径，确认由检查拥有的文件集未被改动，并亲自运行了检查。它不证明工作是如何完成的：外部 agent 的提示、工具调用和推理都留在它自己的产品里，因此 cell 会话只保存 stamp、标准、委托记录、运行和证书，而没有任何助手轮次。导出的 trajectory 因此不含任何步骤。它是一次测量，而不是训练数据，stamp 上的 `implementer` 字段就是经策展的导出所要过滤的依据。[外部实现者说明](../../.agents/notes/proposed/architecture/2026-09-06-external-implementer.md)拥有这些规则。

## 运行列表

| 运行 | Head | 实现者 | 环境 | 已认证 | 尝试次数 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| [2026-09-06-claude-code-run-1](2026-09-06-claude-code-run-1/manifest.json) | `0f67c1759` | `claude-code` | `smoke:round-trip` | 是 | 1 | 两个 cell 共 351 s |
| [2026-09-06-claude-code-run-1](2026-09-06-claude-code-run-1/manifest.json) | `0f67c1759` | `claude-code` | `smoke:unsatisfiable` | 否 | 2 | 两个 cell 共 351 s |
| [2026-09-06-claude-code-run-2](2026-09-06-claude-code-run-2/manifest.json) | `88f6a1f2e` | `claude-code` | `code:slugify` | 是 | 1 | 该时槽共 54 s |
| [2026-09-06-claude-code-run-2](2026-09-06-claude-code-run-2/manifest.json) | `88f6a1f2e` | `claude-code` | `code:parse-duration` | 是 | 1 | 该时槽共 54 s |
| [2026-09-06-claude-code-run-2](2026-09-06-claude-code-run-2/manifest.json) | `88f6a1f2e` | `claude-code` | `code:paginate-fix` | 是 | 1 | 该时槽共 54 s |
| [2026-09-07-claude-code-live-night](2026-09-07-claude-code-live-night/manifest.json) | `88f6a1f2e` 至 `38dd04165` | `claude-code` | `code:slugify` | 22 之 22 | 各 1 | 22 个时槽，每个 45 至 90 s |
| [2026-09-07-claude-code-live-night](2026-09-07-claude-code-live-night/manifest.json) | `88f6a1f2e` 至 `38dd04165` | `claude-code` | `code:parse-duration` | 22 之 22 | 各 1 | 22 个时槽，每个 45 至 90 s |
| [2026-09-07-claude-code-live-night](2026-09-07-claude-code-live-night/manifest.json) | `88f6a1f2e` 至 `38dd04165` | `claude-code` | `code:paginate-fix` | 22 之 22 | 各 1 | 22 个时槽，每个 45 至 90 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code`（产品自身循环） | `code:csv-codec` | 2 之 2 | 各 1 | 162 与 166 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code`（产品自身循环） | `code:glob-match` | 2 之 2 | 各 1 | 318 与 406 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code`（产品自身循环） | `code:interval-ops` | 2 之 2 | 各 1 | 59 与 63 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code`（产品自身循环） | `code:path-normalize` | 2 之 2 | 各 1 | 94 与 100 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code`（产品自身循环） | `code:stable-sort-by` | 2 之 2 | 各 1 | 91 与 100 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code`（产品自身循环） | `code:table-format` | 2 之 2 | 各 1 | 184 与 189 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:dep-resolver` | 2 之 2 | 各 1 | 181 与 183 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:double-entry-ledger` | 2 之 2 | 各 1 | 134 与 182 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:expr-eval` | 2 之 2 | 各 1 | 215 与 287 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:json-patch` | 2 之 2 | 各 1 | 312 与 389 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:order-lifecycle` | 2 之 2 | 各 1 | 122 与 193 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:priority-queue` | 2 之 2 | 各 1 | 149 与 157 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:trie-index` | 2 之 2 | 各 1 | 71 与 95 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:union-find-rollback` | 2 之 2 | 各 1 | 147 与 187 s |
| [2026-09-07-bench-h1-product-loop-t3](2026-09-07-bench-h1-product-loop-t3/manifest.json) | `0253e1505` | `claude-code`（产品自身循环） | `code:url-template` | 2 之 2 | 各 1 | 324 与 342 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:bitset-bloom` | 2 之 2 | 各 1 | 79 与 84 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:cron-next` | 2 之 2 | 各 1 | 124 与 163 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:job-scheduler` | 2 之 2 | 各 1 | 117 与 148 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:markdown-inline` | 2 之 2 | 各 1 | 103 与 126 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:query-string` | 2 之 2 | 各 1 | 145 与 216 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:shell-words` | 2 之 2 | 各 1 | 65 与 103 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:template-engine` | 2 之 2 | 各 1 | 58 与 73 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:text-diff` | 2 之 2 | 各 1 | 120 与 142 s |
| [2026-09-07-bench-h1-product-loop-t4](2026-09-07-bench-h1-product-loop-t4/manifest.json) | `c15a4e944` | `claude-code`（产品自身循环） | `code:token-bucket` | 2 之 2 | 各 1 | 191 与 235 s |

第六份记录完成了产品自身循环对整个基准的一遍运行：未被保留的九个第 4 层环境，十八个单元，每个都在一次尝试内获得认证，每个单元 58 至 235 s，同时运行两个单元共用时 1151 s。第 4 层交给实现者的是一个带有预埋缺陷的现成模块和一套不可变的测试，因此其单元比第 3 层更快。三次舰队合计，产品自身循环以每个一次尝试认证了 48 之 48 个单元，因此就证书而言，这个基准在任何层上都无法为这个产品模型区分实现者；基准的下一个切片是更高的一层与六个保留环境，而在此之下的每一项比较都读取尝试次数、墙上时间和花费。

第五份记录是同一份舰队计划在未被保留的九个第 3 层环境上的运行：十八个单元，每个都在一次尝试内获得认证，每个单元 71 至 389 s，同时运行两个单元共用时 1844 s。因此在这个基准上，第 3 层对产品自身循环同样是天花板；只计数证书的比较在第 4 层以下无法区分实现者，在这些层上能够区分的度量是尝试次数、墙上时间和花费，其中委派记录已保存前两项，排队中的切片落地后将保存子进程报告的花费。

第四份记录是 Proving Ground 基准（`examples/headless-agent/tests/fixtures/proving-ground-bench/`，三十个已通过准入的程序任务）的第一次舰队运行：每个单元都由产品自身的循环实现，覆盖未被保留的六个第 2 层环境，每个重复两次，种子 1，策略 `bench-2026-09-07`，区 `bench-h1`，同时运行两个单元，十二个单元共用时 984 s。每个单元都在一次尝试内获得认证，因此第 2 层对这个实现者而言是天花板，harness 循环与产品循环之间的配对比较在第 3 层和第 4 层进行。单元上标注的模型是 `sonnet`；由于委派尚未把单元的模型转发给子进程（转发它并记录子进程所报告模型的切片已排入队列），产品运行的是安装的默认模型，该默认值在运行前被测得为 sonnet。基准的组合与任务对应提交 `128e037bb`；清单记录的是记录时工作树的头部。

第三份记录是同一个区整夜运行的结果：从 22:16 到 09:16 UTC，按三十分钟的节奏运行了 22 个时槽，其中包括第二份记录所保存的第一个时槽。宿主机重启过一次；应在 00:16 开启的时槽没有被补跑，与班次驱动器的节奏规则所述完全一致，重新启动的进程从 00:46 起在当时的工作树上沿用同一份账本和同一节奏继续，因此重启前的时槽运行的是 `88f6a1f2e` 处的树，重启后的时槽运行的是 `38dd04165` 处的树，manifest 记录的 head 即为后者。66 个 cell 全部在一次尝试内获得认证；该记录保存了全部 22 份班次账本、66 个 cell 会话，以及在它们之上折叠出的导出。

第二次运行是实时区在修复了它自己暴露出的两个缺陷之后的第一个时槽：一个被此版本 Node 拒绝的测试检查，以及一个在验证前把整个 fixture 覆盖回去、从而丢弃了对 fixture 所提供源文件的一切改动的 runner。三个各自带有不可变测试套件的程序任务，由该产品各以一次尝试实现，并由 runner 在它留下的目录树上认证；被留出的任务从未进入计划。

第一次运行是 Proving Ground 首次测量 harness 自身以外的 agent：两个 smoke 环境处于 `isolation: none`，每次尝试一个子运行并记录为 `environment/delegation`，每次委托都以 `completed` 结束，两个会话的事实都已导出，两条 trajectory 都经 curator 导出且其中一条获得奖励，observatory 在 `claude-code` 实现者下发布了两行，已认证的那一行以 `runner` 作为证书执行者。

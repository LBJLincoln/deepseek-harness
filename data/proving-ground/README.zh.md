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
| [2026-09-07-bench-smoke-harness-loop](2026-09-07-bench-smoke-harness-loop/manifest.json) | `8761758fa` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:interval-ops` | 1 之 1 | 1 | 41 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:dep-resolver` | 2 之 2 对 2 之 2 | 各 1 | 108、157 s 对 172、152 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:double-entry-ledger` | 2 之 2 对 2 之 2 | 各 1 | 71、73 s 对 163、217 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:expr-eval` | 2 之 2 对 2 之 2 | 各 1 | 157、266 s 对 325、290 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:json-patch` | 2 之 2 对 2 之 2 | 各 1 | 782、404 s 对 359、363 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:order-lifecycle` | 2 之 2 对 2 之 2 | 各 1 | 211、250 s 对 157、164 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:priority-queue` | 2 之 2 对 2 之 2 | 各 1 | 122、160 s 对 153、179 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:trie-index` | 2 之 2 对 2 之 2 | 各 1 | 59、74 s 对 81、110 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:union-find-rollback` | 2 之 2 对 2 之 2 | 各 1 | 175、164 s 对 147、238 s |
| [2026-09-07-bench-e2-harness-vs-product-t3](2026-09-07-bench-e2-harness-vs-product-t3/manifest.json) | `f07b6614a` | `route` 对 `claude-code`（产品自身循环），两侧均为 `sonnet` | `code:url-template` | 2 之 2 对 2 之 2 | 各 1 | 283、461 s 对 383、354 s |

| [2026-09-07-bench-h1-harness-loop-t2](2026-09-07-bench-h1-harness-loop-t2/manifest.json) | `e608c8502` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:csv-codec` | 2 之 2 | 各 1 | 152 与 116 s |
| [2026-09-07-bench-h1-harness-loop-t2](2026-09-07-bench-h1-harness-loop-t2/manifest.json) | `e608c8502` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:glob-match` | 2 之 2 | 各 1 | 481 与 261 s |
| [2026-09-07-bench-h1-harness-loop-t2](2026-09-07-bench-h1-harness-loop-t2/manifest.json) | `e608c8502` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:interval-ops` | 2 之 2 | 各 1 | 37 与 38 s |
| [2026-09-07-bench-h1-harness-loop-t2](2026-09-07-bench-h1-harness-loop-t2/manifest.json) | `e608c8502` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:path-normalize` | 2 之 2 | 各 1 | 84 与 52 s |
| [2026-09-07-bench-h1-harness-loop-t2](2026-09-07-bench-h1-harness-loop-t2/manifest.json) | `e608c8502` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:stable-sort-by` | 2 之 2 | 各 1 | 172 与 75 s |
| [2026-09-07-bench-h1-harness-loop-t2](2026-09-07-bench-h1-harness-loop-t2/manifest.json) | `e608c8502` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:table-format` | 2 之 2 | 各 1 | 109 与 209 s |

| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:bitset-bloom` | 2 之 2 | 各 1 | 176 与 74 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:cron-next` | 2 之 2 | 各 1 | 176 与 122 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:job-scheduler` | 2 之 2 | 各 1 | 122 与 175 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:markdown-inline` | 2 之 2 | 各 1 | 174 与 86 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:query-string` | 2 之 2 | 各 1 | 293 与 182 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:shell-words` | 2 之 2 | 各 1 | 106 与 68 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:template-engine` | 2 之 2 | 各 1 | 97 与 137 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:text-diff` | 2 之 2 | 各 1 | 255 与 216 s |
| [2026-09-07-bench-h1-harness-loop-t4](2026-09-07-bench-h1-harness-loop-t4/manifest.json) | `88ffa9d08` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:token-bucket` | 2 之 2 | 各 1 | 252 与 204 s |

| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:build-schedule` | 2 之 2 | 各 1 | 560 与 391 s |
| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:conf-canon` | 0 之 2 | 各 3，用例 146 之 150 | 1288 与 1235 s，突破墙上时间预算 |
| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:diff3-merge` | 2 之 2 | 各 2 | 337 与 296 s |
| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:lex-states` | 1 之 2 | 2 与 3，未过者停在用例 159 之 160 | 497 与 1136 s |
| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:ranked-choice` | 2 之 2 | 各 1 | 219 与 177 s |
| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:rate-limit-sim` | 2 之 2 | 各 1 | 490 与 599 s |
| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:sheet-eval` | 0 之 2 | 各 3，可见测试套件未通过 | 1293 与 1289 s，突破墙上时间预算 |
| [2026-09-08-bench-h1-harness-loop-t5](2026-09-08-bench-h1-harness-loop-t5/manifest.json) | `5bf1520dd` | `route`（harness 循环，走 `claude-code`/`sonnet`） | `code:uri-resolve` | 2 之 2 | 各 1 | 226 与 150 s |

| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:build-schedule` | 2 之 2 | 各 1 | 555 与 333 s |
| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:conf-canon` | 0 之 2 | 各 3，用例 144 之 150 | 1304 与 3459 s |
| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:diff3-merge` | 2 之 2 | 各 1 | 310 与 406 s |
| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:lex-states` | 1 之 2 | 1 与 3，未过者停在用例 158 之 160 | 320 与 1918 s |
| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:ranked-choice` | 2 之 2 | 各 1 | 327 与 232 s |
| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:rate-limit-sim` | 2 之 2 | 各 1 | 337 与 312 s |
| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:sheet-eval` | 0 之 2 | 各 3，用例 147 与 148 之 150 | 3234 与 2152 s |
| [2026-09-08-bench-h1-product-loop-t5](2026-09-08-bench-h1-product-loop-t5/manifest.json) | `2d3ba5f10` | `claude-code`（产品自身循环，报告为 `claude-sonnet-5`） | `code:uri-resolve` | 2 之 2 | 各 1 | 435 与 373 s |

| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:dep-resolver` | 2 之 2 对 2 之 2 | 各 1 | 293、207 s 对 323、205 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:double-entry-ledger` | 2 之 2 对 2 之 2 | 各 1 | 54、68 s 对 309、290 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:expr-eval` | 2 之 2 对 2 之 2 | 各 1 | 149、175 s 对 702、1028 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:json-patch` | 2 之 2 对 2 之 2 | 各 1 | 422、490 s 对 258、455 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:order-lifecycle` | 2 之 2 对 2 之 2 | 各 1 | 243、269 s 对 295、110 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:priority-queue` | 2 之 2 对 2 之 2 | 各 1 | 107、94 s 对 207、300 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:trie-index` | 2 之 2 对 2 之 2 | 各 1 | 61、67 s 对 169、184 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:union-find-rollback` | 2 之 2 对 2 之 2 | 各 1 | 216、143 s 对 198、338 s |
| [2026-09-08-bench-e1-haiku-vs-sonnet-t3](2026-09-08-bench-e1-haiku-vs-sonnet-t3/manifest.json) | `c88ddc3d1` | `route`，`sonnet` 对 `haiku` | `code:url-template` | 2 之 2 对 2 之 2 | 各 1 | 349、400 s 对 691、657 s |

第十三份记录是第二个冻结配对实验，即 harness 循环上的模型层级比较：同样九个第 3 层环境，每个重复两次，以较小的产品模型为候选臂、中等模型为基线臂，共 36 个单元，用时 5,437 s。两臂都以第一次尝试认证了 18 之 18 个单元，因此差值再次为 0，区间为 [0, 0]，结论为不确定：就这一层的证书而言，较小的模型并不更差。其他一切都把两个层级区分开来：较小的模型需要 405 个模型步骤（对方 182），单元用时合计 6,719 s（对方 3,807，单元中位数 300 s 对 207 s），输出 token 844,538 个（对方 358,054），缓存写入 token 9,985,537 个（对方 3,070,990）。与第八份记录合读，就证书而言，基准的第 3 层对这三个产品模型在两种循环下都已饱和，模型之间与循环之间的差异体现在步骤、墙上时间与花费上。

第十二份记录是产品自身循环在同样八个第 5 层环境上的运行，也是第一个其单元携带子进程所报告模型、用量与费用的委派舰队：十六个单元，11 个获认证，每张证书都在第一次尝试取得，同时运行两个单元共用时 8,139 s，报告的输出 token 为 1,300,589 个，报告的按目录价计算的费用为 31.48 美元。证书落点与第十一份记录中 harness 循环完全一致：同样六个环境各认证两次，lex-states 一次，conf-canon 与 sheet-eval 从未认证，且未过之处停在同样的角落（conf-canon 每次尝试都停在 144 之 150，harness 循环为 146；lex-states 158 之 160，对方为 159），这既指向两种实现者，也同样指向这些角落的规范本身。两者在其他方面有差异：harness 循环需要三次第二次尝试之处，产品自身循环一次也不需要；其获认证单元用时 232 至 555 s，harness 循环为 150 至 599 s；其未过单元不受上限约束，最长运行 3,459 s、单个花费 5.60 美元，因为组合的墙上时间上限只约束 harness 自己的步骤（预算对等切片已排入队列），而 harness 循环的未过单元在 1,200,000 ms 上限处被截断。harness 循环的 16 个单元花费 860,596 个输出 token，产品自身循环为 1,300,589 个；harness 循环有 4,778,361 个缓存写入 token，而产品自身循环的用量以缓存读取为主。

第十一份记录是 harness 循环在第 5 层上的运行，这一层由实现者永远看不到的用例来裁定：未被保留的八个第 5 层环境，十六个单元，11 个获认证（8 个在第一次尝试，3 个在第二次），同时运行两个单元共用时 5,117 s，平均每个单元 16.9 个模型步骤，860,596 个输出 token，745,264 个缓存读取与 4,778,361 个缓存写入 token。这一层能够区分：五次未过分为两类。三次是聚类指令没有把模型引向的规范角落（conf-canon 两次都在每次尝试停在 146 之 150 个用例，四个失败全在 stderr 通道；lex-states 一次在每次尝试停在 159 之 160）。两次是预算耗尽：在 sheet-eval 上，第一次尝试在写出非常大的模块时就已超过组合的 1,200,000 ms 墙上时间上限；在 conf-canon 上，第一次尝试在达到 146 之 150 之后同样如此，于是预算策略在模型能够依据指令行动之前就阻止了其余尝试。路由的每步成本在两类情形中都可见：每一步都是一个新的产品会话，突破墙上时间上限的两次未过在第一次尝试中分别花了 12 步与 35 步。

第十份记录完成了 harness 循环对第 2 至 4 层的一遍运行：九个第 4 层环境，十八个单元，每个都在一次尝试内获得认证，每个单元 68 至 293 s，中位数 175 s，同时运行两个单元共用时 1467 s，平均每个单元 13.2 个模型步骤，214,397 个输出 token，655,134 个缓存读取与 4,024,446 个缓存写入 token。在这一层上产品自身循环是更快的实现者：与第六份记录逐单元对照，harness 循环在 18 对中只有 6 对更快，其单元合计用时 2915 s，对方为 2292 s。第 4 层交给实现者的是一个带预埋缺陷的模块，harness 循环在其上花费的短步骤比其他层更多；而每一步都是一个新的产品进程，把整个前缀重新写入缓存，墙上时间与缓存写入 token 都耗在这里。三层合计，两种实现者都以每个一次尝试认证了 48 之 48 个单元，harness 循环在第 2、3 层更快，在第 4 层更慢。

第九份记录是 harness 循环在第四份记录用产品自身循环测过的同六个第 2 层环境上的舰队运行：十二个单元，每个都在一次尝试内获得认证，每个单元 37 至 481 s，中位数 116 s，同时运行两个单元共用时 979 s，平均每个单元 7.6 个模型步骤，158,899 个输出 token，255,502 个缓存读取与 884,168 个缓存写入 token。与第四份记录逐单元对照（同一环境与同一重复，但来自不同舰队而非同一个冻结计划），harness 循环在 12 对中的 9 对更快，其单元合计用时 1786 s，产品自身循环为 1932 s。

第八份记录是假设计划的第一个冻结配对实验（摘要 `4c9659e3…`）：以 harness 自身在 Claude Code 路由上的循环为基线臂，以产品自身的循环为候选臂，两侧使用同一个模型，覆盖未被保留的九个第 3 层环境，每个重复两次，种子 1，共 36 个单元，同时运行两个单元共用时 4194 s。两臂都以每个一次尝试认证了 18 之 18 个单元，因此证书率之差为 0，自助区间为 [0, 0]，在 0.05 的最小差值下结论为不确定：在这一层上，就证书而言 harness 循环既不优于也不劣于产品循环，这驳斥了"harness 循环在这些任务上输给产品循环"的假设，也不支持"它胜出"的假设。墙上时间同样持平：harness 循环在 18 对中的 11 对更快，其单元中位数为 164 s，对方为 179 s，两臂总计相差不到百分之一。harness 循环的花费有据可查，因为它的查询经过 harness：200 次查询共 352,494 个输出 token 与 553,676 个缓存读取 token，但缓存写入 token 达 3,005,288 个，因为每次查询都新开一个产品会话，其前缀被再次写入缓存而不是从缓存读取；产品循环每个单元只保持一个会话，这笔开销只付一次。产品臂的花费不在这份记录中：把单元模型转发给子进程并记录其报告用量与费用的切片是在运行开始后才合并的（清单的头部包含它，运行本身不包含），因此下一个配对实验将同时记录两臂的花费。

第七份记录是 harness 自身的循环在 Claude Code 路由上认证的第一个单元，紧接在该路由开始以原生方式提供 harness 工具之后：五次模型查询，五次工具调用（探索、读测试、读桩、写模块、跑测试套件），没有重试，一次验证，从标记到证书 41 s，输出 2580 个 token。同一个环境在第四份记录中由产品自身循环完成用了 59 与 63 s。在这次路由变更之前，同一个单元的每次查询都在产品的轮次上限处失败，该路由的说明记录了这一点。

第六份记录完成了产品自身循环对整个基准的一遍运行：未被保留的九个第 4 层环境，十八个单元，每个都在一次尝试内获得认证，每个单元 58 至 235 s，同时运行两个单元共用时 1151 s。第 4 层交给实现者的是一个带有预埋缺陷的现成模块和一套不可变的测试，因此其单元比第 3 层更快。三次舰队合计，产品自身循环以每个一次尝试认证了 48 之 48 个单元，因此就证书而言，这个基准在任何层上都无法为这个产品模型区分实现者；基准的下一个切片是更高的一层与六个保留环境，而在此之下的每一项比较都读取尝试次数、墙上时间和花费。

第五份记录是同一份舰队计划在未被保留的九个第 3 层环境上的运行：十八个单元，每个都在一次尝试内获得认证，每个单元 71 至 389 s，同时运行两个单元共用时 1844 s。因此在这个基准上，第 3 层对产品自身循环同样是天花板；只计数证书的比较在第 4 层以下无法区分实现者，在这些层上能够区分的度量是尝试次数、墙上时间和花费，其中委派记录已保存前两项，排队中的切片落地后将保存子进程报告的花费。

第四份记录是 Proving Ground 基准（`examples/headless-agent/tests/fixtures/proving-ground-bench/`，三十个已通过准入的程序任务）的第一次舰队运行：每个单元都由产品自身的循环实现，覆盖未被保留的六个第 2 层环境，每个重复两次，种子 1，策略 `bench-2026-09-07`，区 `bench-h1`，同时运行两个单元，十二个单元共用时 984 s。每个单元都在一次尝试内获得认证，因此第 2 层对这个实现者而言是天花板，harness 循环与产品循环之间的配对比较在第 3 层和第 4 层进行。单元上标注的模型是 `sonnet`；由于委派尚未把单元的模型转发给子进程（转发它并记录子进程所报告模型的切片已排入队列），产品运行的是安装的默认模型，该默认值在运行前被测得为 sonnet。基准的组合与任务对应提交 `128e037bb`；清单记录的是记录时工作树的头部。

第三份记录是同一个区整夜运行的结果：从 22:16 到 09:16 UTC，按三十分钟的节奏运行了 22 个时槽，其中包括第二份记录所保存的第一个时槽。宿主机重启过一次；应在 00:16 开启的时槽没有被补跑，与班次驱动器的节奏规则所述完全一致，重新启动的进程从 00:46 起在当时的工作树上沿用同一份账本和同一节奏继续，因此重启前的时槽运行的是 `88f6a1f2e` 处的树，重启后的时槽运行的是 `38dd04165` 处的树，manifest 记录的 head 即为后者。66 个 cell 全部在一次尝试内获得认证；该记录保存了全部 22 份班次账本、66 个 cell 会话，以及在它们之上折叠出的导出。

第二次运行是实时区在修复了它自己暴露出的两个缺陷之后的第一个时槽：一个被此版本 Node 拒绝的测试检查，以及一个在验证前把整个 fixture 覆盖回去、从而丢弃了对 fixture 所提供源文件的一切改动的 runner。三个各自带有不可变测试套件的程序任务，由该产品各以一次尝试实现，并由 runner 在它留下的目录树上认证；被留出的任务从未进入计划。

第一次运行是 Proving Ground 首次测量 harness 自身以外的 agent：两个 smoke 环境处于 `isolation: none`，每次尝试一个子运行并记录为 `environment/delegation`，每次委托都以 `completed` 结束，两个会话的事实都已导出，两条 trajectory 都经 curator 导出且其中一条获得奖励，observatory 在 `claude-code` 实现者下发布了两行，已认证的那一行以 `runner` 作为证书执行者。

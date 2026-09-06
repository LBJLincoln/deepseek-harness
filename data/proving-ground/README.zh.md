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

第二次运行是实时区在修复了它自己暴露出的两个缺陷之后的第一个时槽：一个被此版本 Node 拒绝的测试检查，以及一个在验证前把整个 fixture 覆盖回去、从而丢弃了对 fixture 所提供源文件的一切改动的 runner。三个各自带有不可变测试套件的程序任务，由该产品各以一次尝试实现，并由 runner 在它留下的目录树上认证；被留出的任务从未进入计划。

第一次运行是 Proving Ground 首次测量 harness 自身以外的 agent：两个 smoke 环境处于 `isolation: none`，每次尝试一个子运行并记录为 `environment/delegation`，每次委托都以 `completed` 结束，两个会话的事实都已导出，两条 trajectory 都经 curator 导出且其中一条获得奖励，observatory 在 `claude-code` 实现者下发布了两行，已认证的那一行以 `runner` 作为证书执行者。

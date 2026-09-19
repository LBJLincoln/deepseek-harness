# csv-tools: a program that builds software

[English](README.md) | 中文

一个交付物是可运行命令行而不是文档的[程序](../../../../../packages/improvement/program/README.md)：三个部门各自在自己的分支与会话上，依据一份书面规格构建 `csv-tools` 的一个子命令，再由整合针对一套在任何部门启动之前就已提交的测试套件为合并后的 head 签发证书。2026-09-08 的[自评估程序](../../../../../data/proving-ground/README.md)只运行了一个部门并产出 Markdown；本 fixture 是同一套工作流产出一个程序，而它为何是这个形态，由这篇 [Agent Note](../../../../../.agents/notes/implemented/process/2026-09-19-program-workflow-builds-software.md) 记录。

## 它交付什么

`csv-tools` 是一个零依赖的 Node.js 命令行，带三个子命令：`stats`（数值列的逐列计数、最小值、最大值与均值）、`filter`（指定列与某个运算符和取值相匹配的那些行）以及 `join`（两个文件按指定列做内连接）。[`seed/SPEC.md`](seed/SPEC.md) 就是全部规格——引号规则、表头处理、空输入与畸形输入的行为、退出码以及 stdout/stderr 纪律——也是每个部门首先要读的东西。

程序交付进入的仓库就是 `seed/`，由 driver 提交并打上 `base` 标签：规格、`bin/csv-tools.js`、`package.json` 与 `test/`。那里再没有别的东西，因此发布树中的每一个源文件都由某个部门写成。

| 部门 | 交付 | 由什么测量 |
| --- | --- | --- |
| `stats` | `src/csv.js`（共享的 RFC 4180 读写器）与 `src/stats.js` | `node --test test/csv.test.js test/stats.test.js` |
| `filter` | `src/filter.js` | `node --test test/filter.test.js` |
| `join` | `src/join.js` | `node --test test/join.test.js` |
| 整合 | 不交付任何东西；它负责合并 | `node --test test/*.test.js`，随后两道门禁 |

`filter` 与 `join` 依赖 `stats`，因此在拥有读写器的那个部门持有证书之前，两者都不会启动。但每个 worktree 都从基线版本切出，所以一个部门永远看不到另一个部门的文件：`src/filter.js` 与 `src/join.js` 不 import 任何东西，`bin/csv-tools.js` 是读写器与子命令唯一相遇的地方，而 `test/cli.test.js`——驱动真实命令行的那套套件——也因此只在合并后的 head 上通过，在任何部门分支上都不通过。正是这一点使整合证书成为发布本身。

## 什么才使发布成立

三条规则决定程序可以宣称什么，它们都不是这里新增的。

- **已提交的验证器。** `test/` 在基线提交之中，任何部门都不得改动它；整合在合并后的 head 上把它整套重跑一遍。e2e 会把合并树中的 `SPEC.md`、`bin/csv-tools.js` 与 `test/cli.test.js` 逐字节比对 `seed/`，因此改动了自己考官的部门会在那条断言上失败，而不是让套件通过。
- **要么提交，要么拒绝。** 部门绝不会在携带任何提交都不包含之工作的工作树上被测量。被脚本化的 `join` 部门故意让第一次尝试不提交：程序花掉那一轮，发出 `the worktree carries work that no commit on this branch carries`，并为提交了的那次尝试签发证书。整合把同一条规则带进自己的证书，即 `gate-1`：`test -z "$(git status --porcelain)"`。
- **树摘要。** 每条 `program/goal { status: certified }` 记录都陈述其证书所覆盖的提交与 `HEAD^{tree}`，而整合只在分支仍指向所记录的那次提交时才合并它。e2e 从账本中读出这三个已认证的修订版与树，并断言它们与合并后的 head 不同。

整合会话在运行期间被拒绝访问程序的整个工作树根，因此它工作时读不到任何部门 worktree；无论如何，`program/integration` 都会记录被拒绝了什么。自评估那次运行没有组合屏障，它的整合会话改写了部门已认证的文件——这正是本组合所封堵的缺陷。

## 两份组合

[`cordis.yml`](cordis.yml) 是无密钥的那一半：部门跑在由 [`csv-tools-llm.ts`](csv-tools-llm.ts) 注册的 `cli-mock` 路由上，它读规格、写出提交在 [`scripted/`](scripted/src) 下的那些模块并提交。它证明的是接线——规格被冻结、部门被配备并在已提交的树上被认证、分支被合并、已提交的验证器决定发布——而完全不证明模型能构建出什么。

[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) 是真实的那一份：同一份文件，禁用脚本路由、插入操作者的 Claude Code 安装，并以 `opus` 作为部门的模型。`implementer` 仍是 `route`，因此程序逐轮驱动每个部门，而部门自己的会话持有它所走的每一步。路由不属于规格摘要，因此两次运行是同一组目标上的同一个程序 id。

## 无密钥运行

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-csv-tools.e2e.ts
```

e2e 是 [`examples/headless-agent/tests/program-csv-tools.e2e.ts`](../../program-csv-tools.e2e.ts)。它在一个临时仓库上启动本组合，断言账本、各部门的证书与预算上限、`join` 部门挣来的那条指令、整合的三项通过检查以及发布树的精确文件清单，然后从整合 worktree 中把三个子命令各跑一遍。

## 真实运行

真实运行是同一个 driver 跑在 overlay 上，以脱离启动它的 shell 的方式启动。`$SCRATCHPAD` 是仓库之外的任意目录；driver 会在运行目录下创建仓库、会话存储与它自己的输出。

```sh
REPO=/path/to/deepseek-harness
FIXTURE="$REPO/examples/headless-agent/tests/fixtures/program-csv-tools"
RUN="$SCRATCHPAD/2026-09-19-csv-tools-program"
mkdir -p "$RUN" && cd "$RUN"
DSH_TEST_PROGRAM_REPO="$RUN/repo" \
DSH_TEST_SESSION_ROOT="$RUN/.sessions" \
TSX_TSCONFIG_PATH="$REPO/tsconfig.json" \
  setsid nohup node --import "$REPO/node_modules/tsx/dist/esm/index.mjs" \
    "$FIXTURE/driver.ts" "$FIXTURE/overlays/claude-code.cordis.yml" \
    > "$RUN/stdout.jsonl" 2> "$RUN/stderr.txt" &
```

它需要已安装并已登录的 `claude` CLI，不需要 `DEEPSEEK_API_KEY`。运行期间 `$RUN/.sessions/` 会逐渐填满每个会话一份日志——账本、三个部门和整合——而 driver 会在程序结束时把它唯一的结果行写入 `stdout.jsonl`。

这次运行留下什么——每份会话日志都位于 `$RUN/.sessions/<workspace-slug>/<session id>/session.jsonl`，整合的 key 在其 id 中被百分号转义：

| 产物 | 位置 | 是什么 |
| --- | --- | --- |
| 账本 | `program-<digest>` 会话 | `program/start`、每次状态变更一条 `program/goal`、`program/integration`、`program/end`，以及两个签名 |
| 部门日志 | `program-<digest>-{stats,filter,join}` 会话 | 模型走的每一步、标准、各次运行、各条指令与证书 |
| 验证器输出 | `program-<digest>-~0040integration` 的 `verification/run` 事件 | 每项检查的判定与其有界证据 |
| 整合后的树 | `$RUN/repo/program-<digest>/@integration` | 发布用的 worktree；`git -C "$RUN/repo" ls-tree -r --name-only <mergedRevision>` 列出它携带的内容 |
| driver 的报告 | `$RUN/stdout.jsonl` | 报告、各账本、成员会话、屏障拒绝记录与发布文件清单 |

按其他每次运行的同一方式，在仓库中把它记录到 `data/proving-ground/` 下：

```sh
node data/proving-ground/tools/record-run.mjs "$RUN" 2026-09-19-csv-tools-program \
  --composition examples/headless-agent/tests/fixtures/program-csv-tools/overlays/claude-code.cordis.yml
```

它会把 `stdout.jsonl` 拷成 `result.json`，把每份会话日志拷成 `sessions/<session id>.jsonl`，并写出带仓库 head、组合、从日志折算出的耗时以及每个文件 SHA-256 的 `manifest.json`。它拒绝覆盖已有记录。之后请在[运行表](../../../../../data/proving-ground/README.md)中补一行，并把这次运行暴露出的任何东西——失败的整合、耗尽轮次的部门——原样留在它旁边，而不是反复重跑直到看起来干净。

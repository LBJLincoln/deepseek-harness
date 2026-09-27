# readme-rows: the program builds a tool for this repository

[English](README.md) | 中文

一个交付物是对本仓库的一次修改的[程序](../../../../../packages/improvement/program/README.md)：一个部门在自己的分支与会话上写出 `data/proving-ground/tools/readme-rows.mjs`——为一次已记录的运行打印 [`data/proving-ground/README.md`](../../../../../data/proving-ground/README.md) 中 `## Runs` 表格各行的工具——再由整合针对在部门启动之前就已提交的行为合并后的 head 签发证书。[csv-tools 程序](../program-csv-tools/README.md)依据一份规格构建一个独立的命令行；本程序则把工作流指向仓库自身，而它记录在 [`data/proving-ground/`](../../../../../data/proving-ground/README.md) 下的第一次真实运行证明并暴露了什么，由这篇 [Agent Note](../../../../../.agents/notes/implemented/process/2026-09-27-program-builds-readme-rows.md) 记录。

## 它交付什么

`data/proving-ground/README.md` 及其中文对侧的 `## Runs` 表格为每次已记录运行的每个环境各留一行——每份记录 12 到 62 行，都是手写的。`readme-rows.mjs` 从记录自身的持久文件（`manifest.json`、`result.json`、`facts.jsonl`）打印这些行：

```sh
node data/proving-ground/tools/readme-rows.mjs <record dir> --lang en|zh --implementer "<implementer column text>"
```

fleet 记录为每个模型与环境各打印一行；冻结配对记录为每个环境打印一行，单元格为 `baseline vs candidate`。Implementer 列是每份记录手写的文字，因此由参数传入，其中的 `{model}` 代表该行的模型。[`seed/TASK.md`](seed/TASK.md) 就是全部任务陈述，也是部门首先要读的东西。

程序交付进入的仓库就是 `seed/`，由 driver 提交并打上 `base` 标签——真实运行则是按同一方式准备好的本仓库克隆：任务陈述、`data/proving-ground/tools/summarize-run.mjs`、三份只保留持久文件的记录，以及只装着这些记录的已提交行的 `data/proving-ground/README.md` 与 `README.zh.md`。

| 部门 | 交付 | 由什么测量 |
| --- | --- | --- |
| `readme-rows` | `data/proving-ground/tools/readme-rows.mjs` 与 `readme-rows.test.mjs` | 测试、五项金标比对、`test ! -e node_modules` |
| 整合 | 不交付任何东西；它负责合并 | 再次运行测试与五项金标比对，随后两道门禁 |

五项金标比对把工具打印的行与已提交的行做 diff：`2026-09-26-bench-completion-hidden-pair` 的两种语言（两个模型的 fleet，因此每个模型与环境各一行）、`2026-09-26-bench-completion-t6-haiku` 的英文（26 个环境的 fleet），以及 `2026-09-27-bench-e12-self-review-sonnet-t5t6` 的两种语言（一对冻结配对，每个环境一行）。每项都是一行 shell——`diff <(node … readme-rows.mjs <record> --lang <lang> --implementer '<the record's column>') <(grep -F '| [<record>]' <README>)`——恰在 `diff` 什么都不打印时通过。

## 什么才使发布成立

[csv-tools 程序](../program-csv-tools/README.md#what-certifies-a-release)的三条规则在这里原样成立。行与记录都在基线提交之中，部门不得改动它们，因此考官在工作开始之前就已提交，并由整合在合并后的 head 上重跑；部门只在干净的工作树上被测量，因此未提交的工具不算交付；账本陈述证书所覆盖的提交与 `HEAD^{tree}`，而整合只在分支仍指向那里时才合并它。整合会话在运行期间被拒绝访问程序的整个工作树根，`program/integration` 会记录被拒绝了什么。

一份 route 证书证明了什么，[program README](../../../../../packages/improvement/program/README.md#the-two-implementers) 里有陈述：程序通过 shell 执行器，在部门 worktree 中、在部门提交的树上运行了目标的各项检查，并把这次运行与证书记录在部门自己的会话里。在 `route` implementer 上，那份会话还持有模型走的每一步，因此这个工具是怎么写出来的，就在证书旁边的记录里。

## 两份组合

[`cordis.yml`](cordis.yml) 是无密钥的那一半：部门跑在由 [`readme-rows-llm.ts`](readme-rows-llm.ts) 注册的 `cli-mock` 路由上，它读任务陈述、写出提交在 [`scripted/`](scripted/data/proving-ground/tools) 下的工具与测试，并带着目标要求的两行 trailer 提交。它证明的是接线——规格被冻结、部门被配备并在已提交的树上被认证、分支被合并、已提交的行决定发布——而完全不证明模型能构建出什么。脚本化的文件同时也是参考解：它们通过规格的每一项检查，这正是规格可被满足的证明。

[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) 是真实的那一份：同一份文件，禁用脚本路由、插入操作者的 Claude Code 安装、以 `sonnet` 作为部门的模型，并把部门的上限提高到 8,000,000 个 token，墙钟仍为 1,500 s。`implementer` 仍是 `route`，因此程序逐轮驱动部门，而部门自己的会话持有它所走的每一步。部门的上限就是组合的 `budget-policy` 上限——driver 把它们读进目标的预算，因此它们是配置而不是 driver 里的一个数字——规格摘要覆盖它们但不覆盖路由，因此真实运行是与无密钥运行同一个目标上、有自己 id 的一个程序。

## 无密钥运行

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-readme-rows.e2e.ts
```

e2e 是 [`examples/headless-agent/tests/program-readme-rows.e2e.ts`](../../program-readme-rows.e2e.ts)。它在一个由 `seed/` 铸出的临时仓库上启动本组合，断言账本、部门的证书、预算上限与 trailer 行、整合的检查与门禁、seed 的每个文件在合并树中都未改动、合并树恰为 seed 加上两个交付文件；然后从整合 worktree 中对每项金标运行交付的工具，把它打印的行与已提交的行比对。

## 真实运行

真实运行是同一个 driver 跑在 overlay 上、作用于本仓库的一个克隆，以脱离启动它的 shell 的方式启动。`$SCRATCHPAD` 是仓库之外的任意目录。克隆按 driver 准备 `seed/` 的方式准备——任务陈述提交在其 head 上，并给那次提交打上 `base` 标签——因为部门首先读 `TASK.md`，而程序从该标签切出它的 worktree；准备方式不同的克隆会被 driver 拒绝。

```sh
REPO=/path/to/deepseek-harness
FIXTURE="$REPO/examples/headless-agent/tests/fixtures/program-readme-rows"
RUN="$SCRATCHPAD/2026-09-27-readme-rows-program"
mkdir -p "$RUN"
git clone --quiet --branch "$(git -C "$REPO" branch --show-current)" "$REPO" "$RUN/repo"
cp "$FIXTURE/seed/TASK.md" "$RUN/repo/TASK.md"
git -C "$RUN/repo" add TASK.md
git -C "$RUN/repo" commit -qm 'readme-rows: the task statement the program department reads'
git -C "$RUN/repo" tag base
cd "$RUN"
DSH_TEST_PROGRAM_REPO="$RUN/repo" \
DSH_TEST_SESSION_ROOT="$RUN/.sessions" \
TSX_TSCONFIG_PATH="$REPO/tsconfig.json" \
  setsid nohup node --import "$REPO/node_modules/tsx/dist/esm/index.mjs" \
    "$FIXTURE/driver.ts" "$FIXTURE/overlays/claude-code.cordis.yml" \
    > "$RUN/stdout.jsonl" 2> "$RUN/stderr.txt" &
```

它需要已安装并已登录的 `claude` CLI，不需要 `DEEPSEEK_API_KEY`。运行期间 `$RUN/.sessions/` 会逐渐填满每个会话一份日志——账本、部门和整合——而 driver 会在程序结束时把它唯一的结果行写入 `stdout.jsonl`。在这条路由上，产品查询运行在部门自己的 worktree 里，即其会话创建时的目录，产品会把该目录告诉它的模型；本组合的 prompt 里 harness 不点明任何目录（[该路由的 README](../../../../../packages/llm/llm-claude-code/README.md#how-a-request-is-rendered)）。

这次运行留下什么——每份会话日志都位于 `$RUN/.sessions/<workspace-slug>/<session id>/session.jsonl`，整合的 key 在其 id 中被百分号转义：

| 产物 | 位置 | 是什么 |
| --- | --- | --- |
| 账本 | `program-<digest>` 会话 | `program/start`、每次状态变更一条 `program/goal`、`program/integration`、`program/end`，以及两个签名 |
| 部门日志 | `program-<digest>-readme-rows` 会话 | 模型走的每一步、标准、各次运行、各条指令与证书 |
| 验证器输出 | `program-<digest>-~0040integration` 的 `verification/run` 事件 | 每项检查的判定与其有界证据 |
| 整合后的树 | `$RUN/repo/program-<digest>/@integration` | 发布用的 worktree；`git -C "$RUN/repo" ls-tree -r --name-only <mergedRevision>` 列出它携带的内容 |
| driver 的报告 | `$RUN/stdout.jsonl` | 报告、账本、成员会话、屏障拒绝记录与发布文件清单 |

合并后的修订版是克隆中的一次提交，因此它通过被 fetch 并合并而进入仓库，这让部门的提交保持为它自己的提交；操作者的合并提交才是陈述"这是程序构建的"的地方：

```sh
git fetch "$RUN/repo" 'program/<programId>/@integration'
git merge --no-ff FETCH_HEAD
```

按其他每次运行的同一方式，在仓库中把它记录到 `data/proving-ground/` 下：

```sh
node data/proving-ground/tools/record-run.mjs "$RUN" 2026-09-27-readme-rows-program \
  --composition examples/headless-agent/tests/fixtures/program-readme-rows/overlays/claude-code.cordis.yml
```

它会把 `stdout.jsonl` 拷成 `result.json`，把每份会话日志拷成 `sessions/<session id>.jsonl`，并写出带仓库 head、组合、从日志折算出的耗时以及每个文件 SHA-256 的 `manifest.json`。它拒绝覆盖已有记录。之后请在[运行表](../../../../../data/proving-ground/README.md)中补上这份记录的行与段落，并把这次运行暴露出的任何东西——失败的金标比对、耗尽轮次的部门——原样留在它旁边，而不是反复重跑直到看起来干净。

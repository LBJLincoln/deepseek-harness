# Agent Note: 程序工作流构建 readme-rows——一个属于本仓库的工具

Status: implemented

[English](2026-09-27-program-builds-readme-rows.md) | 中文

## Problem

程序工作流曾两次构建软件，两次都是独立的交付物：[csv-tools](2026-09-19-program-workflow-builds-software.md)——依据一份规格构建的命令行——以及针对一棵目标树的 code-safety 报告。它从未向本仓库交付过一次修改，而 csv-tools 那篇 note 恰好推迟了这个场景：等一个独立交付物有了记录在案的判定，仓库就是下一个要试的案例。对仓库的修改正是这套工作流存在的场景，也是 harness 自身惯例不再只是阅读练习的场景：交付物落进的，正是承载着门禁、记录与它必须适配的文档的那棵树。

另一方面，[`data/proving-ground/README.md`](../../../../data/proving-ground/README.md) 及其中文对侧为每次已记录运行的每个环境各留一行：每份记录 12 到 62 行，每一行都由人从 `summarize-run.mjs` 与 facts 里读出数字手写而成，两种语言的列表形式还不相同（`1 each` 与 `各 1`、`a and b` 与 `a、b`、`… s vs … s` 与 `… s 对 … s`）。这些行是机械的，输入是持久的，而任意三份记录的已提交行就精确定义了格式。

## Decision

[`examples/headless-agent/tests/fixtures/program-readme-rows/`](../../../../examples/headless-agent/tests/fixtures/program-readme-rows/README.md) 是一个只有一个部门 `readme-rows` 的程序，其交付物是 `data/proving-ground/tools/readme-rows.mjs`——`node data/proving-ground/tools/readme-rows.mjs <record dir> --lang en|zh --implementer "<column text>"` 从 `manifest.json`、`result.json` 与 `facts.jsonl` 打印该记录的各行——以及旁边的 `readme-rows.test.mjs`。部门首先读其 worktree 根目录下的 `TASK.md`，并依据自己的测试、五项金标检查以及 `test ! -e node_modules` 被认证。每项金标都是一行 shell，`diff <(node … readme-rows.mjs <record> --lang <lang> --implementer '<the record's column>') <(grep -F '| [<record>]' <README>)`：`2026-09-26-bench-completion-hidden-pair` 的英文与中文行（两个模型的 fleet，每个模型与环境各一行）、`2026-09-26-bench-completion-t6-haiku` 的英文行（26 个环境的 fleet），以及 `2026-09-27-bench-e12-self-review-sonnet-t5t6` 的两种语言（一对冻结配对，每个环境一行，单元格为 `baseline vs candidate`）。整合在合并后的 head 上重跑测试与金标，并以 `test -z "$(git status --porcelain)"` 与零依赖规则作为门禁。

考官是已提交的行，而不是部门自己写的测试。行与记录都在基线提交之中，部门不得改动它们，一份证书意味着工具在两种语言下逐字节复现了 50 行已提交的行。部门自己的测试是必需的，为的是交付物带着一份测试，但它决定不了任何金标决定不了的东西。

Implementer 列是每份记录手写的文字——`sealed, completion family`、`+review (a self-review turn before the validation)`——因此作为 `--implementer` 传入，其中的 `{model}` 代表该行的模型，这就是多模型的 fleet 用一段列文本得到每个模型与环境各一行的方式。这个占位符是检查所钉住的命令行约定的一部分，因此 `TASK.md` 陈述了它。

seed 镜像仓库的布局。`seed/` 装着 `TASK.md`、`data/proving-ground/tools/summarize-run.mjs`、三份只保留 `manifest.json`、`result.json`、`facts.jsonl` 与 `observatory.json` 的记录，以及只装着这些记录的已提交行、逐字复制而来的 `data/proving-ground/README.md` 与 `README.zh.md`。因为路径就是仓库自己的路径，同一份规格可以不加改动地跑在铸出的 seed 上和本仓库的克隆上，无密钥运行与真实运行是同一个程序 id，与 csv-tools 一样。配对门禁本会把 seed 的 README 对读成文档；现在对 `seed/` 的目录排除是一条语料库边界——它下面的任何东西都不被读取——而文件排除仍会拒绝其旁边的 `.zh.md`（[该门禁](../../../../docs/i18n/README.md#the-gate-verify-translation-pairing)）。

任务陈述是部门要读的一个文件，如同 csv-tools 的 `SPEC.md`，而不只是作为用户回合送达的目标段落：它带着检查命令本身，因此部门可以自己运行它被测量的那些东西。对真实运行，操作者按 driver 准备 seed 的方式准备克隆——把 `seed/TASK.md` 复制到克隆的根目录、提交、给那次提交打上 `base` 标签——而 driver 会拒绝在 `base` 上没有 `TASK.md` 的克隆。合并后的修订版并入分支之后，仓库根目录再次去掉 `TASK.md`：这份陈述活在 fixture 的 seed 与账本里冻结的规格中，一个已发布程序的根目录任务文件两者都不是。

真实运行是同一个 driver 跑在 `overlays/claude-code.cordis.yml` 上——禁用脚本路由、插入操作者的 Claude Code 安装、以 `sonnet` 作为部门的模型——作用于本仓库分支的一个克隆。它合并后的修订版从克隆中 fetch 出来并以 `git merge --no-ff` 合并，因此部门的提交与整合的合并都以它们自己的身份落地，而这次运行连同账本、部门日志与整合日志一起记录在 [`data/proving-ground/2026-09-27-readme-rows-program/`](../../../../data/proving-ground/README.md) 下。

这里验证域的 `maxTextChars` 与程序的 `evidenceMaxChars` 都是 4096，而 csv-tools 是 2048 与 512：一项失败金标的证据是对一百多字符长的行做的 `diff`，而这份证据是部门在两次尝试之间得到的唯一指令，因此界限要能完整装下它的好几行。预算与轮次上限沿用 csv-tools：每个部门会话 2,000,000 个 token 与 1,500 s，三轮。

## Alternatives considered

**grep worktree 根目录下的 README。** seed 可以把金标行放在根目录的 `README.md` 里，检查读 `README.md`。这份规格跑不了本仓库的克隆——那里的行在 `data/proving-ground/README.md`——而两份规格就是两个程序 id。于是 seed 转而镜像仓库，检查读的是这个工具为之存在的那条路径。

**让工具自己拼出 Implementer 列。** 同一份记录的各行之间，只有模型是机械变化的；其余——`sealed, completion family`、对自审梯级的描述——是人为每份记录写一次的文字。会拼这一列的工具就得带上每份记录的措辞；只给那个机械部分留一个占位符，这一列仍归操作者所有。

**只在目标里陈述任务。** 目标是作为用户回合送达的一个段落，部门无法重读它；带着七条检查命令的陈述是一份文档。代价是准备好的克隆：`TASK.md` 必须存在于 `base` 上，这是操作者在运行前做的一次提交，合并后再去掉。

**合并后把 `TASK.md` 留在仓库根目录。** 程序一旦发布，它就是一个没有配对也没有读者的文件；账本里冻结的规格与 seed 持有同一段文字。

**给 seed 的金标文件改名，好让它们避开配对门禁。** 工具的约定就是 README 那一对的名字，检查也 `grep` 它们；改了名的金标会让 seed 变成一个不同于工具所服务的仓库。门禁学会了区分它保持单语的文件与它语料库之外的目录。

**把部门的提交 cherry-pick 到分支上。** cherry-pick 会改写提交并丢掉整合的合并，而证书命名的正是那次合并。fetch 整合分支并以 `--no-ff` 合并，让已认证的修订版、合并后的修订版与操作者的合并保持为三次各自可核验的提交。

**让部门跑在最大的产品模型上。** csv-tools 跑在 `opus` 上；本程序问的是工作流能否向仓库交付，而不是模型的上限在哪里，而中间模型是 bench 的参考模型。

**增加一个快照场景。** 这套工作流写给模型看的文本只有目标与验证器的指令；e2e 从持久日志与合并树中断言证书、trailer 行与交付的行，而 driver 打印的是一份 JSON 报告而不是会话事件流（[csv-tools note](2026-09-19-program-workflow-builds-software.md#alternatives-considered)）。

## Consequences

无密钥 e2e 大约十秒钟就证明了接线：规格被冻结，部门被配备、被限额并在一棵已提交的树上被认证——其提交以那两行 trailer 结尾——分支被合并，seed 的每个文件在合并树中都未改动，合并树恰为 seed 加上两个交付文件，交付的工具从整合 worktree 中打印出那 50 行已提交的行。脚本路由回放提交在 `scripted/` 下的参考解，这正是在向模型提问之前证明规格可被满足的方式。

真实运行证明的是一份 route 证书所证明的东西（[program README](../../../../packages/improvement/program/README.md#the-two-implementers)）：程序通过 shell 执行器、在部门 worktree 中、在部门提交的树上运行了各项检查，并把这次运行与证书记录在部门自己的会话里，而在 `route` implementer 上这份会话还持有模型走的每一步。部门的记录稿就在记录里。操作者写了规格与任务陈述、准备了克隆、合并了分支、写了记录的段落，并在合并后运行了仓库的门禁；部门一项都没有运行，因为它的标准是金标、它的测试与零依赖规则。

它没有证明的：关于模型能力的任何东西。已提交的行就在模型被指向的仓库里，任务很小，而且只有一次运行。一个读过 `summarize-run.mjs` 与那些行的部门已拥有它需要的一切；这里的主张是，工作流可以拿到一份任务陈述与已提交的期望输出，然后在本仓库的一个克隆里、在它自己的证书之下，交回一次复现该输出的提交。

这个工具只打印 bench 记录：从 facts 得到的 fleet 或冻结配对。像这次运行自己这样的程序记录没有 facts，它的行仍然手写；某个臂从未运行的配对会被拒绝而不是猜测。

配对门禁的排除项现在有两种含义：文件条目让那篇文档保持单语并拒绝其旁边的翻译；带尾随 `/` 的目录条目把它下面的一切都放到语料库之外。

## Verification

- `pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-readme-rows.e2e.ts` 在脚本路由上发布程序，并从合并树检查证书、trailer、未改动的 seed、交付物与五项金标。
- `pnpm exec vitest run scripts/translation-pairing.spec.ts` 证明目录排除覆盖其下的一切、文件排除只覆盖一篇文档；`pnpm run verify-translation-pairing` 在排除 seed 的语料库上运行该门禁。
- `npx tsc --noEmit -p tsconfig.host.json`、`pnpm run lint`、`pnpm run verify-agent-note-format` 与 `pnpm run doc-sync` 覆盖 fixture、e2e 与本 note。
- 真实运行的证书、尝试次数、步数、秒数与合并后的修订版陈述在 [`data/proving-ground/README.md`](../../../../data/proving-ground/README.md) 中这份记录的段落里，并可从 `data/proving-ground/2026-09-27-readme-rows-program/` 读回。

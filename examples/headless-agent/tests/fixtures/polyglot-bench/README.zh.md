# Polyglot bench

[English](README.md) | 中文

Proving Ground 可与外部对照的套件：[aider polyglot benchmark](https://github.com/Aider-AI/polyglot-benchmark) 中的 Exercism 练习，各模型用 aider 自己的脚手架在其上跑出的分数发布在 [aider 的排行榜](https://aider.chat/docs/leaderboards/)上。这些练习是 Exercism 的内容，不在本仓库中：注册器读取一个位于 [`admission.json`](admission.json) 所记录修订 `7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f` 上的检出，拒绝任何其他修订。每个 cell 都跑在 [proving-ground bench](../proving-ground-bench/cordis.yml) 的 cell 栈、上限、尝试次数与 Claude Code 路由上，因此同一模型在自研 bench 与本套件上的读数出自同一个组合。设计理由由 [Agent Note](../../../../../.agents/notes/proposed/architecture/2026-09-22-polyglot-bench-public-comparability.md) 负责。

## 运行

```sh
git clone https://github.com/Aider-AI/polyglot-benchmark ~/polyglot-benchmark
git -C ~/polyglot-benchmark checkout 7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f
export POLYGLOT_BENCH_DIR=~/polyglot-benchmark
pnpm run bench -- environments --fixture polyglot-bench
pnpm run bench -- fleet polyglot-smoke-sonnet --fixture polyglot-bench
pnpm run bench -- admit --fixture polyglot-bench
```

检出在四个已注册的轨道之下必须保持原样：那里存在已修改、未跟踪或被忽略的文件时启动就会失败，而在检出内部运行某个练习的测试正会留下这类文件。`admit` 会重新执行准入，结果与记录不同时以 1 退出；`admit --write` 记录新的结果，固定修订就是这样移动的。一次运行的记录方式与任何 bench 运行相同，使用 `--composition examples/headless-agent/tests/fixtures/polyglot-bench/cordis.yml`。

## 注册什么

有四个轨道能在密封 cell 中离线运行测试：C++、Go、Python 与 Rust。JavaScript 的测试套件需要把 `jest` 装进 `node_modules`，Java 的需要 Gradle，而 cell 两者都无法下载，所以这两个轨道不注册任何东西。每个被准入的练习是一个 kind 为 `bench` 的环境，id 为 `polyglot:<track>:<exercise>`，`detail.language` 写明轨道，不带层级与领域。它唯一的检查在工作区根目录运行该轨道的命令，提示词的最后一句也写出这条命令：

| 轨道 | 命令 |
| --- | --- |
| `cpp` | `rm -rf build && cmake -S . -B build -DEXERCISM_RUN_ALL_TESTS=1 && cmake --build build` |
| `go` | `GOCACHE=/tmp/go-build GOPROXY=off GOTOOLCHAIN=local go test -count=1 ./...` |
| `python` | `python3 -m pytest -q` |
| `rust` | `cargo test --offline -- --include-ignored` |

密封 cell 以只读方式绑定 `/`，给每条命令一个私有的 `/tmp`，只允许写工作区，所以 Go 把构建缓存放在 `/tmp`，任何命令都不下载东西，implementer 配置过的 C++ 构建目录也决定不了构建。Rust 的测试套件把除第一个以外的测试都标成 `#[ignore]`，C++ 的测试套件只有在 `EXERCISM_RUN_ALL_TESTS` 下才编译除第一个以外的测试；这两个开关都是打开的，与 aider 的 harness 一致。

注册器把每个练习暂存到一个在自己加载期间归它所有的目录中。暂存出的 fixture（测试前置数据）是去掉 `.docs`（它的文本就是提示词）以及 `.approaches` 与 `.articles`（它们带着现成的解法）之后的练习目录；`.meta` 完整保留为任务参考，runner 会把它从每个工作区中移除，只为验证者暂存，因为它装着参考解 `.meta/example.*`。有一行会改动：C++ 的 `CMakeLists.txt` 按构建所在的目录为练习命名，而在 cell 中那是 cell 自己的目录，所以暂存的副本直接写出练习名。在组合了读取屏障时，检出与暂存目录对每个 implementer 都是拒绝访问的。

implementer 修改的是该轨道的解答文件，即 `.meta/config.json` 所列出的那些，但 `Cargo.toml` 与 `CMakeLists.txt` 除外，它们与 aider 的 harness 中一样保持不变。工作区中的其他每个文件都是不可变的：runner 在每次验证前恢复它，并把改动过它的尝试作废。提示词依次是练习的 `.docs/introduction.md`（如果有）、`.docs/instructions.md` 与 `.docs/instructions.append.md`（如果有），这正是 aider 的 harness 发送的文本，最后一句写出要修改的文件与命令；`.docs/hints.md` 不会发送。

在每个轨道中，被准入的练习按其 id 的带种子 SHA-256 排序，前五分之一被留出。一个练习的名次只取决于它自己的 id，所以准入或拒绝另一个练习，最多只会移动留出划分的边界。

## 准入

[`admit.ts`](admit.ts) 按注册器的方式暂存四个轨道中的每个练习，先在密封 cell 中对着存根运行该轨道的命令，再把参考文件复制到它们所替换的存根上后运行一次，只有第一次失败而第二次通过时才准入该练习。它的 cell 就是 fleet 的 cell 去掉网络，这表明没有哪个被准入的测试需要网络。它与注册器共享 [`polyglot.ts`](polyglot.ts)，所以它测量的正是注册所用的 fixture、命令与参考解映射。[`admission.json`](admission.json) 记录结果、它所针对的修订以及它所用的工具链版本；注册器注册被准入的练习，并在检出包含记录未归类的练习时使启动失败。

| 轨道 | 练习 | 准入 | 留出 | 拒绝 |
| --- | --- | --- | --- | --- |
| C++ | 26 | 24 | 5 | 2 |
| Go | 39 | 36 | 7 | 3 |
| Python | 34 | 34 | 7 | 0 |
| Rust | 30 | 22 | 4 | 8 |

被拒绝的练习分属五种原因。前两种是练习本身的属性，在任何主机上都成立：aider 的排行榜计入了这三个练习，只要模型不去动那些可运行的代码，重构练习就能通过。第三种是本主机的属性。后两种源于 cell 处于离线状态：三个 Rust 练习声明了 crates.io 依赖，没有它测试就无法构建；另有五个 Rust 参考解依赖其自带的 `.meta/Cargo-example.toml` 所声明的 crate，所以没有任何东西能证明这五个练习可以离线通过，尽管 implementer 也许只用标准库就能通过它们。

| 原因 | 被拒绝 |
| --- | --- |
| 存根本来就能通过：交付可运行代码的重构练习 | `polyglot:go:ledger`、`polyglot:go:markdown` |
| 存根本来就能通过：练习要求写出测试套件，所以它的命令不运行任何测试 | `polyglot:go:counter` |
| 参考解需要 Boost `date_time`，而本主机缺少它的头文件 | `polyglot:cpp:gigasecond`、`polyglot:cpp:meetup` |
| 练习的 `Cargo.toml` 声明了一个 crates.io crate，而离线的 cell 无法下载它 | `polyglot:rust:gigasecond`、`polyglot:rust:grep`、`polyglot:rust:simple-cipher` |
| 参考解依赖其自带的 `.meta/Cargo-example.toml` 所声明的 crate | `polyglot:rust:alphametics`、`polyglot:rust:decimal`、`polyglot:rust:pig-latin`、`polyglot:rust:poker`、`polyglot:rust:robot-name` |

## 计划

| 计划 | cell 数 | 练习 |
| --- | --- | --- |
| [`polyglot-smoke-sonnet`](plans/polyglot-smoke-sonnet.json) | 8 | 每个轨道按名次排在最前面的两个未留出练习 |
| [`polyglot-core-sonnet`](plans/polyglot-core-sonnet.json) | 40 | 每个轨道按名次排在最前面的十个未留出练习 |

两个计划都让 Claude Code 路由的 `sonnet` 对每个练习跑一次，种子为 1，district 为 `bench-polyglot`，冒烟计划的每个练习也都在核心计划之中。[`overlays/with-openrouter.cordis.yml`](overlays/with-openrouter.cordis.yml) 在本 fixture 仅限评估的条款下加入自研 bench 的 OpenRouter 路由，[`overlays/registry-only.cordis.yml`](overlays/registry-only.cordis.yml) 是 `environments` 所启动的无密钥注册表视图。

## 把一个数字放在 aider 的数字旁边读

这里的认证率与 aider 排行榜上的通过率是两次测量，一份记录会把它们分开陈述。

- **脚手架。** aider 发送说明与存根文件，给模型两次机会，第二次附上测试输出。这里 agent（智能体）用 harness 自己的工具在工作区中工作，会读测试文件，在上限允许的范围内任意次地运行命令，并有三次尝试，每次都以一次验证结束；记录中的尝试次数说明了有多少个在两次之内获得认证。
- **样本。** aider 的数字覆盖六种语言的 225 个练习。这里注册四个轨道，去掉被拒绝的练习，计划也只从未留出的练习中抽取。Exercism 的重构练习交付的是可运行的代码，在 aider 的排行榜上，任何没有把它们改坏的模型都能拿到这一分，而这里会拒绝它们。
- **模型。** 路由向 Claude Code 安装请求它的 `sonnet` 别名，会话日志记录的是这个别名，而不是安装在该别名下实际提供的模型。

## 已知限制

- **implementer 新增的文件会进入检查。** runner 只恢复不可变路径，所以一个 `conftest.py`，或者新测试文件中的一个 Go `TestMain`，都可能改变命令实际运行的内容。这里没有任何东西能防范一个钻 harness 空子的 implementer；这样的运行会在会话日志中显现出来。
- **cell 保留了网络。** 沙箱只管文件效果。准入表明没有哪个被准入的测试需要网络，这些命令也不下载任何东西，但 implementer 自己运行的命令可能会。
- **准入是主机的属性。** 记录写明了它所用的工具链；装有 Boost 头文件或 crates.io 镜像的主机会准入本主机拒绝的练习，并记录它自己的结果。
- **注册器需要 `git`。** 它通过 `git rev-parse` 与 `git status` 读取检出的修订与改动。

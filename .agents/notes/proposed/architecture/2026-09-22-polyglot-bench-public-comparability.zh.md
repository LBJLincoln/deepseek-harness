# Agent Note: 一个可供 Proving Ground 的数字对照的公开套件

Status: proposed

[English](2026-09-22-polyglot-bench-public-comparability.md) | 中文

## Problem

Proving Ground 注册的每一个环境都是仓库自写、零依赖的 JavaScript 程序：[proving-ground bench](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/cordis.yml) 的 44 个任务。它的读数做得很细：密封 cell、经过审计的隐藏用例、冻结配对；但每一个读数都来自本仓库自己编写的任务，且只有一种语言，所以 harness 报出的任何数字都无法与别人发布的数字并排比较。密封第 5 层上 16 之 14 的认证率说明的是一条路由在本仓库任务上的表现；仓库之外的读者无从核对它，它也说明不了 C++、Go、Python 或 Rust 上的任何事。

## Proposal

把 [aider polyglot benchmark](https://github.com/Aider-AI/polyglot-benchmark) 中的 Exercism 练习注册为第二个 bench fixture（测试前置数据），即 [`examples/headless-agent/tests/fixtures/polyglot-bench/`](../../../../examples/headless-agent/tests/fixtures/polyglot-bench/README.md)，并在自研 bench 本身的组合上运行它。aider 会发布各模型在这个套件上、用它自己的脚手架跑出的分数，因此这个 fixture 的一份记录可以在自己的数字旁边引用一个已发布的数字，两者分开陈述，并注明日期。

### 按修订固定，绝不收录

这些练习是 Exercism 的内容，受 Exercism 的许可约束；套件包含哪 225 个练习，由 benchmark 仓库说了算。因此这个 fixture 不收录任何练习。它的注册器读取 `POLYGLOT_BENCH_DIR` 指向的检出，拒绝任何不在 [`admission.json`](../../../../examples/headless-agent/tests/fixtures/polyglot-bench/admission.json) 所记录修订上的检出，也拒绝在已注册语言轨道之下存在已修改、未跟踪或被忽略文件的检出，因为暂存出的 fixture 会复制练习目录里的一切。准入记录是这个固定修订的唯一归属：要移动它，就要对新修订重新运行准入并写下结果。

### 准入决定成员资格

一个练习只有在准入于本主机上证明了以下两点之后才会注册：它的存根无法通过该轨道的测试命令，而它的参考解能够通过；两次运行都在去掉网络的密封 cell 中进行。准入与注册共享同一个 TypeScript 练习模型 [`polyglot.ts`](../../../../examples/headless-agent/tests/fixtures/polyglot-bench/polyglot.ts)，所以准入测量的正是注册所用的暂存 fixture、命令与参考解映射，而不是对它们的另一份复述。能在 cell 中离线运行的轨道有四个：C++、Go、Python 与 Rust。JavaScript 需要把 `jest` 装进 `node_modules`，Java 需要 Gradle，所以这两个轨道不注册任何练习。被拒绝的练习连同准入观察到的情况一并记录：存根本来就能通过的练习（Exercism 的重构练习交付的是可运行的代码；有一个 Go 练习要求写出测试套件，所以它的命令不运行任何测试），以及参考解无法在本主机上离线通过的练习（两个 C++ 练习需要 Boost；八个 Rust 练习需要 crates.io 上的 crate，其中三个由练习自己的清单声明，五个由参考解的清单声明）。

### 暂存会改动练习的哪些地方

暂存出的 fixture 与练习目录逐字节一致，只有三处例外。`.docs` 被去掉，因为它的文本就是提示词；`.approaches` 与 `.articles` 被去掉，因为它们带着现成的解法。`.meta` 被完整保留为任务参考：它装着参考解，所以 runner 会把它从每个工作区中移除，只为验证者暂存。另外，C++ 的 `CMakeLists.txt` 里按构建所在目录为练习命名的那一行，会改为直接写出练习名，因为 cell 的工作区是以 cell 命名的。在组合了读取屏障时，注册器会对每个 implementer 拒绝访问检出及其暂存目录。

### cell 运行的命令

每个轨道只有一条命令，它既是检查，也是提示词结尾那句话里的命令。密封 cell 以只读方式绑定 `/`，给每条命令一个私有的 `/tmp`，只允许写工作区，这决定了四条命令中的三条：Go 把构建缓存放在 `/tmp` 且不得下载任何东西，Cargo 以 `--offline` 运行，CMake 每次从零重建构建目录。Rust 与 C++ 的测试套件会打开它们藏在 `#[ignore]` 与 `EXERCISM_RUN_ALL_TESTS` 之后的测试，与这些轨道自带的运行器及 aider 的 harness 做法一致。

### 两个套件共用一套栈

这个组合沿用自研 bench 的 cell 栈、上限、尝试次数与 Claude Code 路由，因此同一模型的两个读数出自同一套栈。条款仅限评估，并使用自己的协议 id；OpenRouter 叠加层也保持这一条款：一个为了与已发布分数对照而存在的套件，一旦用它的会话记录训练过某个模型，就不再能测量那个模型。

### 把一个数字放在 aider 的数字旁边读

一份记录按轨道陈述自己的认证率，并与之分开地给出排行榜上最接近的已发布模型的数字，以及抓取它的日期。两者在三方面不同：脚手架（aider 发送说明与存根文件，给模型两次机会，第二次附上测试输出；本 harness 的 agent（智能体）会读测试、在上限允许的范围内任意次地运行命令，并有三次经过验证的尝试）、样本（四个轨道，去掉被拒绝的练习与留出的五分之一），以及产品别名背后的模型，而一份记录只以别名称呼它。

## Alternatives considered

**像自研 bench 收录它的任务那样收录这些练习。** 否决：内容属于 Exercism，而收录的副本会自行决定套件包含哪些练习。固定修订的检出让 benchmark 仓库保持权威，也让修订可以核对。

**运行 aider 的脚手架，而不是 harness 自己的循环。** 否决：那样 harness 就不再是在测量自己，而 aider 为自己脚手架跑出的数字已经发布了。这个 fixture 测量的是 harness 自己的循环在公开套件上的表现，并把 aider 的数字分开引用。

**通过把依赖装进 cell 来注册 JavaScript 与 Java。** 在这个 fixture 中否决：这需要网络，或者在每个 cell 中预先备好 `node_modules` 与 Gradle 缓存，而准入确立的恰恰是离线这一性质。以那种方式加入的轨道需要它自己的准入证据。

**把检出中的每个练习目录直接用作 fixture，以 `.meta` 作为参考。** 否决：`.approaches` 与 `.articles` 会带着现成解法进入工作区，而 C++ 练习无法在以 cell 命名的目录中构建。

**保留上游的 `CMakeLists.txt`，从一份以练习命名的副本进行构建。** 否决：检查能通过，但 implementer 在自己的工作区里运行该轨道的常规构建时，会遇到一个与练习本身毫无关系的失败。

**像自研 bench 的 `admit.mjs` 那样用纯 Node 写准入。** 否决：那会在第二个模块里复述暂存规则、参考解映射与命令，准入也就不再能证明注册所注册的东西。

**像 aider 不把测试文件放进对话那样，不把测试文件放进工作区。** 否决：runner 的检查在工作区中运行，而自研 bench 的约定是可见的测试加上密封的验证者。两者的差异改为在每个数字旁边写明。

**在组合中固定修订。** 否决：准入记录仍然必须写出它针对的修订，一个固定点有两个归属就会漂移。

## Acceptance criteria

- 对位于固定修订的检出，`pnpm run bench -- environments --fixture polyglot-bench` 注册的恰好是 `admission.json` 中准入的 id，每个轨道留出五分之一；对任何其他修订、被改动的检出或没有检出，启动都会失败并说明原因。
- `pnpm run bench -- admit --fixture polyglot-bench` 在本主机上复现记录中准入与拒绝的 id。
- 冒烟计划的一次 fleet 记录在 `data/proving-ground/` 之下，按轨道列出其证书，它的 README 段落把排行榜上的数字与记录自己的数字分开引用，并注明日期。
- 这个 fixture 的单元测试与无密钥 e2e 通过，`pnpm run bench` 通过 `--fixture` 运行这个 fixture 的计划，而不需要脚本的第二份副本。

## Risks

- **污染。** 这些练习与它们的解法都是公开的，模型可能在训练中读过它们；高认证率测量的可能既是做题，也是回忆。aider 的数字同样暴露于此。
- **比较并非同类相比。** 脚手架、尝试次数、测试可见性、样本、工具链版本，以及别名背后的具体模型都不相同；读者如果略去这些限定，就会把两个数字当成同一次测量。
- **implementer 新增的文件会进入检查。** runner 只恢复不可变路径，所以一个 `conftest.py`，或者新测试文件中的一个 Go `TestMain`，都可能改变命令实际运行的内容。这里没有任何东西能防范一个钻 harness 空子的 implementer；这样的运行会在会话日志中显现出来。
- **准入是主机的属性。** 另一台主机的工具链可能准入不同的集合；记录写明了它所用的工具链，装有 Boost 或 crates.io 镜像的主机会记录它自己的结果。
- **cell 保留了网络。** 沙箱只管文件效果：准入表明没有哪个被准入的测试需要网络，这些命令也不下载任何东西，但 implementer 自己运行的命令可能会。

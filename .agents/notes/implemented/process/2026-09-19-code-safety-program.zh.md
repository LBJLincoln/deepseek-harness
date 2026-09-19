# Agent Note：program 工作流审查自己未曾编写的代码

Status: implemented

[English](2026-09-19-code-safety-program.md) | 中文

## Problem

工作流此前运行过的两个 program，交付的都是 harness 自己生产的东西。2026-09-08 的[自评估运行](../../../../data/proving-ground/README.md)写了一份关于本仓库的文档，[csv-tools program](2026-09-19-program-workflow-builds-software.md) 则对着一套已提交的测试套件构建了一个命令行。两者之中，被裁定的东西与做事的东西同在一棵树里：检查运行交付的代码，通过它就意味着交付物的行为正确。

客户的第一个问题不同。他们交出一个仓库，问它有什么问题，而交付物是一条关于"program 不得触碰的那棵树"的断言。测试套件无法裁定这条断言，因为无物可跑：输出是散文，而关于代码的散文恰恰是语言模型最容易被采信、也最难被核对的地方。失败模式不是"某个部门什么也没写"——而是某个部门写下一条看似合理的发现，而它所指的那一行并不是它声称的内容；或者一份报告的执行摘要与它自己的发现计数不一致；又或者一次评审得出"代码没问题"的结论。

## Decision

[`examples/headless-agent/tests/fixtures/program-code-safety/`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/README.md) 是一个 program，其交付物是一份关于以路径传入的**目标树**的报告。六个部门——`secrets`、`injection`、`access`、`data`、`dependencies`、`platform`——从各自在一个独立的**报告仓库**中的工作树里阅读那棵树，各自提交 `findings/<department>.json` 与 `report/<department>.md`。集成方合并这六条分支，写出 `SAFETY-REPORT.md` 与 `findings.json`。

每条发现都是一个 JSON 对象，携带 `file`、`line`、可选的 `endLine`，以及 `snippet`——目标在那些行上的原文。`seed/verify-safety-report.mjs` 位于基线提交中，因此没有部门能改动衡量自己的东西；它同时就是每个部门自己的目标检查：它在锁定的树中解析文件、核对行号落在文件之内、并在归一化空白后比对 snippet 与目标的原文。引用站不住脚的发现，会在任何报告存在之前就让作出它的部门失败。

在合并后的 HEAD 上，同一个审查器另外裁定四件事：`findings.json` 中的每个发现 id 都在 `## Findings` 下被引用，报告中的每个 `<file>:<line>` 都能解析;法文与英文摘要都为五个严重度各给出一行 `- <severity>: <count>`，且这些计数就是并集的计数；部门报告过而并集丢弃的每个 id 都在 `## What was not covered` 下被点名；证书陈述已核验条数、目标摘要，并逐字给出"本次评审不证明漏洞不存在"这句话。`no vulnerabilities`、`free of vulnerabilities`、`is secure`、`safe to deploy` 与 `fully audited` 无论出现在何处都会被拒绝。

### 目标被锁定，而不是以只读方式挂载

driver 在组合加载之前遍历目标，并把 `target.json`——绝对根路径、被排除的目录、每个文件的 SHA-256 以及覆盖全部文件的一个总摘要——提交进基线提交。审查器在每次运行时重新哈希每个被锁定的文件，因此写入过目标的部门会让 program 失败，而不是发布一份关于已不复存在的树的报告。

这是靠检测来保证的。本组合中没有任何东西把目标以只读方式挂载：read barrier 拒绝的是读取，而 fs provider 的 `cwd` 是解析默认值而非隔离，所以本该拒绝那次写入的能力在这里并不存在。把这一点说出来是设计的一部分，而不是疏漏：报告陈述这次评审覆盖了什么，记录陈述是什么在施加约束。

### 被丢弃的发现由审查器披露，而不是靠良好意愿

`verify-safety-report.mjs --findings <file> --list-invalid` 打印失败的 id 并以 0 退出。集成方对每个部门的文件运行它，丢弃它点名的那些，并在 `## What was not covered` 下逐条披露；随后 `--report` 模式会拒绝一个"遗漏了某个没有任何小节点名的 id"的并集。于是披露规则在两侧都是机械的——集成方既不能悄悄丢掉部门的发现，也不能悄悄留下一条站不住脚的发现。

### 两种组合，一份 spec

`cordis.yml` 把每个会话脚本化到 `cli-mock` 路由上，针对 fixture 自己的 `sample-target/`；`overlays/claude-code.cordis.yml` 用操作者的 Claude Code 安装替换该路由，把并发提高到三个部门，并在仓库携带 `data/knowledge/code-safety/` 时把它挂载为一个技能根。脚本化的发现只陈述文件与行号，别无其他：每个 snippet 都在流式生成时从目标中读出，用的正是审查器将要比对的那些字节，因此无密钥的那一半无法靠携带一份树的副本蒙混过关。

## Alternatives considered

**让部门直接交付进目标仓库。** 对一个"裁定某个提交"的工作流来说这是最自然的形态，但在这里是错的：交付物是一条关于客户那棵树当前状态的断言，而一个往里提交的 program 裁定的是它自己的修改。两棵树也才使"只读"这条规则得以被陈述。

**用静态分析器而不是已提交的审查器来核验发现。** 扫描器裁定的是某个模式是否存在，而不是"关于第 73 行的这句话是否为真"。这里 Semgrep 的定位恰好相反——它的命中只是"该去读的地方"，而审查器才是每条发现都必须挺过去的关口。

**要求每个部门至少报告一条发现。** 这会让无密钥 fixture 更整齐，同时用编造买下一条发现。一无所获的部门写下 `[]` 并在自己的小节里说明；审查器检查的是引用，而抵御伪造引用的唯一防线，是伪造不会带来奖励。

**把并集作为 program 计算出的产物交给集成方。** program 本可以自己合并六份发现文件，把一份成品 `findings.json` 交给集成方。那会把去重与丢弃判断从会话里搬进 driver——那里没有任何日志记录这项判断——并且把集成方变成一个排版器。并集本身是工作，而不在会话日志里的工作是无法评审的。

**用已知漏洞清单给报告打分。** 对一次评审来说，针对基准真值的召回率是显而易见的度量，但它度量的是这次评审而不是这套工作流。它也无法在客户自己的仓库上运行，而那正是本 program 存在的场景。基准真值应当作为一份独立的读数放在记录旁边，而不是放进发布关口里。

## Consequences

本 program 发布的报告只携带一条断言，并把它说明白：每条列出的发现都已被核验存在于其所引用的那一行，范围是各部门实际读过的文件。它不是审计，没有任何东西被执行，而 `confidence` 是分析者本人对"把路径追到了多远"的陈述——审查器检查的是引用，绝不是其背后的推理。

审查器的失败文本是会话在两次尝试之间收到的唯一指令，因此 `evidenceMaxChars` 被提高到与 verification 域自身的 `maxTextChars` 相同，并且每条失败消息都点名期望的确切字符串。于是一次运行会把一些轮次花在报告结构上，而更宽松的关口不会；集成的第一次尝试必然失败，因为它的检查在它的第一次回合之前运行，而此时合并结果还不含报告。

driver 中的 `MAX_TARGET_FILES` 界定了究竟能锁定多大的树。超过它的树会被拒绝而不是抽样：抽样的锁会把"部门在抽样之外编辑过的目标"报告成未曾改动，那比拒绝运行更糟。

一次运行中每个会话共用同一个模型。冻结的 spec 不携带按目标区分的模型，而 `agent-default-model` 是进程级的，因此一次运行无法把部门放在一个模型上、把集成放在另一个模型上；[program README](../../../../packages/improvement/program/README.md#known-limitations-and-deferred-work) 已经记下了这个缺口，而本 fixture 现在是一个希望它被补上的消费者。

# 代码安全概念验证：演示手册

[English](code-safety-poc.md) | 中文

本教程带操作者从一份干净的检出走到一场现场演示：harness 审查一个应用的源码以查找安全缺陷，把每一条发现对照代码加以验证，并在指挥台上展示整个过程。它为向潜在客户做的演示而写；末尾几节说明哪些可以宣称、哪些不可以。

## 演示展示什么

1. **企业。**指挥台的第一个视图是 147 个已定义 agent 组成的花名册，按部门分组，此刻正在运行的那些由其真实会话点亮。图上的每个 agent 都源自本仓库中的一个定义（一个 preset、一份计划、一个夹具、一篇笔记）；花名册文件点名了每一个的来源。
2. **对客户应用的一次审查。**一次代码安全审查是一个[程序](../packages/improvement/program/README.md)：六个安全部门，各在自己的 git worktree 和自己的会话里，读取目标仓库，运行静态扫描器与依赖审计，写出带文件、行号和该行原文的发现。一个集成部门合并六个分支，写出以法文执行摘要开头的报告，并运行已提交的验证器。
3. **验证，而非信任。**验证器在任何部门运行之前就已提交，没有部门能改动它。它检查每条发现的文件存在于目标中、行号在文件之内、引用的片段与该行代码一致、标识符格式正确，以及报告引用了每条发现并陈述了与发现文件相同的计数。未通过验证的发现会被移除并列为未验证；证书说明的是通过了什么。
4. **记录。**每份会话日志、发现、报告与验证器输出都写在运行目录下，一次被记录的运行放在 [`data/code-safety/`](../data/code-safety/README.md)。演示目标的基准真值列表（[`nodegoat.ground-truth.json`](../data/code-safety/targets/nodegoat.ground-truth.json)，十八个已知问题钉在行号上）让一次运行的召回率可以被数出来，而不是被断言。

## 演示之前（三十分钟，一次）

```sh
git clone https://github.com/LBJLincoln/deepseek-harness.git && cd deepseek-harness
git checkout claude/coding-agent-harness-u9l4gt
pnpm install
pnpm run build:lib:host            # the program drivers run built lib/; about five minutes
claude --version                   # the departments run on your Claude Code login
python3 -m venv ~/semgrep-venv && ~/semgrep-venv/bin/pip install semgrep
ln -sf ~/semgrep-venv/bin/semgrep /usr/local/bin/semgrep   # or add the venv's bin to PATH
git clone --depth 1 https://github.com/OWASP/NodeGoat.git ~/targets/NodeGoat
```

NodeGoat 上已记录的运行（[`data/code-safety/2026-09-19-nodegoat/`](../data/code-safety/2026-09-19-nodegoat/SAFETY-REPORT.md)）就是演示所产出之物的样子：七个部门全部认证，42 条经验证的发现（5 critical、17 high、13 medium、5 low、2 info），中等模型上 1,301 s，审查器退出码 0，十八个已知问题中找到十四个（[该读数](../data/code-safety/README.md)）；在 Java Struts 2 应用 dvja 上的第二次运行在 1,414 s 内发布了 40 条经验证的发现（9 critical），十四个已记载问题中找到十三个；在构建这一切的机器上的一次彩排，完全按指挥台按钮的方式经由 feed 启动，在同一 NodeGoat 修订版上于 1,225 s 内发布了 38 条经验证的发现，同样是 18 之 14（[第二份记录](../data/code-safety/2026-09-19-nodegoat-2/SAFETY-REPORT.md)）。然后在 NodeGoat 上端到端彩排一次：启动 feed 与指挥台，从指挥台发起一次审查，等待证书，打开报告。一次彩排的时长约等于审查本身（中等模型上十五到三十分钟）。在另一个标签页保持已记录运行的报告打开，作为后备。

## 运行演示

三个进程，三个终端：

```sh
pnpm run feed                      # the harness feed: roster, runs, live events, reviews (port 4711)
pnpm run deck                      # the command deck (Next.js, http://localhost:3000)
pnpm run code-safety -- ~/targets/NodeGoat --model sonnet   # or start the review from the deck's Safety view
```

视图的顺序：

1. **Enterprise**（`/`）。说明这张图是什么：是定义，不是营销数字；点亮的节点是此刻正在运行的会话。点开一个部门 agent，展示它的路由、preset、技能与工具。
2. **Process**（`/process`）。展示六个部门并行启动、工具调用流动（扫描器、审计、读取）、第一批发现，然后是验证器与集成。屏幕上的每一次脉动都是磁盘上某份会话日志里的一个事件。
3. **Safety**（`/safety`）。目标呈现为一座代码城市；发现是承载它们的文件上的标记；按严重度过滤的发现表；打开一条发现看它的片段、证据、影响与修复；证书卡片；以法文摘要开头的报告。下载 `findings.json` 与报告。
4. **记录。**打开运行目录和某个部门的会话日志：客户看到这次审查可复现、可审计，而不是一段聊天记录。

如果现场审查很慢或订阅被限速，在运行列表里把指挥台切到已记录的 NodeGoat 运行并继续叙述；说明它是一段录制。

对时钟的预期：先启动 feed，几秒后再启动指挥台，因为 feed 在启动时会把每个已记录的会话折叠一次（在本仓库上约一秒），而指挥台只有在 `GET /roster` 于五秒内应答时才显示 `LIVE`；从 Safety 视图启动的审查会立即以 feed 返回的 id 列出，面板会说明审查正在进行，代码城市显示目标但没有标记，直到各部门发布；Enterprise 与 Process 视图把每个部门的事件归于其 integrator 席位、把集成归于 program lead，各部门的首批工具调用会在一分钟内出现；发现、证书与报告在集成之后一起到达，对一个 NodeGoat 规模的目标、在中档模型上，大约在审查开始后二十到二十五分钟。

## 可以宣称什么

- harness 对该应用的源码做了一次多 agent 审查，报告中的每条发现都经机械验证，确认存在于所审查修订版中所引用文件的所引用行。
- 报告陈述了自己的覆盖范围：读过的文件、用过的扫描器规则集、审计过的生态，以及未覆盖的部分。
- 审查可复现：同一目标修订版、同一组合与同一程序规格给出的一次运行，其记录可与第一次比较。
- 在演示目标上，这次运行对十八个已知问题的召回率就是记录所显示的那个数，不多。

## 不可以宣称什么

- 代码是安全的。审查在它读过的文件里找它所寻找的缺陷类别的实例；它不证明缺陷不存在，不是渗透测试，也不执行该应用。
- 发现是完整的，或严重度是最终的。严重度遵循一套由模型套用的书面评级，应由客户的安全团队确认；正因如此，置信度（`confirmed`、`likely`、`possible`）是每条发现的一部分。
- 任何客户代码或发现被用于训练。每个会话都记录它的数据使用条款，订阅路由的条款只允许评估；客户的代码留在运行审查的那台机器上。

## 一次付费概念验证会增加什么

在客户自己的应用上花四到六周：把他们的语言与框架加进部门的技能和扫描器规则；与他们的安全团队商定一份预埋的基准真值，使召回率在他们的代码上被度量；把验证器扩展到能复现的发现处加以复现（一个到达汇点的请求、一次依赖版本查询）；把报告格式对齐他们的风险登记册；通过每晚运行本仓库自身 bench 的同一条循环，把审查安排在每次合并上。

## 参考

| 部分 | 位置 |
| --- | --- |
| 程序（部门、验证器、组合、真实运行） | [`examples/headless-agent/tests/fixtures/program-code-safety/`](../examples/headless-agent/tests/fixtures/program-code-safety/README.md) |
| 各部门阅读的安全技能 | [`data/knowledge/code-safety/`](../data/knowledge/code-safety/README.md) |
| 企业花名册与 feed | [`data/enterprise/`](../data/enterprise/README.md)、`scripts/harness-feed.ts` |
| 指挥台 | [`apps/command-deck/`](../apps/command-deck/README.md) |
| 已记录的运行与基准真值 | [`data/code-safety/`](../data/code-safety/README.md) |

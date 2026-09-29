# 数据处理：被审查代码库及其记录的去向

[English](data-handling.md) | 中文

本页说明：当 Daliesk 代码安全程序与企业班次按本仓库的组合方式运行时，被审查应用的代码与工作记录去往何处，每个去向受哪些条款约束，以及一次客户合作在读取任何客户代码之前需要什么。本页是这些事实的唯一归属：[演示手册](../code-safety-poc.md)、[代码安全记录](../../data/code-safety/README.md)与[客户简报](https://lbjlincoln.github.io/deepseek-harness/briefing/)都链接到这里。每一条陈述都注明它所依据的文件。

## 概要

- **代码会离开审查机器。**每个部门都通过操作者自己的 Claude Code 登录运行，因此每一次模型请求，连同部门读取的每个文件的文本，都在该账户的条款下发往 Anthropic 的模型 API。
- **记录是公开发布的。**一次被记录的审查会把它的会话日志（引用部门读过的代码）、它的发现（逐条引用所在行的原文）以及它的报告提交到本仓库，而本仓库在 GitHub 上的可见性为公开；实时捕获每五分钟把各部门的 Claude Code 转录推送到同一仓库。
- **目前没有任何协议覆盖客户数据。**代码安全会话不适用任何数据处理协议、零数据保留安排或数据使用条款：已提交的 114 份代码安全会话日志中，携带 `dataUse/terms` 的为 0 份。
- **尚未审查过任何客户代码。**[`data/code-safety/`](../../data/code-safety/README.md) 下的记录审查的是 OWASP NodeGoat 与 Damn Vulnerable Java Application（dvja）这两个公开的、有意设计为含漏洞的训练应用，以及本仓库自己的代码。

## 一次审查的数据流

一次审查在一台机器（审查机器）上运行，命令为 `pnpm run code-safety`，使用 [`claude-code` 叠加层](../../examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml)，这是[代码安全程序](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md)组合的唯一一条真实路由。各行按数据移动的先后排列。

| # | 移动的内容 | 去向 | 时机 | 来源 |
| --- | --- | --- | --- | --- |
| 1 | 目标文件树，只读 | 审查机器上各部门的会话 | 审查全程 | [程序 README](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md) |
| 2 | 每一次模型请求：对话内容，包括部门读取的每个文件或行范围的全文、扫描器的命中与审计的输出 | Anthropic 的模型 API，经由操作者已认证的 Claude Code 安装，在操作者的账户下 | 每个部门与集成的每一轮 | [`dsh-llm-claude-code`](../../packages/llm/llm-claude-code/README.md)；已提交的 114 份代码安全会话日志全部标明提供方为 `claude-code` |
| 3 | 目标解析后的依赖图（包名与版本） | npm 注册表，经由 `npm audit --json` | 依赖部门发现锁文件时 | [依赖部门预设](../../examples/headless-agent/tests/fixtures/program-code-safety/presets/dependencies/agent.cordis.yml) |
| 4 | 对 `p/owasp-top-ten` 规则包的请求，使用统计已关闭（`--metrics off`） | Semgrep 注册表 | 每个部门首次运行扫描器时 | [程序 README](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md) |
| 5 | 会话日志、带有每个被引用行原文的发现、报告 | 审查机器上的运行目录 | 审查期间 | [`data/code-safety/README.md`](../../data/code-safety/README.md) |
| 6 | Claude Code 自己记录的各部门会话转录，凭据形态的字符串与电子邮件地址已遮盖，其余按原样 | GitHub 上的本仓库，公开，每五分钟一次 | [`scripts/transcripts-capture.sh`](../../scripts/transcripts-capture.sh) 运行期间 | [`data/transcripts/README.md`](../../data/transcripts/README.md) |
| 7 | 一次被记录的审查：每份会话日志、发现、报告、审查器的输出；密钥材料与电子邮件地址已替换 | GitHub 上的本仓库，公开，位于 `data/code-safety/<record>/` | 操作者运行 `record-run.mjs` 并推送时 | [`record-run.mjs`](../../data/code-safety/tools/record-run.mjs) |
| 8 | 审查的发现（各带其源代码行）与报告 | Supabase 项目上的镜像中继，其 feed 对每次读取都不要求认证，并允许任意来源 | [`pusher.mjs`](../../apps/command-deck/mirror/README.md) 运行期间 | [镜像 README](../../apps/command-deck/mirror/README.md) |
| 9 | 指挥台位于 `public/fixtures/safety/` 下的审查 fixture（带源代码行的发现、报告） | GitHub Pages，公开 | 分支上每次改动 `apps/command-deck/` 的推送 | [`deck-pages.yml`](../../.github/workflows/deck-pages.yml)、[指挥台 README](../../apps/command-deck/README.md) |

企业班次沿用第 2 行与第 6 行，并按第 7 行的方式发布：班次、评审者与接收会话通过同一登录运行，每个班次都把它的会话日志提交到同一仓库（[简报的数据](../../apps/command-deck/public/fixtures/briefing-claims.md)）。

## 约束每个去向的条款

| 去向 | 条款 | 本仓库记录了什么 |
| --- | --- | --- |
| Anthropic 的模型 API | 操作者的 Claude Code 账户及其服务条款 | 没有这些条款的副本，没有数据处理协议，也没有零数据保留安排。该账户的条款对保留与训练说了什么，要从账户自己的协议中读取，而不是从本仓库读取。 |
| 本仓库与 GitHub Pages | 公开 | 可见性为 `public`，由[简报构建器](../../scripts/enterprise-briefing.ts)从 GitHub 的 API 读入 [`briefing.json`](../../apps/command-deck/public/fixtures/briefing.json)。任何人都能读取与克隆。删除一个文件不会把它从 git 历史中移除。 |
| 镜像中继 | 公开读取 | pusher 的令牌只保护写入；`GET /safety/:id` 对任何人都应答（[镜像 README](../../apps/command-deck/mirror/README.md)）。 |
| npm 与 Semgrep 注册表 | 各注册表自己的条款 | 除第 3 行与第 4 行的命令外，没有其他记录。 |

harness 自己的数据使用条款 [`dsh-data-use`](../../packages/governance/data-use/README.md) 会在包含该插件的组合的每个会话上钉住一个客户、一份协议、用途、驻留地、保留期与一个脱敏配置。代码安全程序没有包含它，因此没有任何代码安全会话携带条款，任何班次或接收会话也都没有（[简报的数据](../../apps/command-deck/public/fixtures/briefing-claims.md)）。确实携带条款的 bench 会话钉住的是 `purposes: [evaluation]`、`residency: eu-west` 与 `retentionDays: 90`（[bench 组合](../../examples/headless-agent/tests/fixtures/proving-ground-bench/cordis.yml)）：这些是 harness 写进日志的标签，[curator](../../packages/governance/curator/README.md) 读取它们来决定一次数据集导出可以包含什么。它们不是模型提供方的条款，而且该插件无法检查驻留地是否就是转录实际所在的位置；这些转录位于一个公开仓库中，其历史会一直保留它们。

操作者的个人电子邮件地址以明文形式在八份已提交的代码安全记录的 15 个文件中出现了 67 次，这些记录都是在 [`record-run.mjs`](../../data/code-safety/tools/record-run.mjs) 开始遮盖电子邮件地址之前提交的；较早的实时转录分块中也有它（[`data/transcripts/README.md`](../../data/transcripts/README.md)）。

## 一次客户合作需要什么

在读取任何客户代码之前：

1. **一条受数据处理协议约束的模型路由。**为这次合作设立一个 Anthropic API 组织，受一份带零数据保留的数据处理协议约束，用该组织的 API 密钥而不是操作者的登录为各部门提供服务。[`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) 可以从 `ANTHROPIC_API_KEY` 提供一条 `anthropic` 路由；代码安全程序目前还没有为它组合任何叠加层。所选模型必须是零保留安排所覆盖的模型：Anthropic 于 2026 年 9 月 1 日发布的两个模型带有 30 天的最短保留期，并且不在零数据保留下提供（[知识包](../../data/knowledge/2026-09-fortnight/skills/frontier-and-api-shifts-2026w36/SKILL.md)）。
2. **记录放在本仓库之外。**客户的审查写入该客户专属的私有存储，绝不写到 `data/code-safety/` 下：`record-run.mjs` 只写那里。指挥台的 fixture 不从客户审查中生成快照，镜像 pusher 不运行，实时捕获也不读取这次合作的会话。
3. **每个会话都带数据使用条款。**代码安全组合包含 `dsh-data-use`，使用客户自己的条款，其保留期要由存放记录的存储来兑现。
4. **注册表调用经过商定。**由客户决定 `npm audit` 是否可以把其依赖图发往公共 npm 注册表、扫描器是否可以获取注册表规则包，或者为两者指定镜像。

## 仍待操作者作出的决定

- **公开历史。**在向客户展示本仓库之前，从公开历史中清除转录、代码安全会话日志与操作者的电子邮件地址，或者把仓库设为私有。
- **中继。**在没有私有 feed 之前保持 pusher 关闭，并轮换中继的令牌。
- **实时捕获。**在它读取任何含客户材料的会话之前，把它指向一个私有目的地。
- **协议。**签署 API 组织的数据处理协议与零保留安排，并确认操作者自己的 Claude Code 账户目前适用哪些条款。

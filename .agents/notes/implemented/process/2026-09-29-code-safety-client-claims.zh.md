# Agent Note: 客户审查者可以核对的代码安全与数据处理声明

Status: implemented

[English](2026-09-29-code-safety-client-claims.md) | 中文

## Problem

一家财富 500 强客户的安全、法务与财务团队所读到的关于代码安全程序的文字，陈述的内容超出了记录所能支持的范围。演示手册写道"客户的代码留在运行审查的那台机器上"以及"每个会话都记录它的数据使用条款"。两者都不成立：每个部门都通过操作者的 Claude Code 登录运行，因此部门读取的每个文件都会发往 Anthropic 的模型 API；被记录的审查、实时转录捕获、镜像中继与已发布的指挥台会把审查所引用的代码放到公开的地方；而已提交的 114 份代码安全会话日志中没有一份携带 `dataUse/terms`。手册归于订阅条款的"只允许评估"，其实是 bench 组合钉在它自己的会话上的用途，而不是模型提供方的条款。

代码安全的数字也以同样的方式被夸大了。"经验证的发现"读起来像已确认的缺陷，而审查器只检查被引用的文本是否在所引用的行上，并且唯一一次经过分诊的审查认定它的四条 `confirmed` 非 canary 发现都不成立。首页说第二次审查与第一次"落在相同的行上"，而记录说的是三行之内。对比把单次通过定价为 $0.36，把企业标为"订阅"，把企业的 47 条发现称为"真实发现"并说"检视的攻击面翻了一倍多"，而其中 15 条未经分诊；在只运行一次之后就称单次通过是非确定性的；并声称在没有任何记录达到的规模上有优势。18 之 18 的读数来自根据同一目标的漏检写成的清单，却没有任何标注说明这一点；手册的时间与发现数描述的是一个更早的程序。

审查自己的交付物是为审查器而不是为高管写的：每份 `SAFETY-REPORT.md` 都以法文摘要开头，然后在任何风险陈述之前先给出一个机器路径和一个 SHA-256，没有封面、没有严重度概览、没有修复优先级，也无法打印；带种子的自我审查的报告以一个植入在真实产品路径上的 `eval()` 作为头条，却没有说明这棵树是预埋过的。

## Decision

**由一个页面陈述数据流。**[`docs/client/data-handling.md`](../../../../docs/client/data-handling.md) 及其中文配对，是被审查代码库及其记录去向的唯一归属：按发生顺序列出的九次数据移动，每一次都带其来源文件；约束每个去向的条款，以及本仓库关于它们没有记录什么（没有账户条款的副本，没有数据处理协议，没有零数据保留安排）；harness 自己的数据使用条款，以及为什么 bench 的 `eu-west` 与 90 天标签不能描述一个公开仓库；一次客户合作在读取任何客户代码之前需要什么；以及仍待操作者作出的决定。手册的"不可以宣称什么"现在禁止宣称代码留在审查机器上或不会被用于训练，并链接到该页面；根 README、代码安全记录的 README 与指挥台的 README 在描述引用被审查代码的记录或 fixture 之处链接它。客户简报已经陈述了同样的数据流，其声明登记禁止出现"never leaves"这一短语，因此它的页面与数据保持不变；由同一份数据渲染的执行摘要 [`enterprise-briefing-summary.ts`](../../../../scripts/enterprise-briefing-summary.ts) 链接到该页面。

**每一个面向客户的召回数字都说明其分母、匹配规则与样本。**根 README、手册、代码安全记录的 README、对比 README 与执行摘要都使用"行级验证"并用一句话定义它；只有落在已记载问题三行之内才算找到该问题；NodeGoat 召回写作：不含诊断修正清单的十次审查为 18 之 13 到 15，含这些清单的两次为 18 之 18，并标注为样本内；运行间的重合按实测陈述（第一次运行的 42 条发现中有 38 条在同一文件三行之内有对应，其中 31 条 CWE 相同）；预埋读数的 8 之 6 出现在哪里，其 95% 区间 [0.409, 0.929] 就出现在哪里。手册预期的是本分支上的程序实际产出的结果：二十五到三十分钟内 49 到 70 条发现。

**对比说明每一层的条件，并删去任何记录都不支持的内容。**每一层都只运行一次，表格如实说明；单次通过连同其只读工具与通用提示词一起描述；它的 $0.36 标为 Claude Code 自己的计费，企业层陈述其 12,367,319 个 token——[`assemble-comparison.mjs`](../../../../data/code-safety/tools/assemble-comparison.mjs) 现在从记录的 `usage` 分块中求和得出——因为记录中没有订阅路由的美元价格。"真实发现""翻了一倍多""非确定性"与"规模上领先"都已删除；超出基准真值的 15 条发现被称为未经分诊的候选，规模被陈述为未经检验。[`iterations.json`](../../../../data/code-safety/comparisons/2026-09-22-nodegoat/iterations.json) 把经过调优的迭代标注为样本内，未调优运行所在的区间由 12 至 15 更正为 13 至 15，指挥台的对比 fixture 由 [`snapshot-fixtures.ts`](../../../../apps/command-deck/scripts/snapshot-fixtures.ts) 所运行的那一步从重新组装的记录复制而来。

**面向客户的评估由记录渲染而成，从不手写。**[`client-report.mjs`](../../../../data/code-safety/tools/client-report.mjs) 读取一份记录——它的 manifest、发现、审查器输出与会话日志——以及当 `targets/` 中有目标的基准真值时读取该基准真值，并在 `data/code-safety/reports/<record>/` 下写出 `SECURITY-ASSESSMENT.md` 和一个自包含、可直接打印的 `SECURITY-ASSESSMENT.html`；`--pdf <file>` 通过 playwright-core 的 Chromium 把 HTML 打印出来。评估的开头是针对 NodeGoat 与 dvja 的训练目标提示，或针对 manifest 带 `seeded` 的记录的预埋副本横幅；一张列出目标、日期、审查方、程序修订版、审查器结论与密级的封面表；一份执行摘要，包含严重度条、带匹配规则的召回率、超出已记载列表且未经分诊的发现数、关于部门置信度的说明，以及五项最紧急的修复，其中所有依赖发现合并为一项升级；然后是范围与方法、按严重度排序的发现、逐个已记载问题的召回率，并附同一目标的其他审查按 knowledge pack 分组的结果，经过调优的那一组标为样本内，接着是局限，以及链接到数据处理页面的数据处理一节。路径、摘要以及每条发现的引用行、证据、影响与修复都放在附录中。已提交的评估是最新一份 NodeGoat 记录 `2026-09-27-nodegoat-12-base-d` 的评估；[`code-safety-client-report.spec.ts`](../../../../scripts/code-safety-client-report.spec.ts) 在它与其记录的渲染结果不一致时失败，并检查训练目标与预埋副本的标注。记录本身保持不被编辑。

## Alternatives considered

**只就地更正手册中的那句话，不另设页面。**一句更正无法容纳九个去向、它们的条款与合作要求，而且 README 与简报也需要同样的事实；由一个页面承载、各处链接它，才能让每个事实只有一个归属。

**陈述 Anthropic 对该订阅的保留与训练条款。**本仓库没有该账户条款的副本，这次改动也无法查阅仓库之外的任何来源，因此页面只陈述仓库所记录的内容，并把确认这些条款列为一项待定决定，而不是断言它们。

**为企业层给出美元价格。**为 12,367,319 个 token 定价需要一份价目表，而本仓库没有订阅路由的价目表；取自记录之外的价格将成为对比中唯一无人能核对的数字。token 是被测量的量，表格说明没有记录美元价格。

**修改指挥台的组件。**Benchmark 面板中写死的句子（"every finding verified""non-deterministic""repeatable"）属于指挥台自己的维护者；这次改动更正了这些组件读取的数据，包括层级名称与描述，组件文本留给他们处理。

**在指挥台中增加一个全宽的报告路由。**路由会把报告放在审查旁边，但指挥台的组件属于指挥台自己的维护者，而由记录渲染出的文件才是客户的安全团队会保存、转发与打印的东西；指挥台可以链接已提交的 HTML。

**在每份记录的 `SAFETY-REPORT.md` 里加盖横幅。**记录在运行之后从不编辑；预埋横幅属于渲染结果，它读取 `manifest.seeded`。

## Consequences

**读者可以核对每一条数据处理陈述。**数据流的每一行都注明能证明它的文件，而唯一的数量性声明——114 份代码安全会话日志中携带条款的为 0 份——用一次 `git grep` 即可核对。

**页面点明了这次改动没有完成的工作。**没有任何叠加层从 API 组织为各部门提供服务，代码安全组合没有钉住任何条款，`record-run.mjs` 只写到 `data/code-safety/` 下，而操作者的电子邮件地址仍以明文留在八份记录的 15 个文件中，这些记录都是在记录器遮盖电子邮件地址之前提交的。页面把每一项都列为要求或待定决定，而不是暗示它已完成。

**客户读到的数字就是记录给出的数字，并附带其条件。**标题不再把每层的一次运行当作程序的结果来展示，而有利的 18 之 18 只与"它是在据以写成这些清单的目标上测得的"这一标注一同出现。

**下一次审查得到同样的报告。**渲染只需要记录本身，因此一份新记录（包括预埋副本的记录）只差一条命令就能成为客户文档，而记录或渲染器的改动会表现为失败的 spec，而不是过时的文件。NodeGoat 记录的 PDF 共 36 页 A4，大部分是发现详情，不提交到仓库。

## Verification

- `git grep -l 'dataUse/terms' -- 'data/code-safety/*/sessions/*.jsonl'` 不列出任何文件，而 `git ls-files 'data/code-safety/*/sessions/*.jsonl'` 列出 114 个。
- `pnpm run verify-translation-pairing` 在新的配对以及重新记录的手册、根 README、代码安全 README 与指挥台 README 配对上通过。
- `node data/code-safety/tools/recall.mjs <record> data/code-safety/targets/nodegoat.ground-truth.json` 在十二份 NodeGoat 记录上，对不含诊断修正清单的十份读出 18 之 14、14、13、13、15、14、13、15、14 与 15，对 `2026-09-27-nodegoat-9-misses-a` 与 `-11-misses-b` 读出 18 与 18。
- `node data/code-safety/tools/assemble-comparison.mjs data/code-safety/targets/nodegoat.ground-truth.json data/code-safety/comparisons/2026-09-22-nodegoat` 写出企业层的 token：输入 380、输出 214,017、缓存读取 11,413,217、缓存写入 739,705，共 12,367,319。
- `pnpm exec vitest run scripts/enterprise-briefing.spec.ts scripts/enterprise-briefing-claims.spec.ts` 通过，执行摘要配对就是已提交的 `briefing.json` 的渲染结果。
- `node data/code-safety/tools/client-report.mjs --check` 报告已提交的评估与 `data/code-safety/2026-09-27-nodegoat-12-base-d` 一致，`pnpm exec vitest run scripts/code-safety-client-report.spec.ts` 通过。
- `PLAYWRIGHT_CORE=<playwright-core dir> PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium node data/code-safety/tools/client-report.mjs --pdf <file>` 写出一份 36 页的 A4 PDF。
- `pnpm run doc-sync` 通过。

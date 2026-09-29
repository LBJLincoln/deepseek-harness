# Agent Note：客户不会打折扣的标题数字、基准声明与 Daliesk 身份

Status: implemented

[English](2026-09-29-headline-figures-and-daliesk-identity.md) | 中文

## 问题

客户最先读到的数字统计的是席位，而不是工作。指挥台的页头、冷开场、标题卡与企业面板把已定义、被占据与"active today"的席位作为孤立的计数陈述，根 README 说指挥台"展示 147 个已定义 agent"。在 2026-09-29 07:07 UTC 盖章的花名册里，44 个活跃席位中有 22 个是自动检查——一个 `verify-*` 包脚本、一个从 GitHub 读取的 Branch CI 裁决、一次对已记录会话的折叠——另有 4 个只因某条工单行而活跃，而该工单所在的 shift 在任何模型运行之前就停止了；"today"是一个固定的时间窗，窗口结束后仍保留这个标签。企业面板以从未运行过的路由和没有任何席位持有的会话开场，并用警示琥珀色绘制从未运行的席位。

Proving Ground 在它的基准上犯了同样的错误。仪表板以"1,645 cells run · 1,473 certificates"开场，这是所有层级的汇总，其中还包括认证一个由简单任务组成的 village 的 district cell 以及一个模拟模型，且没有区间；它对判定卡片排序，使三张绿色的 PROMOTE 卡片排在最前，而其中没有一项是被采纳的改动；它的循环表把每个时间戳折成四行，卡片裁掉了自己的标签；根 README 引用循环的"前五次迭代"，而循环已运行十六次且没有采纳任何改动。

客户分不清谁做了什么。仓库首页把 DeepSeek AI 称为开发者，却从未提到 Daliesk；它的克隆命令拉取的是上游仓库，而上游缺少这个分叉新增的每一条命令；指挥台的链接预览还承诺了"147 agents"。

## 决定

**每条交付物都有一种工作类型。** `scripts/enterprise-ledger.ts` 为每条交付物分类（`workOf`）：模型驱动——一个归属会话；一条其部门或评审运行过会话、已发布或记录了模型 token 的工单行；以及四个检查事业部之外的一条职能行（代码安全 `review`、`intake`）；自动检查——验证、裁决、观象台或策展与数据事业部的一条职能行；其余任何工单行都是在任何模型运行之前就停止的。`seatWork` 在一个席位的全部交付物中、以及时间窗内的交付物中取最强的那一类。花名册在每个被占据的席位上带有 `work`，并带有 `counts.work.{occupied,active}`，每种拆分之和等于它所拆分的计数；`divisionSeats`、`enterprise.json` 与 24 小时报告按事业部带有同样的拆分。

**企业以它交付了什么开场。** `enterprise.json` 新增 `outcomes`：在时间窗内有一行发布了提交的工单（之后被另一个 shift 重做的工单仍只计一次）、由模型处理但未发布任何内容的工单、在任何模型运行之前就停止的工单、按职能计的模型驱动职能运行，以及按结果计的自动检查。企业面板的标题、冷开场与巡览的标题卡陈述这些成果并注明时间窗的终点；随后才是按工作拆分的席位。路由与未归属的会话移入事业部下方一个折叠的 Evidence audit，没有任何交付物的席位以中性灰写作 `provisioned, no work assigned yet`。

**页头从不显示一个孤立的活跃数。** 它显示已定义的席位、被占据的席位，以及时间窗内的活跃席位，分为模型驱动、自动检查与（若有）停止的席位，旁边是花名册的时间戳与时长，并点名 `data/enterprise/roster.json` 为来源；计数为零时以 `--ink-3` 绘制。实时 feed 保留文件中注明时刻的计数，并加上标为"running now"的 `counts.running`；此前它把此刻正在运行的席位报告在 `active` 之下。

**基准以站得住的比率开场。** `data/proving-ground/tools/build-dashboard.mjs` 计算一个 `headline`：实验、fleet 与 partial 记录的 cell 按层级与是否密封分组的认证率，附带 95 % Wilson 区间以及汇总其中的模型与循环，密封的第 5 层排在最前；district 的 cell 与没有层级的测试集分开统计。它按判定是否决定性（`promote` 或 `reject`）统计冻结配对，逐臂汇总四组 harness 对产品的配对，并按类型、按决定性判定、按是否应用了改动统计循环的迭代，后者读自改进日志的 "Default changed" 列。页面用文字陈述这些内容（"What the paired comparisons show"），把判定卡片按从新到旧排序，以每张卡片提出的问题为其命名，把判定标为 "candidate better"、"candidate worse" 或 "no clear difference" 并注明是否决定性，并给未改变任何默认值的更优候选标上 "not adopted"。循环表把日期读作 `19 Sep 11:49`，写出每个计划的问题，并把计划 id、队列、叠加层与统计量移入提示；卡片会为长的臂标签换行，单臂运行以中性灰绘制。根 README 的 Proving Ground 一节以同样的数字陈述，并注明模型、cell 数、区间与是否决定性；记录 README 说明它的表格列出由人记录的记录，循环之后写出的十一份记录在台账与页面上。`--branch` 指定页面链接所指向的分支，供在 worktree 中构建时使用。

**一个名称、一句定位，以及诚实的来源说明。** Daliesk 是企业以及客户打开的每个页面的名称；DeepSeek Harness 是其下 harness 的名称，并保留其 `@deepseek-ai/dsh-*` 包。根 README 这一对文件以一句定位开场，附上指挥台、简报、执行摘要与数据处理页面的链接，以及一段来源说明：本仓库是 `deepseek-ai/deepseek-harness` 的分叉，GitHub 账户 LBJLincoln 在其上运营 Daliesk，DeepSeek AI 既未构建、未审查，也未认可这个分叉新增的内容。它说明实际运行过哪些模型路由，让克隆指向这个分叉的分支，并把社区渠道标明为上游项目的渠道；上游的介绍、开发者预览声明与 MIT 许可证保持原样。指挥台的元数据带有同一句话和一个 Daliesk 图标（`app/icon.svg`），它的 README 这一对文件以 Daliesk Command Deck 为标题并保留包名，仪表板的眉题写作 "Daliesk · Proving Ground"，并把原先的"操作者的订阅"改为一个 Claude Code 登录。

**首屏以同样的拆分陈述数字并注明来源。** 根 README 这一对文件以交付成果和读自 2026-09-29 07:07 UTC 盖章花名册的席位拆分开场，并注明每个数字来自哪个文件；企业 README 这一对文件说明如何读这些计数；演示手册这一对文件要求操作者把拆分说出来，并禁止声称每个活跃席位都是一个 agent。

## 考虑过的替代方案

**只把模型会话算作占据。** 这会让花名册与指挥台、职能运行器和各报告共用的台账规则不一致，并隐藏确实是交付物的自动检查；按类型拆分既保留一条规则，又说明每个席位做了什么。

**按事业部给席位分类。** 一个策展席位处理了一张工单，另一个策展席位运行了一次折叠；按交付物而非事业部分类，才能按每个席位实际做的事来读它。

**不给出汇总的层级，只显示按模型的臂。** "Models on sealed tier 5" 面板已为单一模型的臂做到这一点；客户首先会问一个任务到底有多常被解决，汇总的比率连同其区间与所汇总的模型回答了这个问题，而按模型的面板与判定卡片回答的是哪个模型。

**只有当工单最新的一行发布了它时才算已发布。** T-0007 在 02:04 UTC 发布，之后一个从不知道这一点的检出启动的 shift 在 04:14 UTC 又处理它并停止；按最新一行的规则会报告发布了 2 张，而分支上实际有 3 张。

## 后果

**每个席位数字都可核查。** 每个计数都注明其文件、时间戳与规则，三种类型之和等于它们所拆分的总数。

**README 中的数字会变旧。** README 注明读取时的时间戳；指挥台显示当前花名册及其时长，下一个周期的 `pnpm run roster` 与 `pnpm run enterprise:publish` 会以同样的字段重写数据。

**机器提交与操作者提交仍共用一个作者。** `scripts/enterprise-cycle.sh` 设置周期的提交者，为周期、引擎与操作者的提交区分作者，留给负责该脚本的改动去做。指挥台仍由 `lbjlincoln.github.io/deepseek-harness` 提供，且不带预览图，因为绝对图片 URL 需要一个构建时并不携带的站点来源。

**基准数字随记录变旧。** README 陈述的是仪表板在 2026-09-29 折叠出的数字；夜间循环每晚增加一份记录与一行台账，页面在重建时会重新计算每个数字。

**shift 与 intake 的会话仍只通过台账行到达席位。** 花名册的会话证据读取 `data/proving-ground` 与 `data/code-safety`；工单行或 intake 行代表其会话日志，因此这些席位被算作模型驱动，而它们的会话并未被归属。

## 验证

- `pnpm run roster` 在 141 条台账行上打印"53 occupied (27 model-driven, 22 automated checks, 4 halted before any model ran), 44 active … (18 model-driven, 22 automated checks, 4 halted before any model ran)"，而 `enterprise.json` 的 `outcomes` 读作 3 张已发布、3 张未发布、4 张在任何模型运行之前就停止、7 个审查席位中 7 个、2 位 intake 协调员中 2 位，以及 114 项自动检查中 105 项通过。
- `node data/proving-ground/tools/build-dashboard.mjs` 打印 "sealed tier 5 624 of 733, 95 % [82.4, 87.5]; 4 of 23 frozen pairs decisive; the loop 16 iterations, 0 adopted"，而 `dashboard.png` 是该页面在无头 Chromium 中 1440×2400 的截图。
- `scripts/enterprise-ledger.spec.ts`、`scripts/enterprise-roster.spec.ts`、`scripts/enterprise-publish.spec.ts` 与 `scripts/harness-feed.spec.ts` 覆盖分类、拆分计数、成果与实时的 `running` 计数。

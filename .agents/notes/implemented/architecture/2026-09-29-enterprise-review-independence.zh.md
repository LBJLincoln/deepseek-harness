# Agent Note: 记录在案的评审独立性：每条工单行写明的评审员，以及留待分诊的驳回

Status: implemented

[English](2026-09-29-enterprise-review-independence.md) | 中文

## Problem

[班次引擎](2026-09-28-enterprise-shift-engine.md)在一个从未见过部门会话的会话里评审每个已认证的部门，但它的台账行只记录结论与评审会话的 id。台账的读者——Command Deck、客户简报、审计人员——看不到是哪条路由、哪个模型作出的评审，也看不到评审员是独立于实施者选定的：两者都运行在组合里唯一的 `agent-default-model` 选择上，因此迄今为止的每次评审都运行在它所评判的部门所用的产品模型上。记录表明了这掩盖了什么。在班次 `171951-516d` 中，`T-0019` 的评审员（`review-t-0019-e3dd7355`，按其日志的请求头为 `claude-code` 上的 `sonnet`）驳回了一项正确的修改：工单要求的测试导入改动树里早已存在。该班次在写出任何台账行之前就崩溃了，因此这次驳回从未进入台账；下一个班次 `182951-78a6` 再次领取了 `T-0019`，一位运行在同一路由与模型上的评审员（`review-t-0019-da50c0af`）批准了它，它以 `cfe0a75f7` 发运。在那个班次中，`T-0012` 的评审员批准了 `1d6a5d343`，而它没有重新记录其 README 配对；操作者在 `b7cf48055` 中返工修正了它，该提交以 `2f7ba31d7` 进入分支的第一父提交线。无论是这次驳回、同一模型的再次评审，还是这次返工，都无法从台账或指挥台上看到。

## Decision

**每条由评审作出裁定的行都写明评审员。** 工单行新增可选的 `reviewer: { sessionId, route, model, verdict }`：评审会话、组合为评审会话解析出的路由与模型，以及结论。只要评审返回了结论，引擎就写出它，没有结论时则省略；在它之前写下的行没有这个字段，读者把它们显示为 `reviewer not recorded`。[`scripts/enterprise-ledger.ts`](../../../../scripts/enterprise-ledger.ts) 读取这个字段，已发运提交的信息在评审会话旁写明评审员（`Reviewer: <model> on <route>`）。

**评审员的路由与模型独立于各部门单独组合。** 班次的两份组合都带一个 `enterprise-review-model` 条目（[`review-model.ts`](../../../../examples/headless-agent/tests/fixtures/enterprise-shift/review-model.ts)），其 `provider` 与 `model` 必填且不得为空，为空则加载失败。无密钥组合写明 `cli-mock-reviewer`，即其脚本化路由声明的第二个模型；Claude Code 覆盖层读取 `DSH_ENTERPRISE_REVIEW_MODEL`，未设置时为 `sonnet`，`pnpm run enterprise -- shift --review-model <id>` 设置它。驱动在组合启动之后、程序开始之前立即经 LLM 注册表解析这一对值，因此路由未声明的模型会让班次的每张工单都以 `the shift's reviewer route does not resolve: <注册表给出的原因>` 失败，在任何部门花费预算之前。默认值与各部门的默认值相同，因此在操作者指定另一个模型之前，无人值守的周期照旧评审。

**被驳回的工单留待人工分诊，永不再次评审。** 台账把最近一行为驳回的工单视为已关闭，因此不再有班次领取它，无论用同一个模型还是任何其他模型；引擎缺的是一个可见的原因。[`shift.ts`](../../../../examples/headless-agent/tests/fixtures/enterprise-shift/shift.ts) 中的 `heldForTriage` 列出每张被关闭为驳回的队列工单，原因写明它最近一次驳回：班次、评审会话，以及评审员的模型与路由或 `reviewer not recorded`。驱动在结果行中把这份清单作为 `held` 打印出来，没有找到未关闭工单的班次的结果行也不例外，并把它写进班次记录的 `result.json`。由人决定这张工单的去向：intake 会把被驳回工单的来源作为一张新工单重新接纳。

**每个读者都用同一条状态规则。** [`scripts/enterprise-ledger.ts`](../../../../scripts/enterprise-ledger.ts) 中的 `ticketStandings` 给出每张工单的状态以及陈述该状态的那一行，引擎的选择、指挥台的数据、简报与报告都调用它：只要工单的任一行发运了一个提交，无论各行顺序如何，工单即为 `shipped`，由那一行及其提交陈述；否则由它在文件顺序中的最近一行陈述，事后补记的行只有在其 `at` 不更早时才占据这个位置。此前各读者的做法并不一致。指挥台的数据与简报按 `at` 取每张工单最新的一行，因此把 `T-0007` 读成 halted：班次 `041341-222d` 在 04:13Z 选中它——早于班次 `001527-881f` 以 `cba8e4682` 发运它的那一行（注明 02:04Z，即该班次写下它的时刻）随该班次在 06:45Z 的推送到达分支——并在 04:14Z 使它失败。引擎读取文件顺序中的最后一行，看到的是已发运，而这些数字旁边的评审记录也把它列为已发运。

**指挥台与客户简报展示从数据计算出的评审记录。** [`scripts/enterprise-publish.ts`](../../../../scripts/enterprise-publish.ts) 为 `enterprise.json` 加入覆盖整个台账的 `reviews` 记录——统计批准与驳回、写明评审员的行数，以及每次评审连同其评审员的模型、路由与会话，被同一工单后来已发运的行所推翻的驳回标记为 overturned——并为每张工单摘要加入其评审与评审员；指挥台的 Ledger 标签页列出它们，没有该字段的行显示 `reviewer not recorded`。[`scripts/enterprise-briefing.ts`](../../../../scripts/enterprise-briefing.ts) 从台账统计批准与驳回，并构建 `/briefing` 页面治理一节中的评审记录：台账中的每次评审连同其行所写的评审员；从班次记录读出的其会话日志第一个请求发出时所用的路由与模型及其工具调用数；没有任何台账行写明的班次记录中的每个评审日志，连同其最后一次回答的结论行——`171951-516d` 对 `T-0019` 的驳回正是这样出现在页面上的，而那个班次没有台账行；被后来已发运的行推翻的驳回；以及被后来的提交返工的批准，即已发运提交之后、信息中写明该提交、且修改了该提交所改目录中某个文件的提交，cherry-pick 只计一次。页面上没有写入任何关于某张工单的内容。

## Alternatives considered

**在下一次尝试时换用备用评审模型。** 被驳回的工单就得重新打开，这会改变简报、报告、intake 的准入与请求状态共用的关闭规则，而下一次尝试要以完整预算重跑一个部门，只为了一项评审员已经拒绝过的修改。备用模型自己的驳回随后又需要第三个模型。留待分诊让现有的关闭规则变得可见，且不花任何代价。

**由驱动从环境中读取评审员的模型。** 这个选择会落在驱动里，而不是落在掌管每条路由的组合里，无密钥组合也无法写明自己的选择。组合条目把这个选择留在 `cordis.yml` 中，并在加载处校验。

**以按 `at` 最新的一行、或文件顺序中的最后一行作为工单的状态。** 前者如上所述把 `T-0007` 读成 halted。后者会重新打开 `T-0012`，并把 `T-0019` 变成一次驳回，因为班次 `171951-516d` 事后补记的各行位于文件末尾，其 `at` 却早于发运这两张工单的行。已发运的提交会留在分支上，因此任一发运行都足以确定工单的状态。

**换一个默认评审模型。** 把评审员默认设为 `opus` 会让模型独立成为默认，但它会在操作者未作决定的情况下改变无人值守周期对订阅用量上限的消耗。默认值保持为各部门的模型，换模型只需一个选项。

## Consequences

从运行这台引擎的第一个班次起，台账的读者就能看到每张工单由谁评审，较早的行保持标记为未记录，而不是被推断出来。返工规则读取 git：写明已发运提交、却只修改别处文件的后续提交不计入，而修正了该修改却没有写明其提交的后续提交会被漏掉。路由拒绝的评审模型会让一个班次白白付出开始行推送与工作树安装，并让该班次的每张工单得到一条算作一次尝试的失败行。像 `T-0019` 那样的错误驳回会让工单保持关闭，直到有人重新提交它；引擎从不拿第二次评审来换。评审员与各部门仍共用一条路由，默认也共用一个模型：引擎保证的独立性是一个没有工具、没有父会话、无法访问部门工作树的独立会话，而使用自己的模型是操作者选择的配置。

## Verification

[`enterprise-shift.spec.ts`](../../../../examples/headless-agent/tests/enterprise-shift.spec.ts) 把被驳回的工单挡在选择之外，并在评审员已记录与未记录两种情况下写明原因，还固定了已发运提交中的评审员行；[`scripts/enterprise-ledger.spec.ts`](../../../../scripts/enterprise-ledger.spec.ts) 读取该字段；[`scripts/enterprise.spec.ts`](../../../../scripts/enterprise.spec.ts) 解析 `--review-model`；[`scripts/enterprise-publish.spec.ts`](../../../../scripts/enterprise-publish.spec.ts) 统计评审记录与被推翻的驳回；[`scripts/enterprise-briefing.spec.ts`](../../../../scripts/enterprise-briefing.spec.ts) 从台账行与崩溃班次的评审日志构建记录，读取一份已提交评审日志的结论与请求，并在一个临时仓库中找出返工提交，同时跳过只提及已发运提交的提交。[`enterprise-shift.e2e.ts`](../../../../examples/headless-agent/tests/enterprise-shift.e2e.ts) 证明已发运与被驳回工单的台账行都写明运行在 `cli-mock-reviewer` 上的评审员，评审员的请求以该模型发出而部门的请求以 `cli-mock` 发出，并证明路由未声明的评审模型会在任何部门运行之前让班次的工单失败。

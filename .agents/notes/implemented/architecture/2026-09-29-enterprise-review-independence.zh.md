# Agent Note: 记录在案的评审独立性：每条工单行写明的评审员，以及留待分诊的驳回

Status: implemented

[English](2026-09-29-enterprise-review-independence.md) | 中文

## Problem

[班次引擎](2026-09-28-enterprise-shift-engine.md)在一个从未见过部门会话的会话里评审每个已认证的部门，但它的台账行只记录结论与评审会话的 id。台账的读者——Command Deck、客户简报、审计人员——看不到是哪条路由、哪个模型作出的评审，也看不到评审员是独立于实施者选定的：两者都运行在组合里唯一的 `agent-default-model` 选择上，因此迄今为止的每次评审都运行在它所评判的部门所用的产品模型上。记录表明了这掩盖了什么。在班次 `171951-516d` 中，`T-0019` 的评审员（`review-t-0019-e3dd7355`，按其日志的请求头为 `claude-code` 上的 `sonnet`）驳回了一项正确的修改：工单要求的测试导入改动树里早已存在。该班次在写出任何台账行之前就崩溃了，因此这次驳回从未进入台账；下一个班次 `182951-78a6` 再次领取了 `T-0019`，一位运行在同一路由与模型上的评审员（`review-t-0019-da50c0af`）批准了它，它以 `cfe0a75f7` 发运。在那个班次中，`T-0012` 的评审员批准了 `1d6a5d343`，而它没有重新记录其 README 配对；操作者在 `2f7ba31d7` 中返工修正了它。

## Decision

**每条由评审作出裁定的行都写明评审员。** 工单行新增可选的 `reviewer: { sessionId, route, model, verdict }`：评审会话、组合为评审会话解析出的路由与模型，以及结论。只要评审返回了结论，引擎就写出它，没有结论时则省略；在它之前写下的行没有这个字段，读者把它们显示为 `reviewer not recorded`。[`scripts/enterprise-ledger.ts`](../../../../scripts/enterprise-ledger.ts) 读取这个字段，已发运提交的信息在评审会话旁写明评审员（`Reviewer: <model> on <route>`）。

**评审员的路由与模型独立于各部门单独组合。** 班次的两份组合都带一个 `enterprise-review-model` 条目（[`review-model.ts`](../../../../examples/headless-agent/tests/fixtures/enterprise-shift/review-model.ts)），其 `provider` 与 `model` 必填且不得为空，为空则加载失败。无密钥组合写明 `cli-mock-reviewer`，即其脚本化路由声明的第二个模型；Claude Code 覆盖层读取 `DSH_ENTERPRISE_REVIEW_MODEL`，未设置时为 `sonnet`，`pnpm run enterprise -- shift --review-model <id>` 设置它。驱动在组合启动之后、程序开始之前立即经 LLM 注册表解析这一对值，因此路由未声明的模型会让班次的每张工单都以 `the shift's reviewer route does not resolve: <注册表给出的原因>` 失败，在任何部门花费预算之前。默认值与各部门的默认值相同，因此在操作者指定另一个模型之前，无人值守的周期照旧评审。

**被驳回的工单留待人工分诊，永不再次评审。** 台账把最近一行为驳回的工单视为已关闭，因此不再有班次领取它，无论用同一个模型还是任何其他模型；引擎缺的是一个可见的原因。[`shift.ts`](../../../../examples/headless-agent/tests/fixtures/enterprise-shift/shift.ts) 中的 `heldForTriage` 列出每张被关闭为驳回的队列工单，原因写明它最近一次驳回：班次、评审会话，以及评审员的模型与路由或 `reviewer not recorded`。驱动在结果行中把这份清单作为 `held` 打印出来，没有找到未关闭工单的班次的结果行也不例外，并把它写进班次记录的 `result.json`。由人决定这张工单的去向：intake 会把被驳回工单的来源作为一张新工单重新接纳。

## Alternatives considered

**在下一次尝试时换用备用评审模型。** 被驳回的工单就得重新打开，这会改变简报、报告、intake 的准入与请求状态共用的关闭规则，而下一次尝试要以完整预算重跑一个部门，只为了一项评审员已经拒绝过的修改。备用模型自己的驳回随后又需要第三个模型。留待分诊让现有的关闭规则变得可见，且不花任何代价。

**由驱动从环境中读取评审员的模型。** 这个选择会落在驱动里，而不是落在掌管每条路由的组合里，无密钥组合也无法写明自己的选择。组合条目把这个选择留在 `cordis.yml` 中，并在加载处校验。

**换一个默认评审模型。** 把评审员默认设为 `opus` 会让模型独立成为默认，但它会在操作者未作决定的情况下改变无人值守周期对订阅用量上限的消耗。默认值保持为各部门的模型，换模型只需一个选项。

## Consequences

从运行这台引擎的第一个班次起，台账的读者就能看到每张工单由谁评审，较早的行保持标记为未记录，而不是被推断出来。路由拒绝的评审模型会让一个班次白白付出开始行推送与工作树安装，并让该班次的每张工单得到一条算作一次尝试的失败行。像 `T-0019` 那样的错误驳回会让工单保持关闭，直到有人重新提交它；引擎从不拿第二次评审来换。评审员与各部门仍共用一条路由，默认也共用一个模型：引擎保证的独立性是一个没有工具、没有父会话、无法访问部门工作树的独立会话，而使用自己的模型是操作者选择的配置。

## Verification

[`enterprise-shift.spec.ts`](../../../../examples/headless-agent/tests/enterprise-shift.spec.ts) 把被驳回的工单挡在选择之外，并在评审员已记录与未记录两种情况下写明原因，还固定了已发运提交中的评审员行；[`scripts/enterprise-ledger.spec.ts`](../../../../scripts/enterprise-ledger.spec.ts) 读取该字段；[`scripts/enterprise.spec.ts`](../../../../scripts/enterprise.spec.ts) 解析 `--review-model`。[`enterprise-shift.e2e.ts`](../../../../examples/headless-agent/tests/enterprise-shift.e2e.ts) 证明已发运与被驳回工单的台账行都写明运行在 `cli-mock-reviewer` 上的评审员，评审员的请求以该模型发出而部门的请求以 `cli-mock` 发出，并证明路由未声明的评审模型会在任何部门运行之前让班次的工单失败。

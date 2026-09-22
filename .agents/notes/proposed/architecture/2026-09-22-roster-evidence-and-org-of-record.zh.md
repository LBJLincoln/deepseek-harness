# Agent Note: 花名册席位携带已记录的证据，记录在案的组织是项目运行的台账

Status: proposed

[English](2026-09-22-roster-evidence-and-org-of-record.md) | 中文

## Problem

指挥台曾把 `data/enterprise/roster.json` 中的 147 个席位当作企业本身来呈现，`docs/code-safety-poc.md` 与指挥台 README 也把这个数量当作企业复述。2026-09-22 对代码树所做的一次只读审计发现，这种呈现只是一种投射：

- 每个席位的 `preset` 都是 `packages/subagent/subagent-in-process-driver/tests/fixtures/presets/` 下两个测试夹具预设之一：47 个席位是 `coding`，100 个是 `reviewing`。
- 74 个席位写明路由 `deepseek-official`，25 个写明 `codex`，而没有任何已记录的会话在这两者上运行过。52 条已提交记录中的 1,380 个会话文件里，有 830 个标记了路由，其中 801 个是 `claude-code`，29 个是 `openrouter`（免费档模型）；其余 550 个没有发出任何模型请求。
- feed 的 `mapSessionToAgentId` 会把一个会话放到第一个与其提供方和模型相同的席位上，其次放到角色或事业部出现在其系统提示词中的席位上，再其次放到其提供方的任意席位上，最后放到 `roster.agents[0]` 上。在每个已提交会话上重放时，它点亮了 147 个席位中的 16 个，把 541 个会话送到回退席位 `harness-core-agent-steward`；515 个基准测试会话无论运行的是哪个环境都落在同一个基准测试操作员上，因为它是其路由上的第一个席位；29 个 OpenRouter 基准测试会话落在代码安全审查员席位上；csv-tools 与自评估项目的 4 个会话落在代码安全项目负责人上。

[四个目标的重新思考](../process/2026-09-22-four-goals-rethink.md)拒绝了丢弃花名册的做法：这些定义是真实的；更正的方式是只点亮已记录会话占据过的席位，不再把从未使用过的路由当作企业的路由来呈现，并把项目运行的台账而非花名册视为记录在案的组织。这取代了[企业花名册与 harness feed](../../implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md) 决策中的会话到席位映射；其花名册生成与发现规则保持不变。

## Proposal

**一个归属模块。** `scripts/roster-evidence.ts` 只在会话自身的记录点明了某个席位的工作时，才把该会话放到这个席位上：

- 代码安全审查中的项目会话占据其 id 所指的代码安全席位：某个部门的会话占据该部门的整合员席位，项目自身的会话与其整合会话占据项目负责人席位；
- `environment/run` 指明某个基准测试环境的会话，占据专精于该环境的 Proving Ground 基准测试操作员席位；
- 被委派的会话（其头行写明 `parentSession`）占据其委派方会话所占据的席位。

其余每个会话都不归属，并按没有规则适用的原因计数：`environment-not-seated`、`program-not-code-safety`、`program-member-not-seated`、`parent-not-recorded` 或 `no-seat-evidence`。会话与某个席位共用的路由不算证据。`scripts/session-records.ts` 保存两个调用方共用的读取逻辑：一次运行把会话文件放在哪里、一行如何解码，以及一个会话文件对自身陈述的事实。

**花名册文件中的证据。** `scripts/enterprise-roster.ts` 依据已提交的记录，为每个席位给出 `evidence: { sessions, lastSeen?, routesSeen }`，并添加 `counts.occupied`、顶层的 `evidence`（所读取的记录、它们的会话数、每条路由上的会话数）与 `unattributed`。该文件写明其证据覆盖哪些记录，因此它的规格测试恰好由这些记录重建它；夜间循环提交的新记录不会让测试套件变红，直到 `pnpm run roster` 把它纳入。

**feed 在构造上保持一致。** `GET /roster` 用同一个模块，在它发现的每次运行（包括实时运行）上重新计算相同的字段，席位的实时状态只来自归属于它的会话。事件帧只在会话被放到某个席位上时才携带 `agentId`。

**记录在案的组织。** `GET /programs` 列出 feed 发现的每次项目运行，代码安全审查与 Proving Ground 项目一视同仁：项目 id、目标或规格、每个部门的会话、状态、证书、按 `data/code-safety/tools/trajectory.mjs` 的方式统计的步数与工具调用、整合的结论、每一条 `signoff/recorded` 及其时间与作为 `decidedBy` 记录的主体，以及记录路径。指挥台把它快照为 `public/fixtures/programs.json`，镜像中继也会转发它。

**指挥台。** Enterprise 视图的标题是 `<n> seats defined · <m> occupied by recorded sessions`；没有任何已记录会话占据过的席位，其亮度只有被占据席位的三分之一，悬停标签写着 `defined, never run`；路由图例统计的是每条路由上的会话数，而不是每条路由上的席位数；Record 标签页列出各次项目运行及其部门与签署链，并标出在整合认证之前签署的发布。

## Counts over the committed records

| 度量 | 启发式映射 | 归属规则 |
| --- | --- | --- |
| 被点亮或被占据的席位 | 147 个中的 16 个 | 147 个中的 19 个：12 个基准测试操作员、6 个代码安全整合员、代码安全负责人 |
| 落在回退席位上的会话 | 541 | 0 |
| 被放到席位上的会话 | 1,380 个中的 1,380 个 | 1,380 个中的 380 个 |
| 未归属的会话 | 未报告 | 1,000：892 个 `environment-not-seated`、8 个 `program-not-code-safety`、100 个 `no-seat-evidence` |

每条路由上的会话数：`claude-code` 801，`openrouter` 29，`deepseek-official` 0（有 74 个席位为之定义），`codex` 0（有 25 个）；550 个会话没有发出模型请求。892 个中，871 个运行的是花名册未设席位的基准测试环境，21 个是由这类会话委派的：Proving Ground 配额只取 44 个基准测试环境中的 12 个，而这些记录运行过 49 个不同的环境。那 100 个是村庄调度器的班次台账，那 8 个是 csv-tools 与自评估项目的会话。记录在案的组织包含 7 次项目运行，即 5 次代码安全审查与 2 个 Proving Ground 项目，全部已发布；这 7 次中，发布签名都在规格冻结后的几毫秒内、整合认证之前就已记录。

## Alternatives considered

- **只移除 `roster.agents[0]` 回退，保留提供方与模型匹配。** 该匹配自身的最后一步（会话提供方的任意席位）仍会把其他环境的 515 个会话放到同一个基准测试操作员上，把 OpenRouter 基准测试会话放到代码安全审查员上；路由说明的是会话在哪里运行，而不是它做了谁的工作。
- **丢弃花名册。** 重新思考拒绝了它：这些定义引用的是真实来源，失实的是呈现方式。
- **为记录运行过的每个环境设席位，以减少未归属的会话。** 这是为迎合证据而改动定义；事业部配额是设计常量，而未设席位环境中的 892 个会话，正是对一个 12 席位事业部的准确解读。
- **让已提交的证据始终覆盖每一条已提交记录。** 夜间循环提交记录时并不重新生成花名册，因此每次循环提交都会让单元测试套件失败；写明所覆盖的记录能让文件保持可复现，并把保持最新的工作留给 `pnpm run roster`。
- **按目标键而非记录树来识别代码安全项目。** 记录树是发现逻辑对每次运行（无论实时还是已提交）早已知道的信息；读取规格的目标键只会重复这份信息，而不存在它会做出不同判断的情形。
- **把 `routesSeen` 记录为提供方与模型的组合。** 指挥台所作的每一句陈述都按提供方键比较席位的路由（`defined for deepseek-official, never run`），而提供方键也让模型 id 不进入证据。

## Acceptance criteria

- `pnpm run roster` 写入每个席位的 `evidence`、`counts.occupied`、`evidence` 与 `unattributed`；`scripts/enterprise-roster.spec.ts` 由已提交文件所列的记录逐字节重建该文件，并检查每个会话要么恰好在一个席位上，要么未归属。
- 在没有实时运行时，仓库上的 `GET /roster` 与已提交的证据逐字段相等，且除经由某条归属规则外，没有会话能到达席位；`scripts/roster-evidence.spec.ts` 钉住每条规则与每个原因。
- `GET /programs` 列出七条项目记录；`scripts/harness-feed.spec.ts` 钉住一条记录的部门、整合结论与签名。
- Enterprise 视图显示来自证据的标题，以 `defined, never run` 标签把从未被占据的席位调暗，统计每条路由上的会话数，并在 Record 标签页中列出记录在案的组织；指挥台的类型检查与生产构建通过。
- `apps/command-deck/README.md`、`docs/code-safety-poc.md` 与 `data/enterprise/README.md` 及其中文对应文档，把花名册描述为带有证据的定义，并与记录在案的组织并列。

## Risks

- **归属遵循记录的词汇。** 一种新的会话类型（例如项目之外的审查员运行）在有规则点名它之前一直不归属；各项原因让这样的缺口可见，而不是悄无声息。
- **对未归属的会话，流程视图与工作流视图不再显示席位名称。** csv-tools 的部门以其目标键标注，未设席位环境中的基准测试单元以其会话 id 标注，这正是记录所能支持的内容。
- **已提交的文件与运行中的 feed 可能不同。** 文件覆盖它所列的记录，feed 覆盖它此刻发现的内容；`evidence.records` 说明各自覆盖了哪些记录。
- **冷启动的事件流在第一帧之前会读取其运行的每个文件，**因为被委派会话的席位取决于该运行中的其他会话；feed 启动时的预热把它降为每个文件一次 `stat`。
- **记录在案的组织报告的是项目驱动脚本写入的内容。** 在工作开始前、针对占位摘要记录的发布签名会被展示并标出，而不是被修正；修正它属于驱动脚本的职责。

# Agent Note: 可归属的决定与被钉定的数据使用条款

Status: proposed

[English](2026-09-06-attributable-decisions.md) | 中文

## Problem

Village 的两项治理承诺在日志里没有任何产出方。[Village 笔记](2026-09-05-daliesk-village.md)写明五类转变——规格冻结、放宽安全或合规检查、评审接受、发布、训练数据释出——没有一条能在缺少指名主体与产物哈希的 `signoff/recorded` 的情况下完成，并且每个客户区会话从创建起就携带 `dataUse/terms`；[四目标笔记](2026-09-05-four-goal-workflows.md)把同样这两条记录命名为 `SignoffRecord` 与 `DataUseTerms`，把它们连同审批上带参数摘要的 `decidedBy` 一起放进阻塞性推进项 3，并把"具名人类签署者"这一花名册行挂在它们身上。今天没有任何东西写出这三者中的任何一个。`dsh-program` 依据调用方提供的 `spec.signoff` 字段来把守 `requireSignoff`，而它自己的 README 称该字段是断言而非证明，[程序账本笔记](2026-09-06-program-ledger.md)把真正的记录推迟给本条推进项；审批 seam 的 `approval/decided` 记录了一个结果，却没有主体，也没有陈述所决定的对象是什么。因此一位客户审计员读会话日志时可以看到某个程序发布了，却看不到是谁发布的、针对哪个产物、当时看到了什么；也没有任何导出能把仅供评估的转录与训练运行可以消费的转录区分开。

## Proposal

在新的 `packages/governance/` 组里放两个插件，再给审批 seam 现有的审计事件对加两个字段。三者都以日志为先：没有任何东西持有会话日志重放无法复现的状态，也没有任何东西进入模型请求。

### `@deepseek-ai/dsh-signoff`

`ctx.signoffs.record(agent, { transition, principal, artefactSha256, evidence })` 向该 agent 的会话追加一条 `signoff/recorded`，并返回脱离会话的记录。`transition` 是封闭联合 `spec-freeze | relaxation | review-acceptance | release | training-data-release`——即 Village 笔记治理一节的五类转变。`principal` 是 `{ kind: 'human', id, displayName? }`，即部署方身份提供方给出的身份字符串：本插件记录主体，从不对主体做认证。`artefactSha256` 是签署对象的小写 64 位十六进制摘要——冻结的规格、一份证书、一个合并后的 head、一份数据集清单。`evidence` 是指向签署者当时所见之物的 `{ kind, ref }` 指针的有界列表，界限由 `Config.maxEvidence` 与 `Config.maxEvidenceRefChars` 给出，使单条记录无法把会话日志撑到无限大。`latest(agent, transition)` 从会话自身的日志折叠出某一类转变的最新记录，纯函数 `latestSignoff(events, transition)` 则折叠消费方已经持有的任意日志。

不变量伴随插件会拒绝：畸形的主体、非小写 64 位十六进制的摘要、未知的转变、`kind` 或 `ref` 为空的证据条目，以及其 `artefactSha256` 与同一会话已为同一转变记录过的摘要不一致的记录。它无法检查的是日志之外的一切：主体是否就是所指名的那个人、摘要是否指向真实存在的产物、证据引用是否可解析，以及签署者是否真的看过它们。

`dsh-program` 把两处 `requireSignoff` 把关都切到这条记录上。打开一个程序时读取程序会话上的 `signoff/recorded { transition: 'spec-freeze' }`——由调用方在 `start` 之前通过 `ctx.signoffs` 记录，因为程序会话 id 是由规格摘要派生的，因此在程序存在之前就是可寻址的；发布时则在 `program/end { outcome: released }` 之前读取 `signoff/recorded { transition: 'release' }`。`spec.signoff` 收缩为 `{ artefactSha256 }`：每条记录必须匹配的冻结产物摘要，主体则改由记录而非调用方给出。

### 审批上的 `decidedBy` 与 `argumentsSha256`

`ApprovalRequest` 新增被决定调用的 `arguments`。审批 seam 对其规范 JSON 编码取一次小写 SHA-256 摘要，并把该摘要同时写入 `approval/asked` 与 `approval/decided`，于是一条决定陈述的是它所决定的对象，而不只是它属于哪个 call id。`approval/decided` 还新增 `decidedBy?: { kind: 'human' | 'policy', id }`。`approval/request` 瀑布的答复从一个结果放宽为一个结果或 `{ outcome, decidedBy }`，于是知道由谁决定的应答方可以为自己的答复署名，而所有既有应答方仍返回裸结果。服务只为它自己做出的那一个决定署名：确定性的 `'never'` 策略记录 `{ kind: 'policy', id: 'approval-policy:never' }`。

不变量伴随插件会拒绝：`argumentsSha256` 与配对的 `approval/asked` 所记录的摘要不一致的 `approval/decided`（包括携带了其 ask 并未携带的摘要的那种），以及 `kind` 未知或 `id` 为空的 `decidedBy`。

### `@deepseek-ai/dsh-data-use`

`Config` 陈述部署方的默认条款——`clientId`、`agreementId`、`purposes`（`delivery | training | evaluation` 的非空子集）、`residency`、`retentionDays` 与 `redactionProfile`，即四目标笔记的 `DataUseTerms` 字段。插件在每次 `agent/session-start` 时，为尚未携带条款的会话追加一条 `dataUse/terms`，于是任何挂载了它的组合所创建的会话从创建起就被钉定，而被恢复的会话保留它创建时所处的条款。`ctx.dataUse.pin(agent, terms)` 为单个会话记录更窄的条款；一次把 `purposes` 拓宽到超出会话已携带范围的钉定会以 `DATA_USE_TERMS_PINNED` 被拒绝而不被追加，因为事后拓宽会让一个仅供交付的会话变成训练语料。`termsOf(events)` 是消费方读取的导出折叠函数。不变量伴随插件会拒绝第二条拓宽 `purposes` 的 `dataUse/terms`。

## Alternatives considered

**用一个治理插件同时持有两种记录。** 已否决：两者的生命期与消费方都不同——签署是一次具名的转变，由程序账本与发布路径读取，而数据使用条款是每会话的钉定，由导出器与策展器读取——并且一个需要条款却不需要签名的组合，正是最普通的客户区。

**对主体做认证。** 已否决，既超出范围也放错了位置：harness 没有身份提供方（`dsh-anonymous-user-id` 刻意是匿名的），而一个验证签名的插件会需要密钥库、吊销路径与时钟。记录陈述的是部署方声称的签署者；让这一点具有约束力是身份提供方与部署方的职责。

**保留调用方提供的 `spec.signoff` 作为程序的证明。** 已否决：它正是程序 README 已经标注出来的断言，携带的主体无法归属，并且对不变量伴随插件与每一位会话日志读者都不可见。

**把参数本身放到 `approval/asked` 上。** 已否决：ask 刻意携带 `callId` 而不复制日志已经持有的工具调用，而一份完整的参数副本会把脱敏配置尚未见过的机密放进第二个地方。摘要在不复述的前提下陈述了所决定的对象。

**在服务内部依据应答方的注册信息推导 `decidedBy`。** 已否决：注册插件不是主体——UI 应答方转达的是某个人的点击，机器应答方转达的是一条规则——所以只有应答方能说出二者中是哪一个做了决定。

**执行数据使用条款而不只是记录它们。** 本条切片已否决：执行是导出器拒绝发出不具备 `training` 资格的会话，而它属于导出器的脱敏配置，那不在本切片内。

## Acceptance criteria

- 一条 `signoff/recorded` 指名其转变、主体、产物摘要与证据，`latest` 从日志折叠出某一转变的最新记录；伴随插件拒绝畸形主体、非十六进制摘要、未知转变，以及同一转变在不同产物摘要下的第二条记录，每项都有一个失败夹具。
- `requireSignoff: true` 的 `dsh-program` 在程序会话缺少 `spec-freeze` 记录时拒绝 `start`，在缺少 `release` 记录时拒绝发布，两处都带 `PROGRAM_SIGNOFF_REQUIRED`，并拒绝产物摘要不等于规格摘要的记录。
- 每条 `approval/decided` 都携带其 `approval/asked` 所记录的参数摘要，`'never'` 策略把自己署名为 `policy`，伴随插件拒绝摘要与其 ask 不一致的决定。
- 在挂载了 `dsh-data-use` 的组合下创建的会话在第一个回合之前就携带 `dataUse/terms`，收窄 `purposes` 的钉定被记录，拓宽 `purposes` 的钉定被拒绝且不追加任何内容。
- 一个通过 Loader 启动的 e2e，其单个 `cordis.yml` 组合两个插件、审批 seam、mock 路由、持久化与检查点策略，在持久日志中展示上述四项事实。

## Rollout

1. 本切片：`dsh-signoff`、`dsh-data-use`、审批事件对上的 `decidedBy` 与 `argumentsSha256`、程序把关切换，以及治理 e2e。
2. 导出器接入：`dataUse/terms` 决定轨迹或事实导出可以发出哪些会话，与它已经施加的留出集与区划扣留并列，条款所指名的脱敏配置成为导出自身的配置。
3. 四目标笔记中 `SignoffRecord` 其余的字段——`role`、`method` 与 `scope`——待有阶段词汇表与身份提供方来填充它们时再加。
4. 会署名的应答方：携带做出决定之人身份的 UI 或 ACP 应答方记录 `kind: 'human'`。

## Risks

- **记录的价值不超过其主体的价值。** 没有任何东西认证该 id，因此身份提供方只是一个配置字符串的部署，其审计轨迹指名的是角色而非个人；伴随插件分辨不出差别，README 明说了这一点。
- **条款在创建时被钉定，却尚无处执行。** 在导出器读取它们之前，`dataUse/terms` 是一项持久声明而非屏障，而省略 `dsh-data-use` 的组合产出的会话根本没有条款。
- **`purposes` 是唯一单调的字段。** 驻留地、保留期与脱敏配置都可以自由重新钉定；只有拓宽 `purposes` 被拒绝，因为它正是一旦拓宽就会把交付转录变成训练数据的那个字段。
- **一个会话上的两个写入方。** 与 `budget/caps` 一样，没有任何东西陈述哪个编排器拥有某个会话的条款或签名；伴随插件限定的是第二个写入方能做什么，而不是决定谁可以写。

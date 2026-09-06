# @deepseek-ai/dsh-signoff

[English](README.md) | 中文

以会话事件形式存在的可归属人类关卡。`ctx.signoffs.record(agent, …)` 追加一条 `signoff/recorded`，指名它关闭五类转变中的哪一类、部署方声称由谁签署、所签产物的摘要，以及指向签署者当时所见之物的指针；折叠日志就是任何消费方获知某类转变是否已被签署的方式。本插件记录主体，从不对主体做认证，它写入的任何内容都不会进入模型请求。决策记录：[可归属决定的 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md)。

## Config

```yaml
- id: signoff
  name: '@deepseek-ai/dsh-signoff'
  config:
    maxEvidence: 8           # evidence pointers one record may carry
    maxEvidenceRefChars: 512 # length of one pointer's kind or ref
```

| 字段 | 含义 |
|---|---|
| `maxEvidence`（必填） | 一条记录可携带的 `{ kind, ref }` 指针数量的正整数上限。超出的记录会被拒绝，于是一条签名无法把会话日志撑到无限大。 |
| `maxEvidenceRefChars`（必填） | 单个指针的 `kind` 或 `ref` 的字符长度正整数上限。 |

两者都是部署选择：客户的审计轨迹应当引用什么，因项目而异，而一条无法被限定大小的记录就是一条日志膨胀路径。

## 服务约定

`record(agent, { transition, principal, artefactSha256, evidence })` 校验每个字段，向该 agent 的会话追加 `signoff/recorded`，并返回脱离会话的记录。`latest(agent, transition)` 折叠该 agent 自身的日志，取某类转变的最新记录；导出的纯函数 `latestSignoff(events, transition)` 折叠消费方已经持有的任意日志——`@deepseek-ai/dsh-program` 就是这样读取程序会话的，无需注入。

`transition` 是封闭联合 `spec-freeze | relaxation | review-acceptance | release | training-data-release`，即 [Village 笔记](../../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md)所述没有签名就永远无法完成的五类转变。`principal` 是 `{ kind: 'human', id, displayName? }`，即部署方身份提供方给出的身份字符串。`artefactSha256` 是被签署对象的小写 64 位十六进制摘要——冻结的规格、一份证书、一个合并后的 head、一份数据集清单——`ARTEFACT_SHA256` 是它必须匹配的导出模式。`evidence` 是指向签署者所见之物的 `{ kind, ref }` 指针的有界列表。

每次拒绝都带 `SIGNOFF_INVALID_RECORD` 并指名出错字段：未知的转变、非小写 64 位十六进制的摘要、不是人或指名不了任何人的主体、空的显示名、指名不了任何东西或超出配置长度的证据指针、超过 `maxEvidence` 的列表，以及同一转变在会话已签署的另一个产物之外的第二次签名。

## 记录

| 事件 | 写入时机 | 载荷 |
|---|---|---|
| `signoff/recorded` | 每次签名一条，在 `record()` 处 | `transition`、`principal`、`artefactSha256`、`evidence` |

载荷的声明见[持久化目录](../../../docs/persistence-catalog.md)。一类转变可以被再次签署——例如出现新证据后的重签——`latest` 回答的是最新的那条记录；指名另一个产物的第二条记录会被拒绝，因为两者会对该转变覆盖了什么各执一词。

### 不变量伴随插件

`@deepseek-ai/dsh-signoff/invariant` 检查日志能够证明的部分：转变属于那五类之一、摘要是小写 64 位十六进制、主体是一个具有非空 id 且没有空显示名的人、每个证据指针都指名了 kind 与 ref，并且没有任何会话为同一转变签署两个产物。

它无法检查日志之外的任何东西：主体是否就是所指名的那个人、摘要是否指向真实存在的产物、证据引用是否可解析，以及签署者是否真的看过它们。让该 id 具有约束力是部署方身份提供方的职责；本包陈述的是部署方所说的签署者。

## 从另一个包读取签名

`@deepseek-ai/dsh-program` 把它两处 `requireSignoff` 转变都建立在程序会话中的记录之上：打开程序之前读 `spec-freeze`，`program/end { outcome: released }` 之前读 `release`。程序 id 由规格摘要派生，因此调用方在程序存在之前就能寻址到程序会话——并向其中签名。两处把关都不注入本服务；都通过 `latestSignoff` 折叠持久化日志。

## Model Experience

None, as a signature is a durable record for humans and supervising processes; `signoff/recorded` is not a surface event, no prompt section or tool schema mentions it, and no model request is made or changed when one is appended.

#### KV Cache effect

Independent: the request surface is neither extended nor rewritten, so an already-reusable prefix stays reusable.

## Known Limitations and Deferred Work

- **主体只被记录，从不被认证** —— 没有任何东西验证该 id 指名的就是签署者本人，因此身份提供方只是一个配置字符串的部署，其审计轨迹指名的是角色而非个人。签名消息或 IdP 方式应当与一个本仓库尚不具备的身份提供方一起提供。
- **笔记中的 `role`、`method` 与 `scope` 字段缺席** —— [四目标笔记](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md)在 `SignoffRecord` 上列出了签署者角色词汇表、签署方式与阶段范围；它们要等到有阶段词汇表与身份提供方来填充，因此需要签署者角色的消费方要从转变与自身上下文中推断。
- **对谁可以签署没有权限约束** —— 与 `budget/caps` 一样，会话日志的任何写入方都可以记录签名；伴随插件限定第二条记录能说什么，而不决定谁可以写。
- **只有 `dsh-program` 读取签名** —— relaxation、review-acceptance 与 training-data-release 这三类转变在仓库内尚无消费方，因此记录它们只是持久证据，当前没有任何东西依据它们把关。

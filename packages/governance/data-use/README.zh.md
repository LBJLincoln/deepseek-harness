# @deepseek-ai/dsh-data-use

[English](README.md) | 中文

会话转录所处的合同，在创建时被钉定到会话日志上。本插件所见的每个会话在第一个回合之前都携带一条 `dataUse/terms`，指名它的客户、协议、用途、驻留地、保留期与脱敏配置，于是导出器、策展器或客户审计员从日志读取条款，而不是从产出它的那套部署读取。此后的钉定可以收窄条款，但永远不能拓宽其用途。这里没有任何东西进入模型请求。决策记录：[可归属决定的 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md)。

## Config

```yaml
- id: data-use
  name: '@deepseek-ai/dsh-data-use'
  config:
    clientId: acme-industrial
    agreementId: msa-2026-11
    purposes:
      - delivery
      - evaluation
    residency: eu-west
    retentionDays: 90
    redactionProfile: client-v3
```

| 字段 | 含义 |
|---|---|
| `clientId`（必填） | 本部署每个会话所属的客户。卡片对它取哈希而不直接展示。 |
| `agreementId`（必填） | 条款来源的协议。 |
| `purposes`（必填） | `delivery`、`training`、`evaluation` 的非空子集，每项只列一次，按协议列出的顺序。 |
| `residency`（必填） | 转录可以驻留的地区。 |
| `retentionDays`（必填） | 转录保留天数的正整数。 |
| `redactionProfile`（必填） | 导出时应用的带版本脱敏配置。 |

每个字段都是必填的，并在插件加载时校验：说不出自己条款的部署无法钉定条款，而什么都不允许（`purposes: []`）或指名不了客户的条款会是一条消费方无法据以行动的记录。拒绝时携带 `DATA_USE_INVALID_CONFIG`。

## 会话启动时钉定什么

服务监听 `agent/session-start`，向任何尚未携带条款的会话追加带配置默认值的 `dataUse/terms`。被恢复的会话已经携带它创建时所处的条款，因此保留它们——该记录陈述的是创建时的条款，而不是部署当前的配置。

未组合本插件的组合产出的会话根本没有条款；`termsOf(events)` 对它们回答 `undefined`，而要求条款的消费方自行决定如何对待未钉定的会话。

## 服务约定

`pin(agent, terms)` 校验条款、拒绝拓宽、追加 `dataUse/terms`，并返回被追加的那条记录。`defaultTerms` 是部署配置的条款，也就是每个新会话被钉定时所用的条款。`termsOf(events)` 是消费方读取的导出折叠函数；`widenedPurposes(standing, candidate)` 指名候选条款新增的每一项用途，拒绝逻辑与不变量伴随插件都依据它作判断。

一次 `purposes` 允许了会话现有条款所不允许之物的钉定会以 `DATA_USE_TERMS_PINNED` 被拒绝且不追加任何内容，因为事后拓宽会把仅供交付的转录变成训练材料。其余字段都可以自由重新钉定——缩短的保留期、更严格的配置、更正的驻留地。无法使用的字段携带 `DATA_USE_INVALID_TERMS`。

## 记录

| 事件 | 写入时机 | 载荷 |
|---|---|---|
| `dataUse/terms` | 未钉定会话的 `agent/session-start` 处，以及每次被接受的 `pin()` | `clientId`、`agreementId`、`purposes`、`residency`、`retentionDays`、`redactionProfile` |

载荷的声明见[持久化目录](../../../docs/persistence-catalog.md)。最新的那条记录就是该会话的条款。

### 不变量伴随插件

`@deepseek-ai/dsh-data-use/invariant` 检查日志能够证明的部分：每条记录都指名客户、协议、驻留地与脱敏配置，保留期是正整数天，用途是已知集合的非空子集且每项只列一次；并且没有任何记录拓宽同一会话已携带的用途。

它无法检查日志之外的任何东西：客户与协议是否存在、驻留地是否真是转录所在之处，以及是否真有导出应用了所指名的脱敏配置。

## Model Experience

None, as the terms are a durable record for exports, curators, and auditors; `dataUse/terms` is not a surface event, no prompt section or tool schema mentions it, and no model request is made or changed when one is appended.

#### KV Cache effect

Independent: the request surface is neither extended nor rewritten, so an already-reusable prefix stays reusable.

## Known Limitations and Deferred Work

- **有一条导出路径执行这些条款** —— [`@deepseek-ai/dsh-curator`](../curator/README.md) 扣留其条款不接纳该次导出用途的每一个会话，而完全不携带条款的会话对任何用途都被扣留。`ctx.trajectories.export()` 仍可被直接调用且不读取任何条款，因此钉定约束的是策展路径，而不是数据本身。
- **`purposes` 是唯一单调的字段** —— 驻留地、保留期与脱敏配置可以朝任意方向重新钉定，因为只有拓宽用途才会把在一份协议下记录的转录变成另一份协议的材料。
- **每套部署只有一组条款** —— 配置的默认值是部署级的，因此服务两个客户的进程会用第一个客户的条款钉定双方的会话，除非每个会话都被手工重新钉定；按协议拆分组合是部署方的职责。
- **对谁可以钉定没有权限约束** —— 与 `budget/caps` 一样，会话日志的任何写入方都可以记录条款；伴随插件限定后续记录能说什么，而不决定谁可以写。

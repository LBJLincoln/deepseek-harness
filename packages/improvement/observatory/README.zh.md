# @deepseek-ai/dsh-observatory

[English](README.md) | 中文

公开页面，只从已持久化日志折叠而来。`ctx.observatory.snapshot()` 经 scorekeeper 在全部持久化会话上折叠记分板，把配置的区（district）与留出划分扣留在公开行之外并对丢弃的内容计数，同时记录折叠时刻与最新会话有多新。`render(snapshot, now)` 把一个快照变成一个自包含的 HTML 页面与同一次发布的 JSON，并在折叠过旧时以陈旧提示取代全部数字。服务不写任何会话事件。[观测台 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-observatory.md) 承载设计理由，[Village note](../../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md) 承载它所执行的发布规则。

## Config

```yaml
- id: persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: './.sessions'
- id: scorekeeper
  name: '@deepseek-ai/dsh-scorekeeper'
- id: observatory
  name: '@deepseek-ai/dsh-observatory'
  config:
    withhold:
      districts: ['workshop']
      heldOut: true
    staleAfterMs: 3600000
    refreshIntervalMs: 900000
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `withhold.districts` | 无 | 其行绝不进入公开页面的区。本包不附带任何区名：由部署陈述哪些区的会话不得离开它。 |
| `withhold.heldOut` | 无 | 是否同时扣留留出行。 |
| `staleAfterMs` | 无 | 最新折叠会话超过该年龄后，页面以陈旧提示取代全部数字。 |
| `refreshIntervalMs` | 无 | 批量刷新间隔，作为其数字折叠所依的节奏印在页面上。 |

每个键都是必填。部署扣留什么、多旧算太旧、多久重折一次，都是页面向读者作出的陈述，本包无法代部署挑选其中任何一个。服务需要 scorekeeper 与一个会话持久化后端。

`costRequiresDigest` 固定为 `true`，且有意不作为配置键：在两张价格表下定价的行陈述的是跨价格表的求和而不是价格，因此无论部署怎么想，把这个求和当作成本发布都是错述。与它并列的另两条规则同理——`resolved` 与 `parity` 是两列且绝不由其中一个算出另一个，而没有 `ExperimentResult` 裁决就不出现排名。

## Service contract

`ctx.observatory.snapshot({ experiments? })` 列出全部持久化会话头，经 `ctx.scorekeeper.leaderboard()` 恰好在这些会话上折叠记分板，然后对行做划分。扣留是一次行操作，因为它本来就是一次会话操作：记分板的键携带 `district` 与 `heldOut`，因此被扣留行中的每个会话都被扣留，任何被扣留的会话都不可能进入公开行。因两个原因都被扣留的行只计入其区，那是先检查的原因。

返回的行按路由、环境、隔离级别、留出划分与区排序。记分板自身的顺序是其会话存储列出会话的顺序，没有任何后端承诺保持它，因此未排序的页面会在两次度量相同事物的折叠之间重排。

`foldedAt` 是折叠运行的时刻；`newestSessionAt` 是折叠所读取的会话头中最新的 `createdAt`，当存储中没有会话时缺席。`refreshIntervalMs` 随快照一同传递，使渲染出的页面命名它被产出时的节奏。

没有任何会话事件携带 `ExperimentResult`——实验服务把结果写入 sink，并把它的臂盖章进运行的 `group`——因此没有收到结果的折叠不发布排名。跑过实验的调用方通过 `experiments` 传入结果，快照只保留两条臂路由都出现在公开行中的那些结果。

`ctx.observatory.render(snapshot, now)` 返回 `{ html, json }`，同一次发布的两个面，陈述同样的事实。`now` 对照 `staleAfterMs` 决定陈旧；读不到任何会话的折叠按同一条规则算作陈旧，因为它没有任何东西的年龄可以是当前的。

两者背后的纯函数为测试与离线工具导出：`withhold`、`orderRows`、`rankable`、`isStale`、`publishRow`、`publishDocument`，以及 `renderHtml` 连同 `escapeHtml`、`duration`、`NO_RANKING_SENTENCE` 与 `STALE_SENTENCE`。

## The published column set

每个记分板行一个表格行，按此顺序：

| 列 | 陈述什么 |
|---|---|
| Route | 该行 stamp 的 `provider/model`。 |
| Environment | 该行会话运行的环境 id。 |
| District | 该行每个会话被盖章的区，区外的行为 `none`。 |
| Isolation | 各次运行声明的隔离级别；行绝不跨它取平均。 |
| Certificate executor | 该行各证书的 executor，没有认证任何东西的行为 `no certificate`。两个条目意味着该行的证书彼此不一致，任何单一 executor 都不与其比率并列。 |
| Composition digest | 该行每个会话都陈述的摘要；某个会话没有陈述或两者不一致时为 `pending`。 |
| Held out | 该环境是否保留用于评估。 |
| Tamper | 会话未记录任何运行的行为 `not instrumented`；有运行发现检查所属文件被改动时为 `tampered <n> of <runs>`；其余为 `no tamper`。 |
| Resolved | 以自己的名字出现的证书率，带已认证/运行数计数；未记录任何运行的行为 `no run`。 |
| Parity | 度量了用例的会话上的加权通过率均值，无一度量时为 `none`。 |
| Cost per certified session | 与为该行定价的那一个价格表摘要并列的成本均值，否则为 `not published`。 |

页面还会命名它的折叠时刻、最新折叠会话、批量刷新间隔与陈旧阈值；陈述扣留移除了什么；并以裁决赢得的排名或"没有配对实验就不发布排名"这句话收尾。

## Publication rules the service enforces

- **先有行，再有排名。** 只有两条臂路由都出现在公开行中的 `ExperimentResult` 才发布排名，因此裁决绝不会成为某个会话的唯一证据。不携带裁决的折叠改印那句话。
- **`resolved` 与 `parity` 是两列。** 证书率说的是每个活动检查的每个用例都通过了；加权通过率说的是这些会话达到了多少被度量的行为。此处不合并二者、不跨它们排名，也不把其中一个渲染成另一个。
- **成本与它的摘要同行。** 只有恰好一张价格表为该行定价时，行才发布每个已认证会话的成本，且始终与该摘要并列。
- **`pending` 胜过部分归因。** 只覆盖一行中一部分的组合摘要，会把整行归因到并未运行其全部的组合，因此会话之间不一致的行发布 `pending`。
- **扣留被计数，绝不被隐藏。** 一行的消失而不计数会抬高由其余行算出的每一个比率，因此页面陈述被扣留的区，以及每个原因移除的行数与会话数。
- **陈旧是取代，不是加注。** 超过 `staleAfterMs` 后，提示取代全部数字，JSON 带 `stale: true` 且没有行、没有排名；一张数字表格上方的横幅会被当成装饰，而数字会被当成当前的。

## Model Experience

None, as the observatory folds persisted logs into a page and a JSON document; it adds nothing to any model request.

#### KV Cache effect

无；该服务既不增加也不改变任何模型请求。

## Known Limitations and Deferred Work

- **页面是批量的，不是实时投影**——每次折叠都读取全部持久化会话，页面陈述的是其部署配置的刷新间隔，而不是它能核验的间隔。实时排行榜是 [Village rollout 第 7 项](../../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md)；跨会话的折叠尚无投影 seam，因为 `ProjectionDefinition` 与投影缓存都以单个会话为键。
- **服务不做托管**——它把页面与文档返回给调用方。想把状态页放到公网的部署，按自己的节奏把两者写入自己的 web 根目录或对象存储；本包不打开端口，也不写文件。
- **原始摘录留在签署之后**——页面只发布折叠出的数字。任何提示词、转录、证据串或检查体都不会进入它，而发布任何原始会话摘录都需要数据管理员的 `SignoffRecord` 与导出的脱敏配置，二者尚不存在。
- **裁决来自调用方而不是日志**——没有任何会话事件携带 `ExperimentResult`，因此折叠无法仅凭日志恢复裁决，而同一对路由在不同计划下的两个实验都会匹配到同一批公开行。每个发布出的排名都命名它的计划摘要，使它们仍可区分。
- **被扣留的计数本身就是一次披露**——被扣留的 Workshop 行数是关于一次客户合作的事实。无法发布该计数的部署就不发布页面。

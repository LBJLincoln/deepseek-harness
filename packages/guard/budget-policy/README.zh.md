# @deepseek-ai/dsh-budget-policy

[English](README.md) | 中文

单个会话的持久开销上限：在每个待执行步骤（step）之前，按会话日志度量已配置的 token、挂钟时间与成本上限——并以该会话自身日志所记录的上限收紧它们；日志超出的第一项上限会记录一条 `budget/breach` 事件、阻塞该会话的目标，并拒绝该步骤，使之后不再发出模型请求。每个由有价格路由服务的步骤还会记录一条 `usage/priced` 事件，因此一次会话花费了多少是持久事实，而不是内存中的累加值。所有度量都不来自内存计数：上限读取的正是回放读取的那些持久事件，因此任何持有日志的一方都能重现已记录的越限或计价。对于自身不发起任何步骤、而由本进程之外的实现方（implementer）完成工作的会话，同一套强制逻辑以 `ctx.sessionBudgets` 的形式发布给它的驱动方。决策记录见 [budget-policy Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-budget-policy.md) 与[委派单元的预算对等](../../../.agents/notes/proposed/architecture/2026-09-08-budget-parity-for-delegated-cells.md)。

## 配置

```yaml
- id: budget-policy
  name: '@deepseek-ai/dsh-budget-policy'
  config:
    maxInputTokens: 2000000      # billed input: uncached input + cache reads + cache writes
    maxOutputTokens: 400000      # output tokens, provider-reported
    maxTotalTokens: 2400000      # input + output
    maxWallMs: 3600000           # span between the log's first and last event
    maxCostEur: 25               # priced routes only; needs a non-empty pricing table
    pricing:
      deepseek/deepseek-chat:
        inputEurPerMillionTokens: 0.25
        outputEurPerMillionTokens: 1.0
    foreignCostEurPerUsd: 0.92   # converts a foreign implementer's own USD price into the cost cap's currency
```

每项上限都是可选的，省略即表示不限；因此空配置是一个合法策略，既不会停止任何步骤，也不会读取日志。只有当度量到的开销严格大于上限值时才算超出：`0` 会在记录到第一笔开销时停止会话，而恰好用满预算的会话仍继续运行。

校验发生在插件加载时，早于任何会话依赖某项无法被强制执行的上限。上限值或价格不是有限非负数时抛出；`foreignCostEurPerUsd` 不是有限正数时抛出；`maxCostEur` 在 `pricing` 表为空时抛出——没有价格的路由没有成本上限，因此建立在空表之上的成本上限实际上什么都不会强制执行。

`pricing` 的键是 `provider/model`，与每条 assistant 消息携带的来源信息一致。不在表中的路由会把 token 计入 token 上限，但不计入 `costEur`；因此对于部署尚未声明价格的路由，token 上限仍是最后一道防线。

## 插件约定（命名空间：`budget-policy`）

这是一个提供单个服务的函数／命名空间插件（`name` / `inject` / `Config` / `apply`）。它注入 `ctx.agents`，注册 `ctx.sessionBudgets`，并注册一个前置的 `agent/pre-step` 监听器和一个 `agent/turn-stopping` 监听器；`ctx.goals` 通过 `ctx.get('goals')` 可选读取，因此在没有 goal 领域的组合中，该策略的强制行为完全相同。

pre-step 监听器被前置注册，使预算判定先于任何会构建请求上下文或为无法执行的步骤预留续行工作的监听器。越限时它不调用 `next()`：整条链短路，循环以 `blocked` 原因结束该轮次（turn），且没有打开任何步骤。

包导出 `foldBudgetSpend(events, pricing)`、`measuredFor(spend, cap)`、`unpricedUsage(events, pricing)`、`foldSessionCaps(events)`、`tightenedCaps(configured, session)`、`remainingWallMs(events, caps, now)`、`BUDGET_CAP_ORDER` 与 `pricingTableDigest(pricing)`，便于监督方从日志重算任意一次已记录的度量、计价或被执行的上限。

### `ctx.sessionBudgets`

pre-step 监听器是这些上限的一个消费方；另一个消费方是这样一种驱动方：它的会话自身从不发起步骤，因为工作由本进程之外的实现方完成——比如委派给外部 coding agent（编程智能体）的[环境运行器](../../improvement/environment-runner)单元。这样的会话不会到达任何 `agent/pre-step`，因此除非驱动方主动询问，否则没有任何东西约束它。该服务就是它询问的对象。

- `configuredCaps()` —— 本部署强制执行的上限，按上限求值顺序排列，尚未被任何会话收紧。比较两次运行的计划方读取它，来说明这两次运行受什么约束。
- `capsFor(session)` —— 同一组上限，经该会话日志中最新一条 `budget/caps` 收紧后的结果。
- `pricesForeignCost()` —— 是否配置了 `foreignCostEurPerUsd`，从而让调用方知道成本上限是否根本能约束外部工作。
- `recordForeignSpend(session, spend)` —— 记录会话自身模型路由之外的实现方为它花费了什么，取自其后端上报的 `usage` 与 `costUsd`。返回是否追加了记录；日志已计入的 `ref` 会抛出，因此重试一个已记录的工作单元不会把它计费两次。
- `enforce(agent)` —— 度量该会话，并在第一项被超出的上限上追加 `budget/breach` 并阻塞目标，与被停止的步骤所做的完全一致。返回被度量的上限、越限（如有），以及 `remainingWallMs`：剩余的挂钟预算，驱动方把它设为即将开始的工作的截止时限。

### 会话自身未发生的开销

`usage/foreign` 记录在会话自身模型路由之外完成的工作：标识该工作单元的 `ref`、完成它的 `source`、其计费 `inputTokens` 与 `outputTokens`，以及在部署声明了 `foreignCostEurPerUsd` 汇率、可换算实现方自身价格时的 `costEur`。`foldBudgetSpend` 会把每条记录加入上限所度量的 token 与成本，因此自身不发出任何模型请求的会话，会以相同顺序超出相同的上限，并记录与运行自身路由的会话相同的 `budget/breach`。

该记录是部署自身对外部价格的计量，而非外部产品的计量：以美元表述、又没有配置汇率的成本只计入 token，因为一种货币的上限无法约束另一种货币的价格。实现方实际花费了什么属于该实现方自己的计量，本日志无法重算；记录与它是否相符，归写下该记录的一方负责。

### 从日志度量开销

`assistant/message` 是唯一的用量来源：它携带某个步骤最终的提供方（provider）计量，因此同一步骤更早的 `assistant/chunk` 用量采样被有意忽略，而不是重复计入。没有 `usage` 的消息不产生任何计入。计费输入是 `inputTokens`、`cacheReadTokens` 与 `cacheWriteTokens` 三项不相交计数之和；输出取提供方上报的 `outputTokens`。每条消息按自身的 `provider/model` 来源计价，因此会话中途切换路由时，每个步骤按服务它的那个路由所配置的价格计费。

`maxWallMs` 度量日志首尾两条事件时间之间的跨度。因此它会计入事件之间的空闲间隔（包括跨进程重启的间隔），但不计入自最新事件以来流逝的时间——正是这一点让该度量成为日志的函数，而不是读取时刻时钟的函数。

### 单会话上限

为比整个部署更窄的用途而创建的会话，会把自己的上限记录为一条 `budget/caps` 事件，携带五个上限字段的任意子集。该会话被执行的上限，是已配置上限经其日志中最新一条 `budget/caps` 收紧后的结果：只出现在该记录中的上限按记录值生效，两边都有的上限取两者中较小者，两边都没有的上限保持不设限。因此一条记录只可能收窄部署已配置的范围，这正是编排方能把部署预算的一部分交给某个会话、却无法为它授予更多预算的原因。

上限与它所限制的开销一样都从日志折叠得来，因此恢复运行的会话执行的正是自身日志所记录的那些上限，而模型什么都看不到：`budget/caps` 不会进入任何模型请求。若某会话的路由不在 `pricing` 表中，则记录在它上面的 `maxCostEur` 度量到的成本为零、因而永不触发，这与已配置的成本上限作用于未定价路由时的表现完全一致。

### 越限时发生什么

1. 追加 `budget/breach`，携带触发的上限、度量到的开销，以及被超出的配置值。上限按固定顺序 `maxInputTokens`、`maxOutputTokens`、`maxTotalTokens`、`maxWallMs`、`maxCostEur` 求值，第一项被超出的即为被记录的那一项。
2. 通过 `ctx.goals.block` 阻塞当前 phase 为 `active` 的目标，代码为 `budget-exhausted`，说明为 `Session budget <cap> exceeded: <measured> of <limit>.`。该阻塞是持久的并会停用续行，因此续行驱动器之后不会恢复该目标。没有 `ctx.goals`、没有当前目标，或目标已离开 `active` 的组合，同样会得到越限记录和被停止的轮次。
3. 返回 `{ kind: 'reject' }`，使该轮次在未打开步骤的情况下结束。

开销只增不减，因此同一会话中之后的步骤会再次越限：每个被停止的步骤都记录自己的事件，持久日志因此准确说明这份已耗尽的预算拒绝了多少次尝试。恢复运行的方式是提高上限并重新加载部署。

### 被计价的步骤记录了什么

`usage/priced` 说明一条 `provider/model` 出现在 `pricing` 表中的 `assistant/message` 的价格：被计价的 `turn` 与 `step`、该路由的 `provider` 与 `model`、被计费的 `inputTokens`（计费输入）与 `outputTokens`、所应用的 `inputEurPerMillionTokens` 与 `outputEurPerMillionTokens`、由此得出的 `costEur = (inputTokens * inputEurPerMillionTokens + outputTokens * outputEurPerMillionTokens) / 1_000_000`，以及一个 `pricingDigest`。该摘要是整张已配置价格表的小写 SHA-256：路由键按代码单元排序，每个条目先序列化输入价格、再序列化输出价格；因此读者能判断是哪个版本的价格表为某个步骤计价，而任何一项价格改变都会改变摘要。价格随记录本身一起留存，这正是会话成本无需部署配置即可回放的原因。表中未命名的路由不记录任何内容。

哪些步骤需要计价由日志读出，而不是记在内存里：当某个步骤的消息携带 `usage`、其路由有价格，且日志中没有任何 `usage/priced` 已携带该轮次与该步骤时，它才需要计价。因此恢复的会话恰好为前一进程遗留的未计价步骤计价，且绝不会为同一步骤计价两次。记录写入于两个位置——pre-step 监听器内部、读取上限之前，使越限前的最后一条消息由记录越限的同一个步骤计价；以及 `agent/turn-stopping`，使正常结束的轮次的最后一个步骤同样被计价。

以错误或中止结束的轮次不会到达这两个位置，因此它的最后一条消息会一直未计价，直到该会话的下一次 pre-step 或停止边界；在该状态下被弃置的会话，其日志中会留下一个未计价的步骤。

### 不变式配套模块

`@deepseek-ai/dsh-budget-policy/invariant` 会独立重算每条持久记录。越限记录的 `measured` 必须超过 `limit`；对于可由日志推导的上限，它还必须等于本包对该记录之前那些事件的折叠结果；`maxCostEur` 依赖部署的价格表，而日志并不携带它，因此成本越限只校验"超过自身上限"这一关系。计价记录必须引用更早的、轮次与步骤相同的一条 `assistant/message`，并精确复现其计费 token 与路由；其 `costEur` 必须等于用它自己记录的价格计算它自己记录的 token 所得的结果；并且不得有更早的 `usage/priced` 携带同一轮次与步骤。`usage/foreign` 必须计入同一日志中更早记录尚未计入的工作，且不得声明负数开销；实现方实际花费了什么在日志之外，因此这里不重算它。

`budget/caps` 记录只能收紧。部署的已配置上限不在日志中，因此配套模块把每一项上限与同一会话中更早的 `budget/caps` 折叠出的上限相比较：抬高其中任意一项，或把它丢弃以致该上限消失，都会在追加时被拒绝。放宽部署已配置的上限超出了日志所能呈现的范围，改由执行折叠拒绝——它绝不会把记录值取到高于配置值。

## 模型体验

### 被停止的步骤

#### 模型看到的内容

什么都看不到。越限判定发生在步骤打开之前，因此不会添加任何提示词分区、工具 schema、工具结果或消息文本；被停止的这个步骤不会发出模型请求，只要上限仍被超出，之后的步骤也不会。越限记录、计价记录和目标的 `budget-exhausted` 阻塞原因都是给人和监督进程看的持久状态；它们都不是 surface 事件，因此都不会进入模型请求。

#### Token 影响

不增加任何 token，且被停止步骤本应发出的那次请求完全没有花费。

#### KV Cache 影响

互不相干：请求表面既不被扩展也不被改写，因此已经可复用的前缀保持可复用；只要上限仍被超出，会话只是不再发出请求。

## 已知限制与待办

- **仅限会话范围** —— 上限度量的是单个会话日志。想要按工作区、按用户或按天设置上限的部署，在这里没有聚合点；subagent 会话各自持有自己的日志与彼此独立的预算。
- **成本只覆盖有价格的路由** —— 不在 `pricing` 中的 `provider/model` 上的用量只增加 token、不增加成本，也不记录 `usage/priced`；因此对于路由未全部定价的部署，`maxCostEur` 不能作为唯一上限，而未定价的会话也没有日志能说明的成本。
- **整个部署只有一个外部汇率** —— `foreignCostEurPerUsd` 是加载时的单个数字，作用于每一笔外部价格；因此实现方以不同货币计价的部署，或汇率在一次长时间比较期间发生变动的部署，都无法表达这一点。
- **外部开销按上报采信** —— `usage/foreign` 说明的是实现方自身后端所上报的内容。什么都不上报的后端会让 token 与成本上限对它的工作度量为零，只剩挂钟上限仍在约束它。
- **以错误或中止结束的轮次会留下最后一个未计价的步骤** —— 计价发生在下一次 pre-step 或正常停止边界，而轮次失败或被取消时这两处都不会到达。该记录会落在该会话的下一次 pre-step 或停止处；紧随这样一个轮次之后被弃置的会话会留下一个未计价的步骤。
- **每个路由只有一个输入价格** —— 表中用单个数字为计费输入定价，因此对缓存命中相对缓存未命中给出折扣的提供方，按未命中价格计费。
- **停止之前没有预警** —— 该策略没有提前告知模型收尾的建议性阈值；预算耗尽后模型可见的第一个后果就是轮次结束。
- **提高上限需要重新加载** —— 已配置上限是加载时配置，因此耗尽预算的会话只有在部署重新配置并重新加载后才能继续；`budget/caps` 记录只能收紧，所以运行时同样不存在授予。
- **没有会话上限的归属权** —— 任何写入会话日志的一方都可以记录 `budget/caps`，而该记录之所以被采纳，正是因为它只能收窄。没有任何机制说明某个会话的上限归哪个编排方所有，因此同一会话上的两个写入方只是按"最新者优先再取更小值"叠加。

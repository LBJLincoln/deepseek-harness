# @deepseek-ai/dsh-curator

[English](README.md) | 中文

策展导出路径：把 [trajectory 导出器](../../improvement/trajectories/README.md)包裹进转录离开实验室时不可绕过的两条规则里。它在没有脱敏配置时拒绝运行，扣留其被钉定的 [`dataUse/terms`](../data-use/README.md) 不接纳本次导出用途的每一个会话，在记录到达 sink 之前对其每个文本字段做脱敏，并在这些行旁边写出一份 `ExportManifest`。它读取持久化日志，且不写任何会话事件。决策记录：[curator Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-curator.md)。

## Config

```yaml
- id: curator
  name: '@deepseek-ai/dsh-curator'
  config:
    defaultProfile: village-v1
    profiles:
      village-v1:
        shipped: true
      client-v3:
        shipped: true
        rules:
          - id: client-ticket
            pattern: 'ACME-[0-9]{6}'
            replacement: '[redacted:ticket]'
```

| 字段 | 含义 |
|---|---|
| `profiles`（必填） | 按 id 索引的脱敏配置，至少一个。每个都要陈述 `shipped`——本包拥有的规则集是否先于它自己的规则运行——并可列出 `rules`。 |
| `profiles.<id>.rules[].id`（必填） | 非空的规则标识，在其配置内唯一，也是其命中计数所用的键。 |
| `profiles.<id>.rules[].pattern`（必填） | JavaScript 正则表达式源串，加载时编译。 |
| `profiles.<id>.rules[].flags` | 正则表达式标志。无论是否列出，全局标志都会被加上；粘连标志会被拒绝。 |
| `profiles.<id>.rules[].replacement`（必填） | 每次匹配所变成的字面文本。`$&`、`$1` 与 `$$` 逐字写出，绝不展开。 |
| `defaultProfile` | 未指名配置的导出所应用的配置。 |

每个配置都在插件加载时编译。没有任何有效规则的配置、id 为空的规则、同一配置内已被别的规则使用过的 id、粘连标志、无法编译的模式、空的 `profiles` 映射，以及指向未配置项的 `defaultProfile`，都是携带 `CURATOR_INVALID_CONFIG` 并指名出错配置与规则的加载失败。

没有 `requireProfile` 字段：脱敏由设计所必需。在没有 `defaultProfile` 的部署上，未指名配置的导出以 `CURATOR_PROFILE_REQUIRED` 被拒绝；指名了未配置项的导出以 `CURATOR_PROFILE_UNKNOWN` 被拒绝；两者都不触碰 sink。

## 随包发布的规则

`shipped: true` 会在前面加上本包拥有的五条规则。每条覆盖一种在 agent 转录里原样出现的凭据或标识符格式；没有一条声称穷尽，部署方通过 `rules` 补充自己的格式。

| 规则 id | 匹配 | 不动 |
|---|---|---|
| `shipped:email` | 带点分顶级域的地址 | 不含域名点的裸主机名 |
| `shipped:bearer-token` | `Bearer` 后跟二十个及以上凭据字符，不区分大小写 | 散文里的 "Bearer token" |
| `shipped:api-key` | 位于词边界、以 `sk-` 开头且不少于四个字符的密钥 | 更长单词内部的 `sk-`，例如 `risk-averse` |
| `shipped:ipv4` | 每一段都在 0–255 之间的点分四段 | 存在越界段的点分数字 |
| `shipped:e164-phone` | `+` 后跟八到十五位数字 | 更短的 `+` 号码 |

## 服务契约

`ctx.curator.export({ purpose, profile?, sessions?, sink, manifestPath?, rewardedOnly?, includeHeldOut?, districts? })` 运行一次导出。它读取每个候选会话的日志，用 `termsOf` 折叠其条款，只把被接纳的会话交给 `ctx.trajectories.export`，由后者施加它本就拥有的留出与区扣留。`rewardedOnly`、`includeHeldOut` 与 `districts` 原样透传。

只有当会话最新的 `dataUse/terms` 列出了本次导出的 `purpose` 时，它才被接纳。完全不携带条款的会话按同一条规则被扣留：未钉定的转录没有陈述任何用途，而没有人记录过的用途从不被假设。被扣留的会话计入 `withheldByTerms`，并且从不交给导出器，因此关于它们的任何内容都不会被折叠、序列化或写出。在查找条款时读不出来的会话被报告进 `skipped`，导出继续。

返回的报告携带 manifest、`sessions`、`exported`、`rewarded`、`filtered`、`heldOut`、`withheldByDistrict`、`withheldByTerms` 与 `skipped`。

## 脱敏改写什么

curator 遍历每条记录，对除三类被枚举的例外之外的每个字符串做脱敏，因此记录格式上新增的字段在有人另作决定之前一直被脱敏，而不是在有人注意到之前一直被原样导出。

被脱敏的：渲染后的系统提示（`system`）、每个工具 schema 的 `description` 与参数文本（`tools`）、每个消息内容块，包括推理文本与嵌套在 tool result 内部的内容（`messages[].content[]`）、模型产出的原始参数串（`messages[].content[].arguments`、`messages[].toolCalls[].arguments`）、工作目录（`source.cwd`）、目标陈述（`reward.goal.objective`），以及每个检查项的运行证据（`reward.certificate.results[].evidence`）。

永不脱敏的：`environment`、`steps`、`parity` 与 `provenance` 四棵子树，它们只含标识符、摘要与计数；任何深度上的键名 `format`、`type`、`id`、`sessionId`、`parentSession`、`agentPreset`、`role`、`sourceKind`、`toolCallId`、`basis`、`phase`、`goalId`、`checkId`、`status`、`isolation`、`executor`、`provider`、`model`、`reasoningEffort`、`attachmentId` 与 `mediaType`，读者都会据其分支；以及 `tools[]`、`messages[].content[]` 与 `messages[].toolCalls[]` 上的 `name`，那里它是已注册的工具名。

指令以 `reward.directives` 这个计数进入记录；记录不携带指令文本，因此没有可脱敏的指令。

## curation 块

每行被导出的内容都是 `dsh-trajectory/1` 记录加上一个 `curation` 块。

| 字段 | 内容 |
|---|---|
| `redactionApplied` | 恒为 `true`。没有 `curation` 块的记录是由未脱敏的导出器写出的，而不是由本包写出的。 |
| `redaction.profile`、`redaction.profileSha256` | 运行过的配置，以及按顺序对其有效规则取的摘要，读者据此能区分同名配置的两个版本 |
| `redaction.hits` | 本条记录收到的替换次数，按规则 id 计；在它里面没有匹配的规则不出现 |
| `residency` | 该会话自身条款所指名的区域，于是 sink 无需再次读取日志就能按区域给一次导出分区 |

## 导出 manifest

每次导出产出一份 `ExportManifest`：当请求指名 `manifestPath` 时写到那里，无论如何都在报告中返回。`TrajectorySink` 是一对没有路径的 `write`/`close`，因此由调用方陈述 manifest 的去向，而不是由 curator 从 sink 猜测。

| 字段 | 内容 |
|---|---|
| `version` | `dsh-export-manifest/1` |
| `exportedAt` | 导出结束时刻的 epoch 毫秒 |
| `purpose` | 每个被写出会话的条款都接纳的用途 |
| `profile`、`profileSha256` | 运行过的配置，以及其有效规则的摘要 |
| `records` | 写出的行数 |
| `withheld` | 分别计数的 `heldOut`、`districts` 与 `terms`，于是没有哪一种扣留藏在另一种里面 |
| `ruleHits` | 整次导出的替换次数，按规则 id 计，列出该配置的每一条规则，包括没有匹配到任何东西的那些 |
| `recordsSha256` | 按顺序对写出行取的 SHA-256，也就是 sink 所收到字节的摘要 |
| `trajectoryFormat` | `dsh-trajectory/1` |

一次导出不是一个会话，因此 manifest 是文件而不是会话事件：它横跨请求所考虑的每一个会话，且不属于其中任何一个。

## Model Experience

None, as a curated export reads persisted logs and writes files; it adds nothing to any model request and appends no session event.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **未经脱敏的导出器依然可调用** —— `ctx.trajectories.export()` 仍是进程内任何插件都能调用的服务，因此本包是那条会拒绝的导出路径，而不是围绕数据的屏障。一条拒绝"组合了导出器却没有 curator 的区"的组合规则，要等到出现需要它的区时再落地。
- **规则是正则表达式** —— 没有规则覆盖其格式的凭据会被导出，`redactionApplied: true` 陈述的是有一个配置运行过，绝不是这条记录是干净的。manifest 的逐规则计数正是评审者据以判断某个配置是否会触发的东西。
- **脱敏可能损坏含义** —— IPv4 规则会改写形似点分四段的版本串，而部署方一条激进的规则能让一条记录不再可用于训练。永不脱敏集合保护读者据以分支的标识符，而非文本内部的含义。
- **一次导出一个配置** —— 会话条款所指名的配置不与本次导出的配置交叉核对，因为一份 manifest 陈述一个配置。持有多个客户转录的部署方按配置分别导出一次。
- **每个被接纳的会话读两次** —— 一次为其条款，一次为导出器自身的折叠；这是组合导出器而非重复实现其扣留与跳过记账的代价。
- **没有数据集 manifest** —— 去重、对留出套件的去污染、逐记录的内容哈希与划分归属属于 `DatasetManifest` 切片，本包不产出它们。

# 所有者的请求

[English](README.md) | 中文

企业的所有者通过本目录向企业交派工作。一个请求就是这里的一个 Markdown 文件；企业以[队列](../tickets/README.md)中的一张工单答复它，`pnpm run enterprise:requests` 则读回它后来的结果。

## 撰写请求

在开发分支上向本目录添加一个文件 `<name>.md`；用手机上的 GitHub 网页编辑器即可。文件的第一行须为 `# <title>`，用一行写明你想要什么，其下用自己的话自由写出你想要什么、为什么想要。除此之外别无要求：不需要 id，不需要席位，除第一行外也没有任何格式要求。文件名由你自定，请求按文件名顺序受理。

```markdown
# Show the Command Deck in dark mode

The deck is too bright when I read it at night. Follow the phone's dark setting, and keep the division chart readable in both themes.
```

请求是受信任的输入：只有对该分支有推送权限的人才能添加请求，企业把每个请求都视为所有者的原话。

## 查看状态

当一张工单的 `source.path` 就是某个请求的文件时，这张工单即答复了该请求，并带有优先级 `0`——队列把这一优先级留给答复请求的工单。`pnpm run enterprise:requests` 打印每个请求的文件、标题与状态，`--json` 则把同样的内容打印为一个 JSON 数组。这些状态只从已提交的文件推导：队列、[台账](../README.md#the-ledger)中的工单行，以及 `../intake/` 下的受理记录。

| 状态 | 含义 |
|---|---|
| `waiting` | 尚无任何受理答复这个请求。 |
| `refused` | 没有工单答复它，而最近一份提到它的受理记录拒绝了它；打印时附上原因。 |
| `queued` | 已有工单答复它，但还没有班次处理过这张工单。 |
| `halted` | 其工单最近一行台账记录既未发布也未被拒；后续班次会再次处理它。 |
| `shipped` | 其工单已发布；打印时附上承载这处改动的提交。 |
| `rejected` | 独立评审拒绝了其工单的改动。 |

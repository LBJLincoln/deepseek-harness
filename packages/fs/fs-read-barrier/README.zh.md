# @deepseek-ai/dsh-fs-read-barrier

[English](README.md) | 中文

**fs-read-barrier 插件**：它在 `ctx.fs` 提供方约定（[`@deepseek-ai/dsh-fs`](../fs/README.md)）之上拒绝对验证者所有路径的读取；它通过 `fs/read-intent` 事件门禁参与，**不是**通过方法服务。它是 [`@deepseek-ai/dsh-fs-observation-policy`](../fs-observation-policy/README.md) 经同一门禁贡献的写入与编辑政策在读取侧的对应物。它**不**注册服务，也**不**声明 `Config`，因为所有随部署而变的取值都属于它上方的 [`ctx.readBarrier`](../../verification/read-barrier/README.md)。

```ts
import type { Context } from '@deepseek-ai/cordis'
import * as FsReadBarrier from '@deepseek-ai/dsh-fs-read-barrier'

declare const ctx: Context

// Load it alongside a ctx.fs provider, the @deepseek-ai/dsh-read-barrier service it
// injects, and the read executors that dispatch fs/read-intent
// (@deepseek-ai/dsh-tool-fs, @deepseek-ai/dsh-tool-str-replace-editor).
await ctx.plugin(FsReadBarrier)
```

## 门禁如何参与

| 事件 | 本插件的监听器 |
|---|---|
| `fs/read-intent` | 从不透明 actor 推导出调用会话，为它解析屏障策略，并在追加屏障的 `read-barrier/denied` 记录之后，为被拒目标返回错误码为 `FS_READ_BARRIER_DENIED` 的 `FsReadDenial`。它是委派式的：其他所有读取都调用 `next()`。 |

该槽位委派而非独自决定，因为占据该槽位的屏障会让之后所有读取政策都无法判定。没有 agent 会话的 actor——插件的直接调用——同样委派：屏障按会话解析角色，没有会话的调用不受限制。

包含关系判定会先授予会话自己的工作区，再拒绝其祖先，先后与 [`ctx.readBarrier.denies`](../../verification/read-barrier/README.md) 完全一致：被拒绝读取其工作区所在目录的会话，仍可读取自己的文件，而该目录下的其他路径——同级工作区、旁边的文件——都被拒绝。

在该监听器旁，本插件调用 `ctx.readBarrier.enforce('fs')`，这正是让组合的作用域普查把 `fs` 记为 `denied-at-executor` 而非 `unenforced` 的原因。该登记与监听器存续时间完全一致，因此去掉本插件的组合同时失去这项声明，也就不再能取得 `process` 隔离的证书。

拒绝在任何元数据往返之前分发。[`dsh-tool-fs`](../tool-fs/README.md) 在 `resolveRegularReadTarget` 中于 `ctx.fs.stat` 之前分发，覆盖 `read` 与 `read_image`；[`dsh-tool-str-replace-editor`](../tool-str-replace-editor/README.md) 在 `view` 命令上于它自己的 stat 之前分发，因此被拒路径绝不暴露存在与否。

## 没有方法耦合

该插件只通过事件影响读取，因此移除它之后 `dsh-tool-fs` 仍与此前完全一致地经由裸提供方读取；重新加载它则把政策叠加回去。它确实注入了 `readBarrier`——它所执行的政策有一个拥有者，只挂载本插件而不挂载屏障的组合会保持 pending，而不是悄悄放行所有读取。

## Model Experience

### 被拒读取

#### What the model sees

被拒的 `read`、`read_image` 或 `str_replace_editor` `view` 的工具结果是下面这条错误，携带错误码 `FS_READ_BARRIER_DENIED`，其中 `<path>` 是后端为该目标给出的面向模型的路径。工具层不追加任何恢复指引，因为同一调用重试不会成功；与其他所有文件系统失败一样，读取工具自身的 `Error: ` 外壳包裹着它。其余一切不变：读取工具仍然注册在案、schema 未被改动，因此拒绝是那次操作的性质，而非模型可见范围的性质。

##### 读取拒绝

```markdown
read denied: "<path>" is validator-owned — it is not part of this task; continue without it
```

#### Token effect

被允许的读取零 token。一次拒绝增加那条被保留的简短错误结果，并省去该读取本会返回的文件内容。

#### KV Cache effect

仅追加；该插件不添加提示词段落也不添加 schema，因此已可复用的请求前缀保持可复用，拒绝像任何其他工具结果一样延长对话。

## Known Limitations and Deferred Work

- **只有经 `ctx.fs` 的读取被拒绝** —— `glob`、`grep` 和 bash 工具在该 seam 之外开放路径，因此挂载了它们的组合仍为被拒目录留着这些通路。
- **目录列举被整体拒绝** —— `str_replace_editor` 对目录的 `view` 由同一包含关系判定拒绝，因此实现者无法通过列举被拒目录来单独获知它是否存在。
- **拒绝文案指出已解析的路径** —— 该消息重复的是目标那条面向模型的路径，本就由模型提供；它不泄露其他路径，也不泄露目标是否存在。

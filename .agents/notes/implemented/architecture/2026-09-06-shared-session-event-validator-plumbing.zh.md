# Agent Note: 共享的会话事件校验器接线

Status: implemented

[English](2026-09-06-shared-session-event-validator-plumbing.md) | 中文

## 问题

多个包自有的不变量 companion 都会针对某个持久化会话事件关系,检查它与该事件之前已提交事件之间的关系。每个 companion 都手写了相同的两阶段实现:先按顺序重放每个已加载会话中已提交的事件,再订阅 Cordis 的 `internal/dispatch`,并对之后每个 `session/event` dispatch,用触发该 dispatch 的会话当前已提交的事件重新检查——由于 Session 会在发布候选事件前先 dispatch,这些已提交事件正是紧邻该候选事件之前的事件。`dsh-budget-policy`、`dsh-goal-round-driver` 和 `dsh-scorekeeper` 的实现方式高度一致,以至于 `pnpm run duplication` 将它们的 seed 循环互相标记为克隆。`dsh-shifts`、`dsh-experiments` 和 `dsh-tool-todo` 也携带同样的接线,只是用 `jscpd:ignore` 标记把同样的重复隐藏在门禁之外。

## 决策

`@deepseek-ai/dsh-invariants` 导出 `sessionEventValidator(validate, sessions)`,一个 `InvariantInstaller` 工厂函数:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

declare function sessionEventValidator<TEvent>(
  validate: (prior: readonly TEvent[], event: TEvent, fail: InvariantFailure) => void,
  sessions: (ctx: Context) => Iterable<{ readonly events: readonly TEvent[] }>,
): InvariantInstaller
```

`validate` 是包自有的关系检查;`sessions` 是调用方包自己的会话访问器,当前每个调用方都传入 `ctx => ctx.sessions.list()`。返回的安装器会先对 `sessions` 返回的每个会话中已提交的每个事件运行 `validate`,并把每个事件之前的事件依次作为 `prior` 传入;随后订阅 `internal/dispatch`,对之后每个实时 `session/event` dispatch 再次运行 `validate`,把触发该 dispatch 的会话已提交事件作为 `prior` 传入。它注入 `sessions` 服务——与每个手写版本原本声明的依赖相同。

该 helper 在调用方的会话和事件类型上保持泛型,而不从 `@deepseek-ai/dsh-session` 导入 `Session`/`SessionEvent`:该包自己的 `./invariant` companion 已经依赖 `dsh-invariants`,反向导入会形成循环的包依赖。`dsh-budget-policy`、`dsh-goal-round-driver`、`dsh-scorekeeper`、`dsh-shifts`、`dsh-experiments` 和 `dsh-tool-todo` 现在都以这种方式构建安装器,删除了各自私有的 seed 循环和 dispatch 监听器副本,以及每一处仅用于向门禁隐藏这一重复的 `jscpd:ignore` 标记。

`scripts/package-invariants.ts` 的静态检查——要求非空安装器接收并可见地使用其绑定的失败报告器——识别 `sessionEventValidator(validate, sessions)` 调用的方式,与它原本识别直接 `(ctx, fail) => …` 安装器以及 `Object.assign(fn, { inject })` 包装形式的方式相同:它会解析 `validate`(可以是内联函数,也可以是同一文件中的本地具名函数引用),并检查该函数自身的最后一个参数,因为 `sessionEventValidator` 从不隐藏或丢弃它。

那些逐事件检查需要的信息超出已提交会话事件日志本身的 companion,仍保留各自的安装器:`dsh-permission-presets` 除 `sessions` 外还需要注入另一个服务来解析 preset 引用;`dsh-commands` 按 `Session` 对象身份为 key 维护可变的按会话状态,而不是从 `prior` 事件数组重新计算(`dsh-read-barrier` 出于同样原因也需要 `Session` 对象本身)。`dsh-schedule` 针对每个候选事件对整个会话事件流重新 fold,而不是用某个事件对照它的前缀单独检查。`dsh-llm-retry` 和 `dsh-time-context` 额外添加了 `session/created` 监听器,并按事件类型分支到多个检查函数。另有一组更大的家族——`dsh-goal`、`dsh-verification`、`dsh-hook-protocol`、`dsh-user-approval`、`dsh-compaction`、`dsh-session`、`dsh-tools` 和 `dsh-tool-workflow`——在 seed、`session/created` 与一对由 `internal/dispatch`/`session/event` 完成 stage/commit 的监听器这三个监听点之间,携带按会话增量维护的 fold 状态,这是该 helper 未覆盖的另一种接线形态。`dsh-sandbox-policy` 是这一 helper 所提取形态的一个逐字实例,仍是后续同样迁移的候选对象。

## 考虑过的替代方案

- **让 companion 继承一个基类或 mixin 来共享这段逻辑。** 拒绝:`InvariantInstaller` 是一个普通函数值,而 Cordis 插件组合已经期望 `apply`/`inject` 这类导出,而非继承;工厂函数在不引入新组合机制的前提下匹配现有形态。
- **从 `dsh-session` 导入 `Session`/`SessionEvent` 以获得精确类型的 helper。** 拒绝:`dsh-session` 自己的不变量 companion 依赖 `dsh-invariants`,反向导入会形成循环的 TypeScript project reference 和循环的包依赖。让 helper 在调用方提供的会话/事件形状上保持泛型可以同时避免这两个问题,代价只是每个调用方多传一个访问器参数。
- **无论检查实际需要什么,都强行让共享 seed-and-dispatch 外层循环的每个 companion 采用这一签名。** 针对 `dsh-permission-presets` 和 `dsh-commands` 拒绝:它们的检查需要 `(prior, event, fail)` 签名无法携带的额外注入服务或按会话身份 key 的可变状态,强行改造会改变它们自身的逻辑,而不只是提取共享接线。
- **扩展该 helper 以同时覆盖 stage-then-commit 家族的 companion。** 拒绝:那种形态会在两个 seed-and-dispatch 形态不需要的额外监听器之间携带按会话增量维护的 fold 状态;统一二者要么迫使更简单的 companion 携带用不到的状态,要么让不需要它的调用方也要面对更复杂的 helper。

## 后果

- `pnpm run duplication` 不再标记最初被判定为克隆的三处 seed 循环,六个 companion 也不再携带仅用于向门禁隐藏这一重复的 `jscpd:ignore` 标记。
- 新增一个具有这种形态的 companion 时,只需添加一个 `validate` 函数和一次 `sessionEventValidator(validate, ctx => ctx.sessions.list())` 调用,而不必重新推导 seed-and-dispatch 接线;`scripts/package-invariants.ts` 会直接接受这一模式,无需为该 companion 单独开例外。
- `dsh-invariants` 仍不导入任何产品包:该 helper 的 `sessions` 与事件类型均由调用方以泛型形式提供,该服务仍不拥有这六个 companion 的任何实际关系检查。
- `dsh-permission-presets`、`dsh-commands`、`dsh-read-barrier`、`dsh-schedule`、`dsh-llm-retry`、`dsh-time-context`、`dsh-sandbox-policy` 以及 stage-then-commit 家族仍保留各自手写的安装器;它们与被提取形态在外层循环上的相似性依然存在,但 jscpd 的克隆阈值未将其标记出来,而且除 `dsh-sandbox-policy` 外,强行改用新签名都会改变各自依赖或计算的内容。

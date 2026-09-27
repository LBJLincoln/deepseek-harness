# Agent Note: Claude Code 路由在会话目录中运行

Status: implemented

[English](2026-09-27-claude-code-route-runs-in-the-session-directory.md) | 中文

## Problem

`@deepseek-ai/dsh-llm-claude-code` 过去用 `cwd: process.cwd()`——harness 进程启动时所在的目录——启动每一次产品查询。SDK 把该目录交给安装，安装自己的 system prompt 外壳把它作为工作目录告诉模型，并把产品会话归档在该目录的项目条目之下。工作目录与之不同的 harness 会话得不到任何其他说明：`dsh-program` 服务以 `meta: { cwd: <worktree> }` 创建每个部门会话，而一个不把 `{{cwd}}` 渲染进 prompt 的组合——比如 readme-rows 程序那份 `workspaceContext: false` 的 `agent-spine-demo` 人格——就只剩外壳这一处模型能读到的目录陈述。该程序的第一次真实运行 [`2026-09-27-readme-rows-program`](../../../../data/proving-ground/README.md) 展示了后果：部门把全部 29 步都做在克隆的主检出里，而不是其下的程序 worktree 里，因此它在最后一步写出的工具从未出现在证书所测量的分支上，随后会话在第一次尝试之前就越过了 token 上限。缝（seam）交给适配器的请求不带任何目录，而路由无从得知一个。

## Decision

路由按请求从会话存储解析目录。`GenerateOptions.sessionId` 是循环为来自存活会话的每个请求盖上的身份；插件在 `llm` 与 `subprocess` 之外注入 `sessions`，`queryDirectory(ctx.sessions, sessionId)` 返回 `session.header.cwd`——会话创建时的 `meta.cwd`——或者，对不指名任何会话、或其会话未记录目录的请求，返回 harness 进程自己的目录。指名了存储所不持有的会话的请求，在任何查询之前就以 `LlmError('UNKNOWN_SESSION')` 失败。适配器的 `cwd` 依赖接收请求的会话身份，在连续性计划之前解析，而 SDK 的 `cwd` 选项就是计划里的目录。

一个产品会话属于它被创建时所在的目录：安装把它归档在该目录的项目条目之下，也在那里定位被恢复（resume）的会话。因此路由把目录与所持消息数、摘要一起记在 `ProductSessionRecord` 上，只在请求的目录就是记录的目录时才恢复，把不一致在计划的 fallback 里命名为 `cwd-changed`，并从记录的目录删除它创建的每份转录——在被替换、被驱逐、某一步未交付答案以及卸载时——而不是从进程恰好运行的任何地方删除。`ContinuityPlan` 在全新与恢复两个分支上都携带目录，于是查询选项、记录，以及一次失败的全新步骤之后的释放读的是同一个值。

## Alternatives considered

**把目录放到 `GenerateOptions` 上。** 循环会在 `sessionId` 旁边盖上 `cwd`，每个适配器都会收到它。否决：这为一个 provider 的需要拓宽了缝的 Service Definition，循环与请求头部会为一个没有别人读的字段而改变，而请求已经带着能推出目录的会话身份；会话头部是会话工作目录唯一的家。

**通过一个新的全局量把 `Agent` 或 `Session` 交给适配器。** 一个 `AsyncLocalStorage` 槽位，或由循环在 `llm.stream()` 之前设置的模块级"当前会话"。否决：惯例要求在每个入口显式推导 Agent 与 Session，并禁止隐藏的环境量；`sessions.get(sessionId)` 就是那个显式推导，而 agent-loop 的不变量已经断言循环构造的请求指名一个存活的会话。

**改为在 harness prompt 里陈述目录。** `{{cwd}}` prompt 变量是存在的，`dsh-claude-code` bundle 也渲染它。这是补充而非充分：无论 prompt 说什么，外壳都会指名一个目录，产品会话无论如何都归档在查询的目录之下，而省略了该变量的组合会保留这个缺陷。

**把未知的会话 id 默认到进程目录。** 否决：在错误目录里悄悄运行的查询正是要修的故障；缝从存活的会话盖上会话身份，因此未知的 id 是调用方的错误，而最早可解析的时点就是请求。

**通过 `ctx.get` 把 `sessions` 设为可选。** 否决：带会话 id 却没有存储的请求没有诚实的答案，而每一个挂载该路由的已发布组合都已经挂载了存储；没有存储的组合在加载时失败，而不是在第一个会话请求时失败。

**把目录折进前缀摘要。** 移动了的目录会表现为 `prefix-changed`。否决：日志会写下错误的原因；`cwd-changed` 只多一个联合成员，却说清了发生的事。

## Consequences

这条路由上的部门现在在自己的 worktree 里工作，因为产品是这样告诉它的模型的；带 `cwd` 的 headless 会话、subagent 或 workflow worker 被告知的也是自己的目录。挂载该路由的组合需要一个会话存储；所有已发布的组合都有，本包的 Loader 组合测试也挂载了一个。产品会话在运维方的配置目录里按目录归档——每个部门 worktree 一个项目条目，而不是全部归在 harness 进程的目录下——而 `deleteSession` 寻址的是记录下的目录，因此清理不依赖释放时进程所在的目录。fallback 集合多了 `cwd-changed`，在生产中只有一个未记录目录的会话处在目录发生移动的进程里时才可达，并由测试钉住。外壳仍是日志无法重建的那一项模型可见输入，但它所陈述的目录如今是会话头部的 `cwd`，而日志带着它。对于不渲染 `{{cwd}}` 的 prompt，harness 仍不点明任何目录；这仍是组合自己的选择。

## Verification

- `pnpm exec vitest run packages/llm/llm-claude-code --coverage --coverage.include='packages/llm/llm-claude-code/src/**/*.ts'` 使本包保持逐文件 100%：适配器在解析出的目录里运行会话的查询并把请求的会话身份交给解析器，解析抛出时在任何查询之前拒绝，从产品会话被创建的目录删除它，并在会话的目录移动后以 `cwd-changed` 全新运行、从旧会话自己的目录释放它；在带会话存储的真实 context 上，带 `meta.cwd` 的会话在那里运行，不带的在 `process.cwd()` 运行，未知的会话 id 让流以 `UNKNOWN_SESSION` 结束且不发起查询；连续性表以记录的目录释放每份转录。
- `pnpm exec vitest run --config vitest.e2e.config.ts packages/llm/llm-claude-code/tests/loader-composition.e2e.ts` 从带存储的 `cordis.yml` 启动路由，证明会话的请求在该会话的目录里抵达查询以及被拉起的 CLI。
- `pnpm run lint`、`npx tsc --noEmit -p tsconfig.host.json`、`pnpm run knip` 与 `pnpm run doc-sync` 覆盖本包、其 README 对、`docs/module-graph.md` 与本 note。

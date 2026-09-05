# @deepseek-ai/dsh-environment-runner

[English](README.md) | 中文

环境运行器：把一个已注册环境作为一个全新的、经过验证的会话来运行。运行器为会话盖上所运行环境的 stamp，创建 goal，由环境的检查编写完成标准，逐轮驱动实现者，在每轮之后通过 shell 执行器执行检查，记录运行，并且只在有证书时才完成 goal。[环境运行器 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md) 承载设计理由。

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
- id: environment-runner
  name: '@deepseek-ai/dsh-environment-runner'
  config:
    isolation: none
    maxAttempts: 2
    maxGoalRounds: 8
    checkTimeoutMs: 120000
    evidenceMaxChars: 2000
```

| 字段 | 含义 |
|---|---|
| `isolation`（必填） | `none`、`process` 或 `host`：部署方能为其检查运行辩护的隔离级别。实现者与验证者共享文件系统的本地组合是 `none`；检查与夹具位于另一账户或主机上的运行是 `host`。写入每一张证书与每个 stamp；进程内没有任何东西能验证它。 |
| `maxAttempts`（默认 `1`） | 报告运行未认证之前的实现者轮次数；每轮之后跟随一次验证。 |
| `maxGoalRounds`（可选） | 交给 goal 创建的轮次上限；缺省时使用 goal 服务默认值。 |
| `checkTimeoutMs`（可选） | 每条检查命令的超时覆盖值，由执行器封顶；缺省时使用执行器默认值。 |
| `evidenceMaxChars`（默认 `2000`） | 每条证据字符串与 directive detail 的上界。不得超过验证服务的 `maxTextChars`，否则 `recordRun` 会大声拒绝结果。 |

该服务需要 `environments`、`agents`、`agentDefaultModel`、`goals`、`completionStandards`、`shell` 与 `sessions`。

## Service contract

`ctx.environmentRuns.run({ environment, workspace, model?, repetition?, group?, signal? })` 从注册表读取定义，把 `task.fixture`（一个已存在的绝对目录）覆盖到 `workspace` 上并对其文件求哈希，然后创建一个新 agent：`meta.cwd = workspace`，使用请求的 `model` 路由或组合的默认选择，以及 headless bundle 所用的模型选择 setup。在任何其他内容进入日志之前，它追加 `environment/run` stamp：环境 id 与 kind、`heldOut`、提示词、夹具与检查的内容哈希、`repetition`（默认 `0`）与 `group`、模型路由，以及配置的隔离级别。随后它由任务提示创建 goal，将其解除武装以免组合中的 goal-round driver 自行继续，并逐字用环境的检查编写标准。

每次尝试把提示词作为用户轮次发送，等待整个 agent 空闲，然后以 `workdir: workspace` 通过 `ctx.shell` 执行当前标准的每个活动检查：退出码为 `0` 且未超时、未中止即为 `pass`，其余皆为 `fail`；证据是退出事实加上 stdout 与 stderr 的有界尾部。`recordRun` 提交一张证书或返回失败子集。已认证：完成 goal，验证守卫予以准许。未认证：记录一条 directive（`rootCause` 给出失败检查的数量；`detail` 携带失败证据，绝不包含检查 id、结果陈述或命令），在仍有尝试余额时，下一轮以 `<validation_failed>` 块携带该 directive。

报告携带环境 id、会话 id、与追加时完全一致的 stamp、每次尝试一条记录及其检查结果、`certified`、某次运行通过时的证书，以及对会话全部 assistant 消息求和的模型用量。无论哪条路径，包括抛出错误时，会话都会被刷写，agent 句柄都会被释放。

`EnvironmentRunError` 代码：`ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`、`ENVIRONMENT_RUN_INVALID_WORKSPACE` 与 `ENVIRONMENT_RUN_INVALID_FIXTURE` 在任何 agent 存在之前拒绝；`ENVIRONMENT_RUN_GOAL_REPLACED` 与 `ENVIRONMENT_RUN_STANDARD_LOST` 指出替换了 goal 的实现者或不再是当前的标准，此时会话已被刷写。`resolveConfig(config)` 是导出的默认值解析步骤。

只在已稳定的组合上调用 `run()`：运行器通过 agent loop 注册的注册表工厂创建 agent。持久记录是会话日志；轨迹导出器把它折叠为一行 `dsh-trajectory/1`，其 `environment` 字段就是该 stamp，并据此扣留留出会话。

## Model Experience

### Task prompt and validation follow-up

#### What the model sees

环境的 `task.prompt` 作为新会话的第一条用户消息到达，伴随组合的普通系统提示与工具；检查从不出现。验证失败后，在仍有尝试余额时，下一条用户消息就是下面的块，其中 `<rootCause>` 为 `N of the standard's checks failed`，`<detail>` 为每个失败检查一行带编号的证据（退出事实、stdout 与 stderr 尾部），以 `evidenceMaxChars` 为界。

##### Validation follow-up

```markdown
<validation_failed>
<rootCause>
<detail>
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

#### Token effect

每次尝试一条用户消息：先是提示词，然后每次验证失败一个后续块，其大小以 `evidenceMaxChars` 为界。不向系统提示或工具 schema 添加任何内容。

#### KV Cache effect

仅追加：每个后续块在可复用前缀之后延续同一会话，因此对话前缀在多次尝试间保持可缓存。

## Known Limitations and Deferred Work

- **读取屏障属于部署方**——组合了日志读取工具的实现者 preset，或与检查共享文件系统的执行器，仍能触及标准；本运行器的证书强度等于配置的 `isolation` 声明。实现者无法读取的验证者根目录是下一个切片。
- **失败的运行没有逐次事件**——`recordRun` 只为完全通过的运行提交证书；在 `dsh-verification` 获得 `verification/run` 事件之前，尝试与失败的执行只存在于报告与 directive 中。
- **仅支持命令检查**——`run` 为程序性描述的检查会以非零退出失败，证据如实说明；评审者属于监督 seam。
- **检查顺序执行，每次调用一个 repetition**——检查在工作区内依次运行；分组采样由调用方以设定的 `repetition` 与 `group` 重复调用 `run()`。
- **夹具覆盖不清空工作区**——同名文件会被覆盖；运行器拒绝不是目录的工作区，但不要求它为空。

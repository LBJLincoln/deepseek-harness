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

该服务需要 `environments`、`agents`、`agentDefaultModel`、`goals`、`completionStandards`、`shell` 与 `sessions`。当组合提供 [`ctx.readBarrier`](../../verification/read-barrier/README.md) 时它也会使用；没有它时本次运行不预留任何目录，检查就地执行其指令，这正是 `isolation: none` 声明已经表达的含义。

## Service contract

`ctx.environmentRuns.run({ environment, workspace, model?, repetition?, group?, district?, signal? })` 从注册表读取定义，把 `task.fixture`（一个已存在的绝对目录）覆盖到 `workspace` 上并对其文件求哈希，然后创建一个新 agent：`meta.cwd = workspace`，使用请求的 `model` 路由或组合的默认选择，以及 headless bundle 所用的模型选择 setup。在任何其他内容进入日志之前，它追加 `environment/run` stamp：环境 id 与 kind、`heldOut`、提示词、夹具与检查的内容哈希、`repetition`（默认 `0`）、`group` 与 `district`、模型路由，以及配置的隔离级别。随后它由任务提示创建 goal，将其解除武装以免组合中的 goal-round driver 自行继续，并逐字用环境的检查编写标准。

组合了屏障时，本次运行在写入 stamp 之前预留 `<barrier root>/runs/<sessionId>/`，把留出环境的夹具复制到其中的 `fixture/`，并把每次尝试的检查命令改写为 source 该预留目录中的一个脚本。预留目录在实现者的第一个轮次之前以及每次尝试时都会被写入 `standard.json` 以及每个活动检查一个 `checks/<checkId>` 脚本，因此实现者看到的命令行指向一个屏障拒绝它读取内容的文件。检查 id 不是单个路径段，或预留路径无法被检查命令行以不加引号的方式承载时，本次运行都会以 `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT` 失败。

每次尝试把提示词作为用户轮次发送，等待整个 agent 空闲，[对检查方拥有的集合求摘要](#tamper-on-check-owned-paths)，再次把 `task.fixture` 覆盖到工作区，使实现者对验证者所有文件的改动绝不会到达检查，随后对工作区文件求摘要，并以 `workdir: workspace` 通过 `ctx.shell` 执行当前标准的每个活动检查：退出码为 `0` 且未超时、未中止即为 `pass`，其余皆为 `fail`；证据是退出事实加上 stdout 与 stderr 的有界尾部。`recordRun` 以 `{ executor: 'runner', treeHash }` 记录该次运行——无论通过还是失败，每次尝试一条持久 `verification/run` 事件——并提交一张证书或返回失败子集。已认证：完成 goal，验证守卫予以准许。未认证：记录一条 directive（`rootCause` 给出失败检查的数量；`detail` 携带失败证据，绝不包含检查 id、结果陈述或命令），在仍有尝试余额时，下一轮以 `<validation_failed>` 块携带该 directive。

报告携带环境 id、会话 id、与追加时完全一致的 stamp、每次尝试一条记录及其检查结果与工作区摘要、`certified`、某次运行通过时的证书，以及对会话全部 assistant 消息求和的模型用量。无论哪条路径，包括抛出错误时，会话都会被刷写，agent 句柄都会被释放。

`EnvironmentRunError` 代码：`ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`、`ENVIRONMENT_RUN_INVALID_WORKSPACE` 与 `ENVIRONMENT_RUN_INVALID_FIXTURE` 在任何 agent 存在之前拒绝；`ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`、`ENVIRONMENT_RUN_GOAL_REPLACED` 与 `ENVIRONMENT_RUN_STANDARD_LOST` 指出预留目录无法承载的检查、替换了 goal 的实现者，或不再是当前的标准，此时会话已被刷写。`resolveConfig(config)` 是导出的默认值解析步骤。

只在已稳定的组合上调用 `run()`：运行器通过 agent loop 注册的注册表工厂创建 agent。持久记录是会话日志；轨迹导出器把它折叠为一行 `dsh-trajectory/1`，其 `environment` 字段就是该 stamp，并据此扣留留出会话。

## Tamper on check-owned paths

检查方拥有的集合，是屏障铸造出的预留目录（若有）加上环境在 [`task.immutable`](../environments/README.md#the-immutable-set) 中声明的每条路径：声明的文件对其字节求摘要，声明的目录对整棵树求摘要，已经消失的声明路径摘要为“不存在”，因此删除与改写同样算数。运行器在实现者第一个轮次之前对整个集合求一次摘要，并在每次尝试开始时、夹具被恢复之前再求一次——否则覆盖会把比较正要寻找的内容原样放回去。

摘要与验证者留下的那份不同即终止本次运行：不执行任何检查，该次尝试的每条结果都记录自己未被执行，`recordRun` 收到 `tampered: true` 并写下 `verdict: 'tampered'`，其后不可能有证书，goal 不会进入 `complete`，一条 directive 陈述该篡改，实现者以最后一次验证跟进消息收到它。轨迹导出器读取所记录的裁定，并以其 `tamper` 依据把该会话记为 `0`。每次验证之后，运行器会对自己刚刚改写的集合重新求摘要，因此它自己的 `standard.json` 与检查脚本就是下一次尝试所比对的基线。

## Model Experience

### Task prompt and validation follow-up

#### What the model sees

环境的 `task.prompt` 作为新会话的第一条用户消息到达，伴随组合的普通系统提示与工具；检查从不出现。验证失败后，在仍有尝试余额时，下一条用户消息就是下面的块，其中 `<rootCause>` 为 `N of the standard's checks failed`，`<detail>` 为每个失败检查一行带编号的证据（退出事实、stdout 与 stderr 尾部），以 `evidenceMaxChars` 为界。被篡改的尝试发送同一个块，携带下面这段固定的篡改 directive，然后终止本次运行；那段文本既不指名路径也不指名检查，因为摘要比较只知道检查方拥有的集合变了，不知道别的。

##### Validation follow-up

```markdown
<validation_failed>
<rootCause>
<detail>
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

##### Tamper follow-up

```markdown
<validation_failed>
the files this task is measured with were modified during the attempt
Those files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

#### Token effect

每次尝试一条用户消息：先是提示词，然后每次验证失败一个后续块，其大小以 `evidenceMaxChars` 为界。篡改跟进消息是固定文本。不向系统提示或工具 schema 添加任何内容。

#### KV Cache effect

仅追加：每个后续块在可复用前缀之后延续同一会话，因此对话前缀在多次尝试间保持可缓存。

## Known Limitations and Deferred Work

- **屏障只覆盖文件系统读取**——组合了日志读取工具的实现者 preset，或运行检查的 bash 执行器，仍能通过屏障未设围栏的 seam 触及标准；本运行器的证书强度等于配置的 `isolation` 声明，而此处没有任何环节去验证它。
- **被预留的检查以 source 方式运行**——命令行是 `. <script>`，POSIX shell 执行器运行它的方式与运行原来的内联指令完全一致；组合的 PowerShell 执行器无法 source 无扩展名文件，因此这类部署不使用屏障。
- **只有 fixture 覆盖这一种还原**——每次验证都会还原验证者所有的 fixture 文件，但实现者在 fixture 之外新增的文件会留在工作区并到达检查。
- **篡改检测是一次摘要比较**——它只报告检查方拥有的集合发生了变化，从不报告是谁改的或怎么改的，因此一个正当的构建步骤若改写了不可变集合内的文件，就会作废其所在的那次运行；环境作者应把该集合声明得足够窄，误判的代价是一次运行，而不是一张错误的证书。
- **仅支持命令检查**——`run` 为程序性描述的检查会以非零退出失败，证据如实说明；评审者属于监督 seam。
- **检查顺序执行，每次调用一个 repetition**——检查在工作区内依次运行；分组采样由调用方以设定的 `repetition` 与 `group` 重复调用 `run()`。
- **夹具覆盖不清空工作区**——同名文件会被覆盖；运行器拒绝不是目录的工作区，但不要求它为空。

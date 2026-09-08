# @deepseek-ai/dsh-experiments

[English](README.md) | 中文

一次被冻结、配对且受预算约束的两个 arm（实验分支）比较。一份计划指名环境、重复次数与两个 arm——每个 arm 都是一条模型路由外加由谁来实现它的 cell；一个内容摘要在任何 cell 运行之前冻结它；两个 arm 都经 `ctx.fleet` 以相同的重复索引运行，处于由该摘要派生出的 stamp group 之下；返回的是配对证书率 delta 及其 bootstrap（自助重采样）置信区间、两个 arm 运行所处的上限，以及一个 `promote` / `reject` / `inconclusive` 判定。这里不调用任何模型。[experiments](../../../.agents/notes/proposed/architecture/2026-09-05-experiments.md) 与[预算对等](../../../.agents/notes/proposed/architecture/2026-09-08-budget-parity-for-delegated-cells.md) Agent Note 拥有设计依据。

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
- id: environment-runner
  name: '@deepseek-ai/dsh-environment-runner'
  config:
    isolation: none
- id: fleet
  name: '@deepseek-ai/dsh-fleet'
  config:
    maxConcurrent: 4
- id: experiments
  name: '@deepseek-ai/dsh-experiments'
  config:
    bootstrapResamples: 2000
    confidenceLevel: 0.95
    minimumDelta: 0.05
    cellTokenCap: 200000
    tokenBudget: 20000000
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `bootstrapResamples` | `1000` | 每个区间抽取的重采样次数。在收敛之前，区间仍会随摘要移动；调高它以线性代价收窄这种移动。 |
| `confidenceLevel` | `0.95` | 每个所报告区间的覆盖率。 |
| `minimumDelta` | `0` | 总体区间下界必须超过、方可晋升的证书率 delta。 |
| `cellTokenCap` | 无 | 一个 cell 可花费的 token。必填：计划的预计花费正是以它相乘得出。 |
| `tokenBudget` | 无 | 一份计划的预计花费可以达到的 token 数。必填：预计更高的计划在启动之前就被拒绝。 |

该服务需要 `environments` 与 `fleet`。`resolveConfig(config)` 是导出的默认值处理步骤；它返回被计划摘要冻结的四个 `thresholds`，以及 `tokenBudget`——后者留在摘要之外，因为它约束的是一个部署支付什么，而不是这场比较度量什么。

## Service contract

`ctx.experiments.run(plan)` 接受 `environments`（已注册的 id，每个只指名一次）、正整数 `repetitions`、`baseline` 与 `candidate` 两个 arm、一个已存在的绝对路径 `workspaceRoot`，以及可选的、两条 arm 路由共同服务的 `policyVersion`、基准 `seed`、调用方更早冻结的 `digest`、一个 `signal` 与一个 `sink`。

每个 arm 都是它第一次尝试所运行的一条模型路由——`provider` 与 `model`——外加一个可选的、每次尝试一个档位的 `ladder` 与一个可选的 `implementer`，其取值与 fleet 计划所接受的相同：`{ kind: 'route' }` 是不指名 implementer 的 arm 所运行的取值，它让该 arm 每个 cell 的每次尝试都跑在该 arm 自己的路由上；而 `{ kind: 'subagent', provider, label? }` 把每次尝试委派给那个已注册的 subagent provider。[运行器 README](../environment-runner/README.md#the-two-implementers) 拥有被委派的证书证明了什么，以及高于 `none` 的隔离声明会拒绝哪些 provider。这里不会再次校验该 provider：组合无法兑现的 implementer 会经运行器让其所属 arm 的每个 cell 失败，于是该 arm 的每次重复都落单，判定为 `inconclusive`。

一个 arm 的 `ladder` 与 fleet 计划所接受的是同一份列表，并原样传到该 arm 的每个 cell；它的第一个档位就是该 arm 自己的路由：要么不命名模型，要么恰好命名该 arm 的 `provider` 与 `model`。第一个档位命名了别的路由会以 `EXPERIMENT_LADDER_CONFLICT` 被拒绝，因为结果与每一行计分板都发布在该 arm 之下，而跑在别的路由上的第一次尝试会把这一身份发布到它从未运行过的路由上。其余档位不受限制，先便宜后强与降档正是由此而来。

它在运行任何 cell 之前以 `ExperimentError` 拒绝：`repetitions` 非正或非整数、`seed` 不是安全的非负整数、环境列表为空、某个 arm 的阶梯没有任何档位、某个 id 被指名两次，或注册表不持有某个 id，均为 `EXPERIMENT_INVALID_PLAN`；某个 arm 的第一个档位命名了该 arm 自身以外的路由为 `EXPERIMENT_LADDER_CONFLICT`；两个 arm 的 cell 会在不同上限下运行为 `EXPERIMENT_UNEQUAL_CAPS`；声明的 `digest` 与重算结果不同为 `EXPERIMENT_PLAN_NOT_FROZEN`；`environments × repetitions × 2 × cellTokenCap` 超出 `tokenBudget` 为 `EXPERIMENT_OVER_BUDGET`。

两条 arm 都被转发同一个 `policyVersion` 与同一个基准 `seed`，每条 arm 的 cell 以 `seed + repetition` 采样，因此两条 arm 的配对重复只在 arm 本身——它的路由与它的 implementer——上不同——[fleet README](../fleet/README.md#policy-version-and-the-base-seed) 拥有这套算术，[运行器 README](../environment-runner/README.md#sampling-and-what-a-replay-reproduces) 拥有 replay 能复现什么。

随后两个 arm 作为两次 `ctx.fleet.run` 调用在相同的 id 上以相同的重复次数运行，baseline 在先，每次调用各自携带该 arm 的路由与 implementer。被 fleet 保留为错误的 cell 会让它那次重复落单，而不是让整场实验失败。结果会作为一行 JSON 写入 `sink`，且该 sink 恰好被关闭一次；这个 sink 就是轨迹导出器的 `TrajectorySink`，因此 `@deepseek-ai/dsh-trajectories` 的 `jsonlFileSink(path)` 同时服务于两种导出。

结果在每个 arm 的 stamp group 旁重述该 arm：`arms.baseline` 与 `arms.candidate` 携带该 arm 运行时的 `model` 路由、该 arm 命名阶梯时其升级经过的 `ladder`，以及 `implementer`，缺省的 implementer 被陈述为 `{ kind: 'route' }`，因此一份已存储的结果无需产生它的计划，也能分辨 harness 原生的 arm 与被委派的 arm。`caps` 按上限求值顺序陈述两个 arm 的每个 cell 运行所处的上限，因此一份已存储结果的读者无需找到它背后的组合，就能看到这场比较是在什么预算内被度量的。

### The arms run under one budget

在某一个挂钟或 token 上限处被停止的 cell，与在另一个上限处被停止的同一个 cell 度量的是不同的东西，因此受不同约束的两个 arm 比较的既是上限也是 arm。`ctx.environmentRuns.cellCaps` 回答某个 arm 的单个 cell 在什么约束下运行——[运行器 README](../environment-runner/README.md#the-budget-a-delegated-attempt-runs-under) 拥有被委派的 cell 如何被约束、以及它可能失去哪一项上限——两个 arm 解析出不同列表的计划会在任一 arm 启动之前以 `EXPERIMENT_UNEQUAL_CAPS` 被拒绝。这次拒绝一分钱都不花，而这正是要点：否则两个 arm 会完整跑完，只为产出一份读者随后必须打折扣的比较结果。

`foldExperiment(request)` 是运行背后的纯折叠，供测试与离线工具导出使用，同时导出的还有 `planDigest`、`capsAgree`、`describeCaps`、`experimentGroup`、`ladderConflicts`、`parseExperimentGroup`、`projectedTokens`、`EXPERIMENT_ARM_ROLES`、`EXPERIMENT_GROUP_PREFIX` 以及 `bootstrapIntervals` 这一趟计算。

## Freezing and the group scheme

`planDigest(plan, thresholds, caps)` 是对一个格式版本、按角色顺序排列的两个 arm——各自的模型路由、implementer 与尝试阶梯——**排序后的**环境 id、重复次数、`policyVersion` 与基准 `seed`、四个阈值，以及两个 arm 达成一致的上限取 SHA-256 得到的十六进制摘要。排序使摘要与调用方列出 id 的顺序无关；工作区根目录、中止信号与 sink 不进入摘要，因为它们不改变这场比较度量的任何东西。策略版本与种子进入摘要，是因为两条 arm 的会话正是靠该摘要铸出的 group 在日志里被找到的，所以两次在这两者上不同的比较绝不能撞进同一个 group。上限进入摘要，是因为它们决定 cell 何时停止；部署的 `tokenBudget` 仍在摘要之外，因为它约束的是一个部署跨多份计划要付多少，而不是一场比较度量什么。

一个 arm 不指名 implementer 时，进入摘要的是默认的 `{ kind: 'route' }`，因此省略该字段的计划与把它写出来的计划是同一场实验；被委派的 arm 把它的 subagent provider 与 label 也纳入摘要，且各占固定位置，调用方写下的键顺序改不了它。哪一个 arm 被委派也是身份的一部分，因为角色是按顺序进入摘要的。一个 arm 的阶梯每个档位进入摘要一项，未命名模型的档位为 `null`，因此升级方式不同的两个 arm 是两场实验，而不使用阶梯的计划其摘要一如既往。

每个 arm 在 stamp `group` `experiment-<digest>-baseline` 或 `experiment-<digest>-candidate` 之下运行，环境运行器会在每个会话的第一个轮次之前把它写进该会话的 `environment/run` 事件。那个 group 是结果回溯到其会话的持久链接：`ctx.scorekeeper.leaderboard({ group })` 能从每一份已持久化日志中挑出一个 arm，轨迹导出携带同一个字符串。`experiment-` 前缀是这个包保留的命名空间，包不变量会拒绝声称占用它、却没有 64 位十六进制摘要与已知 arm 角色的 stamp。

## Statistics and verdict

当两个 arm 都报告了某次重复时，这次重复即成为配对。结果按环境陈述 `pairs`、`unpaired`、配对重复上的 `baselineRate` 与 `candidateRate`、二者的 `delta`、均值 `attemptsDelta`，以及求和后的 `inputTokenDelta` 与 `outputTokenDelta`；总体 `delta` 是所有环境全部配对重复上的均值。

每个区间都是对配对 delta 的百分位 bootstrap：一次重采样在每个环境内部有放回地抽取该环境所持有的同样数量的配对 delta，而一次重采样的总体统计量是所有抽出 delta 的均值，因此一个环境按其配对数量加权，没有配对的环境贡献的是无，而不是一个零。每次抽取都来自一个 mulberry32 生成器，其种子是 `<digest>:<environmentId>` 的 32 位 FNV-1a 哈希，因此同一份被冻结的计划在同样的证书之上，在任何进程中都重放出同一个区间；完全没有配对的折叠不报告区间。

判定读取总体区间：下界超过 `minimumDelta` 时为 `promote`，上界低于零时为 `reject`，其余情况为 `inconclusive`——包括什么都没有配对上的情况。`promote` 先判，因此负的 `minimumDelta` 仍然给出晋升，而不是一个依赖判断顺序的答案。

## Model Experience

None, as an experiment schedules fleet runs and folds their reports; the environment runner owns every model-visible effect of each cell.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **preset 无法成为 arm** —— 一个 arm 指名一条模型路由与一个 implementer，而 `EnvironmentRunRequest` 不携带 agent（智能体）preset，因此在运行器与 fleet cell 携带 preset 之前，同一条路由上的两种组合无从比较；计划会随该字段一起为每个 arm 增加一个可选 preset，绝不在此之前。
- **被委派的 arm 不报告 token** —— 外部 implementer 花费在另一个产品里，因此它的 cell 不携带 `usage`：`spend` 与 token delta 度量的只是 harness 原生的那一侧，而预计花费仍为两个 arm 的每个 cell 各预留 `cellTokenCap`。子进程上报的花费通过它的 `usage/foreign` 记录约束该 cell，但本折叠不读取它。
- **两个 arm 顺序运行** —— baseline 跑完之后 candidate 才开始，因此二者之间提供方一侧的漂移会全部落在 candidate 上。把两条路由交错进同一次 fleet 调用会得到同样的配对，且对调用方始终可用。
- **配对的重复索引不是配对的种子** —— `environment/run` stamp 不携带种子，因此配对消除的是环境方差，而不是运行间方差。
- **计划的 token 预算是预计的，不是被强制的** —— 拒绝逻辑把 `cellTokenCap` 乘以 cell 数量，而一个 cell 实际花费多少由 `caps` 所陈述上限的[预算策略](../../guard/budget-policy/README.md)限制。两者是彼此独立的数字：没有任何环节把计划的 `cellTokenCap` 写进每 cell 的策略，因此一份计划可以预计得比它的 cell 被允许花费的更少。
- **摘要冻结的是计划，不是世界** —— harness 的 commit、环境内容哈希，以及一条路由背后提供方的模型版本都在它之外，因此同一个摘要的两次运行只有在 harness 与注册表未变的前提下才可比。
- **没有分阶段评估，也没有存档** —— 一份计划只运行一段；分阶段评估的阶梯、变体存档，以及由诊断证据派生的 cell 由[四目标工作流 note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) 指名，并存在于这个包之外。

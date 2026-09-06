# @deepseek-ai/dsh-shifts

[English](README.md) | 中文

班次：无人值守 fleet 的持久驱动器。每个区（district）按自己的节拍开启一个时槽，把该时槽运行的内容冻结为内容摘要，并把整个班次以 `shift/*` 事件记入该时槽自己的会话日志。重启后的进程只读这份台账：它在同一身份下恢复被中断的班次，只运行那些从未开始过的 cell，并拒绝其所属区已经花完窗口额度的时槽。[村庄班次 Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-village-shifts.md) 承载设计理由。

## Config

```yaml
- id: fleet
  name: '@deepseek-ai/dsh-fleet'
  config:
    workspaceRetention: remove-all
- id: shifts
  name: '@deepseek-ai/dsh-shifts'
  config:
    workspaceRoot: /var/lib/dsh/workspaces
    startImmediately: true
    districts:
      - district: workshop
        plan:
          environments:
            filter:
              heldOut: false
          models:
            - provider: <provider>
              model: <model>
          repetitions: 4
          tokenCeiling: 4000000
        cadence:
          intervalMs: 21600000
        spendWindow:
          windowMs: 86400000
          maxTokens: 12000000
```

| 字段 | 含义 |
|---|---|
| `workspaceRoot`（必填） | 一个已存在的绝对路径目录，fleet 在其下为每个 cell 铸造 `cell-*` 工作区。插件加载时即检查，因此磁盘未挂载的部署会在任何时槽开启之前就失败。 |
| `districts`（必填） | 至少一个区，每个区只出现一次。区名会进入每个 cell 的运行 stamp，因此导出或记分板可以据它分区。 |
| `districts[].plan.environments` | 按给定顺序的 `{ ids: [...] }`，或在时槽冻结时对注册表解析的 `{ filter: { kind, heldOut } }`。 |
| `districts[].plan.models` | 至少一条模型路由。驱动器要枚举自己的 cell 才能算出待运行集合并为计划取摘要，因此路由在此点名，而不是取自组合当前所选的某个默认值。 |
| `districts[].plan.repetitions` | 每个环境与路由的正整数重复次数；重复序号从 `0` 起。 |
| `districts[].plan.tokenCeiling`（可选） | 一个班次的正整数输入加输出 token 上限。被恢复的班次以该上限减去它自己的会话已经花掉的部分来运行。 |
| `districts[].cadence.intervalMs`（必填） | 该区相邻两个时槽之间的正毫秒数。 |
| `districts[].spendWindow`（可选） | `windowMs` 与 `maxTokens`：跨时槽的尾部窗口。缺省时该区运行节拍开启的每一个时槽。 |
| `startImmediately`（必填） | 台账中尚无时槽的区是否在进程启动时立即开启一个。`false` 会先等满一个间隔。 |

该服务需要 `fleet`、`sessions` 与 `sessionPersistence`，并读取 fleet 自身注入的环境注册表；够不到它的时槽会以 `SHIFT_INVALID_PLAN` 被拒绝，而不是在一份空清单上冻结计划。

## Service contract

`ctx.shifts.start()` 先恢复每个被中断的班次，再开启每个区已到期的时槽并为其武装节拍定时器。该循环每个进程只跑一次：插件在 Loader 树稳定之后启动它，第二次调用会汇入同一次运行，因此驱动器可以等待第一个时槽而不与插件抢跑。`ctx.shifts.stop()` 解除每个定时器、通过信号取消在途的 fleet 运行，并等待正在结算的时槽；插件释放资源时会调用它。

`shiftDigest(plan)` 是对区、在对注册表解析过滤器之后按码元排序的环境 id、按列出顺序排列的模型路由、重复次数与 token 上限所取的 SHA-256 十六进制值。工作区根目录、节拍与花费窗口是部署选择，不在其中：它们决定一次部署付出什么，而不是班次运行什么。`shiftId(digest, scheduledAt)` 为 `shift-<digest>-<scheduledAt>`，其中时槽时间以 epoch 毫秒计——因此算出同一个时槽的两个进程会算出同一个身份，无需计数任何东西。该 id 既是班次会话的 id，也是每个 cell 运行 stamp 上的 `group`，一个班次的会话正是这样被持久地归组。

## 台账

驱动器为每个时槽创建一个会话并向其追加，每一步都做刷盘，因此进程死掉时留下的记录是诚实的。

| 事件 | 写入时机 | 载荷 |
|---|---|---|
| `shift/start` | 在班次的第一个 cell 启动之前 | `shiftId`、`digest`、被冻结的 `plan`、`scheduledAt` |
| `shift/cell` | 每个 cell 一次，在该 cell 自己的会话持久之后 | `shiftId`、`cell`、存在时该 cell 的 `sessionId`，以及 `reported`（带 `certified` 标志）、`error`（带 fleet 的代码与消息）或 `interrupted` 之一的 `outcome` |
| `shift/resume` | 后续进程接手该班次时 | `shiftId`、`done`、`pending` |
| `shift/skipped` | 时槽被拒绝时；该会话只持有这一个事件，没有 `shift/start` | `digest`、`scheduledAt`、`reason`（`overlap` 或 `spend-window`） |
| `shift/end` | 班次结束时 | `shiftId`、`outcome`（`completed`、`ceiling` 或 `stopped`）、`spend`，以及按结果计数的 `cells` |

[持久化目录](../../../docs/persistence-catalog.md)记录了每个载荷的声明。以欧元计的成本不是班次字段：它由各 cell 会话的 `usage/priced` 事件折叠而来，因此发布出来的成本永远是一个已记录的事实。

## 恢复

启动时驱动器列出已持久化的会话，加载每一个有 `shift/start` 而没有 `shift/end` 的班次会话，并为每一个算出待运行的 cell：计划的 cell 减去台账已经记录的，再减去那些 `environment/run` stamp 出现在某个创建时间不早于该班次会话自身 `createdAt` 的会话中的 cell。stamp 扫描正是台账落后时仍能保持诚实的手段；`createdAt` 这道界限则把同一份计划的更早实例挡在答案之外。

一个 cell 若会话已存在而台账从未记录过它，就是遗留 cell：它被记为 `outcome: interrupted` 的 `shift/cell`，并且在同一重复序号下绝不再运行，因为一个 cell 的第二个会话会在该 group 上的每次 pass@k 折叠中把它重复计数。崩溃是被测 harness 的一种结果，留在错误列里。随后被恢复的班次追加 `shift/resume`，在同一 group 与区之下、以计划上限减去它自己的会话已花部分作为上限，把待运行的 cell 交给 `ctx.fleet.run`，并以 `shift/end` 收尾。

## 节拍与拒绝

每个区同时只有一个班次在途。一个区的下一个时槽是它上一次 `shift/start.scheduledAt` 加上 `intervalMs`，从台账读出，因此重启既不漂移也不重复某个时槽；没有进程运行时错过的时槽不会补做，缺口留在时槽算术中可见。每次触发都先武装下一个时槽再运行当前这个，因此时槽会持续按节拍到来：落在仍在运行的班次上的那个会以 `shift/skipped { reason: overlap }` 被拒绝，而不是被推迟并入其中。在班次开始之前，驱动器把该区处于 `windowMs` 之内的各时槽的 `shift/end.spend` 折叠起来；若开始时窗口额度已用尽，则以 `shift/skipped { reason: spend-window }` 拒绝，且不创建任何 cell。按 cell 的上限仍归会话预算策略，按计划的上限仍归 fleet；窗口是跨计划的第三层。

## 监管

驱动器不在内存里保留任何重启所需的东西，因此由宿主监管进程重启该进程就是全部的恢复故事。

```ini
[Unit]
Description=DeepSeek Harness shift driver
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/dsh/lib/bin.js --config /etc/dsh/shifts.cordis.yml
WorkingDirectory=/var/lib/dsh
Restart=always
RestartSec=10
Environment=DEEPSEEK_API_KEY=/run/secrets/deepseek
KillSignal=SIGTERM
TimeoutStopSec=300

[Install]
WantedBy=multi-user.target
```

容器部署改用它自己的重启策略——`docker run --restart=always --volume dsh-sessions:/var/lib/dsh/sessions --volume dsh-workspaces:/var/lib/dsh/workspaces <image>`——并把持久化根目录与工作区根目录都放在比容器活得更久的卷上，因为恢复记录就是这份台账。`TimeoutStopSec` 必须超过最长的那个 cell，因为释放资源会取消运行并等待正在结算的 cell；更短的超时会把一次干净的停止变成一批遗留 cell。

### 值班手册

| 状况 | 台账显示什么 | 怎么办 |
|---|---|---|
| 编排器崩溃 | 一个有 `shift/start` 而没有 `shift/end` 的班次会话；重启之后出现 `shift/resume` 与一条或多条 `outcome: interrupted` 的 `shift/cell` 记录 | 除非 interrupted 计数持续增长，否则无需处理：重启会恢复该班次。某个区反复出现遗留 cell 才是结论。 |
| 某条模型路由故障超出重试预算 | 带 `FLEET_ROUTE_BREAKER_OPEN` 的 `outcome: error` 的 `shift/cell` 记录，以及 `cells.error` 覆盖计划大部分的 `shift/end` | 停掉该区（从配置中移除并重启）直到路由恢复；期间由花费窗口限制一条抖动路由能花掉多少。 |
| 班次定时器已死 | 该区最近一次 `shift/start.scheduledAt` 已超过一个 `intervalMs`，且其后没有 `shift/skipped` | 检查进程是否还在、其配置是否仍点名该区；台账分不清停掉的定时器与停掉的进程。 |
| 磁盘写满 | 什么也没有——写不进去的正是台账本身 | 对持久化根目录与工作区根目录的可用空间告警；fleet 上的 `workspaceRetention: remove-all` 限制检出内容，但会话日志目前还没有保留策略。 |
| 工具调用卡死 | 什么也没有——班次一直开着，不再出现新的 `shift/cell` | 对最近一条 `shift/cell` 比预期 cell 时长更旧的班次告警；工具超时策略只能约束执行器看得见的调用，约束不了提供方永不作答的那种。 |

## Model Experience

None, as the shift driver only schedules fleet runs; the environment runner owns every model-visible effect of each cell, and no `shift/*` event ever enters a model request.

#### KV Cache effect

None; the driver neither adds to nor changes any model request, and the shift session it writes carries no message the surface projects.

## Known Limitations and Deferred Work

- **台账尚未折叠成记分板**——一个班次的行目前要人工从 `shift/*` 事件里读，直到记分员折叠它们；记分板行上的区列与每个班次一行都还不存在。
- **`verify-village-composition` 不点名该驱动器**——缺少持久化的班次组合会在 fleet 自己的村庄规则上失败，因此诊断指向的是 fleet 条目，而不是那个会因缺失后端而丢掉台账的驱动器。
- **会话日志没有保留策略**——工作区保留限制了检出内容，但连续运行数月的部署会让持久化根目录无限增长，而带花费窗口时恢复扫描每个时槽都要把其中每个会话读一遍。
- **时槽只会被拒绝，不会排队**——落在运行中的班次上、或落在已用尽的花费窗口上的时槽只留下一条 `shift/skipped` 就消失了；班次结束或窗口向前滚动时，没有任何东西会重新开启它。
- **节拍读取宿主时钟**——时钟跳变只会移动某个时槽而绝不会让它重复，因为由台账决定；但宿主时钟倒退超过整整一个间隔的区，其下一个时槽会开得偏晚。

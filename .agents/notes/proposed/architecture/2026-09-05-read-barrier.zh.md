# Agent Note：读取屏障作为文件系统与进程权威

Status: proposed

[English](2026-09-05-read-barrier.md) | 中文

## Problem

一张证书只证明实现者够不到的那部分，而仓库里没有任何东西决定这一点。[`dsh-verification`](../../../../packages/verification/verification/README.md) 只为完全通过的运行提交 `verification/certificate`，并为其打上 `none`、`process` 或 `host` 之一的 `CertificateIsolation` 标记，但它自己的 Known Limitations 就点名了缺失的读取屏障：标准的 `run` 指令对日志的任何进程内消费方都可读，而拒绝实现者读取是一个尚不存在的插件的文件系统策略工作。[四目标工作流 note](2026-09-05-four-goal-workflows.md) 把这一要求表述为原则 P4，即读取屏障是文件系统与进程层面的权威而非承诺；本 note 是它的设计。

实现者与检查共享同一个文件系统和同一个操作系统用户。`EnvironmentRunner.run()` 以 `meta.cwd = workspace` 创建实现者的 agent，随后在同一进程内以 `workdir: workspace` 通过 `ctx.shell` 执行每个检查（[`packages/improvement/environment-runner/src/index.ts`](../../../../packages/improvement/environment-runner/src/index.ts)）；它的 README 写明读取屏障是部署方的事。标准就在实现者自己的会话日志里，而 [`dsh-session-persistence-jsonl`](../../../../packages/session/session-persistence-jsonl/README.md) 把日志作为普通文件放在其配置的根目录下。[`dsh-credentials-local`](../../../../packages/credentials/credentials-local/README.md) 已经记录了这样做的代价：仅属主可读的权限位挡住的是其他操作系统用户而不是模型，因为工具进程以同一用户运行，而随附的文件策略约束的是修改而非读取。

决定实现者能读什么的是组合，而没有任何组合被检查过。挂载 [`dsh-tool-session-query`](../../../../packages/session-query/tool-session-query/README.md) 的 preset 会把五个读取持久会话日志的工具交给模型；挂载 [`dsh-tool-cordis`](../../../../packages/extensions/tool-cordis/README.md) 的 preset 则让它定义并向活动进程挂载插件。按 [agent-scope-contexts](../../implemented/architecture/2026-07-08-agent-scope-contexts.md)，`tools.restrict()` 与 subagent `toolFilter` 是可见性组合而非权威，而证书不携带任何关于其会话组合了哪些工具的持久记录。

因此高于 `none` 的隔离声明背后没有证据。`recordRun()` 写入调用方传入的级别；invariant 伴生插件校验 revision、只增不改的检查增长与证书覆盖，却从不追问该级别断言了什么。只保留 `process` 与 `host` 的运行——[轨迹导出笔记](2026-09-05-trajectory-export-and-environment-registry.md)给出的奖励作弊缓解手段，也是[fleet 排行榜](../../../../packages/improvement/fleet/README.md)拒绝跨其求平均的那一列——过滤的是一个未经检查的字段。

没有任何东西能发现实现者在自己的检查底下改动过工作区。夹具供给了自身评分所依据的测试的任务，将按验证时刻那些文件所说的内容评分，而运行器不比较自己写下的覆盖内容与自己度量的目录树。

## Proposal

把屏障做成执行器处的权威：一个策略拥有者，在每个打开路径的能力处各自拒绝，以及一张只能声明组合所记录之物的证书。

**验证者拥有的根目录。** 位于 `packages/verification/read-barrier/` 的 [`@deepseek-ai/dsh-read-barrier`](../../../../packages/verification/read-barrier/README.md)（`ctx.readBarrier`）是被拒读取的策略之家，扮演 [`dsh-sandbox-policy`](../../../../packages/sandbox/sandbox-policy/README.md) 为沙箱模式与工作区根目录所扮演的角色。它的 `root` 配置默认经由 [`dsh-home-paths`](../../../../packages/util/home-paths/README.md) 取 `dshHomePath('verification')`，并接受任何绝对路径或以 `~` 开头的目录，每个 `denyRoots` 条目同理；服务在构造时以仅属主权限（`0700`）创建根目录，若它已存在且权限更宽，或某个配置路径展开后仍非绝对路径，则大声失败。`reserve(agent)` 为一次运行铸造 `<root>/runs/<sessionId>/` 并同步返回其绝对路径，因此调用方返回的那一刻角色即已生效；环境运行器在追加 `environment/run` stamp 之前调用它，并在那里写入标准快照、每个检查一份位于 `checks/<checkId>` 的脚本，以及环境标记为留出的任何 fixture，随后把每个检查的 `run` 解析到该目录，于是实现者能在进程列表里看到的命令行指向的是一份它读不到内容的文件。正因为该预留是使会话成为实现者的原因，运行器经 `ctx.get('readBarrier')` 读取屏障：没有屏障的组合不预留任何目录，就地运行其检查，这正是它 `isolation: none` 声明已经表达的含义。`protect(path)` 再登记一个被拒目录并返回其 disposer，于是拥有某个目录的插件——例如带着会话存储根目录的 `dsh-session-persistence-jsonl`——以 effect 的方式贡献它，而不是让部署方在配置里重复一遍；`denyRoots` 仍作为配置字段服务于没有插件拥有的目录。`resolve({ session? })` 回答一份 `ReadBarrierPolicy { role, root, denied }`，而 `denies(policy, target)` 判定包含关系。执行状态不是该策略上的字段：`enforce(capability)` 以 effect 方式登记某个能力的判定，`enforcementCensus()` 把这些登记读回来，于是某个能力所执行的内容与它的监听器同寿，而不是每次调用重新计算。`declareComposition(agent, { presetId, role? })` 是 preset 名册——唯一的调用方——告知屏障某个会话组合了什么的方式。

| 字段 | 含义 |
|---|---|
| `root`（默认 `dshHomePath('verification')`） | 屏障拥有的绝对路径或以 `~` 开头的目录；以 `0700` 创建，若已存在且权限更宽则拒绝。 |
| `denyRoots`（默认 `[]`） | 与 `root` 并列被拒的额外绝对目录，服务于没有插件通过 `protect()` 登记的目录。 |
| `hostAttestation`（可选绝对路径） | 由外部账户写入的文件；没有经过验证的该文件，屏障拒绝 `host` 声明。它与读取它的证书不变量一同到来。 |

某个角色的被拒集合不在其中：`implementer` 可以持有哪些权限是安全不变量，不是部署选择。

**拒绝规则。** 对角色为 `implementer` 的会话，当目标的规范路径就是某个被拒目录或其后代时，读取被拒绝。包含关系的判定方式与 [`dsh-fs-sandbox`](../../implemented/feature/2026-07-14-cross-family-fs-sandbox.md) 相同：先规范化，再在已解析的 target 上通过 `ctx.fs.contains(parent, child)` 检验同一性或后代关系，于是策略不解析任何路径字符串，而自解析以来被替换的祖先符号链接会因判定前的就地重新规范化而被抓住。无法判定包含关系的目标一律拒绝。角色 `validator` 与 `unrestricted` 不被拒绝任何东西；`unrestricted` 是默认值，让每一个随附 preset 与今天完全一致。在 preset 尚不能声明角色之前，持有预留的会话是 `implementer`，其余会话都是 `unrestricted`，因此两个开放角色在判定处无从区分，只有被拒的那个可达。

**fs 策略插件。** 在 `packages/fs/fs-read-barrier/` 加入 `@deepseek-ai/dsh-fs-read-barrier`，它是 [`dsh-fs-observation-policy`](../../../../packages/fs/fs-observation-policy/README.md) 通过同一事件门为写入与编辑所贡献策略的读取对应物。它不注册服务，也不声明 `Config`，因为每一个随部署而变的取值都属于上面那个屏障：它注入 `readBarrier` 并决定一个新事件。[`dsh-fs`](../../../../packages/fs/fs/README.md) 在 `fs/write-intent` 与 `fs/edit-intent` 旁声明 `fs/read-intent(target, actor, next)`，是一个返回 `FsReadDenial { code: FsErrorCode; message: string } | undefined` 的 `@mode waterfall`；与那两个单槽 intent 不同，这一个会委派，因为独占该槽的屏障会让之后的每一条读取策略无从判定。插件对被包含的目标返回拒绝，否则调用 `next()`，并以 `readBarrierDenialMessage` 拥有那条确切文案。`FsErrorCode` 新增 `FS_READ_BARRIER_DENIED`。`dsh-tool-fs` 在 `resolveRegularReadTarget` 内、`ctx.fs.stat` 之前派发该事件，覆盖 `read` 与 `read_image`，于是被拒路径绝不透露存在与否，而 `dsh-tool-str-replace-editor` 在 `view` 命令上派发它。工具层不追加任何恢复指示，因为同一次调用重试不会成功；模型在工具注册表寻常的 `Error: ` 外壳内看到的就是策略消息的原文。

##### Exact error

```markdown
read denied: "<path>" is validator-owned — it is not part of this task; continue without it
```

**一次拒绝记录了什么。** 屏障为每次拒绝追加一条仅日志的 `read-barrier/denied` 会话事件，携带 `{ version, role, capability, displayPath, root }`，其中 `capability` 命名做出拒绝的 seam（`fs`、`shell`、`subprocess`、`terminal`）。该路径本就在模型自己的 `tool/call` 参数里进入了日志，因此该事件增加的是证据而非新的泄露。它是一个由 `gen-persistence-catalog` 登记进 `KNOWN_SESSION_EVENT_TYPES` 的 `SessionEventMap` 成员，因此本构建把它当作必读事件读取。信封的 `ignorable` 标记仍未启用：`Session.append` 没有对应参数，仓库中也没有任何事件设置它，因此为这一个加上标记将是对核心 append 的改动，而不是屏障的一个切片。

**工具权限与组合期守卫。** [`dsh-tools`](../../../../packages/core/tools/README.md) 中的 `ToolDefinition` 新增对模型永不可见的 `authority?: readonly ToolAuthority[]`，其中 `ToolAuthority` 是由 `dsh-tools` 声明的可合并扩展联合，起步有三个成员：`session-log`（该工具读取持久会话事件）、`plugin-mount`（它在活动运行时中挂载或求值代码）与 `runtime-introspection`（它报告活动组合）。`dsh-tool-session-query` 在它的五个工具上都声明 `session-log`；`dsh-tool-cordis` 在 `cordis_define`、`cordis_run`、`cordis_stop` 与 `cordis_undefine` 上声明 `plugin-mount`，并在它为只读报告实际发布的三个工具——`cordis_inspect_list`、`cordis_inspect_query` 与 `cordis_inspect_self`——上声明 `runtime-introspection`。`implementer` 会话三者一个都不得组合。把权限声明在工具处而不是在屏障处列一份名单，意味着日后新增的工具由它自己的声明覆盖。

**preset 如何声明角色。** preset 的可选 `preset.yml` 新增 `role: implementer | validator | unrestricted`，缺省即 `unrestricted`。这是该文件承载的唯一权威声明，所以 [`dsh-agent-presets`](../../../../packages/preset/agent-presets/README.md) 拒绝来自 `user` 信任级 preset 的 `validator`，并把该 preset 连同理由列为 `broken`：一个能把自己命名为 `validator` 的本地编写 preset 就是在给自己授予读取权。这是 roster 第一次把 `trust` 用于强制而非呈现，它的 README 随之改变。`mountPreset` 在 `handle.await()` 使子树稳定之后、紧挨 `inactiveRows` 审计角色，并在声明角色为 `implementer` 且该 preset 作用域层中的任一工具声明了被拒权限时拒绝挂载。由于审计运行在 agent 工厂的 `setup` 内，被拒的组合会把整个会话创建回滚，因此失败是大声的，也不会留下半组合的残留。

##### Exact mount refusal

```markdown
agent-presets: preset "<id>" declares role "implementer" but composes "<tool>", which carries the "<authority>" authority
```

**运行期守卫。** 屏障还在会话 setup 时通过 agent 自己的上下文注册一个 `ctx.tools.guard()`，拒绝任何其定义携带该会话角色所禁权限的执行。守卫在每一个 `tools/pre-execute` 监听器之后运行且是单调的，因此之后的监听器无法把拒绝重新变回许可（[`ToolGuard`](../../../../packages/core/tools/src/index.ts)）。挂载审计覆盖 preset 的组合；守卫覆盖此后注册进 agent 自身层的工具，包括某个 subagent driver 贡献的工具。

##### Exact guard denial

```markdown
"<tool>" carries the "<authority>" authority and is not callable in an implementer session
```

**进程级拒绝。** [沙箱 seam](../../implemented/feature/2026-07-06-sandbox.md) 只表达文件效果，这正是被约束的子进程仍能读取它够得到的任何东西的原因。`SandboxPolicy` 与 `SandboxExecutionPolicy` 新增 `deniedReadRoots: readonly string[]`；`ctx.sandboxPolicy.resolve()` 从 `ctx.readBarrier.resolve({ session })` 填充它，于是 fs 围栏与每个进程运行器仍然每次调用取用一份由拥有者解析的策略。`dsh-sandbox-local` 按后端实现它——为每个根目录加一层 `bwrap` `--tmpfs`、一个省去这些目录读权限的 Landlock ruleset、一条 Seatbelt `(deny file-read* (subpath …))` 子句，以及 Windows ACL 运行器的等价拒绝条目——并在所选后端无法表达该拒绝时报告 `SANDBOX_UNAVAILABLE`，于是失败的是声明而不是屏障。[`dsh-bash-sandbox`](../../../../packages/shell/bash-sandbox/README.md)、`dsh-pwsh-sandbox` 与 [`dsh-terminal-bash`](../../../../packages/terminal/terminal-bash/README.md) 无需改动即可继承它。[`dsh-tool-fs-search`](../../../../packages/fs/tool-fs-search/README.md) 今天通过 `ctx.subprocess` 以不受约束的方式启动 ripgrep；只要屏障生效，它就通过 `ctx.sandbox.confine()` 约束该次启动，此外屏障的工具守卫还会拒绝 `path` 参数直接指向被拒根目录的 `glob` 或 `grep`。

##### 切片 5 记录的偏离

Windows ACL 运行器没有新增拒绝条目。它的约束是 `WRITE_RESTRICTED` 令牌，其受限 SID 只在写访问时被查询；而另一条路——在目录上设置 deny ACE——会同时作用于拥有该目录的 validator（校验方）和受限子进程。该级改为采用本节已经规定的回退：非空的 `deniedReadRoots` 会拒绝包装并指明后端与目录，因此 Windows 部署能强制执行文件操作，却无法支撑依赖禁读的声明。

各执行器并非「无需改动即可继承」该拒绝。能力不得主张其后端从不施加的强制执行，因此 `dsh-sandbox-policy` 新增了 `enforceReadBarrier`，每个消费沙箱的执行器都调用它：它同时等待 read barrier（读屏障）、策略与提供方，以 read barrier 根目录作为禁读目录探测该执行器真实会运行的那次包装，仅在探测成功时登记 `enforce(capability)`。探测被拒绝或部署默认为 `danger-full-access` 时，改为登记 `cannotEnforce(capability, reason)`——这是 read barrier 现在暴露的第三种登记方式，于是普查会携带被组合的能力为何不执行任何拒绝，被拒绝的证书也能指明后端而不只是能力。登记 `subprocess` 的是 `dsh-tool-fs-search`：它是组合中通过该 seam 打开模型所选路径的消费方，未组合它的组合会把 `subprocess` 记为 `unenforced`。

对 `path` 参数指向被拒根目录的 `glob`／`grep` 守卫不属于本切片；受约束的启动属于本切片，并在执行器处拒绝同样的读取。

read barrier 的 `Config` 新增了第四个字段 `isolationClaim`。下文的拒绝需要部署的声明，而拥有 `isolation` 的环境运行器触及不到 workflow 引擎或 subagent 提供方；另一条路是五处重复的配置字段。该字段不授予任何权限——证书可以声称什么仍由普查判定——因此它是部署声明，而非本节刻意排除在配置之外的安全不变量。

**屏障无法约束的执行器。** 它们通过 `enforceByRefusal(capability)` 登记，这正是本 note 切片清单所允许的同类登记：在 `process` 或 `host` 声明下为 `denied-at-executor`，此时 `startRefusal` 拒绝每一次 implementer 启动；在 `none` 声明下为带该原因的 `unenforced`。

##### 精确的启动拒绝

```markdown
"<capability>" opens paths this process cannot confine and does not start in an implementer session under the "<claim>" isolation claim
```

**一次运行的执行者。** `RunEvidence.executor` 已在 `verification/run` 事件上区分 `runner` 与 `agent-reported` 运行，而 `recordRun()` 对二者一视同仁地颁发证书。`VerificationCertificate` 新增 `executor`，从它所引的运行复制而来，于是只读证书的消费方也能分辨是哪一种；scorekeeper 的结果事实以 `certificateExecutor` 暴露它，这正是让排行榜据此分区的依据。`recordRun()` 对 `agent-reported` 运行拒绝任何高于 `none` 的隔离——实现者自己对其检查的交代，只在什么都不断言的那个级别上是可采信的证据——而 invariant 拒绝执行者与其所引运行不一致的证书，也拒绝在 `agent-reported` 运行之上声称 `process` 或 `host` 的证书。

**屏障无法约束的执行器。** 有两个已组合的能力打开的路径无法在进程内围住。[`dsh-workflow-worker-thread`](../../../../packages/workflow/workflow-worker-thread/README.md) 写明它的 worker 不是安全沙箱，逃逸的脚本会以宿主进程的权限重新取得 Node 能力。进程外的 [subagent](../../../../packages/subagent/subagent/README.md) 提供方——`subagent-acp`、`subagent-claude-code`、`subagent-codex`、`subagent-dsh-sdk`——启动的是自带工具栈、不受 harness 策略约束的外部 agent。对 `implementer` 会话，二者在 `process` 或 `host` 声明下拒绝启动，在 `none` 声明下记录为 `unenforced`。进程内的 subagent driver 不需要例外：子 agent 通过 `composeFrom()` 加入父级的常驻组合，因此继承同一份清单、同一个作用域层与同一个角色。

**作用域清单。** 它与 `ToolAuthority` 一同到来，它的 `census` 正由那些声明构成。在会话的第一条 `request/header` 之前，屏障追加一条仅日志的 `read-barrier/scope` 事件，携带 `{ version, role, presetId, root, denied, census, enforcement }`。`census` 是该 agent 可见的每个工具一条 `{ name, authority }`，让组合的权限成为持久事实而不只是组合期事实；invariant 会拿它与每条 `request/header` 已装配 schema 中的工具名交叉核对，于是清单之后新增的工具会被抓住。`enforcement` 是组合所注册的每个打开路径的能力一条——`fs`、`shell`、`subprocess`、`terminal`、`subagent`、`workflow`——取值 `denied-at-executor`、`unenforced` 或 `not-composed`。能力通过在其执行登记的存续期内调用 `ctx.readBarrier.enforce(capability)` 来记为 `denied-at-executor`，于是该声明与支撑它的监听器一同释放。

**证书 invariant。** `recordRun()` 以 `VERIFICATION_ISOLATION_UNPROVEN` 拒绝提交隔离级别超出会话所记录内容的证书；[`./invariant`](../../../../packages/verification/verification/README.md) 伴生插件把同一条规则施加于持久事件流，于是伪造的证书在任何安装了该伴生插件的地方都会在重放时失败。两者都只读会话日志，而不读 `ctx.get('readBarrier')`：活动屏障关于某个会话所知的一切，都已在它追加的清单里，而在同一份证据上只用一条规则，正是让线上拒绝与重放拒绝成为同一条规则的原因。与级别无关地，两者都拒绝作用域清单中带有被拒权限的会话上的证书：即便守卫不知怎么被绕过，组合一个读日志的工具也要付出证书的代价。`CertificateIsolation` 的 JSDoc 随规则改变：`process` 意味着下方阶梯所述之物，而不再只是进程内读取策略。

**`host` 标记。** 只有当屏障验证了配置的 `hostAttestation` 路径上的文件之后写下的 `read-barrier/attestation` 事件，才接受 `host`：该文件必须是常规文件、属主 uid 不同于 harness 进程的有效 uid、且在属主之外不可写。进程内的组件若不先持有另一账户的权限就无法造出该文件，而这正是该级别所断言的性质。屏障在属主之外记录该文件的 SHA-256；把该摘要与本次运行的环境内容哈希作比对，要等 `environment/run` stamp 抵达屏障，因此已发布的检验证明的是属主而非某次运行。属主通过 Windows 不提供的 `process.geteuid()` 读取：那里的证明会以该理由被拒绝，而不是通过 `dsh-sandbox-windows-acl` 验证。文件缺失或无法验证时，屏障不记录证明并记下缘由，声明被拒绝。

**检查所有路径上的篡改。** 检查所有路径是屏障预留的目录，加上环境声明为不可变的工作区路径：`EnvironmentDefinition.task` 新增 `immutable?: readonly string[]`，即 fixture 供给且实现者不得编写的工作区相对路径——测试、参考输出，以及任何被覆盖进去的检查脚本；既非相对路径也未规范化的路径在注册时即以 `ENVIRONMENT_INVALID_IMMUTABLE` 被拒，因为注册表无法解析的路径绝不能进入本应由它裁决的那次运行。运行器已经在 `hashDirectory` 中对目录求哈希；它在预留目录备妥之后、实现者第一个轮次之前记录检查所有集合的摘要，并在每次验证时、fixture 覆盖把比较正要寻找的内容原样放回去之前再记录一次。[环境运行器笔记的第二个切片](2026-09-05-environment-runner.md)加入的 `verification/run` 事件携带该次尝试的 `treeHash`；本笔记为它加上 `verdict: 'passed' | 'failed' | 'tampered'`，其拼写与 `CheckStatus` 的 `pass`、`fail` 区分开，使一次运行的裁定绝不会被读成某个检查的结果。与基线不同的摘要即 `tampered`：运行器不执行任何检查，把每条结果都记为未被执行，并以 `tampered: true` 调用 `recordRun`——颁发证书的那次操作也就是拒绝的那次操作，因此由它写下裁定，并对 `passed` 以外的任何裁定都不签发证书，而 `RunEvidence` 只陈述篡改，因为通过与失败已由结果得出。随后它签发一条点名篡改但不点名路径的 directive，作为最后一次验证跟进消息交付给实现者，使该次运行自身的转录记录下它为何结束，并停止尝试循环（因为工作区已不再度量该任务）。由于每次验证都会改写它自己拥有的预留目录，运行器在生成该次尝试的脚本之后重新确立基线，因此它自己的写入绝不会被读成篡改。`foldTrajectoryReward` 新增奖励依据 `tamper`，`outcome: 0`，它压过同一日志中的任何证书，而 invariant 伴生插件拒绝架设在裁定不是 `passed` 的运行之上的证书。

**单一授权下的盲评审者。** 面对一个标签会影响自身的评审者，跨提供方路由是第一个答案，而只有一份模型授权的部署拿不到它。第二条路线是文件系统与进程隔离，加上一个不持有实现者上下文的评审者会话，其含义是以下全部、且不得更弱。评审者会话通过 `ctx.agents.create` 以全新 `SessionId` 创建，没有 `parentSessionId`，也没有 resume 或 fork 种子，因此它的日志从自身创建处开始。它的 `meta.cwd` 是一个持有实现者目录树在被审计尝试的 `treeHash` 处副本的评审工作区，绝不是实现者的工作区。它的派生历史恰好包含评审者 preset 的系统提示词、环境的任务提示词，以及一条携带审计者所选证据的用户消息；被审计会话中的任何 `assistant/message`、`tool/result` 或 `verification/directive` 都不进入其中。它的 preset 是 `system` 信任级并声明 `role: validator`，因此组合期守卫仍然拒绝给它读日志的工具：能读被审计日志的评审者会重建实现者的推理，从而失去这套安排所提供的独立性。屏障追加一条 `judge/session` 事件，命名被审计的会话 id 并断言空谱系，而 invariant 拒绝来自 header 携带父级或种子的会话的裁定。

##### 第 7 个切片记录的偏差

评审者 preset 声明的是 `role: judge`，不是 `role: validator`。`validator` 是不被拒绝任何内容的角色，因此自称该角色的评审者 preset 可以毫无阻拦地组合一个读日志的工具——正是本节所禁止的那种组合。于是屏障的角色词表新增 `judge`，它被拒绝每一项已声明的工具权限以及屏障拥有的每个目录：实现者不得读取度量它的那份标准，评审者不得读取交给它的证据背后的检查指令。`DENIED_ROLES` 是判定被拒集合约束哪些角色的唯一处所，因此 `deniedAuthority`、`deniedReadRoots` 与拒绝 invariant 都遵循它，而 `authorityDenialMessage` 会指明它所拒绝的角色。`startRefusal` 仍只面向 implementer：进程外执行器在某个声明下可以做什么，是这道阶梯上属于实现者的那一级，而评审者 preset 根本不组合任何执行器。

评审者的系统提示词作为评审者会话的第一条用户消息投递，而不是经由 `request/header.system`。`Session.deriveMessages()` 只投影 `user/message`、`assistant/message` 与 `tool/result`，因此系统提示词根本不属于派生历史，「恰好三条消息」也就无法在持久日志上被检查。该文案由 `@deepseek-ai/dsh-judge` 以其 `systemPrompt` 配置字段拥有；随附 preset 的 persona 是另一句独立的身份陈述，`complete: true` 使它成为完整的系统提示词，因此任何部署的提示词分节也都不会到达评审者。

`judge/session` 携带本节所命名的四个字段，没有 `version`，这与屏障自己的三条记录不同。它的消费方是同一个包中的 invariant 伴生插件，后者读取会话 header 与派生历史，而不是载荷自身的词表。

裁决词表是 `upheld | overturned | inconclusive`，在此选定是因为 [seam 笔记](2026-08-29-verification-improvement-oversight-seams.md)对此未作规定——它只命名了作为提示的 `oversight/flag`。三者皆未指明的回答记为 `inconclusive` 并携带该回答，因此没有作出判定的评审者不会被读成作出了 `upheld` 判定的评审者。

评审者所重现的摘要是 `hashWorkspaceTree`，它从环境运行器移入 `@deepseek-ai/dsh-verification`，由两者共同引入。记录 `treeHash` 的执行器与从副本重新推导它的审计者不得在路径写法、排序或归一化上产生分歧，而同一摘要的两份实现终将产生分歧。

评判 Consumer 位于 `packages/verification/judge/` 而不是 `oversight/` 组：它读取其证据所由构成的完成标准词表，以及其 preset 所声明的读取屏障角色，而监督 seam 的其他部分尚不存在，无从与它并列。

## The isolation ladder

| 级别 | 它断言什么 | 所需强制执行 | 持久证据 |
|---|---|---|---|
| `none` | 什么都不断言。实现者与验证者共享文件系统。 | 无。 | 仅证书本身；组合了屏障时还有一条作用域事件。 |
| `process` | 实现者会话的任何执行器都不打开被拒路径。 | 每个已组合的打开路径的能力都记录 `denied-at-executor`；会话的沙箱模式为 `workspace-write` 或更窄；workflow worker 与进程外 subagent 提供方拒绝启动。 | 第一条 `request/header` 之前的一条 `read-barrier/scope` 事件，角色为 `implementer`，被拒权限交集为空，且没有 `unenforced` 条目。 |
| `host` | 检查与 fixture 位于 harness 账户的可写范围之外。 | `process` 所需的全部。 | `process` 所需的全部，外加一条屏障从 harness 进程无法写入的文件验证得来的 `read-barrier/attestation` 事件。 |

## Alternatives considered

**省略工具并信任提示词。** 当另一个调用方能到达同一操作时，schema 省略与指令都不是强制执行，这正是 packages 标准要求把决定放在做出该决定的操作里的原因。屏障在执行器处拒绝，验收标准也在那里测试拒绝。

**用 `SandboxMode` 而不是单独的策略来拒绝读取。** `SandboxMode` 是每个强制执行家族共享的三值文件效果词汇；再加一个意为"且不能读这些路径"的值会让一个枚举承载两个互不相干的决定，而每个在该模式上分支的消费方都得学会第二个。`deniedReadRoots` 搭乘同一份逐调用策略，而不改变模式的含义。

**像 `fs-sandbox` 那样继承文件系统提供方。** 每个上下文只注册一个 `ctx.fs` 提供方，而 `SandboxedFileSystem` 已经继承 `LocalFileSystem`，因此第二道靠继承实现的围栏会逼出 mixin 或固定的提供方阶梯。`fs/*` 事件门正是为在不引入服务依赖的前提下添加策略而建，且插件缺席时它退化为裸提供方。

**在屏障的配置里列出被禁工具。** 名单在某个包新增读日志工具的那一刻就过时了，而部署方还能把它改短。声明在工具处的权限由工具自身携带，而某个角色的被拒集合是安全不变量而非可调项。

**由会话创建方而非 preset 决定角色。** 创建方知道意图，只有组合知道实际挂载了什么，而这里要防的失败正是某个 preset 组合了它的角色所禁的工具。preset 声明角色，挂载审计据此检查组合，而当解析出的 preset 角色不匹配时创建方的请求被拒绝。

**从配置推断 `host`。** 环境运行器已经出于同样的理由否决了推断隔离：进程内没有任何东西能观察部署的安排，因此推断出的值要么贬低一次隔离运行，要么为一次本地运行撒谎。另一账户拥有的一份文件，是进程内部造不出来的最小事实。

**把篡改记为一次失败的检查。** 检查失败意味着工作未完成；测试被修改意味着度量作废。把两者合并会让一条轨迹为检查已不再描述该任务的工作区挣得部分分数，所以篡改自成一种裁定与一种奖励依据。

**把实现者的转录给评审者作上下文。** 读了被审计推理的评审者会继承它的框定，而[seam 笔记](2026-08-29-verification-improvement-oversight-seams.md)记录的同血统误标正是这个盲会话所要避免的。评审者收到的是任务、目录树，以及审计者挑选的证据。

## Acceptance criteria

- 在基于 `examples/headless-agent/tests/fixtures/read-barrier/` 的 Loader 启动组合中，来自 `implementer` 角色会话、对屏障根目录下某文件的 `read` 以 `FS_READ_BARRIER_DENIED` 与上文原文消息失败，追加一条 `read-barrier/denied` 事件，而同一进程内来自屏障不拒绝任何内容的会话——不持有预留的会话，以及 preset 能声明该角色之后的 `validator`——的同一次调用返回该文件内容。
- 拒绝在执行器处被证明，而不是靠 schema：实现者的 `read` 工具已注册且可见，来自受信插件的直接 `ctx.fs.readText` 仍然成功，测试断言这一点，好让威胁模型保持明确。
- 挂载 `examples/headless-agent/tests/fixtures/read-barrier-guard/` 处那个声明 `role: implementer` 又组合了 `dsh-tool-session-query` 的 preset，以上文原文拒绝并且不留下任何会话；一个声明 `role: validator` 的 `user` 信任级 preset 连同理由被列为 `broken`；而 invariant 伴生插件拒绝作用域清单携带 `session-log` 权限的手工编写日志上的证书。
- 在没有已验证证明的会话上以 `isolation: 'host'` 调用 `recordRun()`，以 `VERIFICATION_ISOLATION_UNPROVEN` 拒绝且不提交证书；invariant 伴生插件在证书那条记录处拒绝携带该证书的手工编写日志。
- 在作用域事件记录了任何 `unenforced` 能力的会话上以 `isolation: 'process'` 调用 `recordRun()` 以同样方式拒绝，而当每个已组合能力都记录 `denied-at-executor` 时成功。
- 在 `examples/headless-agent/tests/fixtures/read-barrier-tamper/` 上——其环境把测试文件标记为不可变，其脚本化模型覆写了它——该次尝试的 `verification/run` 携带 `verdict: 'tampered'`，不存在证书，goal 不进入 `complete`，导出的轨迹行 `outcome: 0` 且依据为 `tamper`。
- 为某个被审计会话创建的评审者会话没有 `parentSessionId` 也没有种子，其派生历史恰好持有评审者系统提示词、任务提示词与证据消息，而 invariant 拒绝来自携带其中任一者的会话的裁定。
- 两个 keyless 快照记录模型所见：`examples/headless-agent/tests/snapshots/read-barrier-denied/` 钉住转录与会话日志中的拒绝文本，`examples/headless-agent/tests/snapshots/read-barrier-tamper/` 钉住篡改 directive 的 `<validation_failed>` 后续轮次。两者按[测试策略](../../../../docs/testing.md)在 macOS 与 Linux 上重放。

## Rollout

每个切片带着自己的测试落地，并各自让各项 gate 保持绿色。

1. **已落地。** `@deepseek-ai/dsh-read-barrier`，含根目录、`reserve`、`protect`、`resolve`、`denies`、`recordDenial`、`read-barrier/denied` 事件，以及它的 invariant 伴生插件——该伴生插件拒绝为 `implementer` 以外角色记录的拒绝、载荷版本或 capability 未知的拒绝，以及在一个会话内指向第二个屏障根目录的拒绝。环境运行器经 `ctx.get('readBarrier')` 预留，并在每次尝试写入 `standard.json` 与每个检查一份 `checks/<checkId>` 脚本，以 `. <script>` 运行每一个，使同一个 shell 执行同一条指令；检查 id 不是单个路径段，或预留路径无法被命令行以不加引号的方式承载时，本次运行以 `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT` 失败。`read-barrier/scope` 与执行清单不在其中：清单是每个可见工具一条 `{ name, authority }`，而执行状态是每个记录判定的能力一条，两者都等待提供其内容的那个切片。`dsh-session-persistence-jsonl` 尚未调用 `protect()`，现有组合的行为不变。
2. **已落地。** `dsh-fs` 中作为返回 `FsReadDenial` 的委派式 waterfall 的 `fs/read-intent`、`FS_READ_BARRIER_DENIED`、`dsh-tool-fs` 中的派发（`read` 与 `read_image`，位于 `resolveRegularReadTarget` 内 stat 之前）与 `dsh-tool-str-replace-editor` 中的派发（`view`，位于它自己的 stat 之前），以及拥有那条确切文案的 `@deepseek-ai/dsh-fs-read-barrier`。`read-barrier` fixture 在 Loader 引导的组合中于执行器处证明该拒绝，`read-barrier-denied` 快照钉住面向模型的文案与持久记录；两者都无需密钥，快照经 `dsh-llm-replay` 重放一份已提交的脚本。
3. **已落地。** `ToolDefinition` 上的 `ToolAuthority`、`dsh-tool-session-query` 与 `dsh-tool-cordis` 中的声明、`preset.yml` 中的 `role` 及对 `user` 信任级 `validator` 的拒绝、`mountPreset` 审计、作为名册设定角色唯一途径的 `ReadBarrierService.declareComposition`，以及逐 agent 的工具守卫。`read-barrier/scope` 连同 `enforce()` 与 `enforcementCensus()` 也在此落地，因为清单正由本切片新增的权限声明构成，而那些执行登记需要一个归属；`dsh-fs-read-barrier` 是 `enforce()` 的第一个调用方。审计按 preset 作用域解析工具注册表，因此被限制规则从该作用域过滤掉的工具不参与审计——该作用域同样无法调用它，而守卫覆盖审计看不到的部分。
4. **已落地。** 证书 invariant：`recordRun` 前置条件、伴生插件的规则、带 `agent-reported` 上限的 `VerificationCertificate.executor` 与 scorekeeper 的 `certificateExecutor` 事实、`read-barrier/attestation` 事件及其文件检验，以及 `CertificateIsolation` 的文档变更。`EnvironmentRunRequest.preset` 不在其中并已撤回：清单已经记录会话的角色，因此 `isolationProblem` 会拒绝未持有 `implementer` 的会话高于 `none` 的声明——该拒绝属于颁发证书的那次操作，而不属于运行请求上的第二个字段。`verification-domain` 的 `agent-reported` fixture 从 `process` 改为 `none`，这一直就是它的证据所支撑的级别。
5. **已落地。** `SandboxPolicy` 与 `SandboxExecutionPolicy` 上的 `deniedReadRoots`、`dsh-sandbox-local` 各后端、`dsh-sandbox-policy` 从屏障的填充、`dsh-tool-fs-search` 中被约束的 ripgrep 启动，以及 workflow 引擎与进程外 subagent 提供方中的拒绝。这一切片才让 `process` 可被声明。
6. **已落地。** 篡改：`dsh-environments` 中的 `task.immutable` 及其注册校验、运行器对检查所有路径的基线与逐尝试摘要、`verification/run` 上的 `verdict` 及 `recordRun` 的拒绝与伴生插件的规则、`dsh-trajectories` 中的 `tamper` 奖励依据，以及驱动运行器跑完一个环境（其 fixture 供给的测试正被实现者改写）的 `read-barrier-tamper` fixture 与快照。省略 `verdict` 的运行载荷按其结果解读，因为只有篡改无法由结果推出，因此未陈述裁定的手写日志会按其结果所描述的那次运行重放。
7. **已落地。** 盲评审者：随附的 `system` 信任级 `judge` preset（声明屏障新增的 `judge` 角色）、带无谱系创建路径与经摘要校验的工作区副本的 `@deepseek-ai/dsh-judge`、`judge/session` 与 `judge/verdict` 事件，以及拒绝来自这样一些会话的裁决的 invariant：携带父级、携带种子、没有 `judge/session`，或历史开头不是那三条消息。评判 Consumer 属于[seam 笔记](2026-08-29-verification-improvement-oversight-seams.md)的监督 seam；它随 `packages/verification/` 发布，缘由记于上文。`blind-judge` fixture 驱动它跑完一次真实的环境运行，同一组合的快照钉住评审者的指令与证据文案。

## Risks

在 `host` 以下，屏障是实现者自己进程里的受信代码。持有直接 `Session` 或 `ctx.fs` 访问的插件既能追加伪造事件也能读取任何路径，与 `dsh-verification` 已就其持久记录所声明的完全一样。这道阶梯对此是诚实的：`none` 什么都不声明，`process` 只声明已组合的执行器会拒绝，而 `host` 是唯一证据来自进程之外的级别。

`process` 的代价是部署方未必想要的强制执行。约束每一次 ripgrep 启动、拒绝 workflow worker、拒绝进程外 subagent 提供方，都会从声明该级别的实现者会话手里拿走能力；想要这些能力的部署运行在 `none` 上，并保留一张如实说明的证书。

检查的命令行仍然可被观察。屏障保护的是脚本内容与 fixture，而不是进程列表所显示的 argv，因此检查名或参数编码了断言的环境会泄露它。环境作者把断言留在脚本里。

清单的完整度只等于它取自的那个组合。它在第一次请求之前追加，并与每条 `request/header` 的工具名交叉核对，这能抓住之后新增的工具，却抓不住一个根本不注册工具就读取路径的插件。

篡改检测是一次摘要比较，因此它报告检查所有集合变了，而绝不报告是谁改的或怎么改的。一个改写不可变集合内文件的正当构建步骤会让该次运行失败；环境作者把不可变集合声明得窄一些，而一次误裁定的代价是一次运行，而不是一张错误的证书。

让 `trust` 对一个字段具有强制力，改变了 roster 的承诺。一个配置了 `user` 根目录、期望 preset 都是普通组合的部署，现在会发现有一类声明在那里被拒绝；该拒绝作为 `broken` 理由列在那个同时提供删除操作的界面上。

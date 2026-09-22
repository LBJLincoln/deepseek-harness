# Agent Note: 补全任务工厂：从基准自身的参考程序生成任务

Status: proposed

[English](2026-09-22-completion-task-factory.md) | 中文

## Problem

Proving Ground bench 下游的每一个消费者，相对于自己的需求而言都严重缺少可验证的任务：RLVR 语料需要成千上万条带可执行验证器的 prompt，而一次 harness-effect 度量需要成百上千对成对的 cell，差值才能与噪声区分开。该 bench 持有 44 个手工编写的环境，横跨第 2 至第 6 层与若干领域，每一个都要写规格、写参考实现、写可见测试套件，第 5、第 6 层还要写实现者看不到的隐藏用例语料。这样的编写成本无法扩展到 RLVR 与 harness-effect 度量所需要的量级；靠手工再写出十倍甚至百倍于现有数量的同类语料，不是一份计划,而是一份招聘需求。

该 bench 自身的参考程序是一项未被充分利用的资产。每一份参考程序都是一个已经工作、已经测试、已经准入的解答，并且早已被拆分成一个个具名的顶层函数,每个函数都有自己的契约——一段 JSDoc 注释、一组参数与返回值形状、一种行为。一个已经存在的验证器——父环境自身的可见测试套件——就足以判断某一个（且只有那一个）函数是否被正确地重新实现，而无需再写一行新的规格、参考实现或测试。

## Proposal

`tools/synthesize-completion-tasks.mjs` 是一个零依赖的 Node ESM 脚本：读取 `environments/` 下的每个父环境，用一个保守的、能识别花括号/圆括号/字符串/注释/正则字面量/模板字面量的扫描器（而非真正的解析器）解析每个 `reference/src/*.js` 文件中的顶层 `function name(...) { ... }` 与 `const name = (...) => { ... }` 声明；对每一个长度足以值得补全的函数（`--min-lines`，默认 4；某文件中符合条件的函数数若超过 `--max-functions-per-file`，默认 20，则该文件不贡献任何候选），在 `environments-completion/<parent>--<function>/` 下写出一个子环境：持有该参考解答，但把那一个函数的函数体替换为 `throw new Error('not implemented')`（签名及其前导注释或 JSDoc 保持不变）；`test/` 与 `package.json` 与父环境相同、未作改动；`reference/` 保留下来以便准入能够运行；`task.json` 携带 `id: code:<parent>--complete-<function>`、父环境的 `tier`、`domain`、`heldOut`、`immutable`、`family: <parent id>`、`completion: { file, function }`，以及经过过滤、去掉了任何携带隐藏用例文件的 `checks`——补全子环境只依可见测试套件评判。每个被抽空的文件都会立即用 `node --check` 检查，解析失败即丢弃，这是独立于准入之外、对扫描器本身的经验性正确性关卡。

要让 `admit.mjs` 能在结果上运行，需要改动一处：它原本对目录名与 id 的一致性检查是把 `task.id` 与 `code:<directory>` 做精确比较，而补全子环境的 id 带有 `--complete-` 标记（但目录名不带，目录名始终是 `<parent>--<function>`），因此总是无法通过。该检查现在会先剥离这个标记再比较，对每一个精选任务原有的、朴素的 `code:<name>` id 而言这是一次空操作。工厂自身的 `--admit` 步骤会在其输出上运行现在已经兼容的 `admit.mjs`，删除它拒绝的每一个子环境，并把每次拒绝的目录名与原因记录进 `environments-completion/REFUSED.json`。

`register-completion-environments.ts` 是一个新插件，独立于精选任务的 `register-environments` 挂载，把通过准入的一切都注册到与那 44 个精选任务相同的 `bench` kind 下；`EnvironmentKindMap` 的 `bench` detail 类型因此新增两个可选字段 `family` 与 `completion`，精选任务上不携带，补全任务上携带。`with-completion.cordis.yml` 把它挂载在基础组合之外；`with-completion-openrouter.cordis.yml` 把它挂载在 `with-openrouter.cordis.yml` 所命名的免费开放权重路由之外——因为一个 fleet driver 只接受一份配置，两个 overlay 的补丁必须落在同一棵树上。

### 数量

在默认参数（`--min-lines 4`、`--max-functions-per-file 20`）下对已入库的 44 个环境运行：

- 44 个父环境，全部 44 个都带有 `reference/src/*.js` 程序。
- 找到 246 个候选函数；`--min-lines` 跳过了 142 个更短的顶层函数；0 个文件超过 `--max-functions-per-file` 上限。
- 写出 246 个；0 个因未通过 `node --check` 而被丢弃。
- 按层写出数：`{2: 48, 3: 62, 4: 53, 5: 57, 6: 26}`。
- 准入：准入 246 个，拒绝 0 个。按层准入数：`{2: 48, 3: 62, 4: 53, 5: 57, 6: 26}`——写出的每一个子环境都获得了准入；`environments-completion/REFUSED.json` 是 `[]`。

## Alternatives considered

**为每个函数都编写一套新的规格与测试套件，成本与一个父环境相当。** 这正是 bench 在父环境这一层已经在做的事；在函数这一层再重复一遍，并不能解决工厂本要解决的规模化问题，而且手写的逐函数验证器还需要从零建立自己的准入纪律（预状态失败、参考解答通过）。

**让补全子环境依父环境（第 5、第 6 层）隐藏用例的一个子集来评判。** 予以拒绝：一个隐藏用例是针对整个程序的规格编写并审计的，而不是针对某一个函数的契约；一个会触达三个函数的用例,如果不重新编写就无法归因到这个子环境所抽空的那一个函数——本质上是把同一个规模化问题换了个地方。只依可见测试评判则诚实地说明了补全证书究竟度量了什么，README 与注册器的 `description` 都这样写明。

**给补全子环境一个独立的 kind，而不是复用 `bench`。** 独立的 kind 可以让特定生产者的 detail 类型不必把 `family`、`completion` 设为可选，但每一个已经按 `kind: 'bench'` 与 `detail.tier`/`detail.domain` 过滤 bench cell 的消费者——某个 plan、observatory 的 district 切分——都要再加一条代码路径才能看到补全 cell。复用 `bench` 并依 `detail.completion` 是否存在来区分，保持了一条代码路径；代价是在一个可合并扩展的类型上多了两个可选字段，而不是干净地新增第二个类型。

**让子环境目录名也叫 `<parent>--complete-<function>`，与 id 完全一致。** 予以拒绝，理由很直接：在已经归组到 `environments-completion/` 下的目录列表里，这只是多余的噪声；`--complete-` 标记的价值在于它会单独出现在日志、plan 与轨迹里，而不在于出现在一条读者已经知道是补全子环境的路径里。

## Acceptance criteria

- `node admit.mjs environments-completion` 在已入库的目录树上以退出码 0 结束，准入其中剩下的每一个子环境。
- `environments-completion/REFUSED.json` 记录了工厂生成过、但没有保留下来的每一个候选，附带 `admit.mjs` 给出的原因。
- 注册器 e2e 测试中的补全任务族用例会启动 `overlays/registry-only-with-completion.cordis.yml`，并在已注册集合中找到一个指定补全子环境的 id。
- 用相同的输入与参数重新运行工厂,会得到相同的写出集合与准入集合（幂等且确定），通过对连续两次运行的结果做 diff 验证。

## Risks

**这个扫描器不是真正的解析器。** 它对行注释、块注释、单双引号字符串、带嵌套 `${...}` 表达式的模板字面量,以及（带字符类的）正则字面量的处理，足以覆盖这个 bench 自身的参考程序——这一点已经过经验验证：在加入正则字面量处理之后，全部 44 个文件的全部 246 个候选,第一次尝试就全部产出了能通过 `node --check` 的存根。如果某个参考程序采用了这个扫描器未曾预料的写法——例如把正则字面量直接写在一个裸关键字后面、中间不隔任何其他字符（这个 bench 的程序里没有这种写法）——仍有可能产出语法合法、但作用范围搞错了的存根，而 `node --check` 无法捕捉这一点，因为语法检查并不知道一个函数本该在哪里结束。

**补全证书是比精选任务更弱的断言。** 它只说明可见测试套件通过了，并不说明该函数在套件未覆盖的输入上也符合规格；一个可见测试覆盖率不佳的函数，会产生一个很容易拿到证书、却未必真正重新实现了原有行为的补全子环境。这是复用已有验证器、而非另写一个验证器所固有的代价；README 记录了这一点，而不是掩盖它。

**`--min-lines` 与 `--max-functions-per-file` 尚未针对真实的补全尝试做过验证。** 选定这两个值是为了让语料规模落在准入（会对每个候选重新跑一遍父环境自身的测试套件）能够处理的范围内，而不是针对"哪些函数是模型的好补全练习"做过验证；能够验证这一点的、以模型为后端的舰队运行，明确不在产出这份笔记的这次改动范围之内。

**现在有两个生产者共用同一个 kind 的 detail 类型。** `register-environments.ts` 与 `register-completion-environments.ts` 都会写入 `EnvironmentKindMap['bench']`；未来若再有第三个生产者要生产 `bench` 任务，就必须继续在同一个接口上新增可选字段来扩展它，而不能收窄或改写已有字段，否则每一个已经依赖 `detail.tier`/`detail.domain` 的消费者都会被破坏。

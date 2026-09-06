# Agent Note: 验证仪器——墙后的加权用例

Status: proposed

[English](2026-09-06-validation-instrument.md) | 中文

## Problem

关于大型软件任务最有力的公开证据支持一种机制：在实现开始之前，从结果推导出一份可执行的完成标准，由实现者看不见的验证者来测量，失败在越过到实现者一侧之前先按根因聚类。本仓库的验证接缝拥有这些角色，并且自读取屏障各切片以来也拥有对"墙"的执行，但没有这件仪器。一个 `StandardCheck` 是一条带二元裁决的 shell 指令：它不携带用例体，因此一个检查无法为它所测量的内容加权，无法对程序的输入空间采样，也无法逐通道地把候选程序的行为与参考程序比较。运行器的 `evidenceOf` 把失败检查的 `stdout` 与 `stderr` 截断尾部转发进实现者阅读的指令里，于是隐藏用例的原始输出穿过了读取屏障在文件系统一侧牢牢关上的那堵墙。没有任何东西从预言机推导标准；验证者在夹具里手工编写检查。而证书是全有或全无的，因此一个达到程序九成行为的实现者与一个只达到一成的实现者，在轨迹导出中产生同样的 `outcome: 0`、在记分板上产生同样的空格，这恰恰隐藏了大型任务所由构成的进展。[竞争基线笔记](2026-09-06-competitive-baselines.md)记录了证据；本笔记设计这件仪器。

## Proposal

对 `dsh-verification`、`dsh-environment-runner` 与 `dsh-environments` 的四项增补，每项都是确定性的，每项都记录在会话日志中，没有一项改变证书的含义：证书仍然要求每个活动检查的每个用例都通过。

### 检查上的用例

`StandardCheck` 增加一个可选的 `cases` 引用：`{ count, weightTotal, sha256 }`。用例体与检查脚本一起放在验证者的保留目录下，位于 `checks/<checkId>/cases.jsonl`，每行一个 `CheckCase`：`{ id, weight, input: { argv, stdin?, files? }, expected: { exitCode?, stdoutSha256?, stderrSha256?, treeSha256? }, comparator: { channels, normalizers } }`。`channels` 是 `exit | stdout | stderr | tree` 的非空子集；`normalizers` 是来自验证包所拥有并记录的封闭集合（`crlf`、`trailing-whitespace`、`blank-lines`、`iso8601-timestamps`、`temp-paths`、`json-canonical`）的有序 id 列表，每个都是作用于字节的纯函数，并有证明幂等性的单元夹具；未知的 id，或某个期望通道没有摘要的用例，在编写时即失败，早于任何运行依赖它。日志携带引用，保留目录携带用例体，切片 6 的篡改摘要覆盖 `cases.jsonl`，环境定义的 `checksSha256` 覆盖已注册环境的用例，因此用例改变时去污染键随之改变。没有 `cases` 的检查行为与今天完全一致。`Config.maxCases` 像 `maxChecks` 限制检查数那样限制一份标准的用例数。

### 四通道执行与 parity 记录

对于带用例的检查，运行器通过解析出的 shell 与沙箱策略，在工作区内以用例的 `argv`、`stdin` 与预置的 `files` 对候选程序逐用例启动一次，并捕获退出码、`stdout` 字节、`stderr` 字节，以及该检查声明的 `treeScope` 之下工作树增量的摘要。每个配置的通道被归一化、摘要化并与期望摘要比较；只有当每个配置的通道都匹配时用例才通过。`CheckResult` 增加 `cases: { passed, total, weightPassed, weightTotal, failed }`，其中 `failed` 列出不超过某个上界数量的用例 id，`verification/run` 增加对本次运行各检查求和的 `parity: { weightPassed, weightTotal }`。`recordRun` 从用例推导检查状态（只有全部用例通过才是 `pass`），并保留现有规则：证书只跟随每个检查都通过的运行；`parity` 绝不签发证书。scorekeeper 的事实从最后一次记录的运行获得 `parity`，记分板把 `resolved`（证书）与 `parity`（最后一次运行的加权通过率）显示为两列，绝不合并或一起排名，轨迹记录在 `outcome` 旁获得 `parity`，并注明它是用于塑形奖励的辅助信号，绝不取代基于证书的 `outcome`。

### 出口处关上的墙

`describeFailures` 不再转发输出。指令由聚类构建：失败的用例按检查、按不匹配通道的集合、按退出码类别分组；每个聚类成为一行，点名该检查由验证者编写的 `outcome` 文本、其用例的数量与权重，以及不一致的通道，绝不出现用例 id 的内容、期望摘要或任何一个 `stdout` 或 `stderr` 字节。`verification/directive` 事件为观测台增加 `clusters: [{ checkId, channels, count, weight }]`；`detail` 仍由 `evidenceMaxChars` 限界。原始证据留在原处，即日志中 `verification/run` 的结果里，可通过会话查询工具读取，而读取屏障已经拒绝实现者持有这些工具的 `session-log` 权限。一个单元测试投入一个期望输出为哨兵字符串的失败用例，并断言该哨兵出现在运行证据中而不出现在指令的任何地方，无密钥快照则钉住实现者看到的聚类指令文本。

### 从参考程序推导标准

`recreation` 环境种类声明 `task.reference`：夹具之下的一个目录，在保留时复制到屏障根目录之下并列为不可变，存放验证者可以执行而实现者绝不能读取的参考程序。一个验证者角色的 preset 组合一个携带新的 `standard-author` 工具权限的 `standard_author` 工具，挂载审计与按 agent 的守卫像今天拒绝 `session-log` 那样对 `implementer` 会话拒绝它。该工具提供三个动词：`record_case` 在同样的四通道捕获下运行参考程序并为给定输入存储期望摘要，`weigh` 设置用例权重，`freeze` 写出用例文件并通过 `ctx.completionStandards` 编写或扩展标准。行为采样仍是验证者 agent 的语义工作，受 `maxCases` 限界并由一个 skill 引导；执行器、摘要与墙是确定性的。`% resolved`（证书）与 `parity`（加权通过率）以各自的名字作为两个指标报告，遵循 ProgramBench 作者所作的区分。

### 切片 1 与切片 2 落地时记录的偏离

定义把用例体携带在检查自身上：`AuthoredCheck extends StandardCheck` 增加 `caseBodies`，`author()` 与 `extend()` 用它校验 `cases` 引用后即将其丢弃，因此日志只保留引用，也不会有第二张按键映射去指名一个并不存在的检查。注册把用例体哈希进 `checksSha256`，但不对其作任何校验，因为撰写才是判定用例是否可用的操作。

检查脚本移至 `checks/<checkId>/run`，好让 `checks/<checkId>` 成为在其旁存放 `cases.jsonl` 的目录。

`CheckResult.cases.failed` 为每个失败用例携带一条记录——`{ id, weight, channels, exitClass }`——而不是一个裸的用例 id：指令按通道与退出码类别聚类，而运行结果是这些事实唯一存在的地方。运行器的 `maxFailedCases` 限制该列表长度；统计仍然计入并加权每一个失败。

`tree` 通道对用例留下的 `treeScope` 下每个常规文件求摘要，且运行器在声明了该目录的检查的每个用例之前清空它，这正是让该摘要成为逐用例增量的原因。

`describeFailures` 只对带用例的检查作聚类，对不带用例的检查保留其证据行不变，因此墙恰好在有用例的地方关上；环境通过给某个检查配上用例来为它关上这堵墙。

### 切片 3 落地时记录的偏离

`dsh-trajectory/1` 记录把 `parity` 放在自己的顶层、`reward` 的旁边，而不是放进奖励分组里 `outcome` 的旁边：`reward` 里的一切都是证书判定的结果，把一个加权通过率摆进那些字段中间，读起来就成了它绝不该成为的奖励的一部分。

scorekeeper 的事实与导出字段都是最后记录的那次运行的 parity，该次运行没有度量用例时不存在，而不是该会话任何一次运行最后携带过的 parity。`certified` 与 `attempts` 描述的已经是最后一次运行，因此一个残留自某个带用例检查已被放宽掉的标准修订的通过率，会把两个标准的度量发布在同一行里。scorekeeper 的不变量配套文件从日志最后一条 `verification/run` 重算该事实，并拒绝陈述了别的值的记录。

`ScoreboardRow.parity` 是各会话 `weightPassed / weightTotal` 的均值，而不是该行各权重的合并比值，因此被更多用例采样的会话，不会比该行所指单元格中的同侪权重更大。

## Alternatives considered

**把用例放进 `verification/standard` 事件。** 否决：一个重建任务携带数百个用例，而日志是每次回放都要读取的记录；保留目录已经存放检查体，篡改摘要已经覆盖它，事件携带把两者绑定的摘要。

**指令中的原始输出尾部。** 现状，否决：隐藏用例期望输出的尾部就是用例本身，一堵在文件系统上守住却从指令中泄漏的墙什么也守不住。

**以 parity 作为奖励。** 否决：加权通过率可被一个过拟合可见失败而放弃其余部分的实现者博弈；`outcome` 仍是证书，`parity` 作为辅助信号导出，训练运行可以用它塑形，但绝不单独优化它。

**以模型作为比较器。** 否决：两次运行可能作出不同裁决的比较无法签发证书；归一化器是有名字的纯函数，在所有归一化器之下输出仍不确定的程序被排除出用例而不是被评判。

**永远二元的检查状态。** 否决：通过 770 个用例中 700 个的检查与一个都不通过的检查是关于工作的不同事实，记分板、轨迹导出与验证者的指令都需要这种差别。

## Acceptance criteria

- 一个 `recreation-instrument` 夹具注册一个参考程序位于屏障根目录之下的环境；验证者 preset 从它编写一份加权用例的标准；模拟实现者的程序通过部分用例、失败其余用例；该次尝试的 `verification/run` 携带权重精确的 `parity`，每个失败用例连同其不匹配通道在运行结果中报告，并且在后续某次尝试通过全部用例之前不存在证书。
- 失败运行之后发出的指令点名各检查的 `outcome` 文本、数量、权重与通道，且不含任何用例期望输出的任何字节；一个单元测试以哨兵证明这一点，一个无密钥快照钉住该文本。
- 每个归一化器都有证明幂等性与其声明效果的夹具；未知的归一化器 id 以及配置了通道却没有摘要的用例在编写时被拒绝。
- 不变量伴随件拒绝 `parity.weightPassed` 超过 `weightTotal` 的运行、用例计数与检查的 `cases` 引用不一致的结果，以及跟随在有失败用例的运行之后的证书。
- `standard_author` 被挂载审计对 `implementer` preset 拒绝，被守卫对稍后注册的工具拒绝；census 列出其权限。
- 记分板把 `resolved` 与 `parity` 显示为分开的列并拒绝跨列排名；轨迹记录在 `outcome` 旁携带 `parity`，导出器的 README 说明该规则。
- 改变一个用例会改变环境的 `checksSha256`；以修改过的 `cases.jsonl` 扩展的篡改夹具产生 `verdict: 'tampered'`。

## Rollout

1. 已落地。检查上的用例：`cases` 引用、`CheckCase`、归一化器集合、`maxCases`、运行器中的四通道执行、`CheckResult.cases` 与 `verification/run.parity`、不变量规则、重新生成的目录。
2. 已落地。关上的墙：带 `verification/directive` 上 `clusters` 的聚类指令、哨兵测试，以及基于 Loader 启动夹具的 `instrument-cases` 快照。
3. 已落地。下游的 parity：`SessionFactsOutcome.parity` 与 `ScoreboardRow.parity` 列、`dsh-trajectory/1` 记录上的 `parity`，以及 Village 笔记中的发布规则。
4. 仪器：带 `task.reference` 的 `recreation` 种类、`standard-author` 权限、`standard_author` 工具、验证者 preset、采样 skill、`recreation-instrument` 夹具。
5. 套件准入：重建环境通过四目标笔记的策展者准入，两个指标都在 stamp 上。

## Risks

- **非确定性程序。** 参考输出会变化的用例会让每个候选程序失败；编写时把参考程序运行两次，并拒绝两次运行之间通道不一致的用例。
- **成本。** 基于用例的验证成倍增加检查执行；已发表的证据把系统条件置于单个 agent 约十四倍的额度，预算策略与 fleet 的上限限定一个 cell 可以花多少。
- **归一化器膨胀。** 每个归一化器都扩大了"相等"的范围；该集合是封闭的、有记录的，只通过本笔记的后继并为每一项配一个夹具来扩展。
- **日志大小。** 每次运行有数百条用例结果进入日志；`failed` 有上界，用例体留在保留目录中。
- **部分得分博弈。** 看到聚类计数的实现者可能追逐可见的聚类；留出用例与篡改摘要保持测量诚实，而 `parity` 绝不签发证书。

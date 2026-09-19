# Agent Note：企业花名册由真实来源生成；实时状态由 feed 计算，而非凭空捏造

Status: implemented

[English](2026-09-19-enterprise-roster-and-harness-feed.md) | 中文

## Problem

一个面向客户的概念验证需要展示一个庞大、结构化的"企业"——事业部、部门、专精方向——却又不能假装这个 harness 今天真的在并发运行 147 个智能体。有两种失败模式都是现实存在的风险：一份手写的花名册 JSON，会在某个软件包被改名或删除的那一刻就与仓库脱节；一个对着什么都没在运行的席位报告"active"的状态字段。二者中任何一个,都会在有人拿它去对照仓库核实的那一刻,把一份概念验证变成一份捏造材料。

## Decision

**花名册是生成出来的,而非手写的,且每条记录都引用一个真实的、经过校验的路径。** `scripts/enterprise-roster.ts` 把恰好 147 个智能体组合为"角色 x 事业部 x 专精方向"。每个事业部的智能体数量都是一个固定配额(`DIVISION_QUOTAS`,总和为 147),而非某个目录列表的长度:`takeQuota()` 会从一个为确定性迭代而排序的来源池中精确截取该配额所需的条目数,若代码树定义的真实来源少于配额所需,则抛出异常并指明该事业部与缺口数量。每个事业部的来源池都是一个可枚举的真实来源：`harness-core` 取自 `packages/core`、`packages/llm`、`packages/subagent` 的叶子目录；`proving-ground` 取自 Proving Ground 基准测试夹具下的任务环境(`examples/headless-agent/tests/fixtures/proving-ground-bench/environments`)；`verification` 取自 `scripts/verify-*.ts`；`judging` 取自 `scripts/run-gates.ts` 中的 CI 关卡 id；`curation-data` 取自 `.agents/notes/implemented/<class>` 目录加上 token-meter 软件包；`program-departments` 取自十个软件包分组的 README；`code-safety` 取自 `data/knowledge/code-safety` 下六个部门真实的审查知识包与六种语言专精方向的交叉；`knowledge` 取自 `.agents/skills/<id>` 目录；`governance` 取自八份流程标准文件；`observatory` 取自六个遥测/查询来源。一个 `cite()` 辅助函数会在生成器产出任何一条硬编码的相对路径之前,先用 `existsSync` 对其做校验,因此一个被改名或删除的来源会让生成器立即失败并指明缺失的路径,而不是发布一条无所依托的花名册记录。每位代码安全审查员的 OpenRouter 模型,以及免费模型列表本身,都来自对 Proving Ground 基准测试的 `with-openrouter.cordis.yml` 叠加层所做的一次正则表达式提取(`openRouterFreeModels()`),并用 `pickCyclic()` 在 36 位审查员之间循环分配,绝非硬编码的模型列表。

**`generatedAt` 是花名册内容最近一次变化的时刻,而绝非某次重新生成的时钟。** `generateRoster()` 先用已提交文件自带的时间戳构建花名册;若由此逐字节复现了该文件,文件便原样保留,只有内容变化才会以当前时间重建并写入。`buildRoster()` 本身把时间戳作为参数接收并保持纯函数,因此在未变化的代码树上运行 `pnpm run roster` 不产生任何差异,规格测试也用同一时间戳把已提交文件与一次全新构建作比较;尚无花名册文件的代码树从固定的纪元时间构建,并以当前时间写入。

**生成文件中的 `status` 永远是 `"defined"`,`counts.active` 永远是 `0`。** 这个模块描述的是仓库定义了什么;它没有会话数据,也不应去猜测。`scripts/harness-feed.ts` 是唯一计算实时状态的地方：其 `GET /roster` 处理函数读取已提交的花名册,再把每个智能体映射到一个实时会话(尽力而为,先依据会话被打上标记的 `request/header` 中声明的提供方/模型,再依据其角色或事业部是否出现在该会话的系统提示词文本中)来判定 `active`(存在匹配且仍在运行的会话)、`certified`(该会话在结束前记录了一个 `verification/certificate` 形状的事件)或 `failed`(结束时未记录该事件),此后才重新计算计数。已提交的文件与被响应返回的对象绝不是同一个对象;被响应返回的内容是每次请求派生并即用即弃的。

**代码安全专精方向标注的是目标,而非已实现的扫描器。** 本仓库是 TypeScript/JavaScript 项目,没有 Java、Go、PHP 或移动端的静态分析工具,因此全部 36 个"部门 x 专精方向"审查席位,无论标注的是哪种语言,都引用其所属部门真实的审查知识包(`data/knowledge/code-safety/<department>/SKILL.md`);专精方向记录的是该席位*为何而设*。每位审查员、整合员与项目负责人也都以 `code-safety/<id>` 技能的形式引用该知识包(负责人还额外引用横切的 `review-method` 与 `severity-and-evidence` 知识包),其余每个事业部则使用裸 `.agents/skills/<id>` id。`data/enterprise/README.md` 对"已定义"与"已实现"的区别直言不讳,以免读者把二者混淆。

**`harness-feed.ts` 中的事件折叠逻辑是针对真实的会话事件词汇表编写的,只留有一小部分面向未来的余量。** `packages/core/session` 生成的 `KNOWN_SESSION_EVENT_TYPES` 包含 `turn/start`、`turn/end`、`step/start`、`step/end`、`tool/call`、`tool/result`、`agent/inbox/spliced`、`hook/*`、`tool-workflow/*`、`tool/code-dispatch*`、`verification/certificate` 与 `program/integration`——全部都是真实的、当前会产出的类型,折叠逻辑将它们分别映射为 `step`、`tool`(若工具名属于子智能体工具则映射为 `delegation`)、`directive`、`certificate` 与 `merge`。只有 `agent/step`、以 `finding` 为前缀的类型,以及 `code-safety/finding` 仍面向未来,是在尚未上线的代码安全扫描器真正产出它们之前预先识别的项目。每一处读取解码后行的 `type` 字段的地方都会经过共享的 `typeOf()` 守卫,而不是假定该字段一定是字符串:运行目录中的非会话 JSONL 记录(`facts.jsonl`、`trajectories.jsonl`)与会话自身的头行都不带 `type`;折叠逻辑无法识别的行会从事件流中被丢弃,绝不会导致崩溃,也绝不会生成占位记录。

**已发现运行的种类与状态来自其驱动脚本实际写入的内容,绝不来自任何驱动脚本都不会填充的字段。** `.proving-ground/runs/<id>/plan.json` 是对用户编写的计划文件的逐字节拷贝(`scripts/proving-ground.ts` 从不会为其添加 `kind`、`status` 或 `endedAt`),因此 `classifyPlanKind()` 会从 `models` 数组推断出 `fleet`,从 `baseline`/`candidate` 一对推断出 `experiment`,从 `goals` 数组(`packages/improvement/program` 的 `ProgramSpec`)推断出 `program`,与 `scripts/proving-ground.ts` 自身的 `planKind()` 保持一致。状态与 `endedAt` 则改为来自 `run.log` 的末尾 JSON 行:每个 fleet 与 experiment 驱动脚本都会在退出前恰好打印一行 `type: "result"` 且携带 `endedAt`,`run.log` 会复制该输出,因此该行的存在(或一行 `type: "error"`/`"refused"`)决定了状态是 `completed`/`failed` 还是 `running`。一次已记录的 `data/proving-ground/<id>` 运行,同样从 `result.json` 的 `report.goals`(program)、`result.arms`(experiment)或 `report.group`/`report.cells`(fleet)中分类出这三种种类,当形状都不匹配时回退到目录名或 manifest 的夹具路径。一次代码安全运行(实时的 `.code-safety/<id>` 或已记录的 `data/code-safety/<id>`)种类始终为 `code-safety`;实时运行的状态同样来自 `stdout.jsonl` 唯一的末尾 `type: "result"` 行,并对照 `scripts/code-safety.ts` 自身的成功判定标准(`report.outcome === "released" && verifier.exitCode === 0`)。

**`GET /runs/:id/events` 逐个文件、逐个事件地流式传输一次运行的会话文件,绝不先把整个文件缓冲进一个数组。** `streamJsonlLines()` 通过 `node:readline` 读取每个文件,每解码出一行就立刻折叠并发送该事件;`resolveFileIdentity()` 会先对文件做一次轻量扫描,找到其 `session` 头行与 `request/header` 行,再进行真正的重放,因此一个文件的智能体 id 归属最多只需同时持有这两行。这使得已记录的、包含 32 个会话的 `data/proving-ground/2026-09-19-bench-e3-attempts-t5` 重放能在远低于一秒的时间内开始输出,原因还在于 `sessionFilesForRun()` 也把它的 `*.jsonl` 搜索范围限定在运行目录的 `sessions`/`.sessions` 子目录内,而不是遍历整个运行目录:运行目录顶层自身的 `facts.jsonl`/`trajectories.jsonl` 不携带任何会话行字段,若不限定搜索范围而做递归遍历,仍会把二者当作会话文件交给折叠逻辑。

## Consequences

- `pnpm run roster` 会确定性地重新生成 `data/enterprise/roster.json`;一次干净的重新生成后该文件出现差异,意味着某个被引用的来源发生了移动,生成器自身的报错会指明是哪一个。
- `pnpm run feed` 在 4711 端口(可用 `--port` 覆盖)或针对一个 `--fixtures <dir>` 目录(供前端自身的测试使用)提供 `GET /roster`、`GET /runs`、`GET /runs/:id/events`(SSE)、`GET /safety/:id` 与 `POST /safety`。它在请求时于四条相互独立的路径下发现运行,每一条都容忍缺失:`.proving-ground/runs/*` 与 `.code-safety/*` 是被 gitignore 排除的运行时输出,一次全新检出本就不会有;`data/proving-ground/*/sessions/*.jsonl` 与 `data/code-safety/*` 是已提交的历史记录,一次全新检出确实会有,但只包含实际已被记录进去的那些运行(`data/proving-ground/2026-09-19-bench-e3-attempts-t5`、`data/code-safety/2026-09-19-nodegoat` 等)。
- `POST /safety` 在每次请求时检查 `package.json` 中是否存在 `code-safety` 脚本,而不是缓存这一结果:脚本缺失时返回带有明确说明的 501,脚本存在时由 `scripts/code-safety.ts` 以分离进程方式启动并返回带运行 id 的 202。`GET /safety/:id` 既服务于实时的 `.code-safety/<id>` 运行——一旦各部门合并进其报告仓库的 `repo/<programId>/@integration` 工作树,就读取该工作树——也服务于已记录的 `data/code-safety/<id>` 运行那种扁平的 `findings.json`/`SAFETY-REPORT.md`/`verifier.txt`。两种形状下,一条发现记录都不带 `department` 字段,只在 id 上带一个部门前缀(如 `access-idor-allocations`);`certificate.counts` 直接从 `findings` 统计得出,而不信赖某次校验读数——两种真实格式都不携带按严重级别的计数。
- 本笔记存在的目的所要落实的诚实原则:147 永远是已定义的数量;活跃数量则是 `GET /roster` 在请求发生的那一刻,从真实会话目录中计算出的结果,包括为零的情况。

## Alternatives considered

- **手写一次 `roster.json` 并作为静态数据提交** ——第一次软件包改名或删除,就会让相关记录悄无声息地指向空处,且没有任何机制能察觉。带有经过校验的 `cite()` 的生成方式,把这种情况变成一次构建失败,而不是一句悄悄的谎言。
- **`generatedAt` 取系统时钟,或取代码树最近一次提交的时间戳** ——系统时钟会让每一次重新生成都产生差异,即便代码树中没有任何来源发生变化;而 HEAD 提交的时间戳在重新生成的文件本身被提交的那一刻就会移动,已提交文件因此永远无法与一次全新构建相符。在内容变化之前保留已提交的时间戳,是唯一能让文件、生成器与规格测试三者一致的选择。
- **让折叠逻辑以理想化的事件名而非真实事件名为主键** ——会让折叠逻辑的主路径无法针对本仓库当前能够产出的任何会话日志进行测试。先折叠真实词汇表,再把仍面向未来的名字(`agent/step`、以 `finding` 为前缀的类型)作为额外可识别的前缀,既能让无密钥测试套件锻炼真实行为,又能为那唯一尚未上线的扫描器保持面向未来的兼容性。
- **把缺失的 `.proving-ground/`、`.code-safety/`、`data/proving-ground/` 或 `data/code-safety/` 当作错误处理** ——前两者是真实机器会填充的运行时目录,一次全新检出或 CI 运行器通常没有;后两者是已提交的记录,但仍可能缺少任何一个具体的运行 id。这四者中任意一个缺失都是常见情形,而非配置错误。
- **从 `plan.json` 自身的 `kind`/`status`/`endedAt` 字段推导一次运行的种类或状态** ——没有任何驱动脚本会写入这些字段(`scripts/proving-ground.ts` 只会逐字节拷贝用户编写的计划文件),若信赖它们,就会让每一次运行都悄无声息地报告同样错误的种类与状态。改为从计划实际声明的 arms、以及从 `run.log`/`stdout.jsonl` 的末尾行推导,能让答案对应驱动脚本确实写下的内容。

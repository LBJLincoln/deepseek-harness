# Agent Note：企业花名册由真实来源生成；实时状态由 feed 计算，而非凭空捏造

Status: implemented

[English](2026-09-19-enterprise-roster-and-harness-feed.md) | 中文

## Problem

一个面向客户的概念验证需要展示一个庞大、结构化的"企业"——事业部、部门、专精方向——却又不能假装这个 harness 今天真的在并发运行 147 个智能体。有两种失败模式都是现实存在的风险：一份手写的花名册 JSON，会在某个软件包被改名或删除的那一刻就与仓库脱节；一个对着什么都没在运行的席位报告"active"的状态字段。二者中任何一个,都会在有人拿它去对照仓库核实的那一刻,把一份概念验证变成一份捏造材料。

## Decision

**花名册是生成出来的,而非手写的,且每条记录都引用一个真实的、经过校验的路径。** `scripts/enterprise-roster.ts` 把恰好 147 个智能体组合为"角色 x 事业部 x 专精方向",其中每个事业部的切片都构建自一个可枚举的真实来源池：`harness-core` 取自 `packages/core`、`packages/llm`、`packages/subagent` 的叶子目录；`proving-ground` 取自 `examples/headless-agent/tests/*snapshots*` 下已记录的基准场景；`verification` 取自 `scripts/verify-*.ts`；`judging` 取自 `scripts/run-gates.ts` 中的 CI 关卡 id；`curation-data` 取自 `.agents/notes/implemented/<class>` 目录加上 token-meter 软件包；`program-departments` 取自十个软件包分组的 README；`code-safety` 取自六个部门依托软件包与六种语言专精方向的交叉；`knowledge` 取自 `.agents/skills/<id>` 目录；`governance` 取自八份流程标准文件；`observatory` 取自六个遥测/查询来源。一个 `cite()` 辅助函数会在生成器产出任何一条硬编码的相对路径之前,先用 `existsSync` 对其做校验,因此一个被改名或删除的来源会让生成器立即失败并指明缺失的路径,而不是发布一条无所依托的花名册记录。

**`generatedAt` 取代码树最近一次提交的时间戳,而非取自系统时钟。** 读取 `git log -1 --format=%cI` 而非 `Date.now()`,正是让 `buildRoster()` 在针对同一提交反复运行时产出逐字节相同的 JSON 的关键——这是一条真正的幂等性质,而不仅仅是字段数量恒定。没有 git 历史的代码树会回退到一个固定的纪元时间,而不是破坏这条保证。

**生成文件中的 `status` 永远是 `"defined"`,`counts.active` 永远是 `0`。** 这个模块描述的是仓库定义了什么;它没有会话数据,也不应去猜测。`scripts/harness-feed.ts` 是唯一计算实时状态的地方：其 `GET /roster` 处理函数读取已提交的花名册,再把每个智能体映射到一个实时会话(尽力而为,依据会话被打上标记的 `request/header` 与 `tool/call` 数据中出现的预设 id 与角色/部门关键词)来判定 `active`(存在匹配且仍在运行的会话)、`certified`(该会话在结束前记录了一个 `verification/certificate` 形状的事件)或 `failed`(结束时未记录该事件),此后才重新计算计数。已提交的文件与被响应返回的对象绝不是同一个对象;被响应返回的内容是每次请求派生并即用即弃的。

**代码安全专精方向标注的是目标,而非已实现的扫描器。** 本仓库是 TypeScript/JavaScript 项目,没有 Java、Go、PHP 或移动端的静态分析工具,因此全部 36 个"部门 x 专精方向"审查席位,无论标注的是哪种语言,都引用其所属部门真实的依托软件包(`dsh-credentials`、`dsh-shell`、`dsh-fs`、`dsh-storage`、许可证校验脚本、`dsh-sandbox`);专精方向记录的是该席位*为何而设*,`data/enterprise/README.md` 对此直言不讳,以免读者把"已定义"误认为"已实现"。

**`harness-feed.ts` 中的事件折叠逻辑是针对真实的会话事件词汇表编写的,而非针对理想化的那一套。** `packages/core/session` 定义了 `turn/start`、`turn/end`、`step/start`、`step/end`、`tool/call`、`tool/result`、`assistant/message` 与 `agent/inbox/spliced`;这棵代码树里今天并不存在 `agent/step`、`subagent/*`、`program/delegation`、`program/integration` 或 `verification/certificate` 这样的事件类型。折叠逻辑映射真实类型(`turn/*` 与 `step/*` 映射为 `step`;`tool/call`/`tool/result` 映射为 `tool`,若工具名属于子智能体工具则映射为 `delegation`;`agent/inbox/spliced` 映射为 `directive`),并额外识别理想化的前缀(`verification/certificate` 映射为 `certificate`,`program/integration` 映射为 `merge`,以 `finding` 为前缀的类型映射为 `finding`,形似拒绝的工具失败映射为 `refusal`),这样当并行推进的 proving-ground 与 code-safety 项目开始产出这些事件时,折叠逻辑无需任何改动。折叠逻辑无法识别的事件类型会被从事件流中丢弃,绝不会导致崩溃,也绝不会生成占位记录。

## Consequences

- `pnpm run roster` 会确定性地重新生成 `data/enterprise/roster.json`;一次干净的重新生成后该文件出现差异,意味着某个被引用的来源发生了移动,生成器自身的报错会指明是哪一个。
- `pnpm run feed` 在 4711 端口(可用 `--port` 覆盖)或针对一个 `--fixtures <dir>` 目录(供前端自身的测试使用)提供 `GET /roster`、`GET /runs`、`GET /runs/:id/events`(SSE)、`GET /safety/:id` 与 `POST /safety`;它在请求时发现 `.proving-ground/runs/*`、`data/proving-ground/*/sessions/*.jsonl` 与 `.code-safety/*`,并容忍这三者同时缺失——在一次全新检出中它们本就会缺失,这些是运行时输出目录,而非仓库夹具。
- `POST /safety` 在并行推进的 code-safety 工作流交付 `pnpm run code-safety` 之前始终返回 501;feed 在每次请求时检查 `package.json` 中是否存在该脚本,而不是缓存其缺失状态,因此该脚本一旦被添加,501 会立即消失,无需对 feed 做任何改动。
- 本笔记存在的目的所要落实的诚实原则:147 永远是已定义的数量;活跃数量则是 `GET /roster` 在请求发生的那一刻,从真实会话目录中计算出的结果,包括为零的情况。

## Alternatives considered

- **手写一次 `roster.json` 并作为静态数据提交** ——第一次软件包改名或删除,就会让相关记录悄无声息地指向空处,且没有任何机制能察觉。带有经过校验的 `cite()` 的生成方式,把这种情况变成一次构建失败,而不是一句悄悄的谎言。
- **`generatedAt` 取系统时钟** ——会让每一次重新生成都产生差异,即便代码树中没有任何来源发生变化,这与幂等性检查的初衷背道而驰。
- **把理想化的事件名(`agent/step`、`program/integration`)当作折叠逻辑的主键** ——会让折叠逻辑的主路径无法针对本仓库当前能够产出的任何会话日志进行测试。先折叠真实词汇表,再把理想化的名字作为额外可识别的前缀,既能让无密钥测试套件锻炼真实行为,又能保持面向未来的兼容性。
- **把缺失的 `.proving-ground/`、`data/proving-ground/` 或 `.code-safety/` 当作错误处理** ——这些是并行工作流在真实机器上填充的运行时目录;一次全新检出或没有它们的 CI 运行器是常见情形,而非配置错误。

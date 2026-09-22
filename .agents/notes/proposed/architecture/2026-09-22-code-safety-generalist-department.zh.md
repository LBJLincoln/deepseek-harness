# Agent Note: 在六个专科部门之外，新增一个通才 code-safety 部门

Status: proposed

[English](2026-09-22-code-safety-generalist-department.md) | 中文

## Problem

[NodeGoat 上的三层对比](../../../../data/code-safety/comparisons/2026-09-22-nodegoat/README.md)在同一份十八项已知问题的基准真值、同一个修订版上，给 semgrep、一次不分部门的前沿模型单次评审，以及六部门 enterprise 打分，其中 enterprise 与单次评审用的是同一个模型（sonnet）。单次评审抓到十八项中的十五项（83%）；六部门 enterprise 抓到十三项（72%）；semgrep 抓到四项。逐项核对，两种做法都漏掉同样两个认证缺陷问题，但唯独单次评审抓到了六个部门整体漏掉的三项——服务端请求伪造（`NG-SSRF`，`app/routes/research.js`）、正则表达式拒绝服务（`NG-REDOS`，`app/routes/profile.js`）与日志注入（`NG-A1-3`）——而唯独 enterprise 抓到了单次评审漏掉的一项（`NG-A6-1`，静态数据的敏感信息暴露）。

该对比自己的解读是：小应用能装进一个评审者的上下文，因此一次覆盖全仓库的单次评审能拿到六路按主题拆分做不到的广度——每个专科部门只读自己那一份，落在几个主题之间、或落在全部六个主题之外的缺陷，可能从六次阅读里全部漏过，却不会从读了一切的第七次阅读里漏过。这个循环已经试过一次窄口径的修法：injection 部门的技能被加上了 SSRF 枚举指令和另外两类缺失的缺陷类别，在同一目标、同一修订版、同一模型与同一组合上重跑一次，三项里抓到了一项（`NG-SSRF`），却在改动从未触及的一个部门里丢了一项不相关的（`NG-A5`）——对比记录自己把这个结果称为落在 program 自身的逐次波动之内（已记录的四次 NodeGoat 运行分别得十八项中的十四、十四、十三、十三），而不是一个已确立的提升。给单个部门打技能补丁，治的是被点名的症状；它没有加上单次评审这一档有、而六部门这一档没有的结构性广度。

缺失的选项是一个能拿到同样结构性广度的部门——一次性阅读整个应用，覆盖任意缺陷类别——同时在六个专科部门之外运行，而不是取代它们，这样集成方的并集就能同时携带单次评审的广度与 enterprise 按主题的深度，而它的每一条发现依然要通过专科部门的发现所通过的那同一个已提交审查器。

## Proposal

在 code-safety program 这个 fixture 里新增第七个部门 `generalist`，作为六个专科部门之外的一个可选项，而不是取代它们：

- **预设。**[`presets/generalist/agent.cordis.yml`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/presets/generalist/agent.cordis.yml) 组合出的人设会从头到尾读完整个应用——每条路由、每条数据访问路径、每个配置文件、客户端代码——并按与每个专科部门相同的发现 schema 和相同的 `REPORTING.md` 约定，报告任意类别的缺陷。它被指示去加载知识包里的每一项技能，而不只是专科部门加载的那两项（`review-method`、`severity-and-evidence`），因为该包本来就已经在所有会话间共用同一个根（`DSH_CODE_SAFETY_SKILLS` / `customSkillDirs`），这一点无需改动。
- **登记表。**[`departments.ts`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/departments.ts) 是新增的一个模块，收纳了原封不动从 `driver.ts` 搬出的六个专科部门定义、新的 `GENERALIST_DEPARTMENT` 定义，以及 `resolveDepartments(requested)`：它对 `DSH_CODE_SAFETY_DEPARTMENTS`（一份逗号分隔的部门键列表）做校验后的解析，变量未设置时按原有顺序默认为六个专科部门，遇到空列表、重复的键或未知的键则抛出异常并点名那个坏值。`driver.ts` 在校验其他源自环境变量的输入的同一处调用它一次，并用结果而不是写死的数组来构建 `ProgramSpec.goals`；每个 goal 拿到的都是映射函数早已给每个专科部门的那同一套 `budget`、`isolation`、`dependsOn` 与两项检查的形状，因此通才部门在那里并不是一个特例。
- **Overlay。**[`overlays/with-generalist.cordis.yml`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/overlays/with-generalist.cordis.yml) 与 `overlays/claude-code.cordis.yml` 是同一份走 Claude Code 路由的真实组合，整份重述而不是叠加在它之上（见 Alternatives considered）。引导它本身并不改变运行哪些部门——那是 `driver.ts` 自己从 `DSH_CODE_SAFETY_DEPARTMENTS` 做出的解析——所以这个 overlay 与这个环境变量是 `scripts/code-safety.ts` 一起设置的一对。
- **CLI。**`scripts/code-safety.ts` 新增 `--with-generalist`（六个专科部门加上 `generalist`，并引导新 overlay）与 `--departments <list>`（一个确切的集合，直接传给 `DSH_CODE_SAFETY_DEPARTMENTS`；校验的活由 `driver.ts` 来做），两者互斥。两个开关都不会改变 `--keyless` 所用的组合文件，只改变脚本化路由同样会读取的那个部门集合环境变量。
- **并发与预算。**`overlays/with-generalist.cordis.yml` 保持 `maxConcurrentGoals: 3`：第七个独立工作树只是又多了一个除目标外什么都不共享的部门，不构成放宽这个窗口的理由。通才部门的 goal 携带的 `BUDGET`（`maxTotalTokens: 4_000_000`、`maxWallMs: 2_400_000`）与每个专科部门运行所用的完全相同。
- **无密钥覆盖。**`code-safety-llm.ts` 的脚本化路由新增三条 `generalist` 发现，每一条的缺陷类别与文件都不与六个专科部门已脚本化的发现重合——操作系统命令注入（`src/admin.js:14`，CWE-78）、路径穿越（`src/admin.js:28`，CWE-22）与基于 DOM 的 XSS（`public/app.js:5`，CWE-79）——因此并集获得的是真正的广度，而不是把已有的命中换个 id 重述一遍。`union()` 与脚本化生成的 `SAFETY-REPORT.md` 文案现在读取的是与 `driver.ts` 相同的、已解析出的部门集合，因此不点名 `generalist` 的运行合并出的、陈述出的与本改动之前完全一致；新增的一个 e2e 用例用 `DSH_CODE_SAFETY_DEPARTMENTS` 点名全部七个来运行 program，并断言第七份证书、它的两项检查，以及合并、经审查后的并集；既有的六部门用例被断言保持不变。

## Evaluation

以上都不是"新增通才部门能提高召回率"的证据——`## Problem` 里的那次对比给出的是尝试它的动机，但它衡量的是另一个 program（六个部门单独运行，或一次不分部门的整体评审），不是这一个（六加一个部门）。要读出它是否有帮助，需要一次新的配对对比，形状与 [`compare.mjs`](../../../../data/code-safety/tools/compare.mjs) 和 [`assemble-comparison.mjs`](../../../../data/code-safety/tools/assemble-comparison.mjs) 已经产出的一样：program 跑两遍，一遍走 `overlays/claude-code.cordis.yml`，一遍走 `overlays/with-generalist.cordis.yml`，同一目标、同一修订版、同一模型，组合的其余部分不变，每一侧至少重复两次，对照该目标已提交的基准真值打分。哪怕通才部门启用后的单次运行召回率再好，也正是对比记录自己所警告的、落在 program 自身波动之内的单次读数；只有配对、重复的读数，才能说明第七个部门的发现究竟是真实的提升、噪声，还是与它多花的时间和 token 相抵。

## Alternatives considered

**用一个通才部门整个替换六个专科部门，完全对齐单次评审那一档。** 拒绝：对比自己的解读是 enterprise 的按主题深度正是它领先的地方——它给出的发现数是单次评审的两倍还多，还抓到了单次评审漏掉的一项（`NG-A6-1`）——而且那个差距之所以在小应用上最窄，恰恰是因为单次评审能把整个东西装进上下文；这个概念验证瞄准的目标有成千上万个文件，单次评审在那里做不到，撤掉专科部门就会丢掉 enterprise 为它而存在的全部理由。

**给每个专科部门的技能打补丁以补上那三处被点名的缺口，就像循环的第一次迭代已经为 injection 部门试过的那样。** 拒绝其单独已经足够：第一次迭代自己的记录是三个目标里抓到一个、丢了一个不相关的，而且认定这个效果没有被一次运行确立——这是对一个被点名的症状的窄口径修补，不是一次覆盖全应用的阅读所具有、而按主题拆分的阅读所不具有的结构性广度。通才部门并不排斥对专科部门继续打技能补丁；二者是互补而非竞争的修法。

**把每个专科部门自己的指令都放宽成"读完整棵树"，而不是新增一个部门。** 拒绝：这会为每个专科部门并不拥有的另外五个主题，成倍增加它的阅读量与 token 预算，还会把每个部门被衡量的对象——它自己那个主题下的 `findings/<key>.json`——与它的人设实际要求它去读的东西之间的界线弄模糊。一个专门的部门能让"衡量什么"与"人设要求做什么"保持对齐，就像现有的每个部门的人设与 goal 目标早已做到的那样。

**用一个 cordis.yml 插件的 config 字段来表达部门集合，而不是由 `driver.ts` 解析的环境变量。** 已考虑，因为任务描述里的 `## Proposal` 两者都给出了选项。拒绝：`driver.ts` 完全在 TypeScript 里构建 `ProgramSpec`，在任何插件的 config 之外——如今没有哪个 `program` 字段或其他已组合的插件拥有"这次运行包含哪些部门"这件事——而这个 fixture 本就已经携带的每一个随运行而变的选择（`DSH_CODE_SAFETY_TARGET`、`_REPORT_REPO`、`_MODEL`、`_SKILLS`）都是 `driver.ts` 或某个 overlay 的 `!!js` 代码块直接读取的环境变量，而不是新插件的 config。只为携带这一份列表而引入一个插件，会是一个更重、单一用途的接缝，而这个 fixture 自己既有的模式早已合适。

**用嵌套的 `cordis-plugin-include` 把 `overlays/with-generalist.cordis.yml` 叠加在 `overlays/claude-code.cordis.yml` 之上，而不是重述它的 patches。** 拒绝：该插件的 patches 是按 id 对它自己 `path` 所指文件里的条目做覆盖或插入，没有办法伸进更早一层 include 已经施加过的某个 patch 里——第二层的 patch 只能整个替换第一层 include 的 `config`，而这仍然需要把完整的 patch 列表重新写一遍，相比让一个同级文件直接对同一个基底打补丁，并无节省。[`dsh-agent-presets`](../../../../packages/preset/agent-presets/README.md) 出于同样的原因接受了同样的代价：它随包附带的 `cordis` 与 `code` 预设是 `standard` 的完整拷贝，因为这一层"没有补丁语义……可以表达『standard 再加一处改动』"。

## Acceptance criteria

- `pnpm vitest run examples/headless-agent/tests/program-code-safety.e2e.ts` 两个用例都通过：原有的六部门运行被断言逐字节保持不变；新增的一次运行用 `DSH_CODE_SAFETY_DEPARTMENTS` 点名全部七个，其 `generalist` 成员在 `generalist-findings` 与 `generalist-section` 上认证通过，它的三条发现出现在合并后的 `findings.json` 里，并通过已提交审查器的 `--report` 检查。
- `resolveDepartments(undefined)` 按原有顺序返回六个专科部门，因此此前记录的每一次运行、每一份快照与每一份对比，都仍能对照一个未被改动的默认值保持可比。
- 遇到空的部门列表、重复的键，或没有任何部门声明过的键，`resolveDepartments` 都会抛出异常并点名那个出错的值。
- `pnpm run code-safety -- <target> --with-generalist` 会引导 `overlays/with-generalist.cordis.yml`，并把 `DSH_CODE_SAFETY_DEPARTMENTS` 设为六个专科部门加上 `generalist`；`--departments <list>` 直接指定一个确切的集合；两个开关互斥。
- 新的 overlay 与预设就位后，`pnpm run verify-cordis-config` 通过。
- 一次配对对比——`overlays/claude-code.cordis.yml` 对 `overlays/with-generalist.cordis.yml`，同一目标、修订版与模型，每一侧至少重复两次，由 `compare.mjs` 打分——才是能裁定第七个部门是否提高召回率的东西；本笔记记录的是设计与方法，不是那个结果。

## Risks

- **引用的对比每一档只有一次运行。** 15∕18 的单次评审与 13∕18 的 enterprise 都只是各一次测量，而对比记录自己对循环第一次迭代的解读，是把已有四次运行之后的一处一项之差，看作落在 program 自身的逐次波动之内。对通才部门这一新增做一次配对、重复的读数，可能显示出更小的效果、没有效果，或者与这次动机对比所暗示的不同的一组"抓到"与"漏掉"。
- **每次运行多一个工作树、一个分支、一个会话。** 在固定的 `maxConcurrentGoals: 3` 下这会占用更多墙钟时间，在固定的按部门预算下会占用更多 token；本笔记把两者都保持不变，而不是为吸收第七个部门去放宽它们，所以它与六个专科部门竞争的是同一个既有的并发窗口。
- **在一个很小或已被覆盖得很充分的应用上，通才部门的发现可能与专科部门的发现几乎完全重合**，这种情况下运行它唯一看得见的效果，就是让 program 跑得更久，换来一份被并集去重回六个部门本就找到的那些东西的报告。人设指示它把阅读花在按主题拆分的阅读不会揭示的地方；但在一次真实运行里，除了模型自己的判断之外，没有任何机制强制这一点。
- **无密钥覆盖证明的是管线，不是人设。** 三条脚本化的通才发现证明了第七个部门能够认证、合并，并通过与六个专科部门相同的已提交审查器；它们不能说明一个真实的 Claude Code 会话在读了通才人设之后，会在真实目标上找到某个专科部门会漏掉的东西。只有 `## Evaluation` 里的配对对比才能回答这一点。

# ruflo 对照本 harness：代码层面的比较

[English](2026-09-07-ruflo-comparison.md) | 中文

Status: proposed；三个待采纳切片已排期。比对对象为：从浅克隆读取的 `ruvnet/ruflo`（提交 `277c7bc0`，2026-09-05），以及处于 Claude Code LLM 路由合入点的本仓库。下文每一条论断都点名其文件或 URL；凡是无法由代码或一手页面验证的论断，都会明确说明。

## 结论

问题原本是「我们看起来和它差不多，难道我们不是更好吗？」答案基本是肯定的，但理由并非推介材料所说的那些。ruflo 与本 harness 解决的是不同的问题，只是从 README 上看很相似。ruflo 做的是把一份 Claude Code 订阅能做到的事情最大化：它在厂商的循环之上加上协同、记忆与插件市场，并拥有真实的分发渠道。本 harness 拥有的是循环、日志与证书，而没有属于自己的分发渠道。在一家欧洲实验室用来对外推介自己的那些标准上——统一的状态权威源、先于工作撰写的检查、实现者触及不到的奖励、配对种子实验，以及覆盖率门禁——ruflo 基本一无所有，它自己的架构记录也如是写明。

## ruflo 是什么

- **架设在 Claude Code 之上的元 harness。** 它的 `CLAUDE.md`（第 86 到 88 行）要求 agent 必须通过 Claude Code 的 Task 工具生成，并禁止 MCP 工具单独执行，因此 agent loop、工具流水线、上下文窗口与权限模型都归厂商产品所有。真正的子进程执行是 `v3/@claude-flow/cli/src/services/headless-worker-executor.ts` 中的 `spawn('claude', ['--print', '--output-format', 'json'])`。
- **一个协同库。** `v3/@claude-flow/swarm/src/` 中有一个面向十五 agent 蜂群的蜂后协调器、一个拓扑管理器、一条消息总线，以及 Raft、Byzantine 与 gossip 共识。共识运行在协调器状态之上，而不是运行在把关任何事情的模型输出之上。
- **以可变记忆作为状态权威源。** `v3/@claude-flow/memory/src/`（一个 AgentDB 后端、一个 HNSW 索引、一个图，以及一个模型驱动的整合器）与仓库根目录下的 `agentdb.rvf` 容器。静态加密默认关闭。
- **作为厂商产物的插件与 skill。** 宣称的 35 个插件（实际 40 个目录）、39 个 skill 与 33 个 agent 定义，均以厂商产品加载的 Markdown 形式存在；没有运行时注册表、身份或 lineage。47 个模块中约有 309 项 MCP 工具注册；README 一处写的是 314，另一处写的是约 210。
- **一个名为 verification、却并非任务验证的目录。** `verification/` 按操作系统分别证明某项已记录的修复依然存在：SHA-256、标记、Ed25519 签名、仅追加的历史记录，以及一个会阻断发布的 `witness-verify` 任务。它的存在，是因为 2026 年 5 月发生的三次回归都通过了单元测试，却仍然破坏了安装。
- **没有覆盖率门禁。** 563 个测试文件，而 `v3/vitest.config.ts` 中的每一项覆盖率阈值都被注释掉了。MIT 许可证，克隆下来的历史中只有一位作者，2026-08-12 到 09-02 之间发布了十个补丁版本，截至 2026-09-07 有 648 个未结 issue 与 293 个未结 pull request。

## 头条论断的出处

- **SWE-bench 84.8%** 出现在 `.claude-plugin/README.md`、插件简介、changelog 与三个 skill 中，全仓库找不到任何 harness、运行产物、seed、日期或模型信息。`v3/docs/adr/ADR-171` 指出，ruflo 没有 SWE-bench oracle，其历史上的 `resolved` 只是结构性置信度，一个代理指标。
- **32.3% 的 token 削减与 2.8 至 4.4 倍的 WASM 加速** 同样缺乏方法说明。相邻的数字被 ruflo 自己的审计发现是捏造的：一个 2.49 至 7.47 倍的注意力加速，其计算方式是 `2.49 + Math.random() * 4.98`（`docs/reviews/intelligence-system-audit-2026-05-29.md`）；还有一个冷启动基准测试，其中包括一个 5.00 倍加速在内的每一个数字，都来自 `setTimeout()` 调用链（`docs/dream-cycle/dream-gist-2026-09-05.md`）。两者都由同一个循环纠正过。
- **采用度。** 在仓库页面上可以核实到 7.12 万个 star；十二个月内 956 万次 npm 下载有具名的来源与方法。README 的 git-clone 徽章链接到一份账本，其中每一份快照都写着 `fetch-failed`，克隆数为零。
- **常驻运行的循环。** `docs/dream-cycle/LEDGER.md`：从 2026-05-25 到 08-13 的 80 个夜间研究 issue 中，4 个已上线（5%）、1 个被拒绝、75 个从未被处理；在 v2 之下，2026-08-24 到 09-05 期间的每一晚，都产出一个通过评审的 accept，但其 pull request 到 head commit 时仍未合并。

## 标准矩阵

| 标准 | ruflo | 本 harness | 证据 |
| --- | --- | --- | --- |
| 单一状态权威源 | 可变的向量与 SQLite 记忆，外加按插件划分的 JSON | 仅追加的会话事件日志；模型历史是它的一个投影 | `memory/src/agentdb-backend.ts`；`docs/architecture.md` |
| 模型可见即已记录 | 没有这样的规则；钩子与记忆注入的上下文，产品从不持久记录 | 不变量：新的模型可见输入，必须有一条会话事件与之对应 | ruflo `CLAUDE.md`；`docs/architecture.md` |
| 标准先于工作撰写 | 无 | `ctx.completionStandards`；证书只来自完全通过的运行 | `verification/README.md`（ruflo）；`packages/verification/README.md` |
| 奖励的防篡改能力 | 没有读取屏障，没有验证者拥有的目录树；结构性置信度是一个明说的代理指标 | 验证者拥有的目录树、按运行的预留、在每一个可打开路径的能力处拒绝、无 lineage 的评审 | ADR-171；`packages/verification/README.md` |
| 沙箱与隔离 | TypeScript 代码树中没有找到操作系统级别的约束 | 带 local、policy 与 Windows ACL 三种提供方的沙箱 seam | 对 `v3/@claude-flow` 的 grep 搜索；`packages/README.md` |
| 多 agent 协同 | 蜂后层级结构，共识运行在协调器状态之上；执行委托给厂商的 Task 工具 | 六个提供方统一在一个接口之后的 subagent seam；委托与继续都是事件 | `swarm/src/`；`packages/subagent/README.md` |
| 知识作为带版本的组件 | RVF 容器与行；没有内容地址、lineage 或 membership | `ctx.components`：id、内容地址、provenance、lineage、membership | `plugins/ruflo-rvf/README.md`；`packages/components/README.md` |
| 模型无关性 | 六个辅助提供方；agent 循环只能是 Claude Code 或 Codex | LLM seam，以包的形式提供 DeepSeek、multi-provider 与 Claude Code 三条路由 | `providers/src/`；`packages/llm/README.md` |
| 通过厂商 CLI 的订阅 | 是，且是主路径 | 是，但只是多条路由中的一条 | `headless-worker-executor.ts`；`village-live/cordis.yml` |
| RL 数据路径 | 在 ADR-171 与 ADR-173 中提议过；代码树中没有导出器 | `ctx.trajectories` 导出带 stamp 的、由证书裁定的奖励；留出数据被扣留 | ADR-171；`packages/improvement/README.md` |
| 配对种子评估 | 未发现 | 冻结的计划摘要、处于相同索引位置的两个实验臂、bootstrap 区间、裁决 | `docs/benchmarks/`；`packages/improvement/experiments/README.md` |
| 常驻运行与恢复 | 外部的夜间例行任务；账本只有通过合并才能进入 `main` | 有节奏、带支出窗口的班次，账本记在该 slot 的会话日志中；靠账本恢复 | `LEDGER.md`；`packages/improvement/shifts/README.md` |
| 门禁与覆盖率 | 阈值被注释掉了 | 逐文件 100% 覆盖率门禁，与类型检查、lint、查重、hygiene、doc-sync、快照并列 | `v3/vitest.config.ts`；`AGENTS.md` |
| 文档 | 1884 个 Markdown 文件；ADR 写得很仔细，但 README 里的说法却与之矛盾 | 双语、有预算、有门禁；每个事实只有一个归属位置 | README 第 38 行与第 256 行；`docs/AGENTS.md` |
| 许可证与治理 | MIT；单一作者的历史 | MIT 血统的 fork；curator、数据使用条款、签署记录 | `LICENSE`；`packages/governance/` |
| 采用度 | 7.12 万个 star、8400 个 fork、35 个插件、960 万次下载 | 21.47 万个 star 上游项目的一个 fork；没有属于自己的渠道 | 仓库页面 |

## 三项，三项，又三项

**ruflo 目前做得更好的地方：** 通过 Claude Code 插件市场分发（`.claude-plugin/marketplace.json`）；对已发布产物按平台签名认证，并配有阻断发布的检查（`verification/README.md`）；为每一个已发布数字设定有约束力的标准（`v3/docs/adr/ADR-169-benchmark-reporting-integrity-standard.md`，2026-07-03）。

**本 harness 能做到、而 ruflo 做不到的地方：** 精确重建模型当时看到的内容（`docs/architecture.md`，配有一条运行时不变量）；把完成状态把关在验证者拥有的读取屏障之后的证书上（`packages/verification`、`packages/read-barrier`）；用一个冻结的、配对的、bootstrap 区间实验来决定一项变更（`packages/improvement/experiments`）。

**值得采纳、已排入切片队列的：**

1. 对组合清单按平台签名见证，并在发布前验证：`packages/components` 与 `packages/bundle`。
2. 在观测台的渲染路径中加入报告规则，使未标注的指标、未披露的 best-of-N，或是把无操作式通过悄悄藏在其中的聚合值，都从设计上就无法发布：`dsh-observatory` 与 `dsh-scorekeeper`。
3. 把一个班次产出的去向记在它的账本上，并由观测台展示一个滞后的合并率或使用率，使产出未被使用的区变得可见：`dsh-shifts`。

## 警示

ruflo 的失效模式，本 harness 同样暴露在其中：80 个 issue，5% 的上线率，随后是十个连续通过证书认证却没有人合并的 pull request。证书能提高一个班次产出的质量；它们并不能创造出把这些产出落地所需要的人力。这是人员编制与销售计划要解决的事，架构本身解决不了。

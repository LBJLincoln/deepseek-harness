# 企业花名册

[English](README.md) | 中文

本目录下的 `roster.json` 是为企业概念验证生成的花名册，包含 147 个席位定义：由本仓库真实定义的来源构建出的"角色 x 事业部 x 专精方向"组合，每个席位都附带已提交的会话记录为它提供的证据。[`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) 生成该文件（`pnpm run roster`）；[`scripts/harness-feed.ts`](../../scripts/harness-feed.ts) 在重新计算实时状态与证据后提供服务（`pnpm run feed`）。花名册不是记录在案的组织：记录在案的组织是 feed 在 `GET /programs` 上提供的项目运行台账，每次已记录的项目运行一条，列出其各部门、各部门的证书、整合的结论以及各项签署。

## 诚实原则

147 是本仓库**已定义**的席位数量——每条记录的 `source` 字段都指向一个真实存在的仓库路径（一个包 README、一个 `verify-*.ts` 脚本、一个 CI 关卡名称、一份 Agent Note、一个技能目录、一个 Proving Ground 基准测试的任务环境，或一个代码安全审查知识包），并在生成花名册时对照磁盘做过校验。每个事业部的数量都是固定配额（总和为 147）；由可变来源池构建的事业部会从该池中按排序精确取出其配额，若代码树定义的来源少于配额所需，生成器会抛出异常，指明该事业部与缺口数量。一个定义既不是正在运行的智能体，也不是曾有智能体运行过的证据：每个席位都由两个测试夹具预设（`coding`、`reviewing`）之一组合而成，并写明它为之定义的路由，无论是否有会话在该路由上运行过。

## 证据

每个席位都带有 `evidence: { sessions, lastSeen?, routesSeen }`，由 [`scripts/roster-evidence.ts`](../../scripts/roster-evidence.ts) 中的归属规则，从 `data/proving-ground/*/sessions` 与 `data/code-safety/*/sessions` 下已提交的记录计算得出；feed 也使用这个模块，因此在相同的记录上，该文件与 feed 的结果一致：

- 代码安全审查中的项目会话占据其 id 所指的代码安全席位：某个部门的会话占据该部门的整合员席位，项目自身的会话与其整合会话占据项目负责人席位；
- `environment/run` 指明某个基准测试环境的会话，占据专精于该环境的 Proving Ground 基准测试操作员席位；
- 被委派的会话占据其委派方会话所占据的席位。

会话与某个席位共用的路由不算证据。`counts.occupied` 统计至少被一个会话占据的席位。`routesSeen` 在席位为之定义的 `route` 旁列出其会话实际运行所在的提供方路由，因此一个为 `deepseek-official` 定义、其会话却全部运行在 `claude-code` 上的席位会如实说明这一点。顶层的 `evidence` 列出所读取的记录（`records`）、这些记录的会话数（`sessions`），以及所有会话（无论是否归属）按路由的数量（`routes`）。`unattributed` 按原因统计没有任何规则将其放到席位上的会话：`environment-not-seated`、`program-not-code-safety`、`program-member-not-seated`、`parent-not-recorded`、`no-seat-evidence`。没有任何会话会被默认放到某个席位上。

已提交文件的证据恰好覆盖 `evidence.records` 所列的记录，因此在提交更多记录之后，它仍能由这些记录复现；`pnpm run roster` 会把它扩展到每一条已提交的记录。文件中的 `status` 始终为 `"defined"`，`counts.active` 始终为 `0`。[花名册证据 Agent Note](../../.agents/notes/proposed/architecture/2026-09-22-roster-evidence-and-org-of-record.md) 记录了这一决策及其背后的审计。

## 实时状态

正在运行的 feed（`pnpm run feed`）上的 `GET /roster` 会在它发现的每次运行（包括实时运行）上重新计算每个席位的证据、计数、`evidence` 与 `unattributed`，并设置每个席位的 `status`：当归属于它的某个会话属于仍在运行的运行时为 `active`；一旦它的某个会话记录了证书事件，变为 `certified`；若它的会话都已结束但未记录证书，则为 `failed`。没有任何会话占据的席位保持 `"defined"`。一次全新检出、尚无运行时数据时，会报告已提交记录的证据与 `active: 0`，这是正确的答案。

## 事业部

| 事业部 | 职责 |
|---|---|
| `harness-core` | 守护产品 API 主干：会话、提示词组装、工具、智能体、智能体循环、LLM 路由与子智能体委派。 |
| `proving-ground` | 让 harness 在 Proving Ground 基准测试夹具中的真实任务环境里运行。 |
| `verification` | 运行在源码变更上线前把关的 `verify-*` 脚本。 |
| `judging` | 在每个命名的 CI 关卡上裁定通过或失败。 |
| `curation-data` | 整理 Agent Note 语料库与夹具数据集，并为观测台记录用量分数。 |
| `program-departments` | 将横切的软件包分组协调为同一项目下的各部门。 |
| `code-safety` | 按语言审查目标仓库中的密钥、注入、访问、数据、依赖与平台风险。 |
| `knowledge` | 让仓库中可复用的技能保持最新且易于发现。 |
| `governance` | 掌管流程标准：标签、堆叠、依赖、代码引入、许可与翻译配对。 |
| `observatory` | 监看各次运行中的会话遥测、Token 花费与查询接口。 |

## 代码安全专精方向标注的是目标，不是已实现的扫描器

本仓库是 TypeScript/JavaScript 项目，并未提供 Java、Go、PHP 或移动端的静态分析工具。每一个"部门 x 专精方向"审查席位——包括本仓库未实现扫描器的四种语言——都引用其所属部门真实的审查知识包，路径为 `data/knowledge/code-safety/<department>/SKILL.md`；专精方向记录的是该席位*为何而设*，而非声称已有匹配的扫描器在运行。每位审查员、整合员与项目负责人也都以 `code-safety/<id>` 技能的形式引用该知识包（负责人还额外引用横切的 review-method 与 severity-and-evidence 知识包）。审查员路由至 `openrouter`，循环使用本仓库自身 Proving Ground 基准测试组合所声明的免费模型 id（`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml`），由生成器提取而非硬编码。具体是哪个来源支撑了每个部门，请参阅 [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts)；完整理由参阅 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md)。

## 重新生成

```sh
pnpm run roster
```

该生成器是幂等的：在未变更的代码树与未变更的记录上运行，会逐字节复现相同的 `roster.json`。一次干净的重新生成后出现差异，意味着某个被引用的来源发生了移动，或有新的记录被提交；来源移动时，生成器会在写入任何内容之前失败，并在错误中指明是哪一个。

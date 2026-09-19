# 企业花名册

[English](README.md) | 中文

本目录下的 `roster.json` 是为企业概念验证生成的、包含 147 个智能体的花名册：由本仓库真实定义的来源构建出的"角色 x 事业部 x 专精方向"组合。[`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) 生成该文件（`pnpm run roster`）；[`scripts/harness-feed.ts`](../../scripts/harness-feed.ts) 在其上叠加实时状态后提供服务（`pnpm run feed`）。

## 诚实原则

147 是本仓库**已定义**的智能体数量——每条记录的 `source` 字段都指向一个真实存在的仓库路径（一个包 README、一个 `verify-*.ts` 脚本、一个 CI 关卡名称、一份 Agent Note、一个技能目录、一个 Proving Ground 基准测试的任务环境，或一个代码安全审查知识包），并在生成花名册时对照磁盘做过校验。每个事业部的数量都是固定配额（总和为 147）；由可变来源池构建的事业部会从该池中按排序精确取出其配额，若代码树定义的来源少于配额所需，生成器会抛出异常，指明该事业部与缺口数量。它绝不是当前正在运行的智能体数量。已提交文件中的 `counts.active` 始终为 `0`，且每个智能体的 `status` 始终为 `"defined"`。

实时状态只来自正在运行的 feed 上的 `GET /roster`（`pnpm run feed`），它会用磁盘上真实会话数据当下反映的情况,叠加到已提交的花名册上：当某次已发现的运行中存在一个映射到该智能体、且仍在运行的会话时，状态为 `active`；一旦该会话记录了一个证书形状的事件，状态变为 `certified`；若其所属运行已结束但未记录该事件，则为 `failed`。没有匹配会话的智能体保持 `"defined"`。一次全新检出、尚无 `.proving-ground/`、`data/proving-ground/` 或 `.code-safety/` 运行时数据时，全部 147 个智能体都会报告 `active: 0`——这是正确、诚实的答案，而不是缺陷。

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

该生成器是幂等的：在未变更的代码树上运行，会逐字节复现相同的 `roster.json`。一次干净的重新生成后出现差异，意味着某个被引用的来源发生了移动；生成器会在写入任何内容之前抛出错误，并指明是哪一个。

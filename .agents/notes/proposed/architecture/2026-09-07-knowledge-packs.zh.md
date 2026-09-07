# Agent Note: 知识包：以带版本的 skill 形式将研究扫描交付给 agent

[English](2026-09-07-knowledge-packs.md) | 中文

Status: proposed，首个包已落地。Owner: 改进 seam。

## 决策

这个 harness 中 agent（智能体）应当具备、而模型本身不具备的知识——例如某个有日期的时间窗口内的技术前沿——以**知识包**的形式进入 harness：`data/knowledge/<pack>/` 下的一个目录，存放一份带来源的语料（`corpus/items.json`，即多次有日期的研究扫描合并后的输出，外加每次扫描各自的简报），以及每个主题一个 skill（技能）bundle（`skills/<theme>/SKILL.md`，一段人工撰写的正文，并配有一份自动生成、列出该主题语料条目的 `references/items.md`）。知识包由随包发布的文件系统 skill 提供方提供给 agent：以该包的 `skills/` 目录作为自定义 skill 根目录，并排除默认根目录，因此无论组合在哪里运行，其目录都只是该包的内容。`data/knowledge/tools/build-pack.mjs` 从扫描结果构建知识包、渲染参考资料、校验每一份 frontmatter，并写出一份记录每个文件摘要的 manifest（元数据清单）；它的 `--check` 模式就是 `doc-sync` 的 `verify-knowledge-packs` 叶子门禁，因此陈旧的包会使该门禁失败。

## 为什么是插件而不是文档

原因是 skill seam 早已具备的三项特性，而这三项特性，没有一项是一份要求 agent 去读的文档所能提供的。

1. **身份与溯源。** 已加载的 skill 以覆盖其名称、描述、路由元数据与正文的 `skillDigest()` 寻址，组合 manifest 记录了每个会话中在场的是哪一世代。因此知识包就是一个组件：一次实验可以把带有该包的会话，与不带它的会话或带着上一个包的会话配对，观测台会把差异归因于一个摘要，而不是归因于一句「agent 已经掌握了这些知识」式的散文断言。
2. **范围与策略。** skill 归入挂载它们的组合所在的那一层，并按 surface 各自携带一条调用策略，因此一个包可以只针对某一个 preset、某一个区或某一个部门挂载，而不会渗入宿主机自身的 skill 根目录；面向判官的包，实现者也无法加载。
3. **Token 与缓存经济。** 目录只到达模型一次，以一条追加在可复用前缀之后的持久 user-role 消息的形式出现，每个主题都被压缩为其名称与一段有上限的描述；只有当模型调用 `skill` 工具时才会加载正文，此后正文留存在保留的工具历史中，而其背后的条目表则通过资源指引按需加载。目录的一次变更是追加一份替换，而不是改写更早的历史，因此被缓存的前缀能在包的修改之后依然存活。这正是以插件形式承载知识比把知识放进系统提示词更省钱的原因：渐进式披露让每次请求都保持精简，仅追加式失效则让 KV Cache 保持热度。这是机制，不是目的：目的在于，这份知识是一个可被测量、带版本的组件。

## 机制

- `pack.json` 命名知识包本身、它的时间窗口、来源与主题；一个主题拥有 kebab-case 的 `id`、一个 `title`、它所收集的条目 `kinds`，以及按标签或按名称与摘要中的整词匹配来选取条目的 `keywords`。一个条目可能属于多个主题；没有任何主题选中的条目会列在 manifest 的 `counts.unmatched` 下。
- 一次扫描（sweep）是一个研究 agent 针对一个来源给出的输出：`items.json`（`id`、`kind`、`name`、`date`、`url`、`summary`、`relevance { goals, seams, role }`、`adopt`、`evidence`、`tags`）与 `report.md`。构建会校验每一条条目，按 URL 跨来源去重，对 tags 与 goals 取并集，并记录哪些来源报告过该条目。
- 人工撰写的 `SKILL.md` 正文承载着判断：变化是什么、Daliesk 采纳、拒绝或测试了什么，以及如何使用这些参考资料。它的描述必须落在 500 个字符的目录上限之内。自动生成的 `references/items.md` 从不手工编辑。
- 证明这条 seam 的组合是 `examples/headless-agent/tests/fixtures/knowledge-pack/cordis.yml`：以该包的 `skills/` 作为唯一根目录，一条无密钥路由读取目录，通过 `skill` 工具加载第一个 skill，并报告所加载的名称。`examples/headless-agent/tests/knowledge-pack.e2e.ts` 断言该目录列出了该包的每个 skill，且没有一个来自宿主机的根目录，加载确实发生，以及模型看到了 `<skill_content>`。

## 包不是什么

知识包是带来源的分析知识；它不是训练数据，也永远不会进入 RLVR 语料。它的条目以第三方产品、模型与论文作为研究对象加以命名。知识包是有日期的：更晚的时间窗口是一个新的包，而不是对旧包的修改，因此一个会话的 manifest 会始终标明它当初运行所依据的那一世代。

## 延后事项

- 一条 curator 规则：只有通过一次实验裁决，才能把一个包接纳进某个区的组合，正如 harness 补丁的晋升方式一样。
- 逐主题的调用策略（仅判官、仅实现者），留待某个区挂载了多个包之后再做。
- 自动陈旧检测：时间窗口结束已超过一个季度的包，应当在其目录描述中渲染一行警告。

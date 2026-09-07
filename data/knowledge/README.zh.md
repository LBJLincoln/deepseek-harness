# 知识包

[English](README.md) | 中文

有日期的研究扫描，以带来源的语料保存，并作为 skill 提供给 agent。一个知识包为一个时间窗口回答一个问题：在与四个目标相关的来源中，出现了什么、改变了什么，且每一条断言都可追溯到其 URL 与证据等级。挂载了知识包的组合中的 agent 会在其 skill 目录中看到该包的各个主题，仅在任务需要时才加载某个主题的正文。[知识包说明](../../.agents/notes/proposed/architecture/2026-09-07-knowledge-packs.md)拥有该决定及其理由；本文件拥有布局与流程。

## Layout

```
data/knowledge/
  tools/build-pack.mjs        merge sweeps, render references, validate skills, write the manifest; --check for the gate
  <pack>/
    pack.json                 identity, window, sources, themes (id, title, kinds, keywords)
    manifest.json             counts per theme, unmatched items, every file's bytes and SHA-256
    corpus/items.json         the merged, deduplicated items of every sweep, with the sources that reported each
    corpus/<source>-report.md the briefing each research agent wrote for its source
    skills/<theme>/SKILL.md   the authored body: what changed, what Daliesk adopts, how to use the references
    skills/<theme>/references/items.md   generated from the corpus by the theme's kinds and keywords
```

## 构建一个知识包

一次扫描（sweep）是一个研究 agent 针对一个来源在仓库之外写出的输出：`<sweeps>/<source>/items.json`，即一个由 `{ id, kind, name, date, url, summary, relevance: { goals, seams, role }, adopt, evidence, tags }` 组成的数组，以及 `<sweeps>/<source>/report.md`。`kind` 取 `model`、`dataset`、`paper`、`repo`、`release`、`environment-hub`、`framework`、`benchmark`、`policy` 之一；`relevance.role` 取 `threat`、`input` 或 `baseline`；`evidence` 取 `primary`、`secondary` 或 `claim`。先编写 `pack.json` 以及每个主题一份 `skills/<theme>/SKILL.md`，然后构建：

```sh
node data/knowledge/tools/build-pack.mjs data/knowledge/2026-q3 --sweeps /path/to/sweeps
```

构建会校验每一条条目，按 URL 跨来源去重（tags、goals 与 seams 取并集；保留第一个来源的文字；列出所有报告过该条目的来源），写出语料与各份简报，按 kind、按 tag 或按名称与摘要中的整词关键字为每个主题选出条目，渲染每个主题的 `references/items.md`，检查每份 `SKILL.md` 的 frontmatter 是否以其主题命名并在 500 个字符的目录上限内给出描述，最后写出 `manifest.json`。没有任何主题选中的条目会列在 manifest 的 `counts.unmatched` 下。修改语料或主题定义之后，不带 `--sweeps` 重新构建即可。`pnpm run verify-knowledge-packs` 以 `--check` 模式运行同一构建，作为 `doc-sync` 的一个叶子门禁，任何渲染文件或 manifest 与磁盘不一致即失败。

## 提供一个知识包

知识包是 [`@deepseek-ai/dsh-skill-filesystem`](../../packages/skill/skill-filesystem/README.md) 的一个 skill 根目录：用 `customSkillDirs` 指向该包的 `skills/` 目录并设置 `includeDefaultRoots: false` 来挂载它，这样宿主机的项目与用户 skill 目录都不会进入，无论组合在哪里运行，目录都只是该包的内容。[`examples/headless-agent/tests/fixtures/knowledge-pack/cordis.yml`](../../examples/headless-agent/tests/fixtures/knowledge-pack/cordis.yml) 是证明这一点的组合：一条无密钥路由读取目录，通过 `skill` 工具加载第一个主题，并报告所加载的名称；`examples/headless-agent/tests/knowledge-pack.e2e.ts` 断言目录列出了该包的每一个主题而没有宿主机的任何 skill、加载确实发生，以及模型看到了 `<skill_content>` 块。

模型看到什么、代价多少，由 skill 接缝的契约决定：目录是追加在可复用提示前缀之后的一条持久消息，每个主题只压缩为名称与有上限的描述；正文按需加载进保留的工具历史；其背后的条目表通过资源指引按需加载；对知识包的改动会追加一份替换目录，而不是改写更早的历史。已加载的主题在组合 manifest 中以其 `skillDigest()` 寻址，因此一次实验可以把两个区之间的差异归因于所使用的知识包世代。

## 知识包不是什么

知识包是带来源的分析知识，保存在这里是为了让实验室及其 agent 共享同一幅有日期的领域图景。它不是训练数据，也永远不会进入 RLVR 语料。其条目以第三方产品、模型与论文作为研究对象加以命名。更晚的时间窗口是一个新的知识包，而不是对旧包的修改。

## 知识包列表

| 知识包 | 时间窗口 | 来源 | 主题 | 条目 |
| --- | --- | --- | --- | --- |
| [2026-q3](2026-q3/manifest.json) | 2026-06-01 至 2026-09-07 | GitHub、Hugging Face、arXiv | 8 | 103 |
| [2026-09-fortnight](2026-09-fortnight/manifest.json) | 2026-08-24 至 2026-09-07 | 一次 Sakana 与路由的深入调研；全部来源按双周分辨率重扫 | 3 | 63 |

2026-q3 知识包的主题为：harness 全景、来自可验证奖励的强化学习、20B 至 200B 级别的开放权重模型、环境与评测、agent 数据管线、多 agent 舰队、上下文与 KV cache，以及通用模型在欧盟 AI 法案下的义务。[扫描决策说明](../../.agents/notes/proposed/architecture/2026-09-07-q3-knowledge-sweep-decisions.md)记录了实验室据此做出的决定。2026-09-fortnight 知识包以更高分辨率重读该窗口的最后两周：季度扫描在这两周里漏掉了三次前沿模型发布、一次会破坏朴素回放的 API 变更，以及[假设检验计划](../../.agents/notes/proposed/architecture/2026-09-07-hypothesis-program.md)所要检验的路由结果；其主题为路由与交接、前沿与 API 变化，以及奖励完整性与训练约束。

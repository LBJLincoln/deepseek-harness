# code-safety：审查他人代码的 program

[English](README.md) | 中文

一个交付物是"关于 harness 未曾编写的仓库的报告"的 [program](../../../../../packages/improvement/program/README.md)：它的安全部门——默认六个专科部门，或加上通才部门后为七个——并行阅读同一棵目标树，各自在自己的分支与会话中工作，集成方把它们的发现合并成一份报告，由一个在任何部门启动之前就已提交的审查器裁定。[csv-tools program](../program-csv-tools/README.md) 构建软件、由测试套件衡量；这一个产出文档，衡量它的是报告中的每一句话能否在它所描述的那棵树里解析得到。

## 两棵树

一次运行有一棵**目标树**——客户的应用，以路径传入，永不写入——和一个**报告仓库**，由 driver 铸造、program 交付进去。部门读前者、提交进后者。program 所做的一切都不会改动目标，而它对目标的任何断言也都不靠信任：基线提交携带 `target.json`，即受审每个文件的 SHA-256，已提交的审查器在每次运行时重新哈希全部文件。编辑过目标的部门会让 program 失败，而不是发布一份关于已不复存在的树的报告。

| 部门 | 主题 | 预设 |
| --- | --- | --- |
| `secrets` | 硬编码凭据、令牌与密钥，泄漏的 `.env` 与配置 | [`presets/secrets`](presets/secrets/agent.cordis.yml) |
| `injection` | SQL、NoSQL、命令、模板与代码注入，XSS，路径穿越 | [`presets/injection`](presets/injection/agent.cordis.yml) |
| `access` | 认证、会话处理、授权、IDOR、CSRF | [`presets/access`](presets/access/agent.cordis.yml) |
| `data` | 敏感数据暴露、日志中的个人数据、明文传输、弱密码学、口令存储 | [`presets/data`](presets/data/agent.cordis.yml) |
| `dependencies` | 存在漏洞与过时的依赖，来自 `npm audit --json` 或清单文件 | [`presets/dependencies`](presets/dependencies/agent.cordis.yml) |
| `platform` | 响应头、CORS、Cookie、错误处理、限流、安全配置错误、客户端代码 | [`presets/platform`](presets/platform/agent.cordis.yml) |
| `generalist`（可选） | 整个应用从头到尾——每条路由、每次数据访问、每个配置文件——一次覆盖任意缺陷类别 | [`presets/generalist`](presets/generalist/agent.cordis.yml) |
| 集成 | 合并各分支并撰写报告 | [`presets/integrating`](presets/integrating/agent.cordis.yml)，即名册默认预设 |

没有部门依赖另一个部门，因此真实运行一次并发三个。每个部门提交 `findings/<department>.json` 与 `report/<department>.md`，别无其他；集成方写出 `SAFETY-REPORT.md` 与 `findings.json`。[`seed/REPORTING.md`](seed/REPORTING.md) 是它们之间的全部约定，也是每个会话最先读的文件。

**部门集合是运行时的选择。**[`driver.ts`](driver.ts) 解析 `DSH_CODE_SAFETY_DEPARTMENTS`——对上面这些键的一份逗号分隔列表，按其校验，未设置时默认为六个专科部门——因此现有的每条记录、快照与 e2e 用例都保持不变。[`overlays/with-generalist.cordis.yml`](overlays/with-generalist.cordis.yml) 与 [`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) 是同一份真实组合；`pnpm run code-safety -- <target> --with-generalist` 把通才部门加入默认的六个并引导该 overlay，`--departments <list>` 则直接指定一个确切的集合。[该 Agent Note](../../../../../.agents/notes/proposed/architecture/2026-09-22-code-safety-generalist-department.md) 说明了原因：一次三层对比发现，一次覆盖全仓库的单次评审在 NodeGoat 上抓到了六个专科部门漏掉的问题。

每个部门先运行 `semgrep --version`，有回应时再对目标运行 `semgrep --config semgrep/ --config p/owasp-top-ten --metrics off --json <path>`（注册表不可达时只用本地规则），每个命中都要先读过才能成为发现；本 fixture 附带的[本地规则](semgrep/code-safety.yml)覆盖——eval、带插值的 `child_process`、字符串拼接的 SQL 与 `$where`、HTML 注入点、弱哈希、硬编码密钥、过宽的 CORS、不安全的 Cookie、明文端点。规则是本地的，因此运行不需要规则注册中心；真实运行可以在其旁另行指定注册中心的规则包。扫描器命中只是"该去读的地方"，绝不是发现本身。

## 一条发现必须是什么

```json
{ "id": "…", "cwe": "CWE-…", "owasp": "…", "severity": "critical|high|medium|low|info",
  "confidence": "confirmed|likely|possible", "title": "…", "file": "…", "line": 1,
  "endLine": 2, "snippet": "…", "evidence": "…", "impact": "…", "fix": "…", "references": [] }
```

[`seed/verify-safety-report.mjs`](seed/verify-safety-report.mjs) 位于基线提交中，因此没有部门能改动衡量自己的东西。它拒绝这样的发现：`file` 不在锁定的树中、`line` 超出该文件、或 `snippet` 在归一化空白后与目标在那些行上的原文不符；它同样拒绝不是 `CWE-<number>` 的 `cwe`、落在两个枚举之外的 severity 或 confidence，以及为空的 `title`、`evidence`、`impact` 或 `fix`。每个部门的目标正是由该命令针对自己那份文件来衡量的，因此伪造的引用会让作出它的那个部门失败，而不是让报告失败。

对合并后的 HEAD，它另外裁定四件事。

- **报告可解析。** `findings.json` 中的每个 id 都在 `## Findings` 下被引用，报告中任何位置写下的每个 `<file>:<line>` 都能在目标中解析得到。
- **摘要陈述并集实际持有的内容。** `## Résumé exécutif` 与 `## Executive summary` 各自为五个严重度都带一行 `- <severity>: <count>`，且这些计数必须是 `findings.json` 实际拥有的计数。
- **没有东西被悄悄丢弃。** 任何 `findings/<department>.json` 携带而 `findings.json` 没有的 id，都必须在 `## What was not covered` 下被点名。集成方通过询问审查器得知它们是哪些：`verify-safety-report.mjs --findings <file> --list-invalid` 打印失败的 id 并以 0 退出。
- **报告不作出超出这次评审所能支撑的断言。** 证书陈述已核验的条数与目标摘要，并逐字携带"本次评审不证明漏洞不存在"这句话。`no vulnerabilities`、`free of vulnerabilities`、`is secure`、`safe to deploy` 与 `fully audited` 无论出现在何处都会被拒绝，残留的模板文本同样如此。

一无所获的部门写下 `[]` 并在自己的小节里说明。要求必须有一条发现，等于用编造把它买下来。

## 什么裁定一次发布

[csv-tools program](../program-csv-tools/README.md#what-certifies-a-release) 所遵循的三条规则在这里同样成立。审查器在任何部门启动之前就已提交，并由集成方在合并后的 HEAD 上重新运行；部门绝不会在携带"没有任何提交承载的工作"的工作树上被衡量——脚本化的 `platform` 部门正是以第一次尝试故意不提交来演示这一点；每条 `program/goal { status: certified }` 都陈述其证书覆盖的提交与 `HEAD^{tree}`，集成方只在分支仍指向该提交时合并它。集成会话在运行期间被拒绝访问 program 的整个工作树根目录，因此它在撰写报告时读不到任何部门的工作树。

## 两种组合

[`cordis.yml`](cordis.yml) 是无密钥的一半：每个会话都运行在 [`code-safety-llm.ts`](code-safety-llm.ts) 注册的 `cli-mock` 路由上，针对已提交的 [`sample-target/`](sample-target)——一个小应用，带有字符串拼接的查询、一处 `$where`、一处 `eval`、一个硬编码密钥、一个 innerHTML 注入点、若干未认证路由、MD5 口令以及通配的 CORS 响应头。脚本化的发现只陈述文件与行号，别无其他：每个 `snippet` 都在流式生成时从目标中读出，用的正是审查器将要比对的那些字节，因此该路由无法靠携带一份树的副本蒙混过关，而改动 sample target 却不同步更新其发现，会让运行失败而不是通过。

[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) 是真实的那一个：同一份组合，禁用脚本路由，换上操作者自己的 Claude Code 安装，一次并发三个部门，并在仓库携带 [`data/knowledge/code-safety/`](../../../../../data/knowledge/code-safety/README.md) 知识包时把它挂载为会话唯一的技能根。`implementer` 仍为 `route`，因此 program 逐轮驱动每个部门，部门自己的会话保存它走过的每一步。

一次运行中每个会话共用同一个模型。冻结的 spec 不携带按目标区分的模型，而 `agent-default-model` 是进程级的，因此一次运行无法把部门与集成配置成不同的人手；`--model` 选择两者共用的那一个。

## 无密钥运行

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-code-safety.e2e.ts
```

e2e 是 [`examples/headless-agent/tests/program-code-safety.e2e.ts`](../../program-code-safety.e2e.ts)。它断言账本与两份签名、六份证书及其额度、`platform` 部门挣得的那条指令、集成的"先失败后通过"两次尝试及其三项检查、已发布树的精确文件清单、十六个发现 id、报告陈述的按严重度计数，以及——作为针对同一个已提交审查器的反例——一条行号被挪动的发现会被拒绝并由 `--list-invalid` 点名。第二个用例在同一目标上运行，用 `DSH_CODE_SAFETY_DEPARTMENTS` 在六个专科部门之外再点名通才部门，并断言第七份证书及其三条发现已合并进经审查的报告。

## 真实运行

```sh
pnpm run code-safety -- /path/to/target [--out <dir>] [--model sonnet|opus]
pnpm run code-safety -- /path/to/target --with-generalist
pnpm run code-safety -- /path/to/target --departments secrets,injection,generalist
```

它在 `<out>`（默认 `.code-safety/<target>-<timestamp>/`，已被仓库忽略）下铸造报告仓库，引导 overlay，并打印部门账本、审查器的裁定，以及已发布的 `SAFETY-REPORT.md` 与 `findings.json` 的路径。它需要已安装并登录的 `claude` CLI，且不需要 `DEEPSEEK_API_KEY`。它在 tsx 下从 TypeScript 源码运行 driver，因此无需构建；只有 `DSH_EXAMPLE_MODE=lib` 的启动方式（CI 所用）才需要先执行 `pnpm run build:lib:host`。

运行期间，`<out>/.sessions/` 会逐渐填满每个会话各一份日志——账本、它的各部门与集成——program 结束时 driver 把它唯一的结果行写入 `<out>/stdout.jsonl`。按[运行表](../../../../../data/code-safety/README.md)所述，把它记录到 `data/code-safety/` 下。

## NodeGoat 上的运行

首次真实评审的对象是 [OWASP NodeGoat](../../../../../data/code-safety/README.md)——一个刻意留有漏洞的 Express 应用——模型为 `sonnet`，并挂载了知识包：锁定 111 个文件，六个部门全部在第一次尝试中获得认证，提交 46 条发现、去重后并集为 42 条（5 条 critical、17 条 high、13 条 medium、5 条 low、2 条 info），已提交的审查器在合并后的 HEAD 上通过。集成的第一次尝试发现合并结果不含报告，第二次写出了它；整个 program 耗时 1301 秒。[`data/code-safety/2026-09-19-nodegoat/`](../../../../../data/code-safety/README.md) 保存了报告、并集、审查器的输出与全部会话日志。

同一个 program 在未挂载知识包时的一次较早运行，得到了可比的发布结果——6 之 6 认证、提交 44 条、并集 42 条——但把全部 44 条发现都记为 `confirmed`。已记录的那次运行挂载了知识包的 `review-method` 技能，记为 39 条 `confirmed`、2 条 `likely`、1 条 `possible`，把五条发现移出了 `critical`，并报告了较早那次没有发现的一处 SSRF。这两个数字都不是测量：两次运行就只是两次运行，能够裁定此事的是一次配对读数。

## 这个 program 不做什么

它只读。没有路由被调用，没有载荷被发送，它报告的任何发现都不是已演示的利用：`confidence` 是分析者本人对"把路径追到了多远"的声明，而审查器检查的是引用而非推理。它覆盖的是各部门实际打开过的文件，这正是 `## Scope and method` 必须陈述、`## What was not covered` 必须界定的范围。

目标的只读性靠检测而非内核来保证：本组合中没有任何东西把目标以只读方式挂载，因此部门是可以写入目标的，阻止这种写入进入发布的，是审查器反复核对的那份已提交的锁。[`driver.ts`](driver.ts) 中的 `MAX_TARGET_FILES` 界定了究竟能锁定多大的树——超过它的树会被拒绝而不是抽样，因为抽样的锁会把"部门在抽样之外编辑过的目标"报告成未曾改动。

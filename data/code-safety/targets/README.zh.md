# 代码安全评审目标

[English](README.md) | 中文

目标文件钉住一次代码安全评审读的是什么：仓库、修订版本；对于没有已记载缺陷列表的目标，还有纳入范围的路径，以及用什么方法代替基准真值来估计召回率。[`data/code-safety/`](../README.md) 下的每条记录都对照它所指明的目标来读；这里的任何内容都不属于发布门禁。

| 文件 | 目标 | 召回率对照 |
| --- | --- | --- |
| [`nodegoat.ground-truth.json`](nodegoat.ground-truth.json) | `c5cb68a` 处的 OWASP NodeGoat | 它的 18 个已记载缺陷 |
| [`dvja.ground-truth.json`](dvja.ground-truth.json) | `597ece1` 处的 dvja | 它的 14 个已记载缺陷 |
| [`dsh-subagent-providers.target.json`](dsh-subagent-providers.target.json) | 本仓库 `599da7580` 处的四个外部 agent subagent provider | 八个预埋的 canary |

## dsh-subagent-providers：企业自己的代码

这四个 Harness Core 包都会在子进程里启动另一个 agent 产品，并按该产品自己的线协议驱动它：[`subagent-claude-code`](../../../packages/subagent/subagent-claude-code/README.md)（Claude Agent SDK 与 `claude` CLI，要么用产品自带的工具，要么桥接到 harness 的工具上）、[`subagent-codex`](../../../packages/subagent/subagent-codex/README.md)（经 JSON-RPC 驱动的 `codex app-server`）、[`subagent-acp`](../../../packages/subagent/subagent-acp/README.md)（任意 Agent Client Protocol agent）与 [`subagent-dsh-sdk`](../../../packages/subagent/subagent-dsh-sdk/README.md)（经 SDK 的 JSON-RPC 驱动的子 harness 运行时）。它们每一个都在委派会话的工作区里运行不是 harness 写的代码，解析那个进程跨进程边界写回来的内容，在没有人在场的情况下答复它的权限请求与输入请求，并决定哪些环境变量、哪些工具能到达它。一个被攻破或遭到提示注入的子进程，最先触及的就是这些代码行。每个包在[花名册](../../enterprise/README.md)中都有一个 Harness Core 管理员席位，因此一条被确认的发现在[工单队列](../../enterprise/tickets/README.md)里有明确的负责人。

纳入范围的路径是修订版本 `599da758095bd221b6747d5b5631592b8620efe4` 处每个包的 `src/`、`package.json` 与 `README.md`：24 个文件、3,552 行，按目标文件所载的摘要锁定，该摘要用 program driver 自己的规则计算。不在范围内、只在某条发现的调用点需要时才去读的有：这些包的测试、负责解析子进程工作目录与策略的共享 [`dsh-subagent`](../../../packages/subagent/subagent/README.md) 服务、负责清洗环境变量并拥有进程树的 [subprocess seam](../../../packages/subprocess/subprocess/README.md)、bridge 所服务的 MCP 工具服务器，以及这些外部产品本身。这个切片的大小按一次约三十分钟的评审来定；NodeGoat 的 111 个文件用了 1,225 到 1,730 秒。

### 没有基准真值时的召回率

没有人数过这段代码的缺陷，因此评审在一份带有八个合成缺陷的副本上运行，并按它找到了其中多少个来打分（[方法](../README.md#recall-without-a-ground-truth-seeded-defects)）。这份副本由 [`seed-defects.mjs`](../tools/seed-defects.mjs) 按目标文件的 `seeding` 参数植入：它的四个 TypeScript 目录条目——一行把从子进程线协议上读到的值写进 stderr 的日志（CWE-117）、对这样一个值调用 `eval`（CWE-95）、用这样一个值编译 `RegExp`（CWE-1333），以及一个带硬编码回退值的模块级令牌（CWE-798）——每类两处。每一行植入代码都是 TypeScript 解析器读作独立成句的一条语句，副本里不带 `.git`。评审运行期间，答案被压缩后存放在 scratch 目录树之外，因为各部门拥有 shell，而且以前读过其他运行的文件；被植入文件的原版仍留在这台主机上本仓库的每一个检出里，这一点任何 seeding 都无法隐藏。

### 复现一次评审

```sh
git clone --no-checkout <this repository> target && git -C target sparse-checkout set --no-cone <each path of the target file, with a leading />
git -C target checkout --detach 599da758095bd221b6747d5b5631592b8620efe4
node data/code-safety/tools/seed-defects.mjs target seeded --language typescript --seed dsh-self-review-2026-09-28 --n 8 --max-per-entry 2
pnpm run code-safety -- seeded/repo --out .code-safety/dsh-self-review --model sonnet
node data/code-safety/tools/record-run.mjs .code-safety/dsh-self-review <date>-dsh-self-review --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml --seeded seeded
```

`--seeded` 把答案与 seed manifest 复制进记录，并写出 `seeded-recall.json`，即已发布的发现对照它们打出的分数。

### 2026-09-28 的评审及其分拣

[`2026-09-28-dsh-self-review`](../2026-09-28-dsh-self-review/manifest.json) 用交付的组合运行了一次：六个部门通过认证，integration 在第二次尝试时通过认证，审查器通过，1,390 秒内发布了 11 条发现。每条发现都对照 `599da7580` 处的代码读过，并归入三类之一：canary（它引用的是一行植入代码）、误报（代码并不存在它所陈述的缺陷），或已确认。

| 发现 | 引用 | 分拣 |
| --- | --- | --- |
| `injection-eval-bridge-usage-cache-tokens` | `subagent-claude-code/src/bridge.ts:60` | canary `SEED-002` |
| `platform-hardcoded-service-token-claude-code` | `subagent-claude-code/src/run.ts:45` | canary `SEED-003` |
| `data-claude-code-raw-result-logged` | `subagent-claude-code/src/run.ts:141` | canary `SEED-004` |
| `injection-log-claude-cli-reported-text` | `subagent-claude-code/src/run.ts:141` | canary `SEED-004` |
| `platform-hardcoded-service-token-codex` | `subagent-codex/src/run.ts:26` | canary `SEED-005` |
| `injection-regexp-from-codex-turn-id` | `subagent-codex/src/wire.ts:363` | canary `SEED-008` |
| `platform-debug-console-log-acp-run` | `subagent-acp/src/run.ts:258` | canary `SEED-001` |
| `dependencies-acp-sdk-outdated` | `subagent-acp/package.json:45` | 误报 |
| `dependencies-anthropic-sdk-outdated` | `subagent-claude-code/package.json:56` | 误报 |
| `dependencies-claude-agent-sdk-outdated` | `subagent-claude-code/package.json:57` | 误报 |
| `dependencies-openai-codex-outdated` | `subagent-codex/package.json:59` | 误报 |

四条依赖发现陈述的是：一个被精确钉住的版本比 registry 上的最新版本旧，而且没有可供审计的 lockfile。四个被钉住的版本都没有受任何安全公告影响——该部门自己的 OSV 查询一条也没找到，评审当天的 npm 安全公告数据库也没有——而仓库根目录的 `pnpm-lock.yaml`（在切片之外）解析了全部四个依赖。`@openai/codex` 是一个仅供测试的依赖，它的 `0.147.0` 正是 Codex provider 的 README 所记载的协议基线；生产环境运行的是主机上安装的 `codex`，而不是这个包。没有安全公告的版本陈旧并不是 CWE-1104 所指的缺陷，因此四条都未被确认。

没有任何已发布的发现被确认。为分拣而阅读代码时，发现了一个评审没有报告的缺陷：在 Windows 上，Codex provider 启动的是裸名称 `cmd.exe` 与 `codex`（`subagent-codex/src/run.ts:36-42`），Claude Code provider 的批处理垫片启动的是裸名称 `cmd.exe`（`subagent-claude-code/src/process.ts:59-65`），两者都以委派会话的工作区作为子进程的工作目录，而 libuv 在 Windows 上启动进程时，会先在该目录里查找裸文件名，然后才查找 PATH 中的任何目录，因此一个含有 `cmd.exe` 或 `codex.cmd` 的工作区会以它代替产品运行（CWE-427）。没有哪个 canary 模拟这一类缺陷，所以它就是这次评审的一次漏报。分拣把它作为 [T-0040](../../enterprise/tickets/T-0040.json) 与 [T-0041](../../enterprise/tickets/T-0041.json) 提交给两位管理员，放进[队列](../../enterprise/tickets/README.md)。除此之外，评审的沉默是关于被静态阅读的 24 个文件的陈述，而不是证明它们没有其他缺陷的证书：报告自己的 `## What was not covered` 点明了共享 subagent 服务、subprocess seam、各个 SDK 以及被启动的产品都没有读过。

canary 读数为 8 中 6，Wilson 95% 区间 [0.409, 0.929]。有三个 canary 并没有植入任何可达的缺陷：`SEED-001`（`String(allow)`）、`SEED-006`（`eval(String(turn))`）与 `SEED-007`（`new RegExp(String(item))`）所在的值已经被代码收窄为对象或 `undefined`，因此 `String()` 得到的是一个任何子进程都无法左右的常量（`[object Object]`）。injection 部门把这三处都读过，并在报告里正是以这个理由把它们排除；`SEED-001` 之所以算作被捕获，只是因为 data 与 platform 把它那一行当作一处多余的 `console.error` 报了出来。在五个携带子进程可控值的 canary 上——线协议上的一个 token 计数、一段结果文本和一个 turn id，以及两个硬编码令牌——评审捕获了 5 中 5，Wilson 95% 区间 [0.566, 1.0]。TypeScript 目录条目锚定的是声明的名字以及读取它的那个对象，而不是它的类型；要求只植入可达缺陷的 seeding，需要一个能证明该值是字符串的锚点。

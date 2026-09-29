# Agent Note: 开发分支在托管 runner 上运行仓库门禁

Status: implemented

[English](2026-09-27-branch-ci-on-hosted-runners.md) | 中文

## Problem

上游工作流 `.github/workflows/ci.yml` 只在推送到 `master` 和 pull request 时运行，并且只跑在企业 runner 标签 `dsh-ubuntu-24-04-16core` 上，而这个 fork 没有该标签。因此开发分支 `claude/coding-agent-harness-u9l4gt` 在 `master`（47f943859）之后累积了 488 个提交，却没有得到过一次 CI 判定。本地推送前纪律（[dsh-pre-push-checks](../../../skills/dsh-pre-push-checks/SKILL.md)）按设计只跑聚焦检查，所以跨包的漂移是不可见的：分支上的头几次运行发现了过期的 `docs/module-graph.md`、两条 knip 发现、一个已腐坏的 bubblewrap 版本钉（`0.9.0-1ubuntu0.2` 已从 `noble-updates` 下架）、一个钉死在计数上的计划列表测试、只在企业主机上成立的真实产品开销断言、三处未覆盖的位置（pwsh 执行器的读屏障探测和进程内驱动的 `model` 分支）、pwsh 终端 lane 里重复的 `tool-pwsh` 加载器条目、28 个以未打包布局提交的会话 fixture、两条在 `model` 能力落地之前记录的加载器组合期望，以及一份在其黄金配对文档变更之前记录的翻译提示快照。

## Decision

`.github/workflows/branch-ci.yml` 在托管的 `ubuntu-latest` runner 上，于开发分支的每次推送以及手动触发时，运行与企业 lane 相同的三组门禁（`check:ci:static`、`check:ci:coverage`、`check:ci:consumers`）。worker 数量按 runner 的四核配置：static 作业一次跑两个门禁；coverage 作业一次跑一个门禁、三个 vitest worker；consumers 作业一次只跑一个门禁，因为当另一个门禁的构建共享这些核心时浏览器套件会超时，并且它把 oxlint 限制为两个线程、publint 限制为两个并发包，并跳过 Node 兼容性的类型检查。每个 ref 一个并发组，让已开始的运行跑完，只让最新的一次推送排在其后等待：企业周期每小时推送多次，而取消进行中运行的并发组曾让任何提交都得不到结论。static 作业检出完整历史，因为归档门禁从检出中读取可信基线。每个作业都禁用遥测。`scripts/prepare-ci-bubblewrap.sh` 把 bubblewrap 包钉在 `noble-updates` 当前提供的版本（`0.9.0-1ubuntu0.3`）及其 SHA-256 上，这样沙箱 lane 保持可复现，未来的版本钉腐坏会在安装步骤中按名字失败，而不是悄悄改变被测的沙箱。

工作流默认不授予任何权限，每个作业只持有 `contents: read`。`branch-ci.yml`、`deck-pages.yml` 与 `docs-pages.yml` 中的每个第三方 action 都钉在完整的提交 SHA 上，旁边注明该标签当时解析到的发布版本（`actions/checkout` v6.1.0、`pnpm/action-setup` v4.3.0、`actions/setup-node` v6.5.0、`actions/cache` v4.3.0、`actions/configure-pages` v6.0.0、`actions/upload-pages-artifact` v5.0.0、`actions/deploy-pages` v5.0.1），因此被移动的标签无法改变 lane 所运行的内容；升级时 SHA 与其注释一起修改。仓库的 Pages 站点只从开发分支发布：`deck-pages.yml` 的作业只对该 ref 运行，因此从其他分支手动触发不会发布任何内容，也只有它持有 `contents: write`，且其检出不为构建保留任何令牌；`docs-pages.yml` 只在上游仓库中部署，因此推送这个 fork 的 `master` 无法替换指挥台。

被更新的推送取代的待运行 run 以 `cancelled` 结束，没有判定，因此一个提交的判定在其自身运行作出过判定时取该运行的，否则取之后第一个 head 包含该提交的已完成运行：`scripts/enterprise-report.ts` 把这种回答标为 `later` 并列出被取代的运行，裁决职能把它连同该 head 记在 `target.via` 中，`pnpm run enterprise:verdicts` 列出每个已交付提交的判定及其依据。

## Alternatives considered

**给企业版 `ci.yml` 加上分支触发器。** 否决：它的 runner 标签在这个 fork 上不存在，而且它的 lane 形态假定十六个核心。

**在开发容器里自建 runner。** 否决：容器是临时的，会话之间会被回收；判定不能依赖它。

**继续只依赖本地推送前检查。** 被 Problem 中的证据否决：这套纪律对一次推送是正确的，但作为唯一门禁是错误的，分支累积的恰恰是它看不见的跨领域漂移。

**不钉版本地安装 bubblewrap。** 否决：不钉版本的安装会让沙箱 lane 的二进制随镜像漂移；版本钉就是可复现性本身，其维护成本在失败的步骤处可见。

**让 action 停留在主版本标签上。** 否决：标签会随其所有者发布新版而移动，lane 就会运行本仓库任何提交都未指明的代码；SHA 才是实际运行的版本。

**把被取代的提交归到分支上最新的判定。** 否决：最新运行的 head 未必包含该提交，其判定也就未必覆盖该提交的改动；台账中就有这样一行：对 `d2cc487f7` 的判定被记给了 `3ed95172e5`，而分支并不包含这个提交。

## Consequences

开发分支的每次推送都在托管 runner 上得到判定；分支的第一次全绿运行是 `master` 之后这些工作的第一份 CI 证据。pwsh 沙箱 spec 的读屏障探测测试只在装有 `pwsh` 的地方运行，托管 runner 装有它，所以覆盖率门禁在 CI 上和装有 PowerShell 的开发者主机上都成立。bubblewrap 版本钉会随下一次 `noble-updates` 发布再次腐坏，安装步骤会点名它。第四次运行中的两个 web e2e 超时里，`workspace-management`（一次悬停轮询）确属负载：consumers 作业改为一次一个门禁后，它在第五次运行中通过。`agent-preset-selection` 则不是：2026-09-06 加入的 judge 与 validator 两个预设没有英文显示名，英文预设菜单于是用中文列出它们，菜单快照之后的每条断言都连锁失败；第五次运行把这一点清楚地暴露了出来。开发容器完全无法运行 web e2e lane：仓库的 Playwright 需要 headless-shell r1228，而容器自带 r1194，所以这些 lane 的判定只能来自 CI。容器里也没有 `pwsh`，因此 `pwsh-tool-turn` ACP 场景和 pwsh 执行器套件只有把 PowerShell 发布包解开放到 `PATH` 上才会在这里运行；托管 runner 自带它。

## Verification

分支上的第一到第四次运行各自发现了 Problem 中列出的缺陷，并且每一项都在随后的提交中修复。第五次运行又发现了两项：pwsh 探测测试期望的是 bash spec 的 `read-only` 默认值，而它自己的组合解析为 `workspace-write`（在 `038e8f019` 中修复）；以及上文的预设名缺陷（为两个预设补上英文名，并对着构建出的应用重新记录了两份 web 快照）。在该提交之前的本地验证：`npx tsc --noEmit -p tsconfig.host.json` 通过；oxlint 在变更的包上通过；`pnpm run verify-module-graph` 报告图是最新的；进程内驱动的测试使其源码保持 100% 覆盖；两条加载器组合测试对着构建出的 `lib/` 通过（`DSH_EXAMPLE_MODE=lib`）；翻译提示快照已从当前黄金配对重新记录并通过；`pnpm run migrate:packed-session-fixtures` 重写了 28 个 fixture 且布局快照通过；ACP 场景 `subagent-continuable-inheritance` 在本地负载下整组 consumers 运行中超时，单独运行则通过。

第五次以及第九到第十三次运行的 consumers 作业都败在同一份钉住的 fixture 上，第五次运行的记述漏掉了它：`examples/acp-agent/tests/snapshots/pwsh-tool-turn/tool-schemas.expected.json` 只在装有 `pwsh` 的地方参与比对，而 `task_*`→`job_*` 的改名（`a2d0f7f41`）是手工编辑而非重新记录它，于是四条后台作业描述保留了旧名词，`pwsh` 也仍排在请求头按名字列出的 `job_*` 工具之前；在 `PATH` 上放着 PowerShell 7.5.4 用 `DSH_SNAPSHOT=refresh` 重新记录了它，让该场景真正运行的完整无密钥快照套件通过。第十三次运行的 coverage 作业还败在 shifts 的 spec `refuses a slot that lands on a running shift of the same district` 上：在其毫秒级节拍下，只要运行被扣住，每个被拒绝的时槽都发布一个自己的会话——每个都要经过数次目录与文件同步——在该 lane 的两个 fork worker 之下，运行中时槽自己的 `shift/start` 和轮询的列表读取都没能在 `vi.waitFor` 默认的一秒内落定（在空闲主机上，仅第二次轮询就花了 218 ms，350 ms 内落下了 82 条拒绝记录）；该 spec 以 25 ms 的节拍驱动拒绝并等待重叠拒绝记录本身，如同它的花费窗口姊妹 spec 自 `c8abb2080` 起所做的那样。

第 23 到第 53 次运行败在五个原因上。第 23 次运行的 coverage 作业败在 fleet spec `stops both plans of a paired run once either plan's route is refused at its limit` 上：第 1 对的两个 cell 各睡 1 ms，而 spec 期望撞墙的 cell 先落定，于是当其同伴先结束时，fleet 在墙立起之前正确地启动了下一个 cell；桩现在把重叠显式化：撞墙的 cell 在其同伴启动之后才拒绝，同伴在 fleet 宣告撞墙的 cell 之后才完成（`85d47f7ac`）。第 27 次运行的 coverage 作业败在 `removes an ordinary managed tree after 'uncaught-exception'` 上，它为宿主 fixture 的 `ready` 文件等待了 30 s：受管进程树用 `writeFile` 写出其进程 id，而 `writeFile` 会先创建空文件，宿主一见到该文件存在就解析它，读到空内容后在写出 `ready` 之前死亡，并在退出时移除了进程树；对这一轮询的独立复现在宿主的 10 ms 间隔下 300 次中有 18 次读到空文件，而把 id 写入旁路文件再重命名到位之后一次也没有，fixture 现在就这样做（`f1e5cb672`）。第 23 到第 25 次以及第 48 次运行的 consumers 作业败在翻译提示快照上，它内嵌五个活的双语配对：`30c607f15` 与 `5b1f5e66c` 修改了其中两个却没有重新记录它，`8a4f37301` 与 `f2fba8fa0` 重新记录了它；T-0023 消除这一依赖。第 35 与第 48 次运行的 consumers 作业败在重复检测门禁上，原因是 `29161bc0e` 从发布器复制到报告中的按事业部统计席位的代码，它现在是 `scripts/enterprise-roster.ts` 中唯一的函数 `divisionSeats`（`e83784055`）；第 48 次运行在 secret-patterns spec 上的 lint 失败已在 `1db0cb562` 中修复。第 35 到第 53 次运行的 static 作业败在 knip 上，因为 `cd535f57e` 在任何视图导入之前就加入了指挥台的运行快照读取器 `apps/command-deck/deck/ops.ts`，而 `feed.ts` 中 `FIXTURE_BASE` 与 `feedUrl` 的唯一用处也随之落在它里面；运行视图（`ece50d66c`）导入了它。第 53 次运行的 head 已包含上述每一项修复，其 coverage 与 consumers 作业均通过。本地验证：`npx tsc --noEmit -p tsconfig.host.json` 通过，fleet 与 process-exit 的 spec 通过，企业职能、台账、报告、发布与判定列表的 spec 通过，`pnpm run duplication` 未发现克隆，三个被修改的工作流都能解析，其权限与作业条件如上文所述。

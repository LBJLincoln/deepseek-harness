# Agent Note: 开发分支在托管 runner 上运行仓库门禁

Status: implemented

[English](2026-09-27-branch-ci-on-hosted-runners.md) | 中文

## Problem

上游工作流 `.github/workflows/ci.yml` 只在推送到 `master` 和 pull request 时运行，并且只跑在企业 runner 标签 `dsh-ubuntu-24-04-16core` 上，而这个 fork 没有该标签。因此开发分支 `claude/coding-agent-harness-u9l4gt` 在 `master`（47f943859）之后累积了 488 个提交，却没有得到过一次 CI 判定。本地推送前纪律（[dsh-pre-push-checks](../../../skills/dsh-pre-push-checks/SKILL.md)）按设计只跑聚焦检查，所以跨包的漂移是不可见的：分支上的头几次运行发现了过期的 `docs/module-graph.md`、两条 knip 发现、一个已腐坏的 bubblewrap 版本钉（`0.9.0-1ubuntu0.2` 已从 `noble-updates` 下架）、一个钉死在计数上的计划列表测试、只在企业主机上成立的真实产品开销断言、三处未覆盖的位置（pwsh 执行器的读屏障探测和进程内驱动的 `model` 分支）、pwsh 终端 lane 里重复的 `tool-pwsh` 加载器条目、28 个以未打包布局提交的会话 fixture、两条在 `model` 能力落地之前记录的加载器组合期望，以及一份在其黄金配对文档变更之前记录的翻译提示快照。

## Decision

`.github/workflows/branch-ci.yml` 在托管的 `ubuntu-latest` runner 上，于开发分支的每次推送以及手动触发时，运行与企业 lane 相同的三组门禁（`check:ci:static`、`check:ci:coverage`、`check:ci:consumers`）。worker 数量按 runner 的四核配置：static 作业一次跑两个门禁；coverage 作业一次跑一个门禁、三个 vitest worker；consumers 作业一次只跑一个门禁，因为当另一个门禁的构建共享这些核心时浏览器套件会超时，并且它把 oxlint 限制为两个线程、publint 限制为两个并发包，并跳过 Node 兼容性的类型检查。每个 ref 一个并发组，让已开始的运行跑完，只让最新的一次推送排在其后等待：企业周期每小时推送多次，而取消进行中运行的并发组曾让任何提交都得不到结论。static 作业检出完整历史，因为归档门禁从检出中读取可信基线。每个作业都禁用遥测。`scripts/prepare-ci-bubblewrap.sh` 把 bubblewrap 包钉在 `noble-updates` 当前提供的版本（`0.9.0-1ubuntu0.3`）及其 SHA-256 上，这样沙箱 lane 保持可复现，未来的版本钉腐坏会在安装步骤中按名字失败，而不是悄悄改变被测的沙箱。

## Alternatives considered

**给企业版 `ci.yml` 加上分支触发器。** 否决：它的 runner 标签在这个 fork 上不存在，而且它的 lane 形态假定十六个核心。

**在开发容器里自建 runner。** 否决：容器是临时的，会话之间会被回收；判定不能依赖它。

**继续只依赖本地推送前检查。** 被 Problem 中的证据否决：这套纪律对一次推送是正确的，但作为唯一门禁是错误的，分支累积的恰恰是它看不见的跨领域漂移。

**不钉版本地安装 bubblewrap。** 否决：不钉版本的安装会让沙箱 lane 的二进制随镜像漂移；版本钉就是可复现性本身，其维护成本在失败的步骤处可见。

## Consequences

开发分支的每次推送都在托管 runner 上得到判定；分支的第一次全绿运行是 `master` 之后这些工作的第一份 CI 证据。pwsh 沙箱 spec 的读屏障探测测试只在装有 `pwsh` 的地方运行，托管 runner 装有它，所以覆盖率门禁在 CI 上和装有 PowerShell 的开发者主机上都成立。bubblewrap 版本钉会随下一次 `noble-updates` 发布再次腐坏，安装步骤会点名它。第四次运行中的两个 web e2e 超时里，`workspace-management`（一次悬停轮询）确属负载：consumers 作业改为一次一个门禁后，它在第五次运行中通过。`agent-preset-selection` 则不是：2026-09-06 加入的 judge 与 validator 两个预设没有英文显示名，英文预设菜单于是用中文列出它们，菜单快照之后的每条断言都连锁失败；第五次运行把这一点清楚地暴露了出来。开发容器完全无法运行 web e2e lane：仓库的 Playwright 需要 headless-shell r1228，而容器自带 r1194，所以这些 lane 的判定只能来自 CI。容器里也没有 `pwsh`，因此 `pwsh-tool-turn` ACP 场景和 pwsh 执行器套件只有把 PowerShell 发布包解开放到 `PATH` 上才会在这里运行；托管 runner 自带它。

## Verification

分支上的第一到第四次运行各自发现了 Problem 中列出的缺陷，并且每一项都在随后的提交中修复。第五次运行又发现了两项：pwsh 探测测试期望的是 bash spec 的 `read-only` 默认值，而它自己的组合解析为 `workspace-write`（在 `038e8f019` 中修复）；以及上文的预设名缺陷（为两个预设补上英文名，并对着构建出的应用重新记录了两份 web 快照）。在该提交之前的本地验证：`npx tsc --noEmit -p tsconfig.host.json` 通过；oxlint 在变更的包上通过；`pnpm run verify-module-graph` 报告图是最新的；进程内驱动的测试使其源码保持 100% 覆盖；两条加载器组合测试对着构建出的 `lib/` 通过（`DSH_EXAMPLE_MODE=lib`）；翻译提示快照已从当前黄金配对重新记录并通过；`pnpm run migrate:packed-session-fixtures` 重写了 28 个 fixture 且布局快照通过；ACP 场景 `subagent-continuable-inheritance` 在本地负载下整组 consumers 运行中超时，单独运行则通过。

第五次以及第九到第十三次运行的 consumers 作业都败在同一份钉住的 fixture 上，第五次运行的记述漏掉了它：`examples/acp-agent/tests/snapshots/pwsh-tool-turn/tool-schemas.expected.json` 只在装有 `pwsh` 的地方参与比对，而 `task_*`→`job_*` 的改名（`a2d0f7f41`）是手工编辑而非重新记录它，于是四条后台作业描述保留了旧名词，`pwsh` 也仍排在请求头按名字列出的 `job_*` 工具之前；在 `PATH` 上放着 PowerShell 7.5.4 用 `DSH_SNAPSHOT=refresh` 重新记录了它，让该场景真正运行的完整无密钥快照套件通过。第十三次运行的 coverage 作业还败在 shifts 的 spec `refuses a slot that lands on a running shift of the same district` 上：在其毫秒级节拍下，只要运行被扣住，每个被拒绝的时槽都发布一个自己的会话——每个都要经过数次目录与文件同步——在该 lane 的两个 fork worker 之下，运行中时槽自己的 `shift/start` 和轮询的列表读取都没能在 `vi.waitFor` 默认的一秒内落定（在空闲主机上，仅第二次轮询就花了 218 ms，350 ms 内落下了 82 条拒绝记录）；该 spec 以 25 ms 的节拍驱动拒绝并等待重叠拒绝记录本身，如同它的花费窗口姊妹 spec 自 `c8abb2080` 起所做的那样。

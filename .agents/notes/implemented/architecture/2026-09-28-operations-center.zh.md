# Agent Note: 运营中心：每个 agent（智能体）工作的一份实时快照

Status: implemented

[English](2026-09-28-operations-center.md) | 中文

## Problem

企业的工作分散在一台机器上的十几个地方：调度器启动的周期，暂存目录里的班次与 intake（受理），harness 会话日志和 Claude Code 转录里的部门与审查者，职能门禁与 CI 裁决，Proving Ground 基准测试，以及运营者自己的后台 agent。每一处都写自己的记录，却没有任何东西把它们合起来读。运营者无法一眼看出什么正在工作、什么需要处理以及原因、企业交付了多少；面向客户的演示没有任何实时内容可以展示；而 GitHub Pages 上的公开 deck 无法连到这台不接受任何入站连接的机器。

## Decision

**一个采集器，一份文档。** [`scripts/enterprise-ops.ts`](../../../../scripts/enterprise-ops.ts)（`pnpm run enterprise:ops`）把每个来源折叠成一份 `OpsSnapshot`，它的字段只在 deck 的 [`contract.ts`](../../../../apps/command-deck/deck/contract.ts) 中定义一次；宿主类型检查程序包含该文件，因此采集器与 deck 读的是同一份模式。[`scripts/enterprise-ops-sources.ts`](../../../../scripts/enterprise-ops-sources.ts) 为每个来源提供一个解析器：周期日志的步骤行、调度器日志、分支历史中的 `chore(enterprise): <cycle>` 提交、harness 的 `session.jsonl` 日志、从字节偏移处增量读取的 Claude Code 转录、GitHub REST API 上的 Branch CI 运行与作业、`/proc/meminfo`、`statfs` 以及 `/proc` 进程表。快照包含此刻正在工作的 agent（类别；有记录时的席位与分部；最新的工具调用或步骤；已运行与静默时长；来源报告用量时的 token 数）、排好序的关注队列、组织的一天（按分部的席位、队列、周期、每小时吞吐、已交付的提交及覆盖每个提交的 Branch CI 结论）、供场景使用的全部席位、过去 24 小时内每一次 agent 运行，以及最近十分钟的活动帧。

**无法读取的来源记为未知，从不猜测。** 每个来源都以 `ok` 或 `unknown` 列出并附原因；从未知来源计出的每个数字都是 `null`，视图在其位置显示 `unknown`。存活状态是读出来的，而不是假定的：`shift.lock` 中的 pid 存活时班次才算存活；周期进程在运行且其日志没有收尾行时周期才算存活；一个仍在运行的 agent 超过二十分钟没有事件即为 `stuck`（卡住）。转录以其最终报告结束的 agent 不再运行（流式转录把这份报告记为一行没有停止原因的文本，所以其后没有工具调用或用户行的文本行即结束该轮），班次或 intake 的会话只从其 `.sessions` 目录读取，因为其暂存运行的其余部分是分支的克隆，其中已提交的记录是历史。采集器在两次运行之间缓存每份转录的折叠结果，而已完成的转录不会再增长，所以状态文件带有 `OPS_STATE_FORMAT`，格式不同的状态会被丢弃，每个来源都从头重新读取。正在运行的周期步骤取它所启动的班次、intake 或门禁的最新事件，因为这些工作进行时周期日志是静默的。每一行公开的文本都经过转录共用的凭据清洗（[`secret-patterns.mjs`](../../../../data/transcripts/tools/secret-patterns.mjs)），遮蔽电子邮件地址，再移除本模块更宽泛的凭据形状，并把主目录和临时目录下的路径截到最后一段。完成的快照随后经过 [`deck/host-paths.ts`](../../../../apps/command-deck/deck/host-paths.ts)，它把剩余的每个机器绝对路径替换为说明该目录用途的占位符，因此生产机器的任何路径都不会到达中继、已提交的 fixture 或屏幕。

**关注队列先按严重程度、再按时间排序。** 红色的 Branch CI 会列出失败的作业；失败或中断的周期步骤（来自周期日志，日志消失后来自已提交的周期记录）、陈旧或已停止的调度器（2.5 小时没有周期）、卡住的 agent、自上一个有交付的班次以来其已提交记录显示因用量上限而暂停或一无交付的班次、没有留下记录就被放弃的班次（其暂存运行没有任何进程持有，且三十分钟没有动静）、已停止或迟到的转录捕获与运营循环、磁盘与内存压力、被暂停和被拒绝的工单，以及所有者未结的请求，每一项都带有证据链接（GitHub 上的提交、运行、作业、账本行、班次记录或周期记录；没有公开页面时只有记录的名称，周期按其 id）和下一步行动。没有记录时间的状况按当前处理。

**每个数字都注明时间，每个循环都有心跳。** 每个来源都带有 `asOf`，即其事实所描述的时刻：实时读取的内容以采集时刻为准，账本、队列和记录以检出最近一次抓取分支（`FETCH_HEAD`）的时间为准，花名册以它自己的 `generatedAt` 为准，Branch CI 以缓存的那次读取为准；每张卡片和每个面板都显示其所依据来源的时长。快照的 `heartbeats` 依据进程表和每个循环最近一次运行（最近一次周期开始；捕获日志记录的最近一次推送，没有时取最近一次 `chore(transcripts): live capture` 提交；循环的状态文件），把周期调度器、转录捕获与运营循环标为 `alive`、`late`、`down` 或 `unknown`。周期时间线、班次看板与已交付工单见[它们自己的笔记](2026-09-29-ops-cycles-and-shift-board.md)。快照的模式版本为 2，deck 拒绝任何其他版本。

**传输沿用 feed 契约。** [`scripts/harness-feed.ts`](../../../../scripts/harness-feed.ts) 提供 `GET /ops`，并在 `GET /ops/events` 上以运行事件流的帧格式流式发送活动帧。中继的 feed 函数从 `ingest` 存在 `/ops` 与运行 id `ops` 下的行提供同样的两个路径。[`scripts/enterprise-ops-live.sh`](../../../../scripts/enterprise-ops-live.sh) 在自己的检出中每隔 `OPS_INTERVAL_SECONDS`（15）以 `--push` 运行一次采集器，每五分钟快进一次该检出，持有一个 `flock` 以保证只有一个循环在运行，并把采集器的增量状态保存在 `/tmp`。周期的 `enterprise:publish` 步骤还会写出 `public/fixtures/ops.json`，因此 Pages 上的 deck 带着一份不早于上一个周期的快照。

**deck 会说明自己处于哪种模式。** [`deck/ops.ts`](../../../../apps/command-deck/deck/ops.ts) 读取 feed 的 `/ops`：比六个生产者间隔（至少 90 秒）更新即为 `live`；否则视图显示它能读到的最新快照（feed 的或随包附带的），标为 `recent` 并注明时长与回放提示；两者都没有时为 `offline`。实时帧按记录时的间隔、比机器晚一个间隔加五秒播放；recent 快照的帧循环回放。[运营视图](../../../../apps/command-deck/README.md#the-operations-view)（`/ops`，按键 `5`）把速览卡片放在顶部，场景居中，泳道图在其下方，关注队列在旁边。它的席位计数（卡片和各分部）读取指挥台的花名册，也就是页头据以计数并标注时间戳的那一份，因此页头与视图从不矛盾；在指挥台读到花名册之前，暂以快照自己对花名册的读取代替。场景挂载在指挥台共用的 `WebGLGate` 之后：它在挂载场景前检查 WebGL 2，用错误边界接住抛出错误的场景或被浏览器收回 WebGL 上下文的场景，并遵循 `?flat`；在这几种情况下，本视图都交给它同一个画成一张 SVG 的大厅，由门说明原因，因此没有 GPU 的笔记本或远程桌面仍能得到一个可读的视图（[门的 Agent Note](2026-09-29-command-deck-room-grade.md)）。

## Alternatives considered

**运行 feed 服务器和现有的 pusher。** pusher 镜像 `/roster`、`/runs` 以及每次运行的事件流；运营快照是采集器已经写出的一份文档，由循环直接推送它不需要本地服务器，而 feed 服务器为本地 deck 提供的是同一个采集器。

**全部通过 Server-Sent Events 流式传输。** 中继只能转发机器推送过来的内容，而机器每个间隔推送一次，所以经由中继的流并不比快照更新。流之所以存在，是因为本地 feed 可以更快，也因为它让场景按顺序播放每一帧；所有数字只靠快照就能得到。

**读取企业周期自己的检出。** 它保存着职能步骤在推送前追加的账本行，但它属于调度器，在那里读取有与其拉取竞争的风险。循环自己的检出每五分钟快进一次，能看到分支上的全部内容。

**只根据周期日志统计周期。** 容器重置会抹掉日志；分支历史中的周期提交和已提交的周期记录不会，因此采集器同时依据这三者统计周期，并在时间线上把只从历史得知的周期标为 `unknown`。

## Consequences

运营者有了一个页面来回答什么在工作、什么出了问题、下一步做什么，客户看到的则是把同样的数字画成的场景。每个数字都能追溯到页面所列的某个来源。代价是机器状态在公开中继上多了一份副本：快照公开了 agent 的标签和工具描述（经过清洗但可读），以及运营者自己 agent 的任务名。中继的 feed 函数只提供读取，因此观看者发送的任何内容都不会在机器上启动工作。中继的令牌存放在仓库之外，每次容器重置都会被抹掉，因此轮换令牌是启动循环时固定的一步（[操作手册](../../../../apps/command-deck/mirror/README.md#rotating-the-token)）。

## Verification

`pnpm exec vitest run scripts/enterprise-ops.spec.ts scripts/harness-feed.spec.ts` 覆盖每个来源的解析器、清洗、严重程度排序、班次记录、心跳、来源时长、未知来源以及 feed 的两个路径；`pnpm exec vitest run apps/command-deck/tests/ops.spec.ts` 覆盖三种模式与面板时长。`DECK_STATIC=1 NEXT_PUBLIC_BASE_PATH=/deepseek-harness pnpm --dir apps/command-deck build` 把 `/ops` 构建进静态导出；该视图的截图位于 [`apps/command-deck/docs/`](../../../../apps/command-deck/README.md#the-operations-view)。

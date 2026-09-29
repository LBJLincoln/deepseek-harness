# Agent Note: 每一份实时 transcript 都在五分钟内进入分支

Status: implemented

[English](2026-09-28-live-transcript-capture.md) | 中文

## Problem

运行操作者会话、其 subagent 以及 enterprise 各个 cycle 的容器会在没有预告的情况下被重置，而重置只保留已推送分支所包含的内容。transcript 原先依靠对整个会话目录树的快照保存（[`collect-claude-code-session.mjs`](../../../../data/transcripts/tools/collect-claude-code-session.mjs)）：它每次运行都重写一棵 200 MB 的原始目录树，拒绝任何未被告知的凭证形状，并由一个已于 2026-09-19 禁用的每小时 Routine 运行。最后一次快照拍摄于 2026-09-23T00:28Z。因此 2026-09-28T22:07Z 的重置抹去了五天的编排会话日志、那几天的每一份 subagent transcript，以及一个进行中 shift 的部门会话；[LOSSES.md](../../../../data/transcripts/LOSSES.md) 说明了丢失了什么、留存了什么。enterprise 的其他日志（shift 的 `.sessions`、intake 的 scratch、cycle 与调度器日志、nightly bench 日志）位于 `/tmp` 或 `/home/user`，即便提交，也只在其运行结束之后。

## Decision

[`capture-live.mjs`](../../../../data/transcripts/tools/capture-live.mjs) 每次运行只追加每个来源自上次运行以来新增的字节，作为 `data/transcripts/live/` 下不可变的 gzip 块，并在 `live/runs/<date>/` 下为每次运行写一份不可变的清单。块只包含完整的行；它的清单条目记录来源路径、epoch、序号、字节与行范围、所存字节以及该块所结束的原始来源前缀的 SHA-256、它的遮蔽，以及捕获时间。状态由已提交的清单折叠得出，因此全新克隆会从最后一次已推送的运行停下的地方继续；一个文件若其最先捕获的字节不再哈希为所记录的前缀，就从字节 0 开始它的下一个 epoch，而不是被覆盖。块目录按文件首次捕获的日期和捕获日期分片，因此循环触及的任何 git tree 都不会无限增长，路径也保持在 140 个字符以内。

凭证与个人数据模式位于 [`secret-patterns.mjs`](../../../../data/transcripts/tools/secret-patterns.mjs)，采集器、实时捕获、数据集工具、intake 准入（[`enterprise-intake-admission.ts`](../../../../scripts/enterprise-intake-admission.ts)）、bench 预检（[`preflight.mjs`](../../../../data/proving-ground/tools/preflight.mjs)）和 code-safety 记录器（[`record-run.mjs`](../../../../data/code-safety/tools/record-run.mjs)）都导入它，因此每个发布 transcript 或 agent 文本的工具都遮蔽同样的形状。每个模式都有一个 `kind`：`credential`，或对 `email` 而言的 `personal`，因为 harness 的上下文提醒会把操作者的账户邮箱带进捕获所读的每个 Claude Code 会话。实时捕获把每个匹配遮蔽为 `[REDACTED-<PATTERN>]` 并按模式计数，而不是拒绝，因为拒绝一个块就会丢失它所含的 transcript；已采集构建接受的摘要逐字保留，因为每个模式对它们仍匹配同样的字符；纯文本日志中的 PEM 块逐行遮蔽，包括通过清单的 `pemOpen` 跨越块边界的情形；邮箱匹配从不在反斜杠之后或 `\uXXXX` 转义内部开始，因此遮蔽后的 JSONL 行仍可解析；遮蔽后的块会再扫描一次，残留的匹配会在写入清单之前终止该次运行。

[`scripts/transcripts-capture.sh`](../../../../scripts/transcripts-capture.sh) 从一个专用的链接 worktree 每隔 `TRANSCRIPTS_CAPTURE_MINUTES`（默认 5）运行一次捕获，结构与 enterprise 调度器相同：单函数主体、`flock` 单实例，间隔非法退出 2、锁被占用退出 4、主检出目录或有已跟踪改动退出 5。它只提交 `data/transcripts/live/`，并通过 fetch、`git pull --rebase` 和 push 推送，在 2、4、8、16 秒后重试。提交和推送都传 `--no-verify`，沿用 [shift 引擎](../architecture/2026-09-28-enterprise-shift-engine.md)的做法：它的数据提交由机器写出、在别处得到认证，而 pre-push 钩子三分钟的工作区类型检查会占去每个间隔的大半。只改动 transcript 数据（实时块、原始目录树和派生数据集）的推送会被 Branch CI 忽略；`data/transcripts/` 下的工具和 Markdown 配对仍会触发它。Pages 工作流原本就只对 `apps/command-deck/**`、它自己的文件和锁文件运行。[`transcripts-to-dataset.mjs`](../../../../data/transcripts/tools/transcripts-to-dataset.mjs) 通过 `--session` 从实时块读取一个会话，更早的 epoch 已包含的行只读一次。

## Alternatives considered

- **重新启用每小时的采集器 Routine。** 它触发到操作者的会话中，而重置会挂起该会话；它每小时重写整棵原始目录树；遇到新的凭证形状它会拒绝，直到有人审阅。三者中任何一个都会丢失 transcript。
- **每次运行都提交来源文件本身。** 一个不断增长的 200 MB 日志每五分钟提交一次，每次都会存一个新的完整 blob；追加的块只存新增的字节。
- **为整个捕获使用一份清单文件。** 每次运行都重写它，会使历史随块数呈二次增长；每次运行一份不可变清单则不会。
- **像采集器那样拒绝含有未处理凭证形状的块。** 拒绝适合经过审阅的归档，却不适合一个唯一职责是在重置之前保住字节的捕获；带计数的遮蔽既保住了 transcript，又让机密不进入分支。
- **在每个工具里各保留一份模式副本。** 这些副本发生了漂移：intake 准入的副本说采集器没有导出它的列表，bench 预检的副本缺少私钥与 bearer 形状，而且没有一份认得个人数据。
- **检测电话号码。** 在 2026-09-06 原始目录树与实时块共 588 MiB 中，国际与北美电话号码形状匹配到的是一个 Twitter snowflake 纪元常量、数字表格和行号列表，没有任何电话号码；遮蔽它们会把 id 和计数从记录中切掉，却没有可测得的收益。
- **只遮蔽操作者的邮箱。** 这需要把该地址放进它必须远离的仓库，并且会放过其他每一个地址。
- **让 pre-push 钩子运行。** 它对整个工作区做约三分钟的类型检查，并且需要一个已安装依赖的检出目录，而仅含数据的 worktree 没有。

## Consequences

现在一次重置至多丢失捕获所列任何来源的一个间隔。只要有会话在写入，分支每个间隔就多一个提交，且不触发 CI 运行；仓库按会话所写一切内容的压缩大小增长：在一个 subagent 工作流运行期间，循环的前两轮分别取走了 7.3 和 5.0 MiB 的来源。块是遮蔽后的副本，因此它们的 SHA-256 描述的是所存字节，原始前缀哈希只用于发现被重写的来源。循环自己的日志和 Claude Code 的 `ccr-tip.json` 指针被排除在外，因为它们中任何一个都会让每次运行都多出一个块。默认列表之外的来源需要 `--source`；一个原地重写自身的来源每次都会开始一个新 epoch，因此上限约束了一次运行所能增加的内容。2026-09-29T00:18:02Z 那次捕获之前各次运行的块、已采集的原始目录树，以及更早的 code-safety 与 proving-ground 记录的会话日志，都逐字保留了操作者的邮箱；[transcripts README](../../../../data/transcripts/README.md#what-the-data-is-and-is-not) 点名了其中的 transcript 目录树，是否从公开历史中清除该地址由操作者决定。循环只有在有人启动它时才会重新运行；重置之后的启动命令见 [transcripts README](../../../../data/transcripts/README.md#live-capture)。

## Verification

`scripts/transcripts-capture-live.spec.ts` 覆盖了增量的整行块与已稳定的末尾行、保持旧块字节不变的新 epoch、带已接受占位符的遮蔽与计数以及跨两次运行被切开的 PEM 块、从复制的 `live/` 目录树继续、单文件上限，以及数据集工具读取实时块；`scripts/collect-redaction.spec.ts` 覆盖采集器对邮箱地址的拒绝以及 `--redact email`；`scripts/secret-patterns.spec.ts` 覆盖每个模式、JSON 转义的 `\n` 之后的密钥和地址、JSON 字符串中的地址、双重编码字符串中的地址和位于 `\u003c` 之后的地址、PEM 正文、紧挨已遮蔽 key id 的 AWS secret、已接受的占位符，并且不触碰 git SHA、UUID、base64 图像片段、包版本锁定和短前缀标识符。循环启用 `email` 模式后的第一轮，即 2026-09-29T00:18:02Z 的捕获 `609d922cc`，遮蔽了 43 个地址。针对本地裸远端对循环做的冒烟运行，以一分钟间隔推送了两次带 trailer 的捕获，并以退出码 5 拒绝了主检出目录。第一个实时 epoch 于 22:54Z 提交在 `541b9f1b5` 中（来自 30 个文件的 30 个块，21.0 MiB 来源，7.2 MiB 存储），从 `.claude/worktrees/transcripts-capture` 启动的循环把它的前两次捕获分别推送为 23:03:09Z 的 `7d505222b` 和 23:08:08Z 的 `9d893dee7`；对每个已存块的重新扫描没有发现任何未接受的凭证形状。

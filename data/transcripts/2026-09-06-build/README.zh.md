# 过程 transcript 数据集

[English](README.md) | 中文

## 这是什么

本数据集是 DeepSeek Harness 分支一次 AI 辅助构建的过程 transcript（文本记录），由 Claude Code 会话产生：一个编排会话（`agents.jsonl` 中 `kind: "orchestrator"` 的记录）加上它派生的 91 个后台 subagent 会话（`kind: "subagent"`），覆盖两类会话记录下的每条消息、每次工具调用和每个 token 计数。

- `agents.jsonl` - 每份 transcript 一条记录：时间、轮次与工具调用计数及其分解、token 用量、提示与回复摘录、最后一条助手消息提到的提交 sha，以及通过 Edit/Write/MultiEdit 触及的文件。
- `messages.jsonl` - 所有 transcript 中每条会话消息一条记录，按顺序排列，含每条消息的文本、工具调用和工具结果大小。
- `stats.json` - 语料总计（transcript 数、消息数、按名称统计的工具调用、按类别统计的 token、挂钟时间）以及 subagent 时长分布。

## 移除了什么

- **工具结果正文。** `messages.jsonl` 只记录每个工具结果的字符数（`toolResultChars`），从不记录其内容；正文保留在本数据集旁边的原始目录树中。
- **密钥。** 任何形似凭证的值——以 `sk-`、`ghp_` 或 `AKIA` 开头的令牌、`Bearer ` 头部值，或任何其他 32 个字符以上的十六进制或 base64 样式串——在本数据集包含文本的所有位置都替换为 `[REDACTED]`：消息文本、提示与回复摘录，以及工具调用输入摘录。
- **非 transcript 文件。** `subagents/` 中有 91 个 transcript 形态的文件；其中 91 个是真正的 Claude Code JSONL subagent transcript（每一行都能解析为 JSON，且至少一行是真实的用户或助手消息）。0 个是其他工具输出的纯文本捕获，0 个是不含任何对话的 JSON，0 个为空。这些都不会出现在 `agents.jsonl` 或 `messages.jsonl` 中。

## 数据质量说明

- 91 个 subagent transcript 文件中有 0 个是指向活动 Claude Code 项目目录的符号链接而非冻结副本；导出时仍在运行的 subagent，在稍后重新运行 `transcripts-to-dataset.mjs` 时会显示比这里更多的行。
- 2 个 subagent transcript 在动作中途结束：最后记录的一行是一次没有伴随文本也没有结果的工具调用，而不是收尾报告——id：`a55a4649cbdf2ed91`, `ac1d0180b6ef3cf0a`。对这些 transcript，`finalAssistantExcerpt` 和 `commitShasMentioned` 反映的是 transcript 在此处停止，而不是该 agent 没有产出最终报告。

## 来源

- 构建/会话 id：`f53f80cc-1f77-5d02-a862-99d59ffabdce`
- 原始 transcript：`data/transcripts/2026-09-06-build/raw`
- 导出日期：2026-09-07
- 导出时 harness 仓库分支：`claude/coding-agent-harness-u9l4gt`
- 导出时 harness 仓库 HEAD 提交：`128e037bb6e37768873175ec433fd5b027822355`

## 使用

这些 transcript 是 Claude 的输出。根据 Anthropic 的使用政策，它们不得用于训练或微调竞争模型；请将其用于分析、过程挖掘、失败分类，以及使用虚构实体的环境合成。Daliesk 模型的 RLVR 语料来自 harness 自身在条款允许的路由上完成的经认证运行。

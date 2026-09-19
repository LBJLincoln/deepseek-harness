# Agent Note：经由会丢弃 reasoning 字段的网关时，把前一步的推理以文本回放

状态：implemented

[English](2026-09-19-reasoning-replayed-as-text-through-gateways.md) | 中文

## 问题

Proving Ground bench 在 OpenRouter 免费层上跑的第一批 cell（[记录](../../../../data/proving-ground/README.md)）显示，`deepseek/deepseek-v4-flash-0731:free` 读了任务、源码和测试，跑了测试，然后再读一遍，如此四十步、三次尝试，没有一次 `write` 或 `edit` 调用；而同一路由、同一任务上的 `nvidia/nemotron-3-super-120b-a12b:free` 写了、也改了源码。工具结果是完整的，系统提示和工具 schema 与已认证的 Claude Code cell 收到的一样，prompt 也逐步单调增长，所以没有任何历史被丢掉。

被丢掉的是模型自己的计划。这个 DeepSeek 模型把每一步的全部推敲都放在 `reasoning` 通道里，`content` 只留一个空格。harness 忠实地记录了这段推理——`stream.ts` 把它折叠成一个 `reasoning` 块，其回放状态带着 `thinkingSignature: "reasoning"`，`replay.ts` 在下一次请求时把它还原成 pi-ai 的 `thinking` 块——随后 pi-ai 的 `openai-completions` 序列化器把它作为 assistant 消息上的顶层 `reasoning` 字段放回线路，`content: null`。OpenRouter 在输入侧忽略这个字段。十二次实况请求把这件事钉死了：放在上一轮 `reasoning` 字段里、或放在从真实响应逐字节回显的 `reasoning_details` 条目里的暗号，回答都是 `UNKNOWN`；同一暗号放在 `content` 里，则逐字返回。于是模型每一步看到的历史里，它发出过工具调用、收到过结果，却什么都没说过，于是它重新开始调查——它那些"输出被截断了"的评论也是同一症状：那是一次它已不记得发出过的调用的结果。

Nemotron 逃过一劫的原因与此无关：它在 pi-ai 内置的 OpenRouter 目录里，`reasoning: true` 且没有 `off` 档位，所以 pi-ai 发送 `reasoning: { effort: "none" }`，模型改在 `content` 里叙述，而 `content` 会被完整回放。DeepSeek 的这个 id 不在该目录里，解析为 `reasoning: false`，于是根本收不到推理参数；提供方的默认是思考，而思考正是被丢掉的部分。

pi-ai 恰好有针对这种情况的开关：`compat.requiresThinkingAsText` 会把前一步的 thinking 作为文本放进 `content`。[`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) 只开放了 `thinkingFormat` 与 `supportsReasoningEffort`，并声明 pi-ai compat 面的其余部分保持自动检测，而 pi-ai 的检测按端点 URL 设置该开关，对 OpenRouter 得到的是 `false`。操作者在组合里写什么都够不到它。

## 决定

`PiAiCompatProfile` 新增 `requiresThinkingAsText?: boolean`，可设在路由上（作为其各模型的默认）或按模型设置（逐字段胜出），解析与校验方式与现有两个开关完全一致：只存在于 `openai-completions` 上，在其他协议的模型上于加载时拒绝，路由级默认会跳过这样的模型，并且是合并到内置目录条目的 compat 之上而不是替换它。缺省时仍然沿用目录条目的值、再到 pi-ai 按 URL 得出的猜测，所以现有路由一个都不变。

bench 的 `with-openrouter` 叠加层在路由级打开它，因为该路由上的每个模型都经同一个网关提供，而这个开关对没有产生推理的步骤没有任何影响。适配器的测试在捕获到的请求体上钉住了两个方向：开关关闭时，同一路由上的前一步被发送为 `{ content: "Working.", reasoning: "<plan>" }`；打开时，被发送为 `content: [{ type: "text", text: "<plan>" }, { type: "text", text: "Working." }]` 且没有 `reasoning` 键。`模型可见 ⟺ 已记录` 的规则成立：会话日志本来就带着每一个推理块，而投影是日志与组合的纯函数。

同一改动里，pi-ai 的失败分类器多了一行：没有状态码、只点名上游过载或不可用的消息（`Upstream error from Nvidia: Service temporarily overloaded`）映射为 `SERVER`，与 503 属于同一瞬时类别，于是路由的重试策略会覆盖它，而不是在第一次这样的应答上就让尝试失败——在被叫停的第一次启动里，Nemotron 的每一次尝试正是这样被切短的。

## 考虑过的替代方案

- **重新发送 `reasoning_details`。** 被测量否决：OpenRouter 同样没有把 `reasoning.text` 条目喂回给模型，而 pi-ai 只保留 `reasoning.encrypted` 条目，这个端点从未产生过这种条目。
- **用 `reasoningEfforts: { off: null, high: 'high' }` 关掉模型的思考**，让它像 Nemotron 一样在 `content` 里叙述。否决：在关掉思考的新一轮里，这个模型返回了 `content: null`，什么叙述都没有；而且 bench 不是为绕开传输缺陷而禁用模型推理的地方。
- **把叠加层指向目录 id `deepseek/deepseek-v4-flash`。** 否决：该条目声明了 `requiresReasoningContentOnAssistantMessages` 和一个没有 `off` 的档位表，pi-ai 会发送 `effort: "none"`——也就是 Nemotron 的待遇，换了一种失败，不是修复。
- **在代码里按 `provider === 'openrouter'` 决定开关。** 否决：哪些网关丢弃该字段是一个不经代码发布就会变化的部署事实，而仓库的规则是随部署变化的选择必须是经校验的 `Config` 字段，不是常量。
- **在 harness 的回放里把推理投影成文本块**，而不是开放 pi-ai 的开关。保留为后备方案：它会发送 OpenAI 标准的字符串 `content` 而不是数组，pi-ai 自己的注释说有一个 DeepSeek 家族的部署会逐字镜像数组形式；探测中数组形式没有出问题，而开放开关能把投影留在 pi-ai 拥有它的地方。

## 后果

- OpenRouter 之后的推理模型，或任何有同样输入规则的网关之后的推理模型，只要路由这么声明，就能在步骤之间保住自己的计划；最初的 DeepSeek cell 按记录保留，计划 `h1-fleet-openrouter-deepseek-t2` 在开关打开的情况下用同一模型重跑六个非保留的第 2 层环境。
- 这个开关和它旁边的模型列表一样，是网关行为的一个快照：一个开始尊重该字段的网关会让数组形式的 `content` 变得多余，但不会变错。
- 没有任何无密钥的快照 fixture 组合了 pi-ai 路由，所以适配器测试捕获的请求体就是这个模型可见改动的回归钉；覆盖经回放的 pi-ai 路由的快照 fixture 仍然缺失。
- 路由上其他在 `reasoning` 中叙述的免费模型在修复前没有被测量；修复之后的记录才是第一批能被读作模型自身、而非传输层表现的记录。

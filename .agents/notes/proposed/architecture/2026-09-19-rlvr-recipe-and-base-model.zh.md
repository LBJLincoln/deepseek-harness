# Agent Note: RLVR 的基座模型与训练它的配方

Status: proposed

[English](2026-09-19-rlvr-recipe-and-base-model.md) | 中文

## Problem

第三个目标是一个在本 harness 经认证运行上以 RLVR 训练的约 120B 开放权重模型，[目标笔记](../process/2026-09-19-objectives-step-back.md)按顺序列出了它的三个阻塞项：开放权重路由的密钥、基座模型的决定，以及算力。本笔记了结第二项并写下配方，好让密钥与算力到位时，余下的工作只是把它跑起来。

有三个事实框定了本笔记能是什么。这里跑不了任何实验：仓库没有开放权重路由，没有挂接训练算力，下文没有一个数字被测量过。训练语料是空的：32 份已记录运行无一例外跑在操作者的 Claude Code 登录上，其协议只允许 `evaluation`，[`dsh-data-use`](../../../../packages/governance/data-use/README.md) 禁止事后放宽一个会话的用途，而 [`dsh-curator`](../../../../packages/governance/curator/README.md) 会扣留条款不允许某次导出之用途的每一个会话——因此 [v1 折叠](../../../../data/proving-ground/datasets/2026-09-18-proving-ground-v1/README.md)是记录格式与奖励基准的一次演练，不是训练数据，而且此后任何决定都不能把它变成训练数据。下面的配方是一份计划：它的数字是从已记录 token 总量推出的投影，不是结果。

## Proposal

训练 **Qwen3.5-122B-A10B**：先在经认证的 `dsh-trajectory/1` 记录上做 SFT 预热，再以 environment runner 自己的证书为奖励、在 bench 环境上做 GRPO，并且只报告留出集上的数字。

### 基座模型

下面是总参数量在 120B 上下、开放权重、有可下载检查点且截至今天仍属当前的每一个候选。`openai`、`zai-org`、`Qwen`、`mistralai`、`moonshotai`、`MiniMaxAI`、`nvidia`、`inclusionAI` 与 `ByteDance-Seed` 的 Hub 列表于 2026-09-19 读取；这个尺寸级别里没有出现别的模型。

| 模型 | 许可 | 总参数／激活 | 架构 | 上下文 | 工具调用 | 权重格式 | 来源 |
|---|---|---|---|---|---|---|---|
| Qwen3.5-122B-A10B | Apache-2.0（`LICENSE` 中为原文） | 122B／10B | MoE，48 层，256 个专家（8 路由 + 1 共享），Gated DeltaNet 线性注意力，每四层一个门控注意力，带视觉编码器与 MTP | 原生 262,144，用 YaRN 可到 1,010,000 | 原生；Qwen-Agent、Qwen Code、vLLM、SGLang | BF16 safetensors，39 个分片；官方另有 FP8 与 GPTQ-Int4 | https://huggingface.co/Qwen/Qwen3.5-122B-A10B |
| gpt-oss-120b | Apache-2.0 | 117B／5.1B | MoE，36 层，128 个专家，每 token 4 个，harmony 响应格式 | 131,072 | 原生函数调用、浏览、Python | MoE 权重为 MXFP4；注意力、路由器、嵌入与 `lm_head` 未量化 | https://huggingface.co/openai/gpt-oss-120b |
| GLM-4.5-Air | MIT | 106B／12B（Hub 报 110B） | `glm4_moe`，思考与直答双模 | 128K | 原生；transformers、vLLM、SGLang 中有工具解析器 | BF16，官方另有 FP8 | https://huggingface.co/zai-org/GLM-4.5-Air |
| Mistral-Small-4-119B-2603 | Apache-2.0 | 119B／6.5B | MoE，128 个专家，4 个激活，多模态，按请求设定推理强度 | 256K | 原生；`--tool-call-parser mistral` | safetensors；官方另有 FP8、NVFP4 与 EAGLE 头 | https://huggingface.co/mistralai/Mistral-Small-4-119B-2603 |
| Devstral-2-123B-Instruct-2512 | "Modified MIT"，合并月营收超过 2000 万美元者被排除 | 123B（Hub 报 125B） | `ministral3` | 256K | 原生 | 只有 FP8 检查点 | https://huggingface.co/mistralai/Devstral-2-123B-Instruct-2512 |
| Qwen3-Next-80B-A3B-Instruct | Apache-2.0 | 80B／3B | MoE，512 个专家，10 个激活，Gated DeltaNet 混合，MTP，无思考块 | 原生 262,144，用 YaRN 可到 1,010,000 | 原生 | BF16 | https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct |
| Qwen3-Coder-480B-A35B-Instruct | Apache-2.0 | 480B／35B | `qwen3_moe` | — | 原生 | BF16 | https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct |
| Qwen3-Coder-30B-A3B-Instruct | Apache-2.0 | 30.5B／3B | `qwen3_moe` | — | 原生 | BF16 | https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct |

已公布的编程与 agentic 结果，一律按其发布方自己的报法：

| 模型 | SWE-bench Verified | Terminal Bench 2 | LiveCodeBench v6 | 其他 | 报告方 |
|---|---|---|---|---|---|
| Qwen3.5-122B-A10B | 72.0 | 49.4 | 78.9 | CodeForces 2100、BFCL-V4 72.2、TAU2-Bench 79.5 | Qwen，模型卡，2026-09-19 |
| gpt-oss-120b | 62.4 | 18.7（Qwen 的表） | 82.7（Qwen 的表） | Qwen 的表中为 62.0 | OpenAI 模型卡，<https://arxiv.org/abs/2508.10925>，2025-08-05；Terminal Bench 2 与 LiveCodeBench 来自 Qwen 的卡 |
| GLM-4.5-Air | 所读来源中未公布 | — | — | 12 项基准平均 59.8，对 GLM-4.5 的 63.2 | z.ai 模型卡；https://arxiv.org/abs/2508.06471 的 GLM-4.5 报告给出的 64.2 属于 355B 的 GLM-4.5，不属于 Air |
| Mistral-Small-4-119B-2603 | 卡上未公布 | — | 声称在少 20% 输出下高于 gpt-oss-120b | AA-LCR 0.72，仅 1.6K 字符 | Mistral，模型卡，2026-09-19 |
| Devstral-2-123B-Instruct-2512 | 72.2 | 32.6 | — | SWE-bench Multilingual 61.3 | Mistral，模型卡，2026-09-19 |
| Qwen 3 Coder Plus（480B） | 69.6 | 25.4 | — | SWE-bench Multilingual 54.7 | Devstral 2 卡上 Mistral 的对比表，2026-09-19 |

已知的 RL 配方，均于 2026-09-19 读取：

- **Qwen3.5-122B-A10B。** verl 以 Ulysses 序列并行支持 Qwen3.5 系列并附带一个 GRPO 演示（<https://github.com/verl-project/verl/issues/6061>）；后续的 pull request 带有 `examples/grpo_trainer/run_qwen3_5_122b_a10b_megatron.sh`（<https://github.com/verl-project/verl/issues/6582>、<https://github.com/verl-project/verl/issues/6587>）。slime 带有 Qwen3.5 的模型与权重桥接插件（<https://github.com/thudm/slime/issues/1641>、<https://github.com/thudm/slime/issues/1676>），以及打包线性注意力路径中跨序列状态泄漏的修复（<https://github.com/thudm/slime/issues/1686>）。Osmosis 报告了在这一检查点上的 GRPO：LoRA 用 16×H200，全量微调用 64×H200，TP=2、EP=8，16K 上下文，LoRA 的 token 吞吐比全量微调高 44%（<https://osmosis.ai/blogs/unlocking-lora-moe-rl-for-qwen3-5>，发表于 2026-04-03）。
- **gpt-oss-120b。** 通过 Unsloth 与 TRL 做 LoRA 与 QLoRA。MXFP4 内核没有实现反向传播，因此在其他任何库里训练都要先把 MoE 权重上转为 BF16，而 BF16 LoRA 约需 210 GB 显存，QLoRA 约需 65 GB（<https://unsloth.ai/docs/models/gpt-oss-how-to-run-and-fine-tune>）。
- **GLM 一脉。** slime 就是其厂商训练它所用的框架，覆盖 GLM-4.5 到 GLM-5.3（<https://github.com/THUDM/slime>）。
- **Mistral Small 4。** 卡上指向 Axolotl 做微调。所读来源中没有出现这一尺寸上的 RLVR 配方。
- **Devstral 2 123B。** 所读来源中没有出现已公布的 RL 配方。

**推荐：Qwen3.5-122B-A10B。次选：Mistral-Small-4-119B-2603。**

决定它的两个理由。第一，它是这个尺寸级别里唯一同时做到许可宽松、以 BF16 权重发布、并且在完全相同的尺寸上已经有一条可用 RLVR 路径的模型——一个点名 122B-A10B 检查点的 verl GRPO 脚本、覆盖该架构的 slime 插件，以及第三方在 16 到 64 张 H200 上的 GRPO 运行。其余每一个都要付出让步：gpt-oss-120b 的 MXFP4 权重没有反向传播，第一步梯度之前就得上转；Devstral 2 123B 是 SWE-bench 数字唯一持平的那个，却被营收条款挡住；Mistral Small 4 许可正确，却既没公布 SWE-bench 数字，也没有 RL 配方。第二，在本 harness 真正测量的那条轴上——一个终端、一个 shell、一条测试命令和一个 validator——它已公布的 agentic 结果领先全级：Terminal Bench 2 为 49.4，对 Devstral 2 的 32.6 与 gpt-oss-120b 的 18.7，而 SWE-bench Verified 为 72.0，与 Devstral 2 持平。它原生 262,144 token 的上下文也覆盖了 bench 实际产生的 rollout，其第 5 层 cell 单个记录到多达 53,787 个输出 token。

什么会改变这个选择。一个 MIT 许可、重新出现在 106B 到 130B 级别的 GLM 模型会凭第一方 RL 工具链胜出，因为 slime 正是其厂商训练它所用的；z.ai 的中等尺寸线目前是 31B（GLM-4.7-Flash）与 321B（GLM-5.3-Flash），中间没有任何东西。若要求报告的数字是仓库规模的编辑而非终端作业，Devstral 2 123B 便与之持平，届时只剩许可把它排除。若要求纯文本检查点——Qwen3.5-122B-A10B 带有视觉编码器——选择就移到 80B 的 Qwen3-Next-80B-A3B-Instruct。若整个训练任务硬性限定在一个 8 卡节点内，就移到激活参数仅 5.1B 的 gpt-oss-120b，并接受上转。而如果法务审查把 Qwen 的 `LICENSE` 读成它所包含的 Apache 2.0 原文之外的任何东西，就移到 Mistral Small 4。

### 配方

#### 语料

只有钉有的 `dataUse/terms` 允许 `training` 的会话才可进入，这在今天意味着由开放权重模型上的路由、在列出该用途的协议下产生的会话。这里没有这样的路由，所以语料是空的，并且在开放权重叠加层落地之前一直是空的。[v1 折叠](../../../../data/proving-ground/datasets/2026-09-18-proving-ground-v1/README.md)——521 条 trajectory，367 条奖励为 `1`，48 条为 `0`，106 条未测量——演练的是记录格式、凭据扫描、排除规则与奖励基准，它不是训练数据；[`build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) 则是真正的折叠将原样复用的工具。

#### SFT 预热

一条 `dsh-trajectory/1` 记录就是一条训练序列。它的字段按下面映射，其定义由 [`dsh-trajectories`](../../../../packages/improvement/trajectories/README.md) 拥有：

- `system` 原样成为 system 消息，`tools` 成为工具 schema，两者都渲染到目标模型自己的 chat 模板所安放的位置。二者都不重写：预热必须教会 RLVR rollout 将会看到的那套工具界面。
- `messages` 按它所持的顺序成为对话序列，`user` 与 `tool` 角色作上下文，`assistant` 作目标。损失只覆盖 assistant 的内容块与 `toolCalls[].arguments`，别无其他。
- 推理块保留在被预测的这一轮上，并从历史中丢弃，这正是 Qwen3.5 自己的 chat 模板对思考内容所做的。
- `environment` 是切分键：它携带 `heldOut`、提示词、fixture 与 checks 的哈希、重复序号与分组，因此去重与留出扣留都由印记而非文本决定。
- `reward.outcome` 是行过滤器。只有 `1` 进入预热，而导出器的 `rewardedOnly: true` 已经产出这一点。
- `config`、`steps` 与 `provenance` 不参与训练。`provenance` 把预热钉在一份组合上，使其工具 schema 与 rollout 的一致。

尝试与指令不需要任何特殊处理。route 实现的运行保留自己的对话记录，于是一个 cell 的每次尝试都在同一个会话、同一条记录里，而 validator 的 `<validation_failed>` 块本来就是 `messages` 中一条普通的 user 消息。因此预热把整段恢复——失败的编辑、指令、修复、停止——作为一条序列来训练，而这正是 harness 存在所要产生的行为。不要把各次尝试拆成独立样本：没有上方的工作，一条指令什么都不是。

失败的尝试不作为负例留在预热里。结果为 `0` 的 trajectory 被整条排除，留给 RLVR 阶段，在那里它是自己那一组的负例一半。经认证 trajectory *内部*被否决的尝试仍留在序列里并被训练；把它们掩蔽的消融实验是下面的一条验收标准，而不是一个已定的选择。

#### RLVR 阶段

一次 rollout 就是一个 cell：在一个全新工作区上对一个环境的一次 `ctx.environmentRuns.run()` 调用，环境的 fixture 已叠加、目标已创建、完成标准已在任何工作开始之前依据环境自己的 checks 编写好（[`dsh-environment-runner`](../../../../packages/improvement/environment-runner/README.md)）。

奖励是证书，别无其他。当证书覆盖当前标准修订时 `reward.outcome` 为 `1`，有标准而无证书时为 `0`。最后一条 `verification/run` 带 `verdict: 'tampered'` 的运行记 `0` 并留在组里：改动 validator 的文件是一种要惩罚的行为，不是一次要丢弃的测量，这正是 RLVR 奖励有意偏离语料构建器无条件排除篡改行的地方。

一致性——validator 隐藏用例上的加权通过比例——**不**进入损失，任何形式都不进，包括塑形。`dsh-trajectories` 说明了原因：通过率会奖励一个只过拟合它被展示的失败用例、放弃其余的候选。一致性只在损失之外使用，用于两件事：当一组没有方差时决定优先重采哪些环境，以及把跨 epoch 一致性一直平在零的环境退役到过难池。两者都记录在案；两者都不到达梯度。

算法是 GRPO，采用组内相对优势、无价值网络、clip-higher，且不含对参考策略的 KL 项——预热就是参考，把策略拉在它附近恰好封住这个阶段所要争取的增益。奖励方差为零的组被丢弃而非塑形，于是一个饱和环境只花掉它的 rollout 而不产生梯度。组大小为 8：一个环境，八个 cell，种子从 `base + 0` 到 `base + 7`，这正是 fleet 计划上 `repetitions: 8` 已经产出的，因为每个 cell 以 `seed + repetition` 运行（[`dsh-fleet`](../../../../packages/improvement/fleet/README.md)）。rollout 上下文上限为 131,072 个 token；单 cell 开销沿用[bench 组合](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/cordis.yml)已设的上限 `maxTotalTokens: 1500000` 与 `maxWallMs: 1200000`（[`dsh-budget-policy`](../../../../packages/guard/budget-policy/README.md)）。尝试次数保持组合的 `maxAttempts: 3`，好让一次 rollout 测量的与一个 bench cell 测量的是同一件事。

#### 报告什么

八个留出环境上的证书率，别无其他：`code:glob-brace`、`code:ini-parse`、`code:kv-log-store`、`code:lru-ttl-cache`、`code:retry-policy`、`code:semver-ranges`、`code:topo-sort`、`code:wrap-justify`。它们在每一处要紧的地方都已被扣留——runner 打上 `heldOut` 印记，导出器默认扣留这类会话，observatory 也扣留它们——而已签入的 `held-out-sonnet-all` 计划正是以 `repetitions: 2` 运行它们（[计划](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/plans/README.md)）。八个环境两次重复是十六个 cell，因此一次翻转值 6.25 个点：这个切分是流水线的冒烟测试，不是可以对外公布的数字。扩大留出集是报告的前提，不是后续事项。

#### 一个 epoch 的算力

假设全部写出，好让每一条都可核对：40 个已注册环境中 32 个可训练，8 个留出；组大小 8；一个 epoch 是一遍，因此 256 次 rollout。每次 rollout 的生成 token 取自[记录](../../../../data/proving-ground/README.md)下已记录的 fleet 排行榜——第 4 层每 cell 11,911，第 2 层 13,242，第 3 层 18,852，第 5 层 53,787，留出扫描为 22,704——给出每次 rollout 两万到五万五千。每次 rollout 的序列长度，提示与补全合计，为三万到十万 token，由 v1 manifest 的 178,531,239 个提示 token 除以 6,966 次模型调用、约每次 25,600 推得。激活参数为 10B。前向成本按 `2 × A × tokens`，一次训练步按 `6 × A × tokens`。

- 每 epoch 生成：510 万到 1410 万 token。每 epoch 序列 token：770 万到 2560 万。
- 生成（含预填充）：0.26 到 0.79 EFLOP。策略更新：0.46 到 1.5 EFLOP。合计**每 epoch 0.7 到 2.3 EFLOP**，即 1 到 4 个 H200 小时的算术。
- 决定墙钟的是 rollout 时延，不是算术。按 NVIDIA 为这一检查点在 agentic 轨迹（输入中位 64K、输出中位 400、KV 缓存命中率 90%）上实测的每卡每秒 720.3 个输出 token（H200、FP8、TP2 带 MTP；<https://github.com/ai-dynamo/dynamo/blob/5593e8857c508bebce7259e107a85c57cd142fd8/docs/fern/pages/recipes/model-recipes/qwen3-5-122b.mdx>，2026-09-19 读取），一个 8×H200 节点解码一个 epoch 的 token 需 0.25 到 0.7 小时。checks 执行再加上 256 个 cell、每个数十秒——一个第 5 层 cell 要一次一个进程地跑多达 170 个 validator 用例（[`code:uri-resolve`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/environments/uri-resolve/task.json)）——在 fleet 已支持的并发下是 0.2 到 0.9 小时。
- **一个 epoch：1 到 4 小时**，在 Osmosis 的配置上，即 LoRA 用 16×H200、全量微调用 64×H200。按每个 epoch 一次策略更新算，50 到 150 次更新的一轮运行是 50 到 600 小时——两天到三周半——而算术从来不是约束。

约束是提示集。32 个环境乘组大小 8 是每 epoch 256 次 rollout，比已公布的 RLVR 运行低一到两个数量级，而 bench 在第 5 层以下被迄今测量过的每个模型饱和。这个配方接下来需要的是更多环境，不是更多 GPU。

#### 今天 harness 如何提供 rollout

不需要一行新代码：`pnpm run bench -- fleet <plan>` 通过 [bench 包装器](../../../../scripts/proving-ground.ts)运行一份已签入的计划；`ctx.fleet.run(plan)` 枚举环境 × 模型 × 重复的 cell，每个在自己全新的工作区里，最多 `maxConcurrent` 个在飞，带每路由熔断器与 token 上限，并按路由与环境返回排行榜行；`ctx.environmentRuns.run()` 就是那次 rollout，而证书已在会话日志里；`policyVersion` 是原样写入每一条印记的自由文本，正是检查点身份的去处，好让折叠按检查点索引奖励；而运行目录中导出的 trajectory 就是训练器读取的 `dsh-trajectory/1` 行。[`dsh-experiments`](../../../../packages/improvement/experiments/README.md) 提供冻结配对比较，用于把一个检查点与它的前身对比测量。

#### 最小的代码新增，逐一点名

1. **让 bench 的导出走 curator。** [fleet-driver.ts](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/fleet-driver.ts) 与 [experiment-driver.ts](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/experiment-driver.ts) 调用的是 `ctx.trajectories.export()`，那个不做脱敏、不读条款的导出器。训练语料需要改为 `ctx.curator.export({ purpose: 'training', … })`，正如 [curator 的 e2e 驱动](../../../../examples/headless-agent/tests/fixtures/curator/driver.ts)已经在调用的那样。没有这一步，条款门在语料真正的来源路径上什么都约束不了。
2. **一个开放权重路由叠加层与一份 `training` 协议。** 一份 `cordis.yml` 叠加层，把 `llm-claude-code` 换成 [`dsh-llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md) 或通过 [`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) 的自托管 OpenAI 兼容路由，外加一个点名允许 `training` 之协议的 `data-use` 块。属于配置，但它并不存在：七份已签入的叠加层没有一份替换路由。
3. **trajectory 记录上的 `stopReason`。** `dsh-trajectories` 自己点名了这个缺口：被预算、中止或提供方错误结束的会话导出结果为 `0`，而训练器无法把它与真正的失败区分开。没有这个字段，每一次被预算结束的 rollout 都是负例，策略便学会提早收工。
4. **on-policy 捕获。** 记录按设计不携带 token id，也不携带 logprob。把它们放进 harness 前方训练器自己的推理代理里，而不是放进会话事件——harness 从不看见 token id，而 RL 框架本来就期望 rollout 来自它自己的采样器。
5. **导出中的按环境分组统计**——best-of-N 选取与按环境的奖励均值与方差，`dsh-trajectories` 把它列为待办。可选：印记携带环境、重复序号与分组，训练器可以离线折叠出来。

## Alternatives considered

**以 gpt-oss-120b 为基座。** 它 5.1B 的激活参数是同级中最便宜的 rollout，Apache-2.0 许可也干净。基于两点否决：MXFP4 没有反向传播，于是每一种训练配置都从把 MoE 权重上转开始，把当初促成这个选择的显存优势又还了回去；而它 18.7 的 Terminal Bench 2 分数是同级中最弱的 agentic 结果，恰在本 harness 最直接测量的那条轴上。

**以 Devstral-2-123B 为基座。** 开放权重候选中最好的 SWE-bench Verified 数字 72.2，而且是为 agentic 编程而建。基于许可否决：它的 "Modified MIT" 禁止任何合并月营收超过 2000 万美元的公司行使其权利，这是一道商业闸门而非开放权重许可，并且适用于派生物。只有 FP8 检查点是第二个、也较小的反对意见。

**以 GLM-4.5-Air 为基座。** MIT，106B／12B，而 slime 是其厂商自己的 RL 框架，这是表中最强的工具链叙事。基于年份与继承否决：它出自 2025 年 8 月，其厂商自己的中等尺寸线已移到 31B 与 321B 而在它的尺寸上空无一物，并且它公布的 agentic 数字是十二项基准的平均，而非其他候选公布的任务级结果。

**等下一个模型而不是现在决定。** 否决：这个决定阻塞配方，配方阻塞叠加层的工作，而配方大体上与基座模型无关。在下一个 GLM Air 级发布时重议，比让目标悬而未决便宜。

**把一致性用作奖励塑形。** 在奖励中加上 `λ · parity` 会在全零组本来没有梯度的地方给出梯度，而隐藏用例坐在读屏障之后，模型读不到它们。仍然否决：可见的测试套件就在工作区里，通过比例会奖励对它的特判，而 `dsh-trajectories` 已经陈述了 harness 承诺遵守的规则。丢弃零方差组会花掉 rollout，却让奖励保持诚实。

**把每次尝试拆成自己的 SFT 样本。** 这会让语料倍增并缩短序列。否决：一条 `<validation_failed>` 指令只有对照挣来它的那段工作才可解读，于是拆分出的样本教会模型回答一条它毫无上下文的指令。

**报告全部 40 个环境的证书率。** 更简单，统计功效也更高。否决：策略训练过的环境不是关于该策略的证据，而扣留机制的存在恰恰是为了把这两个数字分开。

## Acceptance criteria

- 推荐基座模型的 `LICENSE` 文件是 Apache License 2.0 原文，在下载任何权重之前以逐字节比对核对。
- `data/proving-ground/` 下记录了一次开放权重路由上的 bench 运行，其会话携带列出 `training` 的 `dataUse/terms`，且其导出 manifest 对一次 `purpose: 'training'` 的导出报告 `withheldByTerms: 0`。
- 两个 bench 驱动都调用 `ctx.curator.export`，此后记录的一次运行在每一条导出行上都带有 `redactionApplied: true` 的 `curation` 块。
- SFT 语料构建器只写入 `reward.outcome` 为 `1` 的行，且带 `--check` 的重建复现 manifest 的摘要与计数。
- 以一份 fleet 计划在 `repetitions: 8` 下驱动的一批 rollout，为每个环境产出八个 cell，种子从 `base + 0` 到 `base + 7`，每个都打上该检查点的 `policyVersion`。
- 报告的数字只由 `held-out-sonnet-all` 计划产出，且训练语料的任何文件中都不出现任何留出环境 id。
- 掩蔽尝试的消融实验被跑过：在留出集上，以冻结配对比较一个掩蔽经认证 trajectory 内被否决尝试的预热与一个训练它们的预热。
- `stopReason` 是 `dsh-trajectory/1` 的一个字段，且被预算突破结束的 rollout 被掩蔽而非记 `0`。

## Risks

- **语料一直是空的。** 基座模型决定之下的每一步都在等一个开放权重路由的密钥。在有密钥之前，这份配方不可证伪。
- **32 个环境的提示集太小。** 组大小 8 乘 32 个环境是每 epoch 256 次 rollout，而 bench 在第 5 层以下已饱和。策略可能在留出集有任何变化之前就把这个集合背下来。
- **八个留出环境撑不起一个结论。** 十六个 cell 下一次翻转值 6.25 个点。在它扩大之前从这个切分报出的任何数字都会被过度解读。
- **证书是一个粗粒度奖励。** 长程 agentic rollout 上的二值终端奖励给出的跨尝试信用分配很弱，而丢弃零方差组会舍去一个饱和 bench 的大部分。
- **脱敏会损坏训练文本。** `dsh-curator` 重写其枚举例外之外的每一个字符串，而它的 IPv4 规则会重写形如点分四段的版本串；为客户对话记录调校的 profile 可能让一条记录无法用于训练。一次训练导出需要把它的规则命中对照环境自身的文本审计一遍。
- **厂商的基准数字是厂商的数字。** 上表中每一个编程与 agentic 结果都是自报的，或引自竞争对手的表格，脚手架未披露。它们用来给候选排序；它们不是本 harness 的测量，而 bench 是唯一为本 harness 作答的仪器。
- **已公布的 RL 配方面向的是另一种工作负载。** verl 与 slime 的 Qwen3.5 路径以及 Osmosis 的吞吐数字都是数学与短上下文运行；一次带工具调用的 10 万 token agentic rollout 是更重也更少被测试的工况，而 slime 自己对打包线性注意力的修复正展示了那种工况会找出的一类 bug。

# Daliesk

[English](README.md) | 中文

Daliesk 是一个试点性质的 AI 智能体组织：它通过工单队列修改代码库，每项改动在发布前都由一位独立评审者批准，每一步都记录在本仓库中。[指挥台](https://lbjlincoln.github.io/deepseek-harness/) · [简报](https://lbjlincoln.github.io/deepseek-harness/briefing/) · [执行摘要](docs/client/daliesk-executive-summary.md) · [数据处理](docs/client/data-handling.md)

**来源。** 本仓库 [LBJLincoln/deepseek-harness](https://github.com/LBJLincoln/deepseek-harness) 是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的分叉；后者是 DeepSeek AI 开发的开源 agent harness。GitHub 账户 LBJLincoln 在该 harness 之上运营 Daliesk：企业、指挥台、Proving Ground 与代码安全审查都是在这个分叉的 `claude/coding-agent-harness-u9l4gt` 分支上写成的，DeepSeek AI 既未构建、未审查，也未认可它们。harness 保留它自己的名称、`@deepseek-ai/dsh-*` 包及其 [MIT 许可证](LICENSE)。

## 记录显示了什么

这里的每个数字都读自 2026-09-29 07:07 UTC 盖戳的 [`data/enterprise/roster.json`](data/enterprise/roster.json)，以及它所计入的 [`ledger.jsonl`](data/enterprise/ledger.jsonl) 的 141 行，即 [`enterprise.json`](apps/command-deck/public/fixtures/enterprise.json) 所发布的内容；窗口是该时间戳之前的 24 小时。指挥台显示当前数字及其时长，[花名册的 README](data/enterprise/README.md#occupancy) 陈述计数规则。

| 窗口内交付 | 数量 |
| --- | --- |
| 作为经评审的提交发布到分支上的工单 | 3 |
| 由模型处理过但未发布任何内容的工单 | 3 |
| 在任何模型运行之前就停止的工单（某次 shift 无法准备它的 worktree） | 4 |
| 通过的代码安全审查席位：对本仓库的一次审查中的六个部门与负责人 | 7 / 7 |
| 通过的 intake 协调员，每位把请求转成排队的工单 | 2 / 2 |
| 通过的自动检查：`verify-*` 关卡、Branch CI 裁决、会话折叠 | 105 / 114 |

| 席位 | 数量 | 规则 |
| --- | --- | --- |
| 已定义 | 147 | 本仓库定义的一个角色；定义并不是一个正在运行的 agent |
| 已占据（有证据） | 53：27 个模型驱动，22 个自动检查，4 个仅在任何模型运行之前就停止 | 某条已记录的会话或台账行指名该席位 |
| 窗口内活跃 | 44：18 个模型驱动，22 个自动检查，4 个在任何模型运行之前就停止 | 这些交付物之一的日期落在窗口内 |

**运行了哪些模型。** 企业的每条工单行记录的都是 `Claude Code sonnet` 或根本没有模型，每次 intake 与代码安全审查都运行在 Claude Code 上。在 `data/proving-ground` 与 `data/code-safety` 下记录的 1,912 个会话中，1,283 个运行在 Claude Code 上，29 个在 Proving Ground 的第 2 层经 OpenRouter 运行免费的开放权重模型（DeepSeek V4 Flash、Nex N2.5 Pro、Nemotron 3 Super、Laguna S 2.1 与 Qwen 3.8），600 个没有发出模型请求。花名册为 DeepSeek API 路由定义了 74 个席位、为 Codex 定义了 25 个；没有任何已记录的会话在这两者上运行过。

## DeepSeek Harness

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从这个分叉的检出运行（它带有下文的 Proving Ground、代码安全与企业命令；仅上游 harness 位于 `https://github.com/deepseek-ai/deepseek-harness.git`）：

```sh
git clone --branch claude/coding-agent-harness-u9l4gt https://github.com/LBJLincoln/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Proving Ground

harness 在 Proving Ground 上度量自身：这是一个横跨六个领域、由 44 个环境组成的 bench —— 四十个单文件程序，外加一个由四个多文件仓库任务构成的试点层 —— 其最难的两档由 implementer 从未见过的隐藏用例验证，并以带 bootstrap 区间的冻结配对实验运行。[data/proving-ground/dashboard.html](data/proving-ground/dashboard.html) 是由每一条已记录运行折叠而成的那一个页面：每组配对比较的判定及其区间、密封层级上的各模型、认证矩阵、时间线，以及训练语料折叠。[结果笔记](.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md)陈述这些运行证明了什么、驳倒了什么，而 [data/proving-ground/improvement-log.md](data/proving-ground/improvement-log.md) 是这个循环本身的台账：每次改进迭代一行，从被提出的改动到裁决为它挣得的决定。这个 bench 在一个 Claude Code 登录上运行 Claude Haiku、Sonnet 与 Opus，并经 `with-openrouter` 叠加层仅在第 2 层运行免费的开放权重模型。记录所显示的内容，即 2026-09-29 仪表板从 67 份记录折叠出的结果：

- **能力。** 汇总运行过它的每个模型与循环，密封的第 5 层认证了 733 个 cell 中的 624 个，即 85.1 %，95 % Wilson 区间为 82.4 % 至 87.5 %；密封的第 6 层认证了 64 个中的 41 个，区间为 51.8 % 至 74.7 %。district 的 cell（它们认证的是一个由简单任务组成的 village）以及没有层级的测试集都不计入任何层级。
- **配对判定。** 在 23 组冻结配对实验中，有 4 组是决定性的，全部在第 5 层：Haiku 认证的 cell 少于 Sonnet（16 个中 1 对 14），Opus 多于 Sonnet（16 个中 16 对 13），一次尝试少于三次（16 个中 9 对 15），五次尝试多于三次（16 个中 14 对 12），而[改进日志](data/proving-ground/improvement-log.md)把最后这一判定视为统计量造成的假象而搁置。其余 19 组不是决定性的：它们的区间包含零。
- **harness 对产品。** 在 4 组冻结配对上，Claude Code 自身的循环对 harness 循环，二者都在 Sonnet 上：90 个 cell 中，harness 循环认证 85 个，Claude Code 认证 83 个，没有决定性判定。没有证据表明 harness 比它所包装的产品认证更多任务。
- **改进循环。** `pnpm run bench -- loop` 在 2026-09-19 至 2026-09-28 之间无人值守地运行了 16 次迭代：6 组冻结配对，其中 1 组是决定性的，以及 10 次单臂运行，其中 9 次是未作改动的夜间基线。它所测试的改动没有一项被采纳。

![Proving Ground 仪表板：按层级的认证率及其 Wilson 区间、配对比较所显示的内容，以及每个配对判定及其区间](data/proving-ground/dashboard.png)

执行 `pnpm run build` 之后，可以列出已签入的计划、从中运行一组冻结配对实验，或在你自己的 Claude Code 登录上、无需 API key 地通过 harness 运行一个任务：

```sh
pnpm run bench -- plans
pnpm run bench -- experiment e3-attempts-t5
pnpm dsh --profile claude-code "Create hello.txt containing the single line hello."
```

## 代码安全

同一套程序工作流也能审查一个应用的源码以查找安全缺陷：六个部门并行读取目标，各在自己的 worktree 和会话里，运行静态扫描器与依赖审计，写出带文件、行号和该行原文的发现；一个集成部门把它们合并成以法文执行摘要开头的报告，而一个已提交的审查器会拒绝任何所引行号不成立的发现。审查器放行的发现是**行级验证**的：被引用的文本确实在所引用文件的所引用行上，但这并不表明该发现是真实的或可利用的缺陷。召回率在一条发现引用某个已记载问题的文件且落在该问题三行之内时，才把该问题算作找到。对 OWASP NodeGoat（一个有意设计为含漏洞的训练应用，有 18 个已记载问题）的十二次审查每次都让所有部门认证：不含诊断修正清单的十次找到了 18 个中的 13 到 15 个（均值 14.0），并在 1,225 到 1,636 s 内发布了 38 到 57 条行级验证的发现；含这些清单的两次找到了 18 之 18，这是一个样本内读数，因为这些清单是根据该目标的漏检写成的，它们分别在 1,730 s 和 1,559 s 内发布了 70 条和 49 条发现。对 dvja（一个 Java Struts 2 训练应用）的一次审查找到了它 14 个已记载问题中的 13 个。相隔三小时的两次 NodeGoat 审查中，第一次运行的 42 条发现里有 38 条在第二次运行中有一条落在同一文件三行之内的发现，其中 31 条的 CWE 相同。在本仓库自身代码的一份预埋副本上，审查在三行之内捕获了 8 个预埋缺陷中的 6 个，95% 区间 [0.409, 0.929]；其分诊认定另外 4 条发现都是误报，并找到了一个审查漏掉的缺陷（[记录](data/code-safety/README.md)）。[指挥台](apps/command-deck/README.md)展示 147 个席位定义及其已记录交付物所显示的内容、流程，以及落在目标代码上的发现，数据来自实时的 [feed](data/enterprise/README.md) 或回放的夹具；[演示手册](docs/code-safety-poc.md)是演示脚本，[数据处理](docs/client/data-handling.md)说明被审查的代码库及其记录去往何处：在操作者的 Claude Code 登录下发往 Anthropic 的模型 API，并在审查被记录时进入本公开仓库。

```sh
pnpm run code-safety -- /path/to/target --model sonnet   # a review on your Claude Code login
pnpm run poc                                             # the feed on :4711 and the production deck on :3000
```

## 社区与支持

以下是上游 DeepSeek Harness 项目的渠道，面向 harness 本身；Daliesk、企业、指挥台以及本分叉中的记录在[本分叉的仓库](https://github.com/LBJLincoln/deepseek-harness)中讨论。

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

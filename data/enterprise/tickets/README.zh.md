# 企业工单队列

[English](README.md) | 中文

本目录是企业的工作队列：每张工单（ticket）一个 JSON 文件，从 `T-0001.json` 起编号，每张都是对某个花名册席位所拥有的一项交付物的一处小而可验证的改动。受理方（intake）依据仓库树中已有的证据撰写工单；各席位在各自的 worktree 中通过 harness 的 program 工作流处理工单；工单的验收命令、范围检查和一位独立评审人共同决定结果能否合并。席位来自[企业花名册](../README.md)。

## 谁写工单，谁做工单

- **受理方**撰写工单。每张工单都始于仓库树里已经写明待办的事项，优先级依次为：包 README 的 `Known Limitations and Deferred Work` 条目、包 `src/` 中的 `FIXME`/`TODO`/`XXX` 标记、点名该包的 proposed 状态 Agent Note、一个失败或被跳过的测试、一份所陈述事实已与其描述的代码或路径不符的 skill 或 Agent Note，或一个因与其检查内容无关的原因而失败的门禁。受理方在写下候选事项之前先阅读其背后的代码，并舍弃任何一位实现者无法在大约三十分钟专注工作内完成、或没有任何命令能够验证的事项。
- **协调人受理**在队列见底时与手写受理并行撰写工单：`pnpm run enterprise:intake` 请 Program Departments 协调人为各自的包族提出工单，只提交准入接受的拟议工单；准入要求工单自有的每项检查在 tip 的干净检出上都失败、其席位的 `source` 覆盖其 scope，且没有任何开放或已发布的工单带有相同的 source 路径与锚点。被接纳的工单按准入顺序取下一批编号。[enterprise-intake fixture](../../../examples/headless-agent/tests/fixtures/enterprise-intake/README.md) 说明这些规则以及每次运行留下的记录。
- **席位**处理工单。`seat` 指明其 `source` 覆盖该交付物的花名册席位；实现者在自己的 worktree 中处理工单，只改动 `scope` 之下的路径，一旦发现工单比写明的更大，就停下并提交报告，而不是扩大改动。
- **引擎**负责验证与合并。它在 worktree 根目录运行每条 `acceptance` 命令，检查 diff 是否留在 `scope` 之内，把结果交给一位独立评审人，并合并评审人批准的内容。

## 队列中的事业部

| 事业部 | 持有工单的席位 | 工单的来源 |
|---|---|---|
| `harness-core` | 包管家 | 受管包 README 的限制条目、`src/` 标记、proposed 状态的 Agent Note，以及失败或被跳过的测试 |
| `knowledge` | skill 维护者 | `SKILL.md` 中某条已与其描述的脚本、清单、hook 或测试不符的陈述 |
| `governance` | 标准作者 | 仓库树已不再满足其规则的门禁、清单或政策文档，或一个因与其检查内容无关的原因而失败的门禁 |
| `curation-data` | Agent Note 策展人 | 路径或名称已不存在于仓库树中的 implemented 状态 Agent Note，[Agent Note README](../../../.agents/notes/README.md) 要求这类记录保持与现状一致 |
| `program-departments` | 子系统协调人 | 错误描述其包族的分组 README、仓库树已经解决的包 README 限制条目，或所述触发条件已经发生的 `src/` 标记 |

Proving Ground 与 Code Safety 在其交付物验证无误期间不持有工单：bench 的 `admit.mjs` 准入了每个精选环境，代码安全知识包与挂载它们的 fixture 一致，因此受理方记录这一结论，而不是凭空造出工作。

引擎按 `priority` 领取开放工单，因此受理方分配优先级时让相邻班次在事业部之间轮换：每个事业部的第一张工单为 `1`，第二张为 `2`，其余为 `3`。优先级 `0` 属于答复所有者[请求](../requests/README.md)的工单，引擎因此把它排在每一张未尝试过的工单之前；校验器拒绝任何其他工单取这一优先级。

## 工单文件

```json
{
  "id": "T-0001",
  "title": "...",
  "division": "harness-core",
  "seat": "<roster seat id>",
  "kind": "fix|test|docs|feature|chore",
  "source": { "path": "<repository path the ticket comes from>", "anchor": "<section heading, TODO text, or note heading>" },
  "task": "<the full instruction for the implementer>",
  "scope": ["<path prefixes the change may touch>"],
  "acceptance": [{ "id": "<check id>", "run": "<shell command run at the worktree root; exit 0 = pass>" }],
  "budget": { "maxTotalTokens": 8000000, "maxWallMs": 2700000 },
  "priority": 1
}
```

| 字段 | 规则 |
|---|---|
| `id` | `T-` 加四位数字；与文件名一致；队列从 `T-0001` 起连续编号，不留空号。 |
| `title` | 一行文字，点明这处改动。 |
| `division`、`seat` | 来自 `roster.json` 的事业部 id 与席位 id；该席位必须属于该事业部。 |
| `kind` | `fix`、`test`、`docs`、`feature`、`chore` 之一。 |
| `source` | `path` 存在于仓库树中，且其内容逐字包含 `anchor`。 |
| `task` | 问题及其以 `path:line` 形式给出的证据、要求达到的行为、约束它的仓库规则，以及不得触碰的内容。 |
| `scope` | 非空；每个前缀都存在；评审人拒绝任何越出范围的 diff。 |
| `acceptance` | 非空；检查 id 在工单内唯一；始终包含该包的逐文件覆盖率运行和 `pnpm run typecheck`，工单涉及文档时再加 `pnpm run doc-sync`。 |
| `budget` | 正整数：一次尝试的 token 上限与墙钟时间上限。 |
| `priority` | `1`（最先）到 `3`（最后）；当 `source.path` 是 `data/enterprise/requests/` 下的某个请求时取 `0`。 |

解析器只接受这些字段；带有任何其他字段的工单都无效。

## 有意义的验收

在未改动的仓库树上就能通过的验收命令什么也证明不了，因此只要改动允许，工单的检查都写成改动之前必然失败的形式：包管家必须新增的具名 spec 文件（`test -f <spec> && pnpm exec vitest run <spec>`）、断言某条已写明的契约现已存在的 `grep`，或断言某个被移除的符号已不复存在的 `grep`。覆盖率运行和 typecheck 在改动前后都会通过，它们守护的是包，而不是这张工单。凡是每条检查在未改动时都能通过的工单，其任务文本都要说明为什么评审才是真正的门禁。

覆盖率检查要点名拥有该包 `src` 的测试：它自己的 `tests/` 目录（写成带末尾斜杠的形式，因为裸路径前缀也会选中同级包），加上能到达其自身测试触及不到的代码行的同级或消费方 spec，这样逐文件 100% 阈值在正确的仓库树上才成立。手写受理在提交工单前先运行这组命令加以证明；协调人受理不运行它，因此点错集合的协调人工单会在引擎的验证中失败。交付物位于 `packages/` 之外的工单（skill、Agent Note、仓库脚本）点名消费该类交付物的最近的包的覆盖率运行——skill 目录对应 `dsh-skill-filesystem`，启动组合对应 `dsh-app-boot`——并在其任务文本中说明；该运行守护的是那个包而非工单，工单自己的检查才是改动前必然失败的那些。验收命令假定 CI 主机：Linux、非 root 用户、已安装的工作区；需要主机无法表达之条件的测试在那里自行跳过，正如 [docs/testing.md](../../../docs/testing.md) 所规定。

## 状态来自台账

工单文件从不记录进度。引擎把工单上发生的事（部门的结果、它的检查、评审结论、整合、发运的提交）追加到 `data/enterprise/ledger.jsonl`，每班次每工单一行 JSON 并写明工单 `id`，工单的状态由其最近一条台账记录推导而来；没有任何记录的工单即为开放状态。记录行的格式归引擎所有，见[台账一节](../README.md#the-ledger-and-the-shifts)；队列只规定一条：状态从台账读取，绝不写进工单。工单在有了第一条台账记录之后再被编辑，改变的是工作内容而非状态，因此需要重新评审。

## 来源存在，工单才成立

`source.path` 必须存在于仓库树中且包含 `source.anchor`，这样工单就不可能比它所出自的限制、标记或 Agent Note 活得更久：来源一旦被解决或删除，工单就通过台账关闭或直接删除，绝不留下悬空的指向。[`scripts/enterprise-tickets.spec.ts`](../../../scripts/enterprise-tickets.spec.ts) 对每张已提交的工单强制检查 schema、席位及其事业部、来源路径与锚点、非空的范围与验收，以及必备的覆盖率与 typecheck 检查；`pnpm run test` 会连同仓库其他脚本 spec 一起运行它，`pnpm exec vitest run scripts/enterprise-tickets.spec.ts` 则单独运行它。

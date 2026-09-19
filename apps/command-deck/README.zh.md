# @deepseek-ai/dsh-command-deck

[English](README.md) | 中文

Command Deck 是 Daliesk agent（智能体）企业面向客户的前端：147 个已定义 agent、它们之间的工作流、harness 运行的实时活动，以及落在目标仓库代码上的代码安全审查。

它是一个 Next.js 14 应用（App Router、React 18），三个场景通过 `@react-three/fiber` 使用 three.js。它读取一个 HTTP feed；当该 feed 没有响应时，会回放随其一同提交的 fixture，因此在没有服务端、没有 API key 的情况下，deck 依然完全可用、可演示。

## 运行

第一条命令在仓库根目录执行，第二条等同于 `pnpm --dir apps/command-deck dev`。

```sh
pnpm install
pnpm run deck
```

deck 在 `http://localhost:3000` 提供服务。用 `NEXT_PUBLIC_FEED_URL` 指向实时 feed；默认值是 `http://localhost:4711`。

第二行是生产构建及其服务端，第三行重新生成 `fixtures/`。

```sh
NEXT_PUBLIC_FEED_URL=http://localhost:4711 pnpm run deck
pnpm --dir apps/command-deck build && pnpm --dir apps/command-deck start
pnpm --dir apps/command-deck fixtures
```

## 三个视图

| 按键 | 视图 | 展示内容 |
| --- | --- | --- |
| `1` | **企业**（`/`） | 每个已定义 agent 是一个节点，按 division（部门群）聚类，边表示它们之间的委派、验证与裁决。agent 正在行动时节点会脉动；签发证书处会迸发一个圆环。点击节点可打开其角色、模型 route（路由）、preset（预设）、skill（技能）、工具、源文件，以及它在当前跟随运行中的事件。 |
| `2` | **流程**（`/process`） | program（项目）流水线——departments（部门）、Verification（验证）、Judging（裁决）、Integration（集成）——每条已记录事件作为彗星从所在阶段飞向下一阶段。时间轴拖动条可从任意位置回放该次运行；`Head` 返回实时位置。 |
| `3` | **代码安全**（`/safety`） | 被审查仓库呈现为代码城市：目录是街区，文件是按大小缩放、按语言着色的方块，每条 finding（发现）都是立在承载它那行代码上的标记。面板包含带严重级别、department 与 CWE 筛选的 finding 表格、带计数与未验证清单的证书、双语报告、下载，以及启动新一次审查的表单。 |

`Esc` 清除选择。`prefers-reduced-motion: reduce` 会关闭自动环绕、脉动与色差，并把 bloom（泛光）固定在恒定强度。

![企业视图：147 个 agent 分布在十个 division 聚类中](docs/enterprise.png)

![流程视图：departments、验证、裁决与集成](docs/process.png)

![代码安全视图：代码城市中落在各自文件上的 finding](docs/safety.png)

## feed 契约

deck 读取 `NEXT_PUBLIC_FEED_URL`（默认 `http://localhost:4711`），并期望以下路径。feed 服务端本身不在此包内。

| 路径 | 响应 |
| --- | --- |
| `GET /roster` | `{ generatedAt, counts: { defined, active }, divisions[], agents[], edges[] }`——147 个 agent、它们的 division 与相互关系。 |
| `GET /runs` | 每个 `program`、`fleet`、`experiment` 与 `code-safety` 运行的 `[{ id, kind, name, startedAt, endedAt?, status, path }]`。 |
| `GET /runs/:id/events` | Server-Sent Events。每个 `data:` 帧是一条 `{ ts, seq, agentId, sessionId, kind, label, detail?, severity?, file?, line? }`。该流先回放历史，然后保持打开。 |
| `GET /safety/:id` | 一次代码安全审查的 `{ target, departments, findings, certificate, report }`。 |
| `POST /safety` | `{ target, model? }` 启动一次审查并返回 `{ id }`；随后 deck 会实时跟随该次运行。 |

每个字段都在 [`lib/contract.ts`](lib/contract.ts) 中定型，那是该契约被写下的唯一位置。客户端按 `seq` 去重，因此重连后重放的历史不会被投递两次。

有两条 deck 侧规则值得了解，因为 feed 并不携带它们。finding 的归属 department 通过 [`lib/departments.ts`](lib/departments.ts) 中的表由其 CWE 推导，因为 feed 只报告各 department 的总数，而不在 finding 上标注 department。除非证书的 `unverified` 清单点名，否则 finding 记为已验证。

## 回放：没有 feed 时会发生什么

加载时，deck 向所配置的 feed 发送一次 `GET /roster`，超时 1.5 秒。任何失败——连接被拒、超时、非 2xx、被拦截的跨源请求——都会选择回放模式，此后所有读取都走 deck 自己在 `/api/fixtures` 下的路由，它们以相同的载荷提供相同的路径。顶栏徽标显示 `REPLAY` 而非 `LIVE`，状态栏点名它无法连上的 feed，每个视图都带有常驻的 **Example data**（示例数据）提示，因此截图不会被误认为实时运行。

被回放的事件流是有节奏的，而非一次性倾倒：该路由先把录制的前 60% 作为历史立即投递，随后逐帧释放其余部分，然后保持连接打开。因此无需 key 的演示展现的是一家正在运转的企业，而不是一个静态文件。

回放模式下的 `POST /safety` 会重新打开已录制的审查，而不是启动新的审查，并在表单下方说明这一点。

## fixture

`fixtures/` 由 `scripts/generate-fixtures.ts` 用单个带种子的 PRNG 生成，因此重新生成会得到逐字节相同的文件。

- `fixtures/roster.json`——跨十个 division（Harness Core、Proving Ground、Verification、Judging、Curation and Data、Program Departments、含六个 department 的 Code Safety、Knowledge、Governance、Observatory）的 147 个 agent 与 424 条关系。division 规模与成员写在 `scripts/roster-source.ts` 中。
- `fixtures/runs.json`——一次代码安全运行、一个 program、一次 fleet 轮班、一个配对实验。
- `fixtures/events/<run>.jsonl`——录制的事件流；代码安全运行有三百余条事件，从开场指令，到六个 department 并行扫描代码树、finding 落位、验证者在各自行上复读每条 finding，再到裁决、集成与证书。
- `fixtures/safety/<run>.json`——审查结果：34 个文件、26 条 finding、department 汇总、带两条点名未验证 finding 的证书，以及法语和英语的报告。

代码安全的 finding 并非虚构。二十六条中有十八条读自 [`data/code-safety/targets/nodegoat.ground-truth.json`](../../data/code-safety/targets/nodegoat.ground-truth.json)，即本仓库自己针对 OWASP NodeGoat 修订版 `c5cb68a` 的 ground truth（基准事实），带有真实的 CWE、文件与行号。其余八条是超出该 ground truth 的 department 产出，因而置信度相应更低。

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `app/` | 路由，以及 `app/api/fixtures/` 下的 fixture 端点。 |
| `components/` | 外壳，以及每个视图一个目录；所有接触 three.js 的都是 Client Component。 |
| `lib/` | 契约、feed 客户端、事件流、store、布局、配色。 |
| `fixtures/` | 已提交的回放数据。 |
| `scripts/` | fixture 生成器及其 roster 源。 |
| `docs/` | 上方的截图。 |

外壳（`app/layout.tsx`）是 Server Component。每个场景都通过 `next/dynamic` 以 `ssr: false` 加载，因为 three.js 在挂载时就会索取 WebGL 上下文。

## 限制

deck 只读取；它从不写入仓库，也从不自己执行审查——`POST /safety` 是请求 feed 执行。位于其他源的实时 feed 必须发送浏览器接受的 CORS 头，否则 deck 会回落到回放。场景需要 WebGL 2；没有 2D 回退。仅当目标的文件清单包含 finding 的 `file` 时，代码城市才会放置该 finding；落在 feed 未报告文件上的 finding 会列在表格中，但没有标记。

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

第二行是生产构建及其服务端，第三行从运行中的 feed 为 `fixtures/` 拍快照。

```sh
NEXT_PUBLIC_FEED_URL=http://localhost:4711 pnpm run deck
pnpm --dir apps/command-deck build && pnpm --dir apps/command-deck start
pnpm --dir apps/command-deck fixtures
```

## 三个视图

| 按键 | 视图 | 展示内容 |
| --- | --- | --- |
| `1` | **企业**（`/`） | 每个已定义 agent 是一个节点，按 division（部门群）聚类在一团该 division 颜色的柔和星云之中；边表示它们之间的委派、验证与裁决。只有当一条边两端之一的 agent 在最近几秒内行动过时，这条边上才会有按关系类型着色的流量；没有实时活动时，边只是缓慢呼吸。正在工作的 agent 戴着一枚转动的轨道环，已认证的 agent 有一圈暖色边缘，失败的则是一圈暗红边缘；一张证书落下时是一枚扩张的圆环加一道短促的光柱。点击节点会让相机飞向它、让无关的一切变暗，并打开其角色、模型 route（路由）、preset（预设）、skill（技能）、工具、源文件，以及它在当前跟随运行中的事件；`Esc` 飞回原位。 |
| `2` | **流程**（`/process`） | program（项目）流水线呈现为一条点亮的走廊：每个部门车道是一条该 division 颜色的发光轨道，从左缘出发穿过三道高大的玻璃门——Verification（验证）、Judging（裁决）、Integration（集成）——脚下是没入雾中的地面网格。每条已记录事件以带丝带尾迹的彗星沿其车道飞行，大小与颜色按事件类型而定；一张证书让验证门响起一圈涟漪，一次合并点亮集成门并让它保持点亮。车道标签写着正在其上工作的 agent 与其事件数，并在该 agent 行动时变亮。相机以一段定场运动开场，运行产出时缓慢漂移，运行结束后拉远以框住每条车道。时间轴拖动条沿流水线拖动一块时间平面；`Head` 返回实时位置。 |
| `3` | **代码安全**（`/safety`） | 被审查仓库呈现为一座夜晚的代码城市：目录是街区，每块街区的地面以其中大多数代码所用语言的颜色勾出轮廓；文件是按大小缩放的方块，窗户按文件字节数的比例点亮，并以路径为种子，因此同一文件在每次渲染中点亮的都是同样的窗户。每条 finding（发现）都在其文件的屋顶立起一道光柱，critical 最高最亮、info 最矮，柱脚有一圈呼吸的光晕；悬停其上会显示文件、行号与该 finding，选中则让相机飞到它所在的楼上并在光柱上挂出一张标注。只要已加载审查中还有 department 处于 pending，一道光墙就会每隔几秒扫过城市，街区轮廓随之脉动；最后一个 department 发布后扫描停止。面板包含带严重级别、department 与 CWE 筛选的 finding 表格、带计数与未验证清单的证书、双语报告、下载，以及启动新一次审查的表单。 |

`Esc` 清除选择并让各舞台飞回原位：企业视图回到整张图，代码城市回到其静止高度。企业视图以一个定场镜头开场：相机从图的远处高空用两秒半缓入；代码城市以一段三秒的飞越开场，从其远端边缘的高空掠入。`prefers-reduced-motion: reduce` 让每个视图静止开场，停止流量、自动环绕、脉动与色差，把 bloom（泛光）固定在恒定强度，并对选中的 agent 直接切换而不是飞行；在流程视图中，它把相机固定在俯瞰整条流水线的一个角度，并把每条事件作为静止的光点立在自己的轨道上；在代码城市中，它跳过飞越、对选中的 finding 直接切换、把扫描线静止在中央，并停止窗户与光晕的呼吸。

`F` 把整个画面交给舞台：侧面板隐藏，顶栏只保留标识、计数与实时徽标。`P` 开始一段巡览，每三十秒走过三个视图，每个视图以一张标题卡开场，卡上两行文字由指挥台实际读到的数据组成：agent 与关系的计数、当前运行及其事件数、被审查的目标及其发现数与是否已认证。任何按键或点击都会结束巡览。在 `prefers-reduced-motion: reduce` 下，动态标题、路由渐隐与计数器的补间也会关闭；每种模式仍然可用。

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
| `POST /safety` | `{ target, model? }` 启动一次审查并返回 `{ id }`；随后 deck 会实时跟随该次运行。`target` 是 feed 所在机器上的绝对路径，`model` 是 `sonnet` 或 `opus`，即 `pnpm run code-safety -- --model` 接受的名称；表单打开时预填已加载审查自己的目标。 |

每个字段都在 [`deck/contract.ts`](deck/contract.ts) 中定型，那是该契约被写下的唯一位置。客户端按 `seq` 去重，因此重连后重放的历史不会被投递两次。状态栏的每分钟事件数由事件窗口中各帧的 `ts` 在最近六十秒内计得：实时 feed 以墙钟衡量这一分钟，因此停止报告的 feed 会衰减为 `—`；回放则以最新一条录制帧为基准衡量，因为 fixture 的时间戳是历史时间。没有任何外推。

有两条 deck 侧规则值得了解，因为 feed 并不携带它们。finding 的归属 department 通过 [`deck/departments.ts`](deck/departments.ts) 中的表由其 CWE 推导，因为 feed 只报告各 department 的总数，而不在 finding 上标注 department。除非证书的 `unverified` 清单点名，否则 finding 记为已验证。

## 回放：没有 feed 时会发生什么

加载时，deck 向所配置的 feed 发送一次 `GET /roster`，超时 5 秒。任何失败——连接被拒、超时、非 2xx、被拦截的跨源请求——都会选择回放模式，此后所有读取都走 deck 自己在 `/api/fixtures` 下的路由，它们以相同的载荷提供相同的路径。顶栏徽标显示 `REPLAY` 而非 `LIVE`，状态栏点名它无法连上的 feed，每个视图都带有常驻的 **Example data**（示例数据）提示，因此截图不会被误认为实时运行。

被回放的事件流是有节奏的，而非一次性倾倒：该路由先把录制的前 60% 作为历史立即投递，随后逐帧释放其余部分，然后保持连接打开。因此无需 key 的演示展现的是一家正在运转的企业，而不是一个静态文件。

回放模式下的 `POST /safety` 会重新打开已录制的审查，而不是启动新的审查，并在表单下方说明这一点。

## fixture

`fixtures/` 是真实 feed 的一份快照，由 `scripts/snapshot-fixtures.ts` 生成（在 `pnpm run feed` 运行时执行 `pnpm --dir apps/command-deck fixtures`）：其中没有任何虚构内容，且该脚本拒绝实时运行目录，因为只有已提交的记录才经过了密钥材料的脱敏。

- `fixtures/roster.json`——feed 的 `GET /roster`：生成的 [`data/enterprise/roster.json`](../../data/enterprise/README.md)，十个 division 中的 147 个 agent 与 124 条关系，并带有已记录运行赋予它们的状态。
- `fixtures/runs.json`——五条已提交记录：2026-09-19 记录的两次代码安全审查（第二次 NodeGoat 运行、Java 的 dvja 运行）、一次 tier-5 fleet、一个配对实验，以及 csv-tools program。
- `fixtures/events/<run>.jsonl`——每条记录的会话日志经 feed 折叠成指挥台跟随的事件流：NodeGoat 审查有 1,079 条事件，从各部门的开场指令、它们的工具调用，到四张证书与两次合并。
- `fixtures/safety/<run>.json`——feed 对每次审查的 `GET /safety/:id`：NodeGoat 审查的 111 个文件与 38 条经验证的发现、dvja 审查的 174 个文件与 40 条，各自带有部门、证书与双语报告。

已记录的审查正是 [`data/code-safety/README.md`](../../data/code-safety/README.md) 据以读取召回率的那几次，因此回放展示的与现场运行所展示的完全一致。

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `app/` | 路由，以及 `app/api/fixtures/` 下的 fixture 端点。 |
| `components/` | 外壳，以及每个视图一个目录；所有接触 three.js 的都是 Client Component。 |
| `deck/` | 契约、feed 客户端、事件流、store、布局、配色。 |
| `fixtures/` | 已提交的回放数据。 |
| `scripts/` | fixture 快照脚本。 |
| `docs/` | 上方的截图。 |

外壳（`app/layout.tsx`）是 Server Component。每个场景都通过 `next/dynamic` 以 `ssr: false` 加载，因为 three.js 在挂载时就会索取 WebGL 上下文。

## 限制

一次运行的已记录历史会一次性到达指挥台，因此流程视图以固定速率从队列中释放彗星：每条已记录事件都能被看到在飞行，只是比面板计数它晚几秒。

deck 只读取；它从不写入仓库，也从不自己执行审查——`POST /safety` 是请求 feed 执行。位于其他源的实时 feed 必须发送浏览器接受的 CORS 头，否则 deck 会回落到回放。场景需要 WebGL 2；没有 2D 回退。仅当目标的文件清单包含 finding 的 `file` 时，代码城市才会放置该 finding；落在 feed 未报告文件上的 finding 会列在表格中，但不会立起光柱。在最远缩放下，共享的 bloom 会捕捉到点亮的窗户本身，使城市略微发软；调色是三个视图共用的一个合成器，首先为光柱与轨道而调。

# Agent Note: Command Deck 读取单一 feed，在其无响应时回放已提交的 fixture

Status: implemented

[English](2026-09-19-command-deck.md) | 中文

## Problem

一次客户概念验证必须展示 Daliesk 企业在运转——147 个已定义 agent（智能体）、它们之间的工作流、harness 运行的实时活动，以及落在目标仓库代码上的代码安全审查——就在明天的会议室里、一台笔记本上。本仓库本可以把同样的事实以日志和生成目录的形式呈现，但满屋高管读的是场景，不是 JSONL 文件。而仓库中原本没有任何东西能渲染 agent 名册、program（项目）流水线或代码安全结果。

三项约束塑造了设计，并彼此拉扯。提供这些数据的 feed 服务端由另一个 agent 并行编写，因此前端既不能等它，也无法靠运行它来摸清行为。演示必须能在没有网络、没有 API key 的房间里存活，因为一个只显示空白屏幕的概念验证还不如没有。且屏幕上任何内容都不得在并非实时结果时被误认为实时结果，因为客户会复述的主张，就是仓库必须为之担保的主张。

## Decision

**一份契约文件，其后两个数据源。** `deck/contract.ts` 是 feed 的路径与载荷被写下的唯一位置。`resolveFeed()` 以 5 秒超时（冷启动的 feed 会在首次应答之前折叠每个已记录的会话）向 `NEXT_PUBLIC_FEED_URL` 发送一次 `GET /roster`，并返回一个 base URL：feed 有响应时是所配置的 feed，否则是 deck 自己的 `/api/fixtures` 路由。这些路由以相同的载荷提供相同的路径，因此下游每个读取方——store、三个场景、各面板——都只按一份契约写一次，且永远不知道自己在读哪个源。探测失败不是需要恢复的错误状态；它是状态栏报告的二值选择的另一半。

**回放是有节奏的，而非一次性倾倒。** fixture 事件路由先把录制的前 60% 作为历史立即投递，随后逐帧释放其余部分，然后用心跳保持连接打开——正是实时端点自身契约所描述的行为。把录制的各阶段（department 扫描、finding、验证者复读、裁决、集成）交错而非顺序铺开，才使流水线的四个阶段从开场数秒起就都有内容。因此无需 key 的演示展现的是一家正在运转的企业。

**示例数据会在每个视图上自陈。** 回放模式下，顶栏徽标显示 `REPLAY`，状态栏点名它无法连上的 feed，每个视图都带有常驻提示。该提示位于面板内部而非只在外壳中出现一次，这样任一单个视图的截图都会带着这一声明。

**finding 是借来的，不是编的。** 二十六条代码安全 finding 中有十八条由 `data/code-safety/targets/nodegoat.ground-truth.json` 生成，即本仓库自己的 OWASP NodeGoat ground truth（基准事实），保留真实的 CWE、文件与行号。其余八条是超出它的 department 产出，置信度相应更低。在一个真实且广为人知的目标上编造 finding，是这次演示中懂安全的读者唯一能当场揭穿的东西，而仓库早已持有使其不必要的材料。

**逐帧状态绝不经过 React。** store 把 `activity` 与 `bursts` 保存为就地改写、由 `useFrame` 读取的对象；只有 roster、runs、events 与选择是 React 状态。每个场景只用少数几次绘制调用——节点与文件方块用实例化网格，每层辉光用一个叠加点层，每组边用一个线段层——因此 147 个脉动 agent、424 条曲线边和一座代码城市，在开启完整调色（bloom、暗角、色差）的笔记本上仍能保持 60 fps。

**deck 是一个独立的 Next.js 程序。** 它的 `tsconfig.json` 归自己所有；它既不加入 host 也不加入 client 的 project reference 聚合，因为它是由 `next build` 构建的浏览器应用，而非仓库 `tsc -b` 产出的包。

## Consequences

`pnpm run deck` 与 `pnpm --dir apps/command-deck build` 在干净检出、无 key、无 feed 的情况下均可工作。`pnpm --dir apps/command-deck fixtures` 从运行中的 feed 为每个 fixture 拍快照：生成的花名册、五条已提交记录、它们折叠后的事件流以及两次审查的详情，并拒绝实时运行目录，因为只有已提交的记录经过了脱敏；因此回放展示的正是现场运行所展示的数据，审阅者可以把它与记录做 diff。

有两项 feed 并不携带的事实在 deck 侧推导，并在 README 中如实说明：finding 的归属 department，通过 `deck/departments.ts` 中的表由其 CWE 得出；以及它的验证状态，由证书的 `unverified` 清单是否点名它得出。若 feed 日后在 finding 上标注 department，该表即成死代码，应当删除。

`pnpm run constraints` 为此包报告四项无法从包内修复的违规。`scripts/check-workspace-constraints.ts` 把每个 `apps/*` 目录都视为发布成员——不得为 `private`、必须设置 `publishConfig.access`、repository 字段必须指明其目录、且其名称必须出现在该脚本的 `appPackageFiles` 策略中。客户概念验证不是已发布的包，因此清单保持 `private: true`，该门禁将持续报红，直到该脚本为不发布的 app 增加一个分支。

场景需要 WebGL 2，且没有 2D 回退。`prefers-reduced-motion: reduce` 会关闭自动环绕、脉动与色差，这是无障碍底线，而非完整的替代渲染。

## Alternatives considered

- **等待 feed 服务端，然后基于它开发。** 两半正是按一份写定的契约并行编写，才使任何一方都不阻塞另一方；没有服务端就无法启动的前端，同样没有服务端就无法演示。
- **把 fixture 作为导入的 JSON 打包。** 更简单，并会丢掉使回放具有说服力的关键：一条带重连、由驱动实时 feed 的同一份客户端代码所检验的、有节奏的 Server-Sent Events 流。磁盘上的文件也更便于作为数据审阅。
- **单独的"演示模式"开关。** 每个视图两条代码路径，其中一条只在会议室里被走到。回退因此被做成一个 base URL，于是演示路径就是生产路径。
- **编造代码安全 finding。** 写起来更快，在会议室里无从辩护。仓库的 NodeGoat ground truth 已经把十八个真实问题钉在指名修订版的具体行上。
- **企业视图用 2D 图（SVG 或 canvas）。** 它能承载名册与边，却承载不了客户相信这家企业为真的理由。3D 场景是交付物，而非装饰。

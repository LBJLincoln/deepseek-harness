# @deepseek-ai/dsh-command-deck

[English](README.md) | 中文

Command Deck 是 Daliesk agent（智能体）企业面向客户的前端：它的 147 个席位定义，每个都附带已记录会话为它提供的证据；记录在案的组织，即每次已记录的 program（项目）运行及其部门、证书与签署；会话之间的工作流；harness 运行的实时活动；落在目标仓库代码上的代码安全审查；以及企业的运营：此刻正在工作的每个 agent，以及需要处理的事项与原因。

它是一个 Next.js 14 应用（App Router、React 18），三个场景通过 `@react-three/fiber` 使用 three.js。它读取一个 HTTP feed；当该 feed 没有响应时，会回放随其一同提交的 fixture，因此在没有服务端、没有 API key 的情况下，deck 依然完全可用、可演示。

## 运行

第一条命令在仓库根目录执行，第二条等同于 `pnpm --dir apps/command-deck dev`。

```sh
pnpm install
pnpm run deck
```

deck 在 `http://localhost:3000` 提供服务。用 `NEXT_PUBLIC_FEED_URL` 指向实时 feed；默认值是 `http://localhost:4711`。观看者也可以在 deck 的 URL 上用 `?feed=https://feed.example` 为一个浏览器标签页指定 feed；该标签页在切换视图和刷新后仍保留它，因此托管的 deck 无需重新构建即可跟随浏览器能访问的任何 feed。

第二行是生产构建及其服务端，第三行从运行中的 feed 为 `public/fixtures/` 拍快照。

```sh
NEXT_PUBLIC_FEED_URL=http://localhost:4711 pnpm run deck
pnpm --dir apps/command-deck build && pnpm --dir apps/command-deck start
pnpm --dir apps/command-deck fixtures
```

`DECK_STATIC=1 pnpm --dir apps/command-deck build` 把同样的视图写成 `apps/command-deck/out/` 下的静态导出：每个视图都是基于静态 fixture 的 Client Component，因此这份导出就是回放模式下的整个 deck，而 `NEXT_PUBLIC_BASE_PATH` 设定它被提供时的路径前缀。[`deck-pages.yml`](../../.github/workflows/deck-pages.yml) 在 deck 分支的每次推送时构建这份导出，并把它发布到仓库的 GitHub Pages 站点 <https://lbjlincoln.github.io/deepseek-harness/>：一个不需要 feed、不需要 key、不需要机器的演示 URL。那里提供的页面仍会先探测所配置的 feed，而浏览器拒绝从 `https` 页面访问 `http://localhost:4711`，所以它会在一秒内落入回放。在操作者的机器向[镜像](mirror/README.md)推送期间，同一个页面是实时的：工作流把中继烘焙为页面的 feed，`?feed=` 可以指定另一个。

## 五个视图

| 按键 | 视图 | 展示内容 |
| --- | --- | --- |
| `1` | **企业**（`/`） | 每个已定义席位是一个节点，按 division（部门群）聚类在一团该 division 颜色的柔和星云之中；边表示它们之间的委派、验证与裁决。被已记录会话占据过的席位以全亮度显示；没有任何已记录会话占据过的席位显示为暗色，悬停其上会写着 `defined, never run`。只有当一条边两端之一的席位在最近几秒内行动过时，这条边上才会有按关系类型着色的流量；没有实时活动时，边只是缓慢呼吸。正在工作的席位戴着一枚转动的轨道环，已认证的席位有一圈暖色边缘，失败的则是一圈暗红边缘；一张证书落下时是一枚扩张的圆环加一道短促的光柱。点击节点会让相机飞向它、让无关的一切变暗，并打开其角色、它为之定义的 route（路由）及其会话实际运行所在的路由、它的已记录会话、preset（预设）、skill（技能）、工具、源文件，以及它在当前跟随运行中的事件；`Esc` 飞回原位。面板标题是 `<n> seats defined · <m> occupied · <a> active today`，读自花名册：一个席位只能被一条已记录的交付物占据——一个会话、一张已交付或已评审的工单、在某个提交上运行过的一道关卡、一个 CI 裁决、一份已发布的快照——且只有在花名册盖章时刻之前 24 小时内有交付物时才算活跃（[规则](../../data/enterprise/README.md#occupancy)）；活跃的席位戴着轨道环。其 Enterprise 标签页按每条路由上记录的会话数列出各路由（有席位为之定义却从未有会话运行的路由写作 `defined for N seats, never run`），列出没有任何席位持有的会话及其原因，以及每个 division 被占据、已定义与活跃的席位数。其 Ledger 标签页是发布出来的 [`enterprise.json`](#the-fixtures)：它所描述的时刻与企业的一天、每个 division 的在岗与活跃席位、当天分为 queued、shipped、rejected、halted 的工单、当天按班次列出并标明各席位结果的职能运行，以及最近已交付的提交及其上记录的 CI 裁决，每条都链接到其 job。其 24 hours 标签页是发布出来的 [`enterprise-day.json`](#the-fixtures)，即在截至花名册盖章时刻的 24 小时上的[企业报告](../../data/enterprise/README.md#the-report)，以报告陈述试点精确计数的标题开头：运行过的周期，每个周期或干净、或在第一个失败步骤处失败、或因没有提交周期记录而结果未知（发布这份数据的周期就在其中，因为它的记录在指挥台数据之后写出），并注明由谁启动；班次，丢失的班次以红色显示；按 division 列出的已交付工单，附带每个提交及其 Branch CI 裁决，链接到给出该裁决的运行，裁决来自包含该提交的后续运行时标注 `later run`，以及评审的批准、拒绝与未进行数；按来源列出、从不相加的开销；按 division 的活跃席位；以及数据未显示的每一项事实。其 Record 标签页是来自 `GET /programs` 的记录在案的组织：每次已记录的项目运行，连同其各部门的步数、工具调用与证书、整合的结论，以及按记录的日志顺序排列的签署链，并标出在整合认证之前签署的发布；当 deck 列出该运行时，点击某个部门行会在工作流视图中打开它的会话。 |
| `2` | **流程**（`/process`） | program（项目）流水线呈现为一条点亮的走廊：每个部门车道是一条该 division 颜色的发光轨道，从左缘出发穿过三道高大的玻璃门——Verification（验证）、Judging（裁决）、Integration（集成）——脚下是没入雾中的地面网格。每条已记录事件以带丝带尾迹的彗星沿其车道飞行，大小与颜色按事件类型而定；一张证书让验证门响起一圈涟漪，一次合并点亮集成门并让它保持点亮。车道标签写着正在其上工作的 agent 与其事件数，并在该 agent 行动时变亮。相机以一段定场运动开场，运行产出时缓慢漂移，运行结束后拉远以框住每条车道。时间轴拖动条沿流水线拖动一块时间平面；`Head` 返回实时位置。 |
| `3` | **代码安全**（`/safety`） | 被审查仓库呈现为一座夜晚的代码城市：目录是街区，每块街区的地面以其中大多数代码所用语言的颜色勾出轮廓；文件是按大小缩放的方块，窗户按文件字节数的比例点亮，并以路径为种子，因此同一文件在每次渲染中点亮的都是同样的窗户。每条 finding（发现）都在其文件的屋顶立起一道光柱，critical 最高最亮、info 最矮，柱脚有一圈呼吸的光晕；悬停其上会显示文件、行号与该 finding，选中则让相机飞到它所在的楼上并在光柱上挂出一张标注。只要已加载审查中还有 department 处于 pending，一道光墙就会每隔几秒扫过城市，街区轮廓随之脉动；最后一个 department 发布后扫描停止。面板包含带严重级别、department 与 CWE 筛选的 finding 表格、带计数与未验证清单的证书、双语报告、下载、启动新一次审查的表单，以及——当某个目标有已提交的基准对比时——一个 Benchmark 标签页，它在同一基准真值上把企业与一台扫描器和一个单前沿模型打分对比，并给出逐问题矩阵以及那次对比交给改进循环的差距。 |
| `4` | **工作流**（`/workflow`） | 当前跟随运行自己的各个会话呈现为一张有向图，由其事件流构建：根会话在最左，它启动的各会话按首次报告的顺序在其旁扇形展开，集成它们工作的会话在最后。子会话的第一帧被采纳时，一条边从父节点向子节点生长；一张证书用一枚圆环封印其会话并沿这条边向上送回一个脉冲；一次合并从每个已认证部门向集成节点拉出光丝并将其点亮；一次拒绝闪红并留下红色边缘；一条指令则托起它被排入的那个会话。每个节点带有一个以最忙会话为基准的事件计数表，三十秒没有工作便变暗。悬停显示该会话的名称、id、事件数与最后一帧；点击则打开这些事实及其最近十条事件。相机以定场镜头开场，并随着层级与行数增加而自行重新取景。 |
| `5` | **运营**（`/ops`） | 基于一份运营快照的企业运营中心：排好序的待处理事项及其证据和下一步行动；此刻正在工作的每个 agent；当天的工单、周期、吞吐与 Branch CI；运营大厅，147 个席位随 agent 工作而点亮，每一次工具调用都从席位飞向它的站点；以及过去 24 小时内按类别划分的每一次 agent 运行。[运营视图](#the-operations-view)一节描述它及其三种模式。 |

`Esc` 清除选择并让各舞台飞回原位：企业视图回到整张图，代码城市回到其静止高度。企业视图以一个定场镜头开场：相机从图的远处高空用两秒半缓入；代码城市以一段三秒的飞越开场，从其远端边缘的高空掠入。`prefers-reduced-motion: reduce` 让每个视图静止开场，停止流量、自动环绕、脉动与色差，把 bloom（泛光）固定在恒定强度，并对选中的 agent 直接切换而不是飞行；在流程视图中，它把相机固定在俯瞰整条流水线的一个角度，并把每条事件作为静止的光点立在自己的轨道上；在代码城市中，它跳过飞越、对选中的 finding 直接切换、把扫描线静止在中央，并停止窗户与光晕的呼吸。

`F` 把整个画面交给舞台：侧面板隐藏，顶栏只保留标识、计数与实时徽标。`P` 开始一段巡览，每三十秒走过五个视图，每个视图以一张标题卡开场，卡上两行文字由指挥台实际读到的数据组成：已定义与被占据的席位数、当前运行及其事件数、被审查的目标及其发现数与是否已认证、工作流的会话数、边数、证书数与合并数、此刻正在工作的 agent 数与待处理事项数。任何按键或点击都会结束巡览。在 `prefers-reduced-motion: reduce` 下，动态标题、路由渐隐与计数器的补间也会关闭；每种模式仍然可用。

`O` 运行冷开场：舞台在 Daliesk 标识背后转为全黑，配一行只由指挥台实际读到的数据组成的宣言（已定义的席位数、被占据的席位数、已列出的运行数），随后企业按花名册顺序逐个 division 自行组装，顶栏计数器同时从零攀升，宣言在按键约十八秒后溶解到工作中的指挥台上。`P` 把它作为巡览的第一幕运行，每次页面加载只一次；再按一次 `P` 则直接开始巡览。任何按键或点击都会立刻结束它，且图是完整的而不是半亮的；在 `prefers-reduced-motion: reduce` 下，宣言在一张已静止的图上停留四秒。

在代码安全视图按 `G`，会按从最严重开始的顺序走过已加载审查最严重的十二条 finding，每条四秒半：相机从一道光柱飞到下一道，挂出各自的标注，面板打开该 finding 的卡片，与点击一样。巡览在最后一条之后结束、相机飞回原位；任何其他按键或点击都会立刻结束它；运行期间面板的眉题写着 `findings tour`。与回放键一样，它只在该视图挂载期间绑定。

调色会随帧预算在三个质量档之间切换：`high`（像素比最高 1.75、SMAA、完整 bloom）、`medium`（1.25、SMAA、bloom 减少五分之一）与 `low`（1、无 SMAA、bloom 0.8）。连续两次下降降一档，连续四次上升升一档，任一变化后该档保持五秒，两次下降之后所到达的档位成为上限，因此一台陌生的笔记本只会适应一次而不会来回闪动。`?quality=high|medium|low` 固定某一档并停止监视器——演示机器就是在彩排之后这样设定的——状态栏会说明正在运行哪一档以及它是否被固定。

回放按一次已记录运行自己的时钟重现它。工作流面板与流程视图 Timeline 区中的播放控件从游标处开始播放——指挥台跟随最新位置时则从运行的第一帧开始——速度为 1×、10×、30× 或 60×，播到末尾时回到跟随最新位置，因此仍在产出的运行会在回放追上它的那一刻继续实时进行。`Space` 播放与暂停，`[` 与 `]` 调节速度，只在这两个视图之一显示时生效，且观看者位于某个控件内时从不生效。按钮下方的两个时间是游标已经越过的记录时长与前方剩余的记录时长，而不是屏幕时间：二十分钟的 NodeGoat 审查在 60× 下二十秒播完。每个视图读取同一个游标，因此图在自我构建的同时，流水线的车道按它们当初点亮的顺序点亮，而流程视图的发射队列以其固定速率乘以回放速度释放，而不会落后旁边面板好几分钟。

审查进行期间，某个部门每打开一个文件，该文件自己的楼就以该部门的颜色闪亮，并在约两秒半内淡去，同时一道短促的脉冲沿楼身向上跑过；之后该文件保留一层该颜色的淡淡色调，于是城市随着审查的阅读逐渐填满，面板也按同一套解析统计 `N of 111 files opened`——把工具事件中的路径按最长路径后缀与目标清单匹配（在已记录的 NodeGoat 审查上，634 条工具事件中有 124 条解析到 111 个文件中的 51 个）。在指挥台注视下启动的审查，以一段八秒的发射序列开场，六个部门依次点亮，各自写明它为什么而读代码。在指挥台注视下拿到证书的审查，播放一段十秒的裁决——CERTIFIED 或 NOT CERTIFIED，列出已认证的部门、证书点名的审查器及其各严重级别计数——同时一圈地面光环从城市中心向外扩散，经过每道光柱时使其迸发；以最终状态加载的审查两者都不播放，因为没有任何事发生在有人注视之时。在 `prefers-reduced-motion: reduce` 下，城市只对最后被触及的那个文件保持稳定高亮，发射序列是一张静态卡片，裁决是不带光环与迸发的卡片。六个部门在任何地方都是同一种颜色：流程车道与城市的阅读轨迹都从配色表取色。

![企业视图：147 个已定义席位，19 个被记录会话占据，其余变暗](docs/enterprise.png)

![记录标签页：一次程序运行及其部门、证书与签核链](docs/record.png)

![流程视图：departments、验证、裁决与集成](docs/process.png)

![代码安全视图：代码城市中落在各自文件上的 finding](docs/safety.png)

![工作流视图：运行的各会话构成的图，证书已封印，合并汇聚到集成节点](docs/workflow.png)

## 运营视图

`/ops`（按键 `5`）是企业的运营中心，它只依据一份运营快照绘制（[`scripts/enterprise-ops.ts`](../../scripts/enterprise-ops.ts)，在 [`deck/contract.ts`](deck/contract.ts) 中定义为 `OpsSnapshot`），别无其他来源。它同时服务三类读者：

- **速览。** 顶部的横条先说明视图是否为实时，然后依次统计：需要处理的事项及其最高严重程度、此刻按类别划分的正在工作的 agent（智能体）、24 小时内交付的工单及队列状况、每小时的交付物数量及 24 小时柱状小图、当天的周期与下一个周期、Branch CI 最新的结论，以及已占用的席位。
- **给运营者。** 场景旁边的面板是关注队列，最严重的排在最前：列出失败作业的红色 Branch CI、失败或中断的周期步骤、陈旧或已停止的调度器、卡住的 agent（二十分钟没有事件）、自上一个有交付的班次以来其记录显示因用量上限而暂停或一无交付的班次、没有留下记录就被放弃的班次（没有进程，且三十分钟没有动静）、已停止或迟到的转录捕获与运营循环、磁盘与内存压力、被暂停和被拒绝的工单，以及所有者未结的请求，每一项都带有证据链接和下一步行动。它的上方是周期调度器、转录捕获与运营循环的心跳，各自标明存活、迟到或停止以及最近一次运行；其下依次是此刻正在工作的 agent（各自在做什么、已运行多久、用了多少 token）；各分部的席位；最近已交付的提交及覆盖每个提交的 Branch CI 结论；以及快照读取过的每个来源，读不到的来源附有原因。
- **用于演示。** 场景是运营大厅：全部 147 个席位排成一个圆环，每个分部是一段带其颜色的圆弧，没有被占用的席位暗淡，被占用时点亮，在花名册当天活跃时全亮；流水线的五道门——受理、班次、审查、CI、交付——横穿圆环；每个正在工作的 agent 从它的席位到它所在的门拉出一道光束，卡住时变为红色虚线；运营者自己的 agent 是在上方环绕的紫色光点；每一次工具调用或步骤都有一颗彗星从席位飞向它的门，每一张证书和每一次合并都在门上激起一道金色光环。镜头缓慢环绕，观看者可以随时接管。`F` 隐藏面板和时间线。

每张卡片和每个面板都按观看者的时钟说明其事实有多旧：采集器实时读取的内容（进程、日志、转录、主机）以快照自身的时间为准，账本、队列和记录以检出最近一次抓取分支的时间为准，花名册以它自己的 `generatedAt` 为准，Branch CI 以缓存的那次读取为准；面板所依据的来源读不到时，它说明其时长未知。

浏览器不提供 WebGL 2 时（没有 GPU 的笔记本、远程桌面、禁用它的策略），以及场景抛出错误或失去其 WebGL 上下文时，视图把同一个大厅画成一张平面 SVG，包含席位、门、光束和运营者的 agent，并在下方说明原因；横条、面板和时间线照常工作。`?flat` 直接要求平面大厅。

场景下方，过去 24 小时内每一次 agent 运行都按类别排在各自的泳道上，按结束方式着色（运行中、通过、失败、未记录结束），同样的运行也可以在一个可展开的表格中查看。视图跟随系统的浅色或深色设置，视图自带的开关可以覆盖它；场景在两种主题下都保持为深色窗口。`prefers-reduced-motion: reduce` 会停止环绕、彗星、光环和脉动；在手机宽度下，页面把横条、场景、关注队列和时间线排成一列。

视图会在它自己的徽标和页头的徽标中说明它处于三种模式中的哪一种：

| 模式 | 何时 | 显示什么 |
| --- | --- | --- |
| `live` | feed 对 `GET /ops` 的回答是一份比其生产者六个间隔（至少 90 秒）更新的快照。 | 该快照，每个间隔重新读取一次；来自 `GET /ops/events` 和每份快照的活动帧按记录时的间隔播放，比机器晚一个间隔加五秒。 |
| `recent` | 没有实时快照，但能读到 feed 上过时的快照或随包附带的 `fixtures/ops.json`。 | 两者中较新的一份，附上它的时长和一条常驻的回放提示；它的帧循环回放，视图每分钟再向 feed 询问一次。 |
| `offline` | 两者都读不到。 | 原因，以及怎样才能得到一份快照。 |

运营者的机器运行[运营循环](mirror/README.md#the-operations-loop)时，托管的 deck 是实时的；否则它显示上一个企业周期发布的快照。

![1440×900 下的运营视图：速览卡片、运营大厅、关注队列与 24 小时泳道图](docs/ops.png)

![手机宽度下的运营视图](docs/ops-phone.png)

## 客户简报

`/briefing` 是一份文档而不是一个舞台：它把企业的试点分成八节呈现给高管审阅——试点现状，已交付的工单按工作的启动者计数；运营模式，附组织结构图与一张工单的路径；试点记录（每个周期与周期之外的每个班次，连同其启动者及其尝试、交付、失败或丢失的工单；已交付的工单，确切提交上的 Branch CI 运行与携带它们的那次推送的包含运行分开列出；每一次 Branch CI 运行；按 division 的在岗席位）；实测质量（Proving Ground 的冻结配对实验以森林图及其区间呈现，安全审查对已记录缺陷与植入缺陷在三行以内的召回率，附分母）；数据处理、治理与审计，以一个班次的数据流向以及读取客户代码之前合作所需的条件开头；经济性；局限与风险；以及路线图与建议的合作方式——最后列出计算所用的输入集及其 SHA-256。它在构建时读取一个文件 `public/fixtures/briefing.json`，由 `pnpm run enterprise:briefing`（[`scripts/enterprise-briefing.ts`](../../scripts/enterprise-briefing.ts)）写出，`pnpm run enterprise:publish` 在每个周期之后刷新它。每个数值都带有编号来源：悬停或聚焦其标签会显示读取它的路径或 URL 及其计算方法，每一节末尾列出本节的注释。构建器无法计算的数值显示为 `unknown`，其注释给出原因。同一条命令还会渲染页面并写出其声明清单；若某个句子陈述了数字却没有来源，或页面含有试点记录不支持的短语，它会拒绝写出。

简报打开期间，指挥台的页眉、页脚与舞台快捷键都会让开：页面像文档一样滚动，在观看者做出选择之前跟随系统的浅色或深色设置（浏览器会记住该选择），并且可以打印——通过浏览器的打印对话框或页面上的 "Print or save as PDF"——得到分页的 A4 或 Letter 文档：每一节从新的一页开始，页脚带页码，来源注释印在各节之下。它在手机宽度下排版时没有横向滚动。[`components/briefing/`](components/briefing/) 存放该页面；[客户简报 Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-client-briefing.md) 记录了为什么每个数值都是计算出来而不是手写的。

![桌面宽度下的客户简报：封面、记录日期与目录](docs/briefing.png)

![手机宽度下的客户简报：封面，以及主题与打印按钮](docs/briefing-phone.png)

## feed 契约

deck 读取 `NEXT_PUBLIC_FEED_URL`（默认 `http://localhost:4711`），并期望以下路径。feed 服务端本身不在此包内。

| 路径 | 响应 |
| --- | --- |
| `GET /roster` | `{ generatedAt, counts: { defined, occupied, active }, divisions[], agents[], edges[], evidence, unattributed }`——147 个席位，每个带有其证据（`sessions`、`lastSeen`、`routesSeen`），它们的 division 与相互关系，证据所读取的记录及每条路由上的会话数，以及按原因统计的、没有任何席位持有的会话。 |
| `GET /runs` | 每个 `program`、`fleet`、`experiment` 与 `code-safety` 运行的 `[{ id, kind, name, startedAt, endedAt?, status, path }]`。 |
| `GET /programs` | `[{ programId, runId, kind, path, target?, spec?, startedAt, endedAt?, outcome?, departments[], integration?, signoffs[] }]`——记录在案的组织：每次已记录的项目运行，按最新优先，连同每个部门的会话、状态、证书、步数与工具调用，整合的结论，以及每一项签署及其时间与 `decidedBy`。 |
| `GET /runs/:id/events` | Server-Sent Events。每个 `data:` 帧是一条 `{ ts, seq, agentId?, sessionId, kind, label, detail?, severity?, file?, line? }`；`agentId` 是该帧所属会话占据的席位，当没有任何规则把该会话放到席位上时则不出现。该流先回放历史，然后保持打开。 |
| `GET /safety/:id` | 一次代码安全审查的 `{ target, departments, findings, certificate, report }`。 |
| `POST /safety` | `{ target, model? }` 启动一次审查并返回 `{ id }`；随后 deck 会实时跟随该次运行。`target` 是 feed 所在机器上的绝对路径，`model` 是 `sonnet` 或 `opus`，即 `pnpm run code-safety -- --model` 接受的名称；表单打开时预填已加载审查自己的目标。 |
| `GET /ops` | 运营快照 `OpsSnapshot`，由 [`scripts/enterprise-ops.ts`](../../scripts/enterprise-ops.ts) 写出：`{ schema, generatedAt, producer, intervalSeconds?, window, sources[], agents[], attention[], big, seats, runs[], activity[] }`。每个来源都以 `ok` 或 `unknown` 列出并附原因，从未知来源计出的每个数字都是 `null`。 |
| `GET /ops/events` | 以 Server-Sent Events 发送快照的活动帧，每一帧都是一个 `GET /runs/:id/events` 帧，其 `sessionId` 是快照中的某个 agent：先发送当前快照的每一帧，再发送之后每份快照新增的帧，每对 `sessionId` 与 `seq` 只发送一次。没有 `Last-Event-ID` 的连接由中继从 200 帧之前开始。 |

每个字段都在 [`deck/contract.ts`](deck/contract.ts) 中定型，那是该契约被写下的唯一位置。`seq` 在 feed 折叠的每个会话内部从一开始计数，因此客户端按 `sessionId` 与 `seq` 这一对去重，重连后重放的历史不会被投递两次；`ts` 是 epoch 毫秒，时间轴游标是一个 `ts` 上限而不是序号，因为来自不同会话的序号彼此之间没有先后。状态栏的每分钟事件数由事件窗口中各帧的 `ts` 在最近六十秒内计得：实时 feed 以墙钟衡量这一分钟，因此停止报告的 feed 会衰减为 `—`；回放则以最新一条录制帧为基准衡量，因为 fixture 的时间戳是历史时间。没有任何外推。

有两条 deck 侧规则值得了解，因为 feed 并不携带它们。finding 的归属 department 通过 [`deck/departments.ts`](deck/departments.ts) 中的表由其 CWE 推导，因为 feed 只报告各 department 的总数，而不在 finding 上标注 department。除非证书的 `unverified` 清单点名，否则 finding 记为已验证。

## 回放：没有 feed 时会发生什么

加载时，deck 向所配置的 feed 发送一次 `GET /roster`，超时 5 秒。任何失败——连接被拒、超时、非 2xx、被拦截的跨源请求——都会选择回放模式，此后所有读取都走 `public/fixtures` 下已提交的 fixture，它们是保存着 feed 各路径所返回载荷的静态文件（`/roster` 变为 `/fixtures/roster.json`，一次运行的事件流变为 `/fixtures/events/<run>.jsonl`）。顶栏徽标显示 `REPLAY` 而非 `LIVE`，状态栏点名它无法连上的 feed，每个视图都带有常驻的 **Example data**（示例数据）提示，因此截图不会被误认为实时运行。

被回放的事件流是有节奏的，而非一次性倾倒：流客户端把录制读取一次，先把前 55% 作为历史立即投递，随后每 330 ms 释放一帧，然后保持打开并静默。因此无需 key 的演示展现的是一家正在运转的企业，而不是一个静态文件。

回放模式下的 `POST /safety` 会重新打开已录制的审查，而不是启动新的审查，并在表单下方说明这一点。

## fixture

`public/fixtures/` 保存着真实 feed 的一份快照，由 `scripts/snapshot-fixtures.ts` 生成（在 `pnpm run feed` 运行时执行 `pnpm --dir apps/command-deck fixtures`），以及 `pnpm run enterprise:publish` 在每个班次之后从花名册与台账重新生成的企业数据：其中没有任何虚构的内容，且快照脚本拒绝实时运行目录，因为只有已提交的记录才对密钥材料做过脱敏。

- `public/fixtures/roster.json`——生成的 [`data/enterprise/roster.json`](../../data/enterprise/README.md) 的逐字节副本，由 `pnpm run enterprise:publish` 写出：十个 division 中的 147 个席位与 124 条关系，各自带有已提交记录赋予它的证据与指名它的台账行，在花名册时间窗内活跃的席位带有 `status: "active"`。
- `public/fixtures/enterprise.json`——Ledger 标签页，由同一条命令从花名册、[`data/enterprise/ledger.jsonl`](../../data/enterprise/README.md#the-ledger) 与工单队列写出：所描述的时刻、时间窗、按 division 的在岗与活跃席位、当天按状态分列的工单、当天的职能运行，以及最近十个已交付提交及其 CI 裁决。指挥台在实时模式下也从 fixture 读取它，因为它是发布出来的记录而不是 feed 路径。
- `public/fixtures/enterprise-day.json`——24 hours 标签页，由同一条命令写出：在截至花名册盖章时刻的 24 小时上的[企业报告](../../data/enterprise/README.md#the-report)的 JSON，读取自周期记录、台账、git 历史与 Branch CI。与 `enterprise.json` 一样，两种模式下都从 fixture 读取它，其他任何视图也可以读取同一个文件。
- `public/fixtures/briefing.json`——客户简报的数据，由 `pnpm run enterprise:briefing` 从已提交的记录与 GitHub 报告的 Branch CI 运行写出：`/briefing` 页面展示的每个数值及其来源；无法计算的数值记为 `unknown` 并附原因。
- `public/fixtures/briefing-claims.md`——简报的声明清单，由同一条命令依据在 `briefing.json` 上渲染的页面写出：每个句子及其引用的来源注释，然后是每条注释及其计算方法与读取的内容。
- `public/fixtures/programs.json`——feed 的 `GET /programs`：七次已记录的项目运行，即五次代码安全审查与两个 Proving Ground 项目。
- `public/fixtures/runs.json`——五条已提交记录：2026-09-19 记录的两次代码安全审查（第二次 NodeGoat 运行、Java 的 dvja 运行）、一次 tier-5 fleet、一个配对实验，以及 csv-tools program。
- `public/fixtures/events/<run>.jsonl`——每条记录的会话日志经 feed 折叠成指挥台跟随的事件流：NodeGoat 审查有 1,079 条事件，从各部门的开场指令、它们的工具调用，到四张证书与两次合并。
- `public/fixtures/safety/<run>.json`——feed 对每次审查的 `GET /safety/:id`：NodeGoat 审查的 111 个文件与 38 条经验证的发现、dvja 审查的 174 个文件与 40 条，各自带有部门、证书与双语报告。
- `public/fixtures/ops.json`——企业周期的发布步骤写出的运营快照（`pnpm run enterprise:publish` 最后运行 `scripts/enterprise-ops.ts --fixture`），每个周期重写一次；没有 feed 以实时快照回答 `/ops` 时，运营视图把它作为 `recent` 显示并注明时长。

已记录的审查正是 [`data/code-safety/README.md`](../../data/code-safety/README.md) 据以读取召回率的那几次，因此回放展示的与现场运行所展示的完全一致。

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `app/` | 路由。 |
| `components/` | 外壳，以及每个视图一个目录；所有接触 three.js 的都是 Client Component。 |
| `deck/` | 契约、feed 客户端、事件流、store、回放时钟、布局、配色。 |
| `public/fixtures/` | 已提交的回放数据，作为静态文件提供。 |
| `scripts/` | fixture 快照脚本。 |
| `docs/` | 上方的截图。 |

外壳（`app/layout.tsx`）是 Server Component。每个场景都通过 `next/dynamic` 以 `ssr: false` 加载，因为 three.js 在挂载时就会索取 WebGL 上下文。

## 限制

一次运行的已记录历史会一次性到达指挥台，因此流程视图以固定速率乘以回放速度从队列中释放彗星：每条已记录事件都能被看到在飞行，只是在 1× 下比面板计数它晚几秒。

deck 只读取；它从不写入仓库，也从不自己执行审查——`POST /safety` 是请求 feed 执行。位于其他源的实时 feed 必须发送浏览器接受的 CORS 头，否则 deck 会回落到回放。场景需要 WebGL 2；没有 2D 回退。仅当目标的文件清单包含 finding 的 `file` 时，代码城市才会放置该 finding；落在 feed 未报告文件上的 finding 会列在表格中，但不会立起光柱。在最远缩放下，共享的 bloom 会捕捉到点亮的窗户本身，使城市略微发软；调色是四个视图共用的一个合成器，首先为光柱与轨道而调。

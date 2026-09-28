# Agent Note: 公开仓库任务工厂：从宽松许可的公开代码生成带隐藏测试的函数任务

Status: implemented

[English](2026-09-27-public-repository-task-factory.md) | 中文

## Problem

目标三的瓶颈约束是环境数量。Proving Ground bench 持有 44 个手工编写的环境，[补全任务族](../../proposed/architecture/2026-09-22-completion-task-factory.md)把它们增殖为 246 个子环境，而产品模型已经把这些子环境做到饱和；[仓库派生任务族](../../proposed/architecture/2026-09-22-repository-derived-environments.md)证明了一个带文档、带测试的模块就是一份自带验证器的答案，却只从 `packages/util` 产出了两个子环境，因为它的规则要求一个模块绑定一个只导入该模块与 `vitest` 的 spec。而在本仓库从未写过的公开仓库里，存在着数以百计可验证、且从构造上就未被污染的函数任务：小型工具库，其每个导出都带 JSDoc 块，其测试是按函数划分的文件，运行在一个 bench 可以近似的运行器之下。触达它们意味着沿着公开测试套件彼此不同的那些轴去推广仓库派生工厂——带有依赖闭包的模块、导入多个模块或一个 barrel 或一个命名空间的测试、垫片无法运行的块与可以运行的块并存、`node:test` 与 vitest 并存——并给每个子环境附上由第三方代码构建的任务必须携带的东西：其来源、其钉住的 commit、其许可证，以及该许可证所准许的数据使用条款。

## Decision

`tools/synthesize-public-tasks.ts` 从 `tools/public-sources.json` 钉住的来源派生函数实现任务：每个来源记有名称、克隆 URL、完整 commit、SPDX id、许可证文件的路径与 SHA-256、镜像进子环境 `src/` 的目录，以及要读取的目录。工厂用 `git init`、`git fetch --depth 1 origin <commit>` 与 `git checkout FETCH_HEAD` 把每个 commit 取到被 gitignore 的缓存 `.proving-ground/public-sources/<name>` 中，若缓存的 head 已是该 commit 则复用；抓取失败、许可证文件缺失或摘要不符、许可证文本读出的 id 与声明不一致、或 id 不在 MIT、ISC、BSD-2-Clause、BSD-3-Clause、Apache-2.0 之列的来源，在读取任何内容之前就被丢弃，普查会说明是哪一个、为什么。这五种许可证准许派生任务在保留署名的前提下用作训练材料，因此每个子环境的 `task.json` 都在 `public: { source, url, commit, license, licenseFile, licenseSha256, copyright, module, tests }` 之外携带 `terms: { purposes: [delivery, training, evaluation], attribution: LICENSE }`，来源的许可证文本作为不可变的 `LICENSE` 放在工作区根目录，README 的署名小节重述来源、commit、许可证与版权行。公开子环境上的一条 trajectory 只有在路由的 `dataUse/terms` 同样准许训练时才是训练材料；基础 bench 组合只钉住 evaluation，所以子环境携带的条款陈述的是其许可证允许什么，而非某次运行产出了什么。

纯函数的一半 `tools/public-environments.ts` 推广了 `repository-environments.ts`（它从中导入转译、函数定位、抽空、层级、id 与用例条目），而不是复制它。函数定位新增了公开来源使用的两种形式：由后续 `export default name` 或 `export { name }` 语句导出的函数，以及前面带有无函数体重载签名的实现——当它自身没有 JSDoc 时继承第一个重载的 JSDoc。测试的导入决定其命运：`describe`/`it`/`test`/`suite`/`expect`/`vi`/`expectTypeOf`/`assertType` 与四个钩子之内的 `vitest` 或 `@jest/globals` 具名绑定，或 `node:test` 自身集合之内的绑定，决定框架；不导入任何运行器的测试按全局变量形式的 `expect` 家族读取；`node:` 内置模块原样保留，因此 `node:test` 套件的 `assert` 导入照原样运行；相对导入沿着 `export { x } from`、`export { default as x } from` 与 `export * from` 链追到声明它的文件——该文件必须位于来源根目录之下——并把导入改指向该文件的工作区路径，命名空间导入则变成一个由测试所读成员组成的冻结对象；任何包导入都会拒绝该测试。测试导入的模块就是它所评判的模块，其块按模块在所有导入该模块的测试之间汇总，而模块的依赖闭包——传递的相对导入，每一个都改指向工作区，允许 `node:` 内置模块、不允许包——就是子环境 `src/` 所持有的内容：存根在那一个模块里，其余每个文件保持原样。当一个块的函数体、或任一外层层级自身的语句引用 `vi` 或 `mock`、把 `expect` 链到匹配器子集之外或经过 `.resolves`/`.rejects`/`expect.*`、注册钩子、嵌套运行器调用、或使用 `require`/`import()` 时，这个块被单独丢弃并按原因计数；经 `it.each`、`it.skip`、循环、选项对象或非字面量标题注册的块被跳过并按形式计数；所有块都被丢弃或跳过的测试以「一个块都没保住」被拒绝。工厂先对参考实现把汇总后的用例运行两遍，丢弃任一遍失败的用例——那是垫片或转换在这个块上的不足，或是裁决取决于宿主负载的块，这样的块必须离开语料，而不是在某个 cell 里拒绝一个正确的实现——然后为每一个存根至少失败一条剩余用例的、带文档的导出函数写出一个子环境，层级按该数量在仓库派生任务族的 `--tier-bands` 下设定；其 `--admit` 步骤对输出运行 `admit.mjs`，删除准入拒绝的内容，并写出 `REFUSED.json` 与 `CENSUS.json`——按来源记抓取状态与原因、模块数、测试数、可用测试数、按类别的拒绝、按原因丢弃的块与按形式跳过的块、候选数、写出数与准入数；整体记按原因的跳过、参考实现失败的用例数，以及按层级的写出数与准入数。

`expect-shim.mjs` 不再内联进公开子环境的用例：工厂把它作为不可变的 `test/expect-shim.mjs` 写进工作区，每条用例导入它，于是一条用例只有几百字节，而裁决断言的那个文件对 implementer 可见——implementer 从中得不到任何关于用例的信息。垫片新增了候选套件在仓库子集之外最常用的匹配器——`toBeDefined`、`toBeNaN`、`toBeTypeOf`、`toBeInstanceOf`、`toHaveProperty`、`toContainEqual`、`toMatchObject`、`toThrowError`、`toThrowErrorMatchingInlineSnapshot`、`toBeGreaterThanOrEqual`、`toBeLessThanOrEqual`、`toBeCloseTo`——以及运行时空操作 `expectTypeOf` 与 `assertType`，每个只有几行；`MATCHER_SUBSET` 列出了全部这些名字，仓库派生任务族也随之准许它们。`register-public-environments.ts` 把准入保留的内容注册到 `bench` kind 下，领域为 `public`，带 `detail.public`、`detail.terms` 与 `detail.completion`，并拒绝所指名的署名文件缺失、或不携带任何带用例检查的子环境；`overlays/with-public.cordis.yml` 把它挂载在基础组合旁，`overlays/registry-only-with-public.cordis.yml` 是注册器 e2e 启动的无密钥变体。

## Alternatives considered

**就地拓宽仓库派生工厂。** 被否决：它的规则集是仓库派生任务族的普查与 spec 所钉住的契约（一个 spec、只有该模块与 `vitest`、整个 spec 一起拒绝），而公开套件一次性打破了所有这些规则；在同一批纯函数辅助之上建第二个工厂，既让仓库派生任务族的行为保持稳定，又让公开工厂得以推广，而共享部分（`transpile`、`analyzeModule`、`stubFunction`、`tierFor`、`taskId`、`caseEntries`）只存于一处。

**像仓库派生任务族那样把垫片内联进每条用例。** 因体积被否决：数百个子环境、每个若干条用例，每条用例再内联几 KB 的垫片，会让这个任务族远超 bench 所能承载的提交体积；而垫片出现在工作区里并不会透露 prompt 尚未说出的任何东西。仓库派生任务族保留内联形式，因为它的两个子环境不必付出这个代价。

**把 barrel 复制进工作区并从它导入。** 被否决：barrel 会把整个库拖进每一个子环境，而经由 `index` 触达某个函数的测试正是点名该函数的测试，所以沿着再导出链追到声明文件，就能把工作区限制在模块自身的闭包之内。

**为 `vi.fn()` 与 mock 匹配器、chai 的 `assert` 加垫片，或展开 `it.each` 与循环。** 推迟而非否决：每一项都是比一个匹配器更大的扩展，普查已统计每一项能挽回多少（因 `vi` 丢弃的块、因包导入拒绝的测试、按形式跳过的块），需要它们的来源都已列入白名单，后续切片可以度量其收益。

**接受 copyleft 或无许可证的来源，并把其条款标记为不可训练。** 被否决：由第三方代码构建的任务是派生作品，其每一份副本与每一条 trajectory 都携带该许可证，而 bench 没有任何消费者需要一个不可用于训练的任务；在许可证检查处排除这些来源，使这个任务族在所准许的条款上保持一致。

**允许来源根目录之外的闭包文件，映射到第二个目录之下。** 在本切片中被否决：工作区的 `src/` 镜像一个目录，这样子环境的路径读起来就是库自己的路径，而普查显示了这条规则的代价（remeda 中从其 `test/` 目录导入辅助模块的测试）。

## Consequences

白名单列出十个来源——es-toolkit、remeda、simple-statistics、@antfu/utils、case-anything、string-ts、ms、date-fns、ufo 与 change-case，九个 MIT、一个 ISC，每个都钉住了 commit 与许可证摘要——已入库的这次运行读取了全部十个：2,027 个模块与 808 个测试文件，其中 537 个可用；627 个带文档的函数进入了存根运行，560 个成为子环境——第 2 层 224 个、第 3 层 240 个、第 4 层 96 个——另有 65 个没有任何用例触达、2 个与已占用的名字重复，4 条汇总用例因参考实现失败而被丢弃，准入未拒绝任何一个，因此 `REFUSED.json` 是 `[]`。每个子环境都是 `heldOut: false`、领域 `public`、只依其用例评判，并携带来源的许可证文本与条款，因此按子环境条款过滤的 trajectory 导出可以在路由条款同样准许时把它纳入训练。已提交的任务族在工作树中占 21.7 MiB、9,745 个文件，其中大部分是 git 只存一份的重复内容（垫片、每个来源的许可证，以及在一个来源的多个子环境间反复出现的闭包文件）：不重复的内容为 2,980 个 blob、7.9 MiB，打成增量压缩的 pack 后为 1.7 MiB；相比之下补全任务族占 23 MiB、2,354 个文件。这个任务族的测试就是来源自己的测试，以同样的许可证公开发布，任何在公开代码上训练过的模型都读过它们，因此它上面的证书只在 implementer 没有背下测试套件的程度上度量「从文档出发的实现」；下面的冒烟结果说明了对产品模型而言这能走多远。仓库派生任务族的 spec 改了两处期望：前面带重载签名的实现现在继承该签名的 JSDoc，`toMatchObject` 位于子集之内。仓库里有两个门禁把这个任务族的子环境当作任务内容而非文档：双语配对 manifest 排除了该目录，`verify-md-links` 不扫描其 README，因为子环境的 README 逐字重复其来源的 JSDoc，其中的链接（remeda 的 `clone` 指向 `#isPlainObject`）应由来源自己的文档站点解析。

## Verification

对十个钉住的来源运行 `node tools/synthesize-public-tasks.ts --admit`，写出了上述任务族及其普查；之后对同样这些 commit 重新抓取的 checkout 再次运行，逐字节重现了 `CENSUS.json` 与每个子环境的用例，再对该目录运行 `admit.mjs`，准入了同样的 560 个、未拒绝任何一个。宿主负载较高时的一次运行曾多丢弃一条参考用例——remeda 使用真实计时器的 `debounce.test.ts › can check for inflight timers (trailing)`——这正是参考实现现在对每条用例运行两遍的原因。`examples/headless-agent/tests/proving-ground-public-family.spec.ts` 逐行覆盖纯函数模块——许可证分类与条款、白名单校验、解析与工作区路径、运行时导入与说明符改写、导出映射与 barrel 追踪、在 vitest、命名空间、`node:test`、钩子、丢弃、跳过与拒绝各情形上的 `analyzeTest`、作为用例程序运行的新增匹配器、任务文件与 README——并对一个经 `file://` URL 触达的本地仓库端到端地运行工厂，其中一个改换了许可证的与一个不可达的同级来源被丢弃并计入普查。`proving-ground-bench.e2e.ts` 启动 `registry-only-with-public.cordis.yml`，在精选任务之外至少一百个公开 cell 之中找到 `code:ms--implement-parse`。冒烟舰队 `public-smoke-sonnet`——每个钉住的来源各取一个已准入的子环境，十个 cell 在中间模型上，种子 1，密封，同时两个——10 之 10 获证书，其中 8 个在第一次尝试，墙钟时间 307 s、cell 时间 606 s（每个 cell 13 到 210 s，中位数 48 s），记录为 [`2026-09-27-bench-public-smoke-sonnet`](../../../../data/proving-ground/2026-09-27-bench-public-smoke-sonnet/manifest.json)：这个任务族能以来源自己的测试为裁决、在产品路由上端到端地跑通，而需要第二次尝试的两个 cell 在第一次都是被文档没有言明的隐藏边角用例拒绝的；它能在多大程度上区分模型，要等更大的舰队与开放权重路由在它上面跑过才能度量。门禁：宿主编译面、lint、knip、`verify-cordis-config`、`verify-translation-pairing`、`verify-agent-note-format`、`doc-sync` 与 `scripts/proving-ground.spec.ts` 均通过。

# Agent Note: 仓库派生环境：从本仓库自身经过测试的代码生成函数任务

Status: proposed

[English](2026-09-22-repository-derived-environments.md) | 中文

## Problem

[补全任务族](2026-09-22-completion-task-factory.md)增殖了 Proving Ground bench 手工编写的环境，但它仍然建立在手工编写的父环境之上：44 份参考程序限定了补全子环境的数量上限，而每新增一个父环境都要付出规格、参考实现、可见测试套件与准入的成本。与此同时，本仓库还持有另一批没有人专门为 bench 编写的、既有文档又有测试的函数：每一个 `packages/*/*/src/*.ts` 模块的每个导出都带有 JSDoc，并配有一份在 CI 中通过的 vitest spec。这批语料本身就是一份附带验证器的答案卷，而一个能在自身代码上度量自己的 harness，就拥有了随代码一起增长的任务来源。

在这批语料与 bench 之间横着两件事。这些模块是 TypeScript，而 bench 的工作区通过组合好的 shell 在纯 `node` 下运行，没有编译器、没有测试运行器、没有安装任何依赖。而且这些 spec 是 vitest spec：其 `describe`/`it` 结构与 `expect` 匹配器是 bench 的带用例检查所不具备的运行时，而它们的函数体恰恰是实现者绝不能看到的材料——它们就是评判实现的标准。

## Proposal

`tools/synthesize-repository-tasks.ts` 像 polyglot fixture 的 `admit.ts` 一样，由纯 `node` 通过其原生类型剥离运行；它读取 `<packages-dir>/<package>/src/*.ts` 下的每个模块（默认 `packages/util`），并把它与 `<package>/tests/` 下这样一份 spec 配对：其运行时导入恰好只有该模块（相对路径或其包名）与 `vitest`，且只绑定 `describe`、`it`、`test`、`expect`。仅类型导入会在转译中被擦除，不计入其中。分析通过 TypeScript 编译器的解析器进行，而非文本扫描，因为工厂本来就依赖编译器做转译：`ts.transpileModule` 产出工作区所持有的纯 ESM JavaScript（保留注释、省略仅类型导入），同一个解析器还定位每一个导出的块体函数、它自己的 JSDoc（紧贴其上方的最后一个 `/**` 注释，这样文件的 `@module` 注释不会变成第一个声明的文档）、直到函数体为止的 TypeScript 签名，以及每一个顶层 `interface` 与 `type` 声明。

spec 的每个 `it` 块都成为一条隐藏用例：一个自包含的 ESM 程序，由 `node --input-type=module` 在工作区中从标准输入读取，由逐字内联的匹配器垫片 `tools/expect-shim.mjs`、把模块导入重定向到 `./src/index.js` 后的 spec 导入、spec 的模块级语句，以及每一层外围 `describe` 对应的一个块（持有该层的其余语句，最内层持有 `it` 的函数体）组成。每一层的全部语句都在函数体之前运行，这正是 vitest 自身的顺序（先收集、后执行）；每一层都是一个块，因此某一层声明的名字会像回调作用域那样遮蔽外层的同名。用例期望的退出码为 0，且只比较退出通道，因此实现碰巧打印的日志不会让断言成立的用例失败；断言失败是一个未捕获的 `AssertionError`，`node` 会把它报告到 stderr 并以非零退出。垫片实现 `toBe`、`toEqual`、`toStrictEqual`、`toBeUndefined`、`toBeNull`、`toBeTruthy`、`toBeFalsy`、`toHaveLength`、`toContain`、`toThrow`、`toMatch`、`toBeGreaterThan`、`toBeLessThan`，每一个都可加 `.not`；spec 分析会拒绝任何越出该集合的 spec 并打印原因：其他导入、其他 vitest 绑定、`it.each` 或任何修饰符、带参数或没有块体的回调、在带标题块语句之外的任何位置调用的 `describe`/`it`、`expect.any` 或 `.resolves`/`.rejects`、动态导入，以及没有 `it` 的 spec。

工厂先对转译后的参考实现运行全部用例，参考实现在任一用例上失败的模块会被跳过，因为那是垫片或转换的不足，而非模块的问题。对每一个带 JSDoc 的导出函数，它把转译后的模块抽空为存根——函数体替换为 `throw new Error('not implemented')`，其余每个字节不动——对存根运行用例，并保留失败的那些：它们就是直接或经由另一个导出触达该函数的用例。没有任何用例触达的函数不产生子环境。子环境的层级取决于这个数量（`--tier-bands`，默认 `4,12`：不足四条为第 2 层，不足十二条为第 3 层，十二条及以上为第 4 层），每个子环境都是 `heldOut: false`，因为这个任务族没有可以继承切分的父环境；子环境目录 `environments-repository/<package>--<function>/` 持有 `src/index.js`（存根）、`README.md`（prompt 加上被擦除的类型声明，使签名与文档用到的每个名字都能解析）、`package.json`、`reference/src/index.js`、`reference/cases.json`，以及 `task.json`，后者携带 `id: code:<package>--implement-<function>`、`domain: repository`、`repository: { package, module, spec }`、`completion: { file, function }` 与两个检查：`spec-cases`（`run: node --input-type=module`，`cases: reference/cases.json`）和 `no-dependencies`。prompt 指明文件与函数，并交出 JSDoc 与签名；它从不泄露 spec。

`admit.mjs` 新增第二个任务族标记（`--implement-` 与 `--complete-` 一样在目录比较前被剥离），并从任务自身的检查中读取可见测试套件——`run` 调用 `node --test` 的那个检查——而不再使用固定命令；没有这样一个检查的任务只依其用例评判：预状态必须至少与一条用例不符，参考实现必须重现每一条用例，而既无套件又无带用例检查的任务会被拒绝。对每一个精选任务与补全任务，套件检查都是同一条 `node --test test/*.test.js`，因此它们的准入不变。`register-repository-environments.ts` 把准入保留的内容注册到同一个 `bench` kind 下，该 kind 的 detail 在两个 fixture 完全一致的声明中新增一个可选的 `repository` 字段；用例文件的读取从 `register-environments.ts` 移入 `bench-cases.ts`，使两个注册器通过同一个函数读取用例文件。`overlays/with-repository.cordis.yml` 把该生产者挂载在基础组合之外，`overlays/registry-only-with-repository.cordis.yml` 是注册器 e2e 所启动的无密钥变体。

### Counts

在默认参数（`--min-lines 1`、`--tier-bands 4,12`）下对 `packages/util` 运行：

- 7 个包，14 个模块；1 个模块拥有规则准许的 spec。
- 按原因跳过的模块：7 个没有任何 spec 导入它们（六个 `invariant.ts` 伴随模块与 `dsh-brand`，后者没有 spec 的类型仅存在于编译期）；3 个 spec 绑定了四个名字之外的 vitest 名字（`home-paths` 与 `timeout` 绑定 `afterEach`，`launch-environment` 绑定 `vi`）；2 个 spec 导入了模块与 `vitest` 之外的东西（`atomic-write` 的 index spec 导入 `node:fs/promises`，其 invariant spec 导入 `@deepseek-ai/cordis`）；1 个模块没有导出任何块体函数（`dsh-native-command` 的运行器是表达式体箭头函数）。
- 2 个候选函数，均来自 `@deepseek-ai/dsh-output-retention`；0 个没有 JSDoc，0 个过短，0 个未被触达，0 个被 `node --check` 丢弃。
- 写出 2 个，均为第 3 层：`describeOmitted` 有 7 条触达用例（它自己的三个块，以及调用它的四个 `formatRetentionNotice` 块），`formatRetentionNotice` 有 4 条。
- 准入：准入 2 个，拒绝 0 个；`environments-repository/REFUSED.json` 是 `[]`。

## Alternatives considered

**在验证器内运行 vitest。** 予以拒绝：bench 的 cell 与保留区不安装任何东西，一个带用例检查就是每条用例一个进程、按通道比较，而保留区里的运行器会成为第二个验证器，带来自己需要维护的组合。把匹配器子集内联进每条用例，使验证器仅需 `node`；而"参考实现必须通过每一条用例"这条准入规则，正是对每个已准入 spec 检验该子集是否忠实的经验性检查。

**在工作区中保留 TypeScript 模块，并用 `node` 自身的类型剥离运行它。** 予以拒绝：bench 的语言是 JavaScript，其检查通过组合好的 shell 在宿主机上的任何 `node` 下运行，而仅剥离模式拒绝参数属性、枚举与命名空间，某些模块正在使用它们。编译器的 JavaScript 构建才是该包的消费者所运行的东西，README 则携带被擦除的类型声明，使 prompt 交出的签名能够解析。

**不论是否触达该函数，把 spec 的每个 `it` 块都作为用例携带。** 予以拒绝：存根本来就能通过的用例度量不出该函数的任何东西，还会抬高带用例检查的加权计数，层级也会变成在说模块 spec 有多大，而非该函数承担了其中多少。只保留存根失败的用例是精确的，准入还会独立复核至少有一条用例能够区分。

**用补全任务工厂的文本扫描器提取 JSDoc、签名与类型声明。** 予以拒绝：那个扫描器为纯 JavaScript 参考程序而存在，不读 TypeScript，而这个工厂无论如何都需要编译器做转译；其解析器能精确读取 `describe`/`it` 结构、`expect` 链与导入形式，而扫描器对每一种构造都需要一条启发式规则。

**为工作区生成 `.d.ts`，而不是在 README 中引用类型声明。** 予以拒绝：声明发射需要一个解析了该模块全部依赖的完整程序，而带有 JSDoc 的逐字声明正是源码读者所看到的东西。

**允许 spec 导入 `node:` 内置模块。** 是推迟而非拒绝：这会准入 `atomic-write` 的两个函数——其 spec 在模块之外只使用 `node:fs/promises`、`node:os` 与 `node:path`——而转译后的模块无论如何都在 `node` 下运行。既定规则是"只导入被测模块与 `vitest`"，放宽它是一行策略改动，并有一份普查来展示其效果。

## Acceptance criteria

- `node admit.mjs environments-repository` 在已入库的目录树上以退出码 0 结束，准入其中的每一个子环境并给出其用例数。
- `environments-repository/REFUSED.json` 记录了工厂生成过、但没有保留下来的每一个候选，附带 `admit.mjs` 给出的原因。
- 注册器 e2e 测试中的仓库派生任务族用例会启动 `overlays/registry-only-with-repository.cordis.yml`，并在已注册集合中找到带七条用例、领域为 `repository` 的 `code:output-retention--implement-describeOmitted`。
- 用相同的输入与参数重新运行工厂，会得到相同的写出集合与准入集合，通过对连续两次运行的结果做 diff 验证。
- 纯函数库 `tools/repository-environments.ts` 由 `examples/headless-agent/tests/proving-ground-repository-family.spec.ts` 逐行覆盖，该 spec 还在一个合成的包目录上端到端运行工厂，并把垫片的每一个匹配器作为用例程序运行。

## Risks

**垫片只是对 vitest 的近似。** `toEqual` 与 `toStrictEqual` 在未定义值属性、原型、数组、类型化数组、`Map`、`Set`、`Date`、`RegExp`、`Error` 与环上遵循 vitest，`toThrow` 在其五种参数形式上亦然；但依赖该范围之外某个角落（非对称匹配器、对带访问器的类实例做 `toEqual`）的 spec，会在参考实现上失败并让该模块带着失败用例的名字被跳过，而不是准入一个标准错误的子环境。

**普查规模从构造上就很小。** `packages/util` 产出两个子环境，这正是严格规则集所能产出的；这个任务族的增长途径是放宽规则（`node:` 内置模块、只做赋值的 `beforeEach`）、覆盖类方法，或把 `--packages-dir` 指向另一个包组，每一项都是有其自身普查的独立决定。

**隐藏用例就是模块自身的测试，而它们就在本仓库里。** 读过本仓库的实现者、或在其上训练过的模型，可能回忆起 spec 而非依文档实现；这个任务族只在实现者没有见过测试的程度上度量"依文档实现"，在它上面得到的结果也应如此说明。

**文档可能规定不足。** `describeOmitted` 的 JSDoc 引用的是 `Omitted 3 items`，而其 spec 期望末尾有句号；文档留下这种空隙的子环境，很难仅凭文档拿到证书。这既是对实现者的度量，也是对文档的度量，普查会如实报告而不是掩盖。

**`ownDocStart` 是一条启发式规则。** 一个声明的 JSDoc 被认定为紧贴其上方、中间没有空行的最后一个 `/**` 注释，这符合本仓库的风格；把声明与其 JSDoc 用空行隔开的模块会产出一个没有 JSDoc 的候选，普查会把它计入。

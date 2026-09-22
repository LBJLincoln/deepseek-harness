# Proving Ground bench（试炼场基准）

[English](README.md) | 中文

零依赖的多领域程序任务，从 `environments/<task>/task.json` 文件注册，既可通过本 harness 自身的 agent loop 运行，也可通过产品自身的 loop 运行，并在冻结的成对实验中比较。[`SUMMARY.md`](SUMMARY.md) 记录了哪些层级的判定依赖实现者看不到的用例；[`plans/README.md`](plans/README.md) 记录了已提交的实验与舰队计划；[`packages/improvement/environments/README.md`](../../../../../packages/improvement/environments/README.md) 记录了每个任务都会注册进去的注册表服务。

## 补全任务族（completion family）

[`tools/synthesize-completion-tasks.mjs`](tools/synthesize-completion-tasks.mjs) 把这 44 个手工编写的环境增殖为补全任务：对每个父环境及其参考程序中的每个顶层函数，都会在 `environments-completion/<parent>--<function>/` 下写出一个子环境，其工作区持有该参考解答，但把其中那一个函数的函数体替换为 `throw new Error('not implemented')`（签名及其前导注释或 JSDoc 保持不变）；其 `test/` 与 `package.json` 与父环境相同，未作改动；其 prompt 则是父环境的 prompt 再加一段文字，指明要补全的文件与函数，并禁止修改其余任何地方。[`register-completion-environments.ts`](register-completion-environments.ts) 只注册工厂已经准入的内容，注册到与这 44 个精选任务相同的 `bench` kind 下，用 `detail.family` 标注父任务、用 `detail.completion` 标注被抽空的文件与函数；[`with-completion`](overlays/with-completion.cordis.yml) overlay 把它作为精选生产者之外的第二个生产者挂载，[`with-completion-openrouter`](overlays/with-completion-openrouter.cordis.yml) 则把它与 `with-openrouter` 所命名的免费开放权重路由一并挂载。

补全子环境的 `checks` 从不携带隐藏用例：`admit.mjs` 与工厂自身的 `--admit` 步骤只准入这样的子环境——其预状态无法通过自身可见测试套件，而其参考解答能够通过；因此补全任务的证书只说明那一个被抽空的函数现在通过了实现者能读到的测试，和验证者持有的隐藏语料毫无关系，后者由精选的第 5、第 6 层任务以及仓库派生任务族携带。`environments-completion/REFUSED.json` 记录了工厂生成过、但准入拒绝了的每一个候选函数及其原因——最可能的原因是父环境的可见测试套件根本没有触达该函数，因此把它抽空后预状态检查也看不出任何失败。已入库的这次运行在这 44 个环境上没有拒绝任何一个，因此该文件是 `[]`。

每个补全子环境都继承其父环境的 `heldOut` 标记，因此同一个任务族不会横跨留存切分：从同一份参考程序抽出的函数，要么全部可用于训练，要么全部被留存，与其父环境本身所属的一侧一致。

## 仓库派生任务族（repository-derived family）

[`tools/synthesize-repository-tasks.ts`](tools/synthesize-repository-tasks.ts) 从本仓库自身经过测试的代码派生出函数实现任务：对 `packages/util/<package>/src/*.ts` 下的每个模块——只要其 `tests/` 下的 spec 只导入该模块与 `vitest`、只绑定 `describe`、`it`、`test`、`expect`，并且只通过 [`tools/expect-shim.mjs`](tools/expect-shim.mjs) 实现的匹配器子集断言（`toBe`、`toEqual`、`toStrictEqual`、`toBeUndefined`、`toBeNull`、`toBeTruthy`、`toBeFalsy`、`toHaveLength`、`toContain`、`toThrow`、`toMatch`、`toBeGreaterThan`、`toBeLessThan`，每一个都可加 `.not`）——以及该模块中每一个带有 JSDoc 块的导出函数，都会在 `environments-repository/<package>--<function>/` 下写出一个子环境：由 TypeScript 编译器转译为纯 ESM JavaScript 的模块，其中那一个函数的函数体被替换为 `throw new Error('not implemented')`（其余每个导出保持完整）；一份属于任务内容的 `README.md`（prompt 加上被构建擦除的类型声明）；`reference/src/` 下转译后的参考实现；以及 `reference/cases.json` 下、对应每一个触达该函数的 `it` 块的一条隐藏用例——一个自包含的 ESM 程序，由 `node --input-type=module` 从标准输入读取，通过时以 0 退出，失败时以非零退出并给出断言消息，因此用例只需纯 `node` 就能运行，无需安装任何测试运行器。prompt 指明文件与函数，并交出 JSDoc 与 TypeScript 签名；它从不泄露 spec。不符合这些规则的 spec 会被跳过并打印原因，工厂打印的普查会统计候选、按原因分类的跳过以及准入的子环境。[`register-repository-environments.ts`](register-repository-environments.ts) 把工厂已经准入的内容注册到同一个 `bench` kind 下，领域为 `repository`，用 `detail.repository` 标注包、模块与 spec，用 `detail.completion` 标注被抽空的文件与函数；[`with-repository`](overlays/with-repository.cordis.yml) overlay 把它作为精选生产者之外的第二个生产者挂载。

仓库派生子环境只依其隐藏用例评判：其工作区不含任何测试，`admit.mjs` 只准入存根至少失败一条用例、且参考实现通过全部用例的子环境，工厂的 `--admit` 步骤会删除准入拒绝的内容，并把原因记录进 `environments-repository/REFUSED.json`。子环境的层级取决于触达其函数的用例数量（`--tier-bands`，默认 `4,12`：不足四条为第 2 层，不足十二条为第 3 层，十二条及以上为第 4 层），每个子环境都是 `heldOut: false`，因为这个任务族没有可以继承切分的父环境。已入库的这次运行读取了 `packages/util` 中 7 个包的 14 个模块，并从其中一个派生：七个模块没有任何 spec 导入它们（六个 `invariant.ts` 伴随模块与 `dsh-brand`），三个 spec 绑定了 `vi` 或 `afterEach`，两个导入了 `node:fs/promises` 或 `@deepseek-ai/cordis`，`dsh-native-command` 没有导出任何块体函数；`@deepseek-ai/dsh-output-retention` 产出两个第 3 层子环境——`describeOmitted` 七条用例、`formatRetentionNotice` 四条用例——二者均获准入，因此 `REFUSED.json` 是 `[]`。

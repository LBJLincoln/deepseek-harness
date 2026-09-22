# Proving Ground bench（试炼场基准）

[English](README.md) | 中文

零依赖的多领域程序任务，从 `environments/<task>/task.json` 文件注册，既可通过本 harness 自身的 agent loop 运行，也可通过产品自身的 loop 运行，并在冻结的成对实验中比较。[`SUMMARY.md`](SUMMARY.md) 记录了哪些层级的判定依赖实现者看不到的用例；[`plans/README.md`](plans/README.md) 记录了已提交的实验与舰队计划；[`packages/improvement/environments/README.md`](../../../../../packages/improvement/environments/README.md) 记录了每个任务都会注册进去的注册表服务。

## 补全任务族（completion family）

[`tools/synthesize-completion-tasks.mjs`](tools/synthesize-completion-tasks.mjs) 把这 44 个手工编写的环境增殖为补全任务：对每个父环境及其参考程序中的每个顶层函数，都会在 `environments-completion/<parent>--<function>/` 下写出一个子环境，其工作区持有该参考解答，但把其中那一个函数的函数体替换为 `throw new Error('not implemented')`（签名及其前导注释或 JSDoc 保持不变）；其 `test/` 与 `package.json` 与父环境相同，未作改动；其 prompt 则是父环境的 prompt 再加一段文字，指明要补全的文件与函数，并禁止修改其余任何地方。[`register-completion-environments.ts`](register-completion-environments.ts) 只注册工厂已经准入的内容，注册到与这 44 个精选任务相同的 `bench` kind 下，用 `detail.family` 标注父任务、用 `detail.completion` 标注被抽空的文件与函数；[`with-completion`](overlays/with-completion.cordis.yml) overlay 把它作为精选生产者之外的第二个生产者挂载，[`with-completion-openrouter`](overlays/with-completion-openrouter.cordis.yml) 则把它与 `with-openrouter` 所命名的免费开放权重路由一并挂载。

补全子环境的 `checks` 从不携带隐藏用例：`admit.mjs` 与工厂自身的 `--admit` 步骤只准入这样的子环境——其预状态无法通过自身可见测试套件，而其参考解答能够通过；因此补全任务的证书只说明那一个被抽空的函数现在通过了实现者能读到的测试，和验证者持有的隐藏语料毫无关系，后者只有精选的第 5、第 6 层任务才携带。`environments-completion/REFUSED.json` 记录了工厂生成过、但准入拒绝了的每一个候选函数及其原因——最可能的原因是父环境的可见测试套件根本没有触达该函数，因此把它抽空后预状态检查也看不出任何失败。已入库的这次运行在这 44 个环境上没有拒绝任何一个，因此该文件是 `[]`。

每个补全子环境都继承其父环境的 `heldOut` 标记，因此同一个任务族不会横跨留存切分：从同一份参考程序抽出的函数，要么全部可用于训练，要么全部被留存，与其父环境本身所属的一侧一致。

# @deepseek-ai/dsh-components-packages

[English](README.md) | 中文

把一个组合所运行的包镜像进组件注册表：每个已挂载的 Loader 条目对应一个 `plugin` 组件，agent 在运行期编写的包每有一次存活激活就对应一个 `dynamic-package` 组件。

## 配置

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-packages
  name: '@deepseek-ai/dsh-components-packages'
- id: cordis-host-runner
  name: '@deepseek-ai/dsh-cordis-host-runner'
```

该适配器不接受配置，并要求 `ctx.components` 与 `ctx.loader`。动态运行器是可选的：没有它的组合不会挂载运行期编写的包，适配器只镜像 Loader 条目。

## 约定

一行在拥有存活 fiber 后才算在用，而被禁用的条目、失败的条目以及选项尚未落定的树节点都没有存活 fiber；group 条目承载其他行，本身不组合任何包。适配器在每次条目所属 fiber 的状态变化（`internal/status`）与每次条目更新落定（`loader/partial-dispose`）时重新计算整棵树，因为同级条目并发挂载，且 config 补丁会替换条目选项而不替换其 fiber。每个组件的 id 为 `plugin:<entryId>`，类别为 `plugin`，`provenance: 'curated'`，`digestBasis: 'registration'`，不带 `invoke` 指针，`detail: { specifier }`；`pluginComponentId(entryId)` 为消费方构造该 id。

`plugin` 的规范值是 `[specifier, config]`，由 `pluginDigest(specifier, config)` 寻址。配置文件以字面量书写 `name`，因此在组合了同一配置的每台主机上 specifier 都相同；无法通过无损 JSON 边界的 config 贡献 `null`，与缺失时完全一致。其依据是 `registration`：该行说明挂载了哪个包、带什么配置，从不说明这个包发布的字节。

动态包在运行器自身的无过滤通知 `cordis/dynamic-changed` 上按 Session 对账，并通过 `listPlugins` 与 `inspectPackage` 读取。只有存活的激活才是在用的代码；已定义但未启动的包只是会话写下而未挂载的源码。每个组件的 id 为 `dynamic-package:<pluginId>`，类别为 `dynamic-package`，`provenance: 'synthesized'`，`digestBasis: 'content'`，`detail: { pluginId, packageId, packageName }`，由 `dynamicPackageDigest(pluginId, packageId, hostSource, clientSource)` 寻址，因此在同一 plugin 上定义的修正包地址不同。该描述符通过所属 agent 自己的上下文注册，因此合成代码只在那个会话的清单中被指名。释放适配器 fiber 会移除它注册的全部组件。

## 模型体验

无，因为适配器只注册组件元数据；被镜像的每个包各自负责其注册内容的一切模型可见影响。

#### KV Cache 影响

无；适配器既不增加也不改变任何模型请求。

## 已知限制与暂缓事项

- **源码编辑不会移动 `plugin` 摘要** — 它寻址的是被组合的那一行，而不是包的字节，而这里的每个 workspace 包共用同一个版本号。harness 源码由其基线提交与补丁集寻址；仅按 plugin 摘要比较会把同一个包的不同代混为一谈。
- **不含包版本与补丁层** — 把 specifier 解析到其 package manifest、以及对当前生效 bundle 的 `cordis.patch.yml` 行做哈希，都需要 Loader 条目并不携带的读数；需要它们的消费方改读组合该部署的 profile。
- **已释放会话的动态包会滞留在适配器自己的表中** — 该注册随那个 agent 的层一同离开，但其记账行只有在该 plugin 再次变化时才被清除；该表的规模以一个进程定义过的动态 plugin 数量为界。
- **处于注册表服务隔离域之外的 agent 只被报告、不被记录** — 适配器发出告警且不登记任何内容，因为登记到别处的描述符会把那个会话的合成代码指到并不属于它的组合里。

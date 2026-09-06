# @deepseek-ai/dsh-components-packages

English | [中文](README.zh.md)

Mirrors the packages a composition runs into the component registry: one `plugin` component per mounted Loader entry, and one `dynamic-package` component per live activation of a package an agent wrote at runtime.

## Config

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-packages
  name: '@deepseek-ai/dsh-components-packages'
- id: cordis-host-runner
  name: '@deepseek-ai/dsh-cordis-host-runner'
```

The adapter takes no configuration and requires `ctx.components` and `ctx.loader`. The dynamic runner is optional: without it a composition mounts no runtime-written packages, and the adapter mirrors Loader entries alone.

## Contract

A row is in play once it has a live fiber, which is what a disabled entry, a failed one, and a tree node whose options have not settled all lack; a group entry carries other rows and composes no package of its own. The adapter recomputes the tree on every entry-owning fiber transition (`internal/status`) and on every settled entry update (`loader/partial-dispose`), because siblings mount concurrently and a config patch replaces an entry's options without replacing its fiber. Each component has id `plugin:<entryId>`, kind `plugin`, `provenance: 'curated'`, `digestBasis: 'registration'`, no `invoke` pointer, and `detail: { specifier }`; `pluginComponentId(entryId)` builds the id for consumers.

The `plugin` canonical value is `[specifier, config]`, addressed by `pluginDigest(specifier, config)`. A config file states `name` literally, so the specifier is identical on every host that composed the same configuration, and a config that does not survive the lossless-JSON boundary contributes `null` exactly as an absent one does. The basis is `registration`: the row names which package is mounted and with what configuration, never the bytes that package ships.

Dynamic packages are reconciled per Session on `cordis/dynamic-changed`, the runner's own unfiltered notification, and read through `listPlugins` and `inspectPackage`. Only a live activation is code in play; a defined-but-unstarted package is source the session wrote and has not mounted. Each component has id `dynamic-package:<pluginId>`, kind `dynamic-package`, `provenance: 'synthesized'`, `digestBasis: 'content'`, and `detail: { pluginId, packageId, packageName }`, addressed by `dynamicPackageDigest(pluginId, packageId, hostSource, clientSource)` so a corrected package defined on the same plugin addresses differently. The descriptor is registered through the owning agent's own context, so synthesized code is named in that session's manifest alone. Disposing the adapter fiber removes every component it registered.

## Model Experience

None, as the adapter registers component metadata only; each mirrored package owns every model-visible effect of what it registers.

#### KV Cache effect

None; the adapter neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **A `plugin` digest does not move on a source edit** — it addresses the composed row, not the package bytes, and every workspace package here shares one version. Harness source is addressed by its base commit and patch set; a comparison keyed on plugin digests alone pools generations of the same package.
- **No package version or patch layer** — resolving a specifier to its package manifest, and hashing the `cordis.patch.yml` rows of the bundles in force, both need readings the Loader entry does not carry; a consumer that needs them reads the profile that composed the deployment.
- **A dynamic package of a disposed session lingers in the adapter's own table** — the registration left with that agent's layer, but its bookkeeping row is pruned only when that plugin changes again; the table is bounded by the dynamic plugins one process defined.
- **An agent outside the registry's service isolate is reported, not recorded** — the adapter warns and files nothing, because a descriptor filed anywhere else would name that session's synthesized code in a composition it does not belong to.

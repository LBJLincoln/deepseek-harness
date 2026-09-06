# @deepseek-ai/dsh-command-components

English | [中文](README.zh.md)

Human-facing read-only `/components` command rendering the composition's component inventory grouped by kind, each line carrying the component's provenance, lineage, member count, and the tool that reaches it. The registry stays the only writer; this adapter only reads.

## Config

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
- id: command-components
  name: '@deepseek-ai/dsh-command-components'
```

The command registers globally through `ctx.commands` and requires the component registry; a composition without a command adapter simply never invokes it.

## Command

`/components` takes no arguments. The invoking agent is the viewing scope, so the inventory is what that agent sees: the global layer plus every layer on its scope chain, the nearest registration winning a duplicate id. Without visible components it prints the empty-inventory notice; otherwise it prints the total, then each kind in first-seen order with its count and one line per component: the id, the description, the provenance, and, when present, `from <lineage>`, `<n> members`, and `via <tool>`. A rejected argument or an empty inventory never writes a session event.

## Model Experience

### Human `/components` view

#### What the model sees

Nothing. The `/components` input and the rendered inventory are absent from model requests, and the command writes no session events.

#### Token effect

Zero direct token effect; the command neither adds nor removes model-visible content.

#### KV Cache effect

None; command discovery and direct output never touch the request prefix.

## Known Limitations and Deferred Work

- **Read-only by design** — registration stays with producer adapters; a human registration grammar would create components no seam mirrors.
- **Plain-text inventory only** — filtering by kind, adapter-specific badges, and a Web client panel remain future UI work.
- **Identity fields unrendered** — a line names the component but not its content address or registry layer; showing a truncated digest and the layer is presentation work a UI can add without touching the registry.
- **Web command adapter only in the shipped apps** — headless, ACP automation, and JSON-RPC adapters do not consume `ctx.commands`; those callers read `ctx.components` directly.

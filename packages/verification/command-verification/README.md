# @deepseek-ai/dsh-command-verification

English | [中文](README.zh.md)

Human-facing read-only `/verification` command rendering the session's evidence ledger: the current completion standard, its certificate status with per-check pass evidence, recorded relaxations, and the directive count. Mutations stay with the validator-side service verbs; this adapter only reads.

## Config

```yaml
- id: verification
  name: '@deepseek-ai/dsh-verification'
- id: command-verification
  name: '@deepseek-ai/dsh-command-verification'
```

The command registers globally through `ctx.commands` and requires the completion-standard service; a composition without a command adapter simply never invokes it.

## Command

`/verification` takes no arguments. Without a current standard it prints the empty-ledger notice; with one it prints the goal, revision, certificate status (`certified` with isolation level and passed-check count, or `not certified`), the active checks with their outcomes (each carrying its pass evidence while a covering certificate exists), the relaxed checks with their recorded evidence, and the session's directive count. A rejected argument or missing standard never writes a session event.

## Model Experience

### Human `/verification` view

#### What the model sees

Nothing. The slash input and the rendered ledger are absent from model requests, the command writes no session events, and the completion-standard state it reads is itself log-only.

#### Token effect

Zero direct token effect; the command neither adds nor removes model-visible content.

#### KV Cache effect

None; command discovery and direct output never touch the request prefix.

## Known Limitations and Deferred Work

- **Read-only by design** — authoring, extending, relaxing, and run recording stay with the service verbs used by validator-side callers; a human mutation grammar would duplicate authority the validator owns.
- **Plain-text ledger only** — adapter-specific badges, live status widgets, and a Web client panel over the `verification` session projection remain future UI work.
- **Web command adapter only in the shipped apps** — headless, ACP automation, and JSON-RPC adapters do not consume `ctx.commands`; those callers read the `verification` projection or the service directly.

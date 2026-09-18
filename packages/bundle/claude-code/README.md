# `@deepseek-ai/dsh-claude-code`

English | [中文](README.zh.md)

The dsh Claude Code bundle. [`cordis.patch.yml`](cordis.patch.yml) is a patch layer over [`dsh-base`](../base/README.md) and [`dsh-headless`](../headless/README.md) that serves every model request of the one-shot task mode from the Claude Code installation the operator has already authenticated, so `dsh --profile claude-code "task"` runs the same task mode as `--profile headless` without an API key. The package has no runtime API; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code.

The layer reaches exactly three rows. It inserts `llm-claude-code` ([`dsh-llm-claude-code`](../../llm/llm-claude-code/README.md)) as the `claude-code` provider route over three models — `opus`, `sonnet`, and `haiku`, each carrying the `productModel` the installation is asked to run and a 200,000-token `contextWindow` — at `effort: medium` and a five-minute `queryTimeoutMs`. It repoints [`agent-default-model`](../../core/agent-default-model/README.md) at `claude-code`/`sonnet`; an id-targeted patch replaces the whole config, so both fields are restated. And it restates the `system-prompt` persona, because the headless persona renders `{{model}}` with nothing naming what serves it, and on this route that placeholder resolves to a product alias. Nothing else moves: the route injects `subprocess`, which the base layer already mounts as `@deepseek-ai/dsh-subprocess-local`, and the one-shot runner, its startup provider, and the disabled HMR row stay as `dsh-headless` composed them.

The keyed adapters stay mounted. [`llm-deepseek`](../../llm/llm-deepseek/README.md) resolves its credential per request and keeps its route registered and its catalog browsable without one, and [`llm-pi-ai`](../../llm/llm-pi-ai/README.md) registers no route at all until a `llm-pi-ai:` settings section supplies provider profiles. Neither fails a keyless load, so disabling them would only take away routes a user's own profile patch layer can still select.

## Model Experience

### The deployment persona

#### What the model sees

The persona this layer configures on the `system-prompt` row, rendered as the order-0 `deployment:persona` section, with `{{model}}` resolving to the selected model id — `sonnet` unless a request names another — and `{{cwd}}` to the session's working directory. Selecting the `claude-code` route also means that whole prompt reaches the model inside the installation's own system-prompt envelope, which [`dsh-llm-claude-code`](../../llm/llm-claude-code/README.md) neither authors nor can inspect.

##### Verbatim persona

```markdown
You are a coding agent powered by the Claude Code {{model}} model. Your working directory is {{cwd}}.
```

#### Token effect

One short sentence per request, replacing the persona `dsh-headless` configures rather than adding to it; the installation's envelope adds a further fixed amount this layer does not measure.

#### KV Cache effect

The persona sits at the head of the system prompt and is constant for a session, so it preserves the reusable prefix; under the route's default `per-session` continuity the installation reads that prefix back from its own prompt cache.

## Known Limitations and Deferred Work

- **The installation's system-prompt envelope is not in the session log** — the harness authors the persona and every other prompt section, but the product wraps them in text this composition neither writes nor sees, so one model-visible input of every request cannot be reconstructed from the log.
- **One product session per harness session** — the route's default `per-session` continuity resumes a single product session across the steps of a run, so a process killed between steps leaves that session's transcript behind in the operator's own configuration directory.
- **The model ids are product aliases** — `opus`, `sonnet`, and `haiku` name what the installation is asked to run, not a pinned model version, so what a run executes changes with the installation rather than with this composition.

# Agent Note: The claude-code profile

Status: implemented

English | [中文](2026-09-18-claude-code-profile.zh.md)

## Problem

`dsh --profile headless "task"` is the product's one-shot coding run, and it needs `DEEPSEEK_API_KEY`: the base bundle's `agent-default-model` names `deepseek-official`/`deepseek-v4-flash`, and every keyed route resolves a credential the operator may not have. The harness could already run without one — `@deepseek-ai/dsh-llm-claude-code` serves the LLM seam from a Claude Code installation the operator has already authenticated — but only a hand-written composition used it. The Proving Ground bench config is the one place that route is composed, as a raw `cordis.yml` beside its drivers, so an operator with a Claude Code subscription and no API key had nothing to run: no shipped profile reached that route, and reproducing the bench's rows by hand in `$DSH_HOME/profiles/<name>/cordis.patch.yml` is composition work the installation should own.

## Decision

A third in-box bundle, `@deepseek-ai/dsh-claude-code` at `packages/bundle/claude-code`, and a `claude-code` entry in `PROFILE_TEMPLATES` whose layers are `dsh-base`, `dsh-headless`, then this bundle, so `dsh --profile claude-code "task"` auto-initializes on first use exactly as `headless` does. The bundle is a patch layer with no runtime API, like `dsh-base`: its substance is `cordis.patch.yml`, resolved through the `dsh.bundle.patch` manifest field.

The layer reaches three rows and no others. It inserts `llm-claude-code` with the catalog the bench composes — provider `claude-code`, the `opus`, `sonnet`, and `haiku` product aliases with their `productModel` and a 200,000-token `contextWindow`, `effort: medium`, and a five-minute `queryTimeoutMs` — so the two compositions name the same models and a measurement taken on the bench describes the shipped profile. It repoints `agent-default-model` at `claude-code`/`sonnet`, restating both fields because an id-targeted patch replaces the whole config. And it restates the `system-prompt` persona as `You are a coding agent powered by the Claude Code {{model}} model.`, keeping the placeholders `dsh-headless` uses, because on this route `{{model}}` renders a product alias and the headless persona leaves nothing naming what serves it.

The keyed adapters stay mounted. `llm-deepseek` keeps its route registered and its catalog browsable without a credential and fails only the request that needs one, and `llm-pi-ai` registers no route until a settings section supplies provider profiles, so neither fails a keyless load. Disabling them would remove routes a user's own patch layer can still select, which is what the profile-layer order exists to allow.

The package name is `@deepseek-ai/dsh-claude-code`, matching its directory as every other package does, so the `@deepseek-ai/dsh-*` wildcard in `tsconfig.base.json` maps it to source with no per-package entry. Bundle names in this group state the profile layer they are (`base`, `web-app`, `headless`), not the word "profile".

## Alternatives considered

- **Patch the shipped `headless` template instead of adding a profile.** Rejected: the route is a deployment choice, not the mode. An operator with a key and one with a subscription both want the same one-shot mode, and a template that picks the route for them takes away the other.
- **Make the route conditional inside `dsh-headless` with a `!!js` expression on a `DSH_*` variable.** Rejected: an environment switch that silently changes which company serves the request is the opposite of the profile contract, where the composed tree is readable with `--dump-config` before it boots, and `AGENTS.md` keeps deployment-varying choices in validated config rather than hidden defaults.
- **Ship the bench's whole `cordis.yml` as the bundle.** Rejected: the bench composes fleets, experiments, verification, and a curator, none of which a one-shot coding run needs. Only the route rows transfer.
- **Disable `llm-deepseek` and `llm-pi-ai` in the layer.** Rejected: neither fails a keyless load, and a user who adds a key to this profile would have to re-enable rows the layer turned off.

## Consequences

`dsh --profile claude-code "task"` is a keyless one-shot run on the operator's own subscription, and `apps/cli` carries one more bundle dependency, whose own dependency on `@deepseek-ai/dsh-llm-claude-code` reaches the profile module fallback through the launcher's dependency-closure walk. Two model-visible facts follow from the route and are recorded in the bundle README's limitations: the installation wraps the harness system prompt in an envelope the session log cannot reconstruct, and the model ids are product aliases whose resolution belongs to the installation rather than to this composition. A deployment that wants a different alias, effort, or continuity mode overrides the row from its profile `cordis.patch.yml`, restating the fields it keeps.

## Testing

The bundle suite resolves the three real bundle packages through the launcher's own two-anchor `loadProfile` and composes their shipped patch files with `composeEntries`, pinning the route's whole config, the default selection, the persona placeholders, the untouched one-shot rows, and that the keyed adapters stay enabled — with no unmatched-patch warnings, which is what proves the ids this layer targets exist below it. The app-boot profile suite pins the new template's layer order and its auto-initialized manifest. One real run of `dsh --profile claude-code` in an empty directory created the requested file and left two `assistant/message` events recording `claude-code`/`sonnet`, the first fresh and the second resumed on the same product session.

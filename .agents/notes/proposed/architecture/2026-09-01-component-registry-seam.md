# Agent Note: Component registry — every plugin addressable, callable, and scored

Status: proposed

English | [中文](2026-09-01-component-registry-seam.zh.md)

## Problem

Model-callable surfaces are per-kind and disjoint. Tools are called through `ctx.tools`, skills through the `skill` tool over `ctx.skills`, agents through the `subagent` tool over `ctx.subagents`, workflows through the `workflow` and `ralph` tools, and MCP servers through `dsh-mcp-client` mounting their tools; context providers, presets, bundles, and knowledge sources have no callable identity at all. No registry enumerates what a composition can do, and no identity spans kinds.

Nothing attaches to a plugin across its life. Lineage (which plugin a synthesized plugin derived from), provenance (curated versus synthesized), and evidence (which certificates a session earned while the plugin was in play) have no home, so the per-agent scores the [verification seam](2026-08-29-verification-improvement-oversight-seams.md) folds cannot extend to the plugins those agents used.

Runtime self-improvement stops at the session edge. [`tool-cordis`](../../../../packages/extensions/tool-cordis/README.md) lets an agent define and run a plugin in process memory, and its dynamic packages cannot be promoted automatically by design; a synthesized plugin has no route into a shared catalog, so the loop the Hermes Agent runs for skills (write after use, refine in use, curate the core) and the archive the Darwin Gödel Machine keeps for harness rewrites have no substrate here.

A fleet of agents is compositions of compositions: a department is a preset composition of agents, and an agent is a composition of tools, skills, and context plugins. Without one addressing scheme across those levels, leaderboards, judge councils, and promotion policies cannot name what they score.

## Proposal

Add a component registry [capability seam](../../implemented/architecture/2026-06-13-capability-seams.md). A component is one addressable unit of a composition: a plugin, or a plugin-provided member such as a tool, skill, subagent provider, workflow, MCP server, context provider, preset, or composition. The registry records identity, kind, provenance, lineage, membership, and how a model reaches the component; it executes nothing.

**Service Definition (`dsh-components`, `ctx.components`).** `ComponentDescriptor` carries a branded `ComponentId`, a `kind` drawn from the merge-extensible `ComponentKindMap` (each producer package declares its kind by declaration merging, so the registry ships no kind of its own), `name`, `description`, the owning package, `provenance` (`curated` or `synthesized`), an optional `lineage` parent id, optional `members` (child component ids, which makes a composition a component), an optional `invoke` pointer (`{ tool, arguments }`: the existing tool a model calls with fixed arguments to reach the component), and kind-specific `detail`. `register()` returns its disposer and rejects a duplicate id loudly; `list(kind?)` and `get(id)` read. Registrations are composition-time effects, not durable session facts.

**Producers: one adapter package per seam.** Each adapter mirrors its seam's live registry into components and stays in sync through that seam's own events. `dsh-components-subagents` registers every provider from [`ctx.subagents`](../../../../packages/subagent/subagent/README.md) as an `agent-provider` component whose `invoke` names the `subagent` tool with a fixed `provider` argument, following `subagent/provider-added` and `subagent/provider-removed`. Later adapters do the same for tools, skills, workflows, MCP servers, LLM providers, context providers, and presets. A preset composition registers as a `composition` component whose `members` are the components it mounts; that is the recursion a fleet needs: department, agent preset, then tools, skills, and context.

**Consumers.** `/components` (`dsh-command-components`) renders the inventory grouped by kind with provenance and lineage for humans. A later `component_invoke` tool dispatches a component's `invoke` pointer so a model reaches any kind through one call beside the native tools, and Code Mode collapses that into one binding. The verification, improvement, and oversight seams take component ids as the subject of certificates, scores, and audits: a certificate records which components were in play, so scores fold per component exactly as they fold per agent.

**Promotion.** A synthesized component registers with `provenance: 'synthesized'` and `lineage` pointing at the component it derived from, whether a `tool-cordis` dynamic package or an agent-authored skill, and is usable in its own session immediately. It enters a shared catalog only through the improvement seam's promotion: sessions where it was in play produced verification certificates, the environment registry's evaluation passes, and a user approves; the promotion record keeps the lineage so later synthesis may branch from any ancestor rather than only the current best. Nothing in this seam promotes automatically.

## Recursion at fleet scale

An organisation is a composition of departments; a department is a `composition` component whose members are agent-preset components; an agent preset is a `composition` whose members are tool, skill, context, and model-provider components; every member is a plugin. The same descriptor describes every level, and `invoke` on a composition starts a subagent from that preset. Leaderboards fold certificates per component id at every level, so a department, an agent, a skill, and a tool are scored by the same rule, and judge councils address their subjects by the same ids.

## Alternatives considered

**Make `ctx.tools` the universal registry.** Tool definitions are model-facing schema surface with scoped visibility layers; components include non-callable kinds and need lineage and provenance. A tool is one kind of component and stays where it is.

**Use MCP as the universal bus.** MCP is a process and wire protocol outside the harness authority model; tools reached through it lose in-process approval, sandbox policy, and the logged-request invariant unless re-wrapped. MCP servers are one kind, not the bus.

**Per-kind lineage and provenance fields inside each seam.** Five copies of the same fields diverge, and no cross-kind identity exists for scoring and councils.

**Promote dynamic packages automatically once their tests pass.** The Darwin Gödel Machine incidents and Anthropic's cheating taxonomy show self-authored tests are gameable; promotion needs certificates, held-out evaluation, and approval.

**A knowledge-graph database as the registry.** The registry is composition-time truth mirrored from live seams; durable facts (promotion records, certificates) ride session events and the storage domain rather than a new database.

**Register components by hand from every producing package.** Mirroring a seam's own registry through an adapter keeps components in sync with that seam's events and adds no obligation to seams that predate the registry.

## Acceptance criteria

- `dsh-components` ships the Service Definition and in-process registry; a keyless test proves duplicate ids are rejected and that disposing a registration removes the component.
- `dsh-components-subagents` mirrors every provider present at mount and every later `subagent/provider-added` and `subagent/provider-removed` edge, and disposing the adapter removes its components.
- `/components` renders the grouped inventory through the command registry and writes no session events.
- A composition component lists its members, and `component_invoke` on it starts a subagent from that preset in a Loader-booted composition.
- A synthesized component with no certificate and no approval is refused entry to the shared catalog by a test that exercises the promotion path.
- Every phase lands keyless snapshot scenarios through runnable examples per the [testing policy](../../../../docs/testing.md).

## Rollout

1. Registry seam, the subagent-provider adapter, and the `/components` command.
2. Adapters for tools, skills, workflows, MCP servers, LLM providers, context providers, and presets; the `composition` kind; the `component_invoke` tool.
3. Promotion: synthesized provenance from `tool-cordis` and skill authoring, certificates as component evidence, improvement-seam evaluation, approval, and the lineage archive.

## Risks

Mirror drift: an adapter that misses a seam event shows a component that no longer exists. Adapters bind to the seam's own events and register through effects, and disposal tests cover both edges.

Two callable surfaces: `component_invoke` beside native tools may split model attention. Native tools remain primary; the uniform call serves kinds without a tool of their own, as Code Mode already collapses many schemas into one binding.

Identity stability: ids derive from the kind and the seam's own stable name, never from mount order, so a remount produces the same id.

Promotion gaming: identical resubmission, format mimicry, and disguised intent apply to plugins as they do to tasks; the promotion path reuses the verification seam's isolation and the oversight seam's cross-lineage judges.

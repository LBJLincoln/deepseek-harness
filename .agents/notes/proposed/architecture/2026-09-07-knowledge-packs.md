# Knowledge packs: research sweeps served to agents as versioned skills

English | [中文](2026-09-07-knowledge-packs.zh.md)

Status: proposed, first pack landed. Owner: the improvement seam.

## Decision

Knowledge that agents in this harness should have and models do not, such as the state of the art of a dated window, enters the harness as a **knowledge pack**: a directory under `data/knowledge/<pack>/` holding a sourced corpus (`corpus/items.json`, the merged output of dated research sweeps, plus each sweep's briefing) and one skill bundle per theme (`skills/<theme>/SKILL.md`, an authored body, with a generated `references/items.md` listing the corpus items of that theme). A pack is served to agents by the shipped filesystem skill provider with the pack's `skills/` directory as a custom skill root and the default roots excluded, so a composition's catalog is the pack's contents wherever it runs. `data/knowledge/tools/build-pack.mjs` builds a pack from the sweeps, renders the references, validates every frontmatter, and writes a manifest with every file's digest; its `--check` mode is the `verify-knowledge-packs` leaf of `doc-sync`, so a stale pack fails the gate.

## Why a plugin and not a document

Three properties the skill seam already has are the reasons, and none of them is available to a document an agent is told to read.

1. **Identity and provenance.** A loaded skill is addressed by `skillDigest()` over its name, description, routing metadata, and body, and the composition manifest records which generation was in play in every session. A pack is therefore a component: an experiment can pair a session with the pack against one without it or with the previous pack, and the observatory attributes the difference to a digest, not to a prose claim that the agents "had the knowledge".
2. **Scope and policy.** Skills file into the layer of the composition that mounts them and carry an invocation policy per surface, so a pack can be mounted for one preset, one district, or one department without leaking into the host's own skill roots, and a pack meant for judges is not loadable by implementers.
3. **Token and cache economy.** The catalog reaches the model once, as a durable user-role message appended after the reusable prefix, with each theme reduced to its name and a capped description; a body is loaded only when the model calls the `skill` tool and then lives in retained tool history, and the item tables behind it load on demand through the resource guidance. A catalog change appends a replacement rather than rewriting earlier history, so the cached prefix survives edits to the pack. This is what makes knowledge as a plugin cheaper than knowledge in the system prompt: progressive disclosure keeps every request small, and append-only invalidation keeps the KV cache warm. It is the mechanism, not the purpose: the purpose is that the knowledge is a measured, versioned component.

## Mechanism

- `pack.json` names the pack, its window, its sources, and its themes; a theme has kebab-case `id`, a `title`, the item `kinds` it collects, and the `keywords` that select items by tag or by whole word in name and summary. An item may belong to several themes; items no theme selects are listed in the manifest's `counts.unmatched`.
- A sweep is a research agent's output for one source: `items.json` (`id`, `kind`, `name`, `date`, `url`, `summary`, `relevance { goals, seams, role }`, `adopt`, `evidence`, `tags`) and `report.md`. The build validates every item, deduplicates by URL across sources, unions tags and goals, and records which sources reported the item.
- The authored `SKILL.md` body is where the judgement lives: what changed, what Daliesk adopts, rejects, or tests, and how to use the references. Its description must fit the catalog cap (500 characters). The generated `references/items.md` is never edited by hand.
- The composition that proves the seam is `examples/headless-agent/tests/fixtures/knowledge-pack/cordis.yml`: the pack's `skills/` as the only root, a keyless route that reads the catalog, loads the first skill through the `skill` tool, and reports the loaded name. `examples/headless-agent/tests/knowledge-pack.e2e.ts` asserts the catalog names every pack skill and none from the host's roots, that the load happened, and that the model saw `<skill_content>`.

## What a pack is not

A pack is analysis knowledge with sources; it is not training data and never enters the RLVR corpus. Its items name third-party products, models, and papers as the subjects of research. A pack is dated: a later window is a new pack, not an edit of the old one, so a session's manifest keeps naming the generation it ran with.

## Deferred

- A curator rule that admits a pack into a district's composition only through an experiment verdict, the same way a harness patch is promoted.
- Per-theme invocation policies (judge-only, implementer-only) once a district mounts several packs.
- Automatic staleness: a pack whose window ended more than one quarter ago should render a warning line into its catalog description.

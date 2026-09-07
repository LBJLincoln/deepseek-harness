# Knowledge packs

English | [中文](README.zh.md)

Dated research sweeps, kept as a sourced corpus and served to agents as skills. A pack answers one question for one window: what appeared or changed in the sources that bear on the four goals, with every claim traceable to its URL and its evidence quality. Agents in a composition that mounts a pack see its themes in their skill catalog and load a theme's body only when a task calls for it. The [knowledge packs note](../../.agents/notes/proposed/architecture/2026-09-07-knowledge-packs.md) owns the decision and the rationale; this file owns the layout and the procedure.

## Layout

```
data/knowledge/
  tools/build-pack.mjs        merge sweeps, render references, validate skills, write the manifest; --check for the gate
  <pack>/
    pack.json                 identity, window, sources, themes (id, title, kinds, keywords)
    manifest.json             counts per theme, unmatched items, every file's bytes and SHA-256
    corpus/items.json         the merged, deduplicated items of every sweep, with the sources that reported each
    corpus/<source>-report.md the briefing each research agent wrote for its source
    skills/<theme>/SKILL.md   the authored body: what changed, what Daliesk adopts, how to use the references
    skills/<theme>/references/items.md   generated from the corpus by the theme's kinds and keywords
```

## Building a pack

A sweep is one research agent's output for one source, written outside the repository: `<sweeps>/<source>/items.json`, an array of `{ id, kind, name, date, url, summary, relevance: { goals, seams, role }, adopt, evidence, tags }`, and `<sweeps>/<source>/report.md`. `kind` is one of `model`, `dataset`, `paper`, `repo`, `release`, `environment-hub`, `framework`, `benchmark`, `policy`; `relevance.role` is `threat`, `input`, or `baseline`; `evidence` is `primary`, `secondary`, or `claim`. Author `pack.json` and one `skills/<theme>/SKILL.md` per theme, then build:

```sh
node data/knowledge/tools/build-pack.mjs data/knowledge/2026-q3 --sweeps /path/to/sweeps
```

The build validates every item, deduplicates by URL across sources (tags, goals, and seams are unioned; the first source's text is kept; every reporting source is listed), writes the corpus and the briefings, selects each theme's items by kind, by tag, or by a whole-word keyword in the name or summary, renders each theme's `references/items.md`, checks that every `SKILL.md` frontmatter names its theme and describes it within the catalog cap of 500 characters, and writes `manifest.json`. Items no theme selects are listed under `counts.unmatched` in the manifest. After an edit to a corpus or a theme definition, rebuild without `--sweeps`. `pnpm run verify-knowledge-packs` runs the same build in `--check` mode as a `doc-sync` leaf and fails on any rendered file or manifest that differs from disk.

## Serving a pack

A pack is a skill root for [`@deepseek-ai/dsh-skill-filesystem`](../../packages/skill/skill-filesystem/README.md): mount it with `customSkillDirs` naming the pack's `skills/` directory and `includeDefaultRoots: false`, so the host's project and user skill directories stay out and the catalog is the pack's contents wherever the composition runs. [`examples/headless-agent/tests/fixtures/knowledge-pack/cordis.yml`](../../examples/headless-agent/tests/fixtures/knowledge-pack/cordis.yml) is the composition that proves it: a keyless route reads the catalog, loads the first theme through the `skill` tool, and reports the loaded name; `examples/headless-agent/tests/knowledge-pack.e2e.ts` asserts that the catalog names every theme of the pack and none of the host's skills, that the load happened, and that the model saw the `<skill_content>` block.

What reaches the model, and what it costs, is the skill seam's contract: the catalog is one durable message appended after the reusable prompt prefix, with each theme reduced to its name and capped description; a body is loaded on demand into retained tool history; the item tables behind it load on demand through the resource guidance; a change to the pack appends a replacement catalog instead of rewriting earlier history. A loaded theme is addressed by its `skillDigest()` in the composition manifest, so an experiment can attribute a difference between two districts to the pack generation in play.

## What a pack is not

A pack is analysis knowledge with sources, kept here so the lab and its agents share one dated picture of the field. It is not training data and never enters the RLVR corpus. Its items name third-party products, models, and papers as the subjects of research. A later window is a new pack, never an edit of an old one.

## Packs

| Pack | Window | Sources | Themes | Items |
| --- | --- | --- | --- | --- |
| [2026-q3](2026-q3/manifest.json) | 2026-06-01 to 2026-09-07 | GitHub, Hugging Face, arXiv | 8 | 103 |
| [2026-09-fortnight](2026-09-fortnight/manifest.json) | 2026-08-24 to 2026-09-07 | a Sakana and routing deep-dive; all sources at fortnight resolution | 3 | 63 |

The 2026-q3 pack's themes are the harness landscape, RL from verifiable rewards, open-weight models in the 20B to 200B class, environments and evaluation, agent data pipelines, multi-agent fleets, context and KV cache, and EU AI Act obligations for general-purpose models. The [sweep decisions note](../../.agents/notes/proposed/architecture/2026-09-07-q3-knowledge-sweep-decisions.md) records what the lab decided from it. The 2026-09-fortnight pack re-reads the last two weeks of that window at higher resolution, where the quarter sweep had missed three frontier releases, an API change that breaks naive replay, and the routing results the [hypothesis program](../../.agents/notes/proposed/architecture/2026-09-07-hypothesis-program.md) tests; its themes are routing and handoffs, frontier and API shifts, and reward integrity and training constraints.

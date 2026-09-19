# Agent Note: Code-safety knowledge pack as a flat skills root, not a sweep pack

Status: implemented

English | [中文](2026-09-19-code-safety-knowledge-pack.zh.md)

## Problem

A customer proof of concept needs a security review department to read a canonical, code-pattern-oriented reference before analysing a customer's web back end, web front end, or mobile client: the review discipline, the OWASP Top 10 and CWE Top 25 mapped to concrete code patterns, per-department checklists (secrets, injection, access, data, dependencies, platform), a severity and evidence rubric with a finding schema, and the report layout the integration writes. This has to be loaded on demand, per department, rather than carried in every prompt.

Every existing entry under `data/knowledge/` is a dated research sweep: `pack.json` records a window and external sources, `corpus/items.json` merges deduplicated items those sources reported, and `skills/<theme>/SKILL.md` sits under a nested `skills/` folder with a generated `references/items.md` beside it, all built and checked by `data/knowledge/tools/build-pack.mjs`. Security-review method and standard identifiers are neither dated nor sourced from an external sweep, so that shape does not fit.

## Decision

`data/knowledge/code-safety/` is a plain skills root, not a sweep pack: eleven directories sit directly under the pack root, each `<name>/SKILL.md` and nothing else — `review-method`, `owasp-top-10`, `cwe-top-25`, `secrets`, `injection`, `access`, `data`, `dependencies`, `platform`, `severity-and-evidence`, `report-template`. There is no `pack.json`, `manifest.json`, `corpus/`, or nested `skills/` folder. A separate program mounts the directory itself on [`@deepseek-ai/dsh-skill-filesystem`](../../../../packages/skill/skill-filesystem/README.md) with `customSkillDirs: ['data/knowledge/code-safety']` and `includeDefaultRoots: false`, and references skills by these directory names directly. Each `SKILL.md` carries only the `name`/`description` frontmatter that provider requires, stays within 300 to 900 words, and cites CWE and OWASP identifiers directly in its body rather than through a generated references file. The pack root carries a bilingual `README.md`/`README.zh.md` pair (purpose, the skill list, the mounting call, and the rule that the pack guides a review and does not replace a penetration test); individual `SKILL.md` bodies stay English-only.

## Alternatives considered

**Fit it into the sweep-pack shape.** Rejected: that shape's contract is a dated external sweep with per-item evidence and provenance; this pack's content is the reviewer's own method plus standard identifiers, with no sweep source or window to record, so `pack.json`'s `window`/`sources` fields and the `corpus`/`build-pack.mjs` machinery would be unpopulated ceremony around content that never changes on a sweep cadence.

**One large `SKILL.md` for the whole department.** Rejected: the mounting program loads a skill by directory name to bring in only the department relevant to the code under review (`secrets` without also loading `platform`); one file would force loading the entire pack on every reference and exceed the per-skill word budget by an order of magnitude.

**Translate every `SKILL.md` body into a `.zh.md` pair.** Rejected: no existing knowledge-pack skill body has a Chinese counterpart — `isTranslationScopeFile` in `scripts/translation-pairing.ts` does not place `SKILL.md` in the bilingual corpus at all, since it matches only `README` artifacts, `.agents/notes/`, `docs/`, and `python/`. Duplicating eleven technical references in a second language for a deliverable whose bilingual half is already the [report template](../../../../data/knowledge/code-safety/report-template/SKILL.md)'s French résumé exécutif would add translation-maintenance burden with no consumer.

## Consequences

- The mounting program points `customSkillDirs` at `data/knowledge/code-safety` directly and gets exactly eleven catalog entries, with no `skills/` indirection to account for.
- `pnpm run verify-translation-pairing`'s corpus-wide check requires no `.zh.md` for any `SKILL.md` here, matching every other knowledge pack; only this pack's own `README.md` is bilingual, recorded in `README.i18n.yaml`.
- A future knowledge-pack gate in `scripts/run-gates.ts` (none exists yet — `grep -n knowledge scripts/run-gates.ts` finds nothing) must account for two pack shapes, the sweep pack's `pack.json`/`manifest.json`/`corpus`/`skills/<theme>` and this pack's flat `<name>/SKILL.md`, or scope itself explicitly to one.
- Each `SKILL.md`'s OWASP and CWE content is a snapshot as of this pack's authoring date; unlike a sweep pack, there is no window or build step that forces a refresh, so keeping it current is a manual editing responsibility for whoever next touches these files.

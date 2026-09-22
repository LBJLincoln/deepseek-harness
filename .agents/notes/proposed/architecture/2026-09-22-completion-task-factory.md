# Agent Note: The environment factory: completion tasks from the bench's own reference programs

Status: proposed

English | [中文](2026-09-22-completion-task-factory.zh.md)

## Problem

Every consumer downstream of the Proving Ground bench is starved of verifiable tasks relative to what it needs: an RLVR corpus needs thousands of prompts with executable verifiers, and a harness-effect measurement needs hundreds of paired cells before a delta is distinguishable from noise. The bench holds 44 hand-authored environments across tiers 2 through 6 and several domains, each the product of writing a specification, a reference implementation, a visible test suite, and — for tiers 5 and 6 — a hidden case corpus an implementer never sees. That authoring cost does not scale to the volumes RLVR and harness-effect measurement need, and reaching a comparable corpus at ten or a hundred times today's count by hand-authoring more of the same is a headcount request, not a plan.

The bench's own reference programs are an underused asset. Each one is a working, tested, admitted solution already decomposed into named top-level functions, each with its own contract — a JSDoc comment, a parameter and return shape, one behavior. A verifier that already exists, the parent's own visible test suite, can judge whether one function, and only that function, was correctly reimplemented, without writing a single new specification, reference, or test.

## Proposal

`tools/synthesize-completion-tasks.mjs` is a zero-dependency Node ESM script that reads every parent under `environments/`, parses each `reference/src/*.js` file with a conservative brace/paren/string/comment/regex-literal/template-literal scanner (not a real parser) for top-level `function name(...) { ... }` and `const name = (...) => { ... }` declarations, and for each one long enough to be worth completing (`--min-lines`, default 4; a file with more eligible functions than `--max-functions-per-file`, default 20, contributes none) writes a child under `environments-completion/<parent>--<function>/`: the reference solution with that one function's body replaced by `throw new Error('not implemented')` (the signature and any leading comment or JSDoc kept), the parent's `test/` and `package.json` unchanged, the parent's `reference/` kept so admission can run, and `task.json` carrying `id: code:<parent>--complete-<function>`, the parent's `tier`, `domain`, `heldOut`, and `immutable`, `family: <parent id>`, `completion: { file, function }`, and `checks` filtered to drop any check that names a hidden-case file — a completion child is judged on the visible suite alone. Every stubbed file is immediately checked with `node --check` and dropped if it does not parse, an empirical correctness gate on the scanner independent of admission.

`admit.mjs` needed one change to run over the result: its directory/id consistency check compared `task.id` to `code:<directory>` exactly, which a completion child's `--complete-` marker in the id — but not in the directory, which stays `<parent>--<function>` — always failed. The check now strips that marker before comparing, which is a no-op for every curated task's plain `code:<name>` id. The factory's own `--admit` flag runs the now-compatible `admit.mjs` over its output, deletes every child it rejects, and records each rejection's directory and reason in `environments-completion/REFUSED.json`.

`register-completion-environments.ts` is a new plugin, mounted independently of the curated `register-environments`, that registers whatever survived admission under the same `bench` kind the curated 44 use; `EnvironmentKindMap`'s `bench` detail type gains two optional fields, `family` and `completion`, absent on a curated task and present on a completion one. `with-completion.cordis.yml` mounts it beside the base composition; `with-completion-openrouter.cordis.yml` mounts it beside the free open-weight route `with-openrouter.cordis.yml` names, since a fleet driver takes exactly one config and the two overlays' patches must land on the same tree.

### Counts

Run against the checked-in 44 environments with the defaults (`--min-lines 4`, `--max-functions-per-file 20`):

- 44 parents, all 44 with a `reference/src/*.js` program.
- 246 candidate functions found; 142 shorter top-level functions skipped by `--min-lines`; 0 files over the `--max-functions-per-file` cap.
- 246 written; 0 dropped for failing `node --check`.
- Written by tier: `{2: 48, 3: 62, 4: 53, 5: 57, 6: 26}`.
- Admission: 246 admitted, 0 refused. Admitted by tier: `{2: 48, 3: 62, 4: 53, 5: 57, 6: 26}` — every written child was admitted; `environments-completion/REFUSED.json` is `[]`.

## Alternatives considered

**Author a new specification and test suite per function, at the same cost as a parent environment.** This is what the bench already does at the parent level; repeating it per function does not solve the scaling problem the factory exists to solve, and a hand-written per-function verifier would need its own admission discipline (pre-state fails, reference passes) built from nothing.

**Judge a completion child on a slice of the parent's hidden cases, for tiers 5 and 6.** Rejected: a hidden case is authored and audited against the whole program's specification, not against one function's contract, so a case that exercises three functions cannot be attributed to the one this child stubs without re-authoring it — the same scaling problem in a different place. Visible-tests-only is honest about what a completion certificate actually measures, and the README and the registrar's `description` both say so.

**Give a completion child its own kind instead of reusing `bench`.** A distinct kind would let a producer-specific detail type skip `family` and `completion`'s optionality, but every consumer that already filters bench cells by `kind: 'bench'` and `detail.tier`/`detail.domain` — a plan, the observatory's district split — would need a second code path to also see completion cells. Reusing `bench` and discriminating on `detail.completion`'s presence keeps one code path; the cost is two optional fields on one merge-extensible type instead of a clean second one.

**Name the child directory `<parent>--complete-<function>`, matching the id exactly.** Rejected as redundant noise in a directory listing already grouped under `environments-completion/`; the `--complete-` marker earns its place in the id, which travels alone into logs, plans, and trajectories, but not in a path a person reading the tree already knows is a completion child.

## Acceptance criteria

- `node admit.mjs environments-completion` exits 0 against the committed tree, admitting every child that remains in it.
- `environments-completion/REFUSED.json` accounts for every candidate the factory generated but did not keep, with the reason `admit.mjs` gave.
- The registrar e2e test's completion-family case boots `overlays/registry-only-with-completion.cordis.yml` and finds a named completion child's id among the registered set.
- Re-running the factory with the same inputs and flags reproduces the same written and admitted sets (idempotence and determinism), verified by diffing two consecutive runs.

## Risks

**The scanner is not a real parser.** It tracks line and block comments, single- and double-quoted strings, template literals with nested `${...}` expressions, and regex literals (with character classes) well enough for this bench's own reference programs — verified empirically, since all 246 candidates across all 44 files produced a stub that passes `node --check` on the first attempt after adding regex-literal handling. A reference program in a style the scanner does not anticipate — a regex literal written directly after a bare keyword with nothing else between, for instance, which this bench's programs do not do — could still produce a syntactically valid but wrongly scoped stub that `node --check` cannot catch, because a syntax check does not know where a function was supposed to end.

**A completion certificate is a weaker claim than a curated task's.** It says the visible suite passes, not that the function matches the specification on inputs the suite does not exercise; a function whose visible suite gives poor coverage yields a completion child that is easy to certify without truly reimplementing the original behavior. This is inherent to reusing an existing verifier rather than authoring a new one; the README documents it rather than hiding it.

**`--min-lines` and `--max-functions-per-file` are unvalidated against real completion attempts.** They were chosen to keep the corpus a size admission can process (which reruns the parent's own test suite per candidate) rather than validated against which functions make a good completion exercise for a model; the model-backed fleet runs that would validate them are explicitly out of scope for the change that produced this note.

**Two producers now share one kind's detail type.** `register-environments.ts` and `register-completion-environments.ts` both write to `EnvironmentKindMap['bench']`; a future third producer of `bench` tasks must keep widening the same interface with more optional fields rather than narrowing or repurposing the existing ones, or every existing consumer of `detail.tier`/`detail.domain` breaks.

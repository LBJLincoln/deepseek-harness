# Agent Note: Ruflo against this harness, a code-level comparison

Status: proposed

English | [中文](2026-09-07-ruflo-comparison.zh.md)

## Problem

The question put to the lab was "it seems like us, but aren't we better?" about `ruvnet/ruflo`, formerly claude-flow, the most adopted open-source multi-agent platform of 2026 by stars and downloads. A README-level answer misleads in both directions: ruflo's README describes an agent meta-harness with swarms, memory, and verification, which is the vocabulary of this harness, and its headline numbers are quoted widely. A useful answer has to come from the code, name the criteria a European lab sells against, say where ruflo is ahead, and turn what is worth adopting into slices. This note is that answer, read against ruflo at commit `277c7bc0` (2026-09-05) from a shallow clone and against this repository at the merge of the Claude Code LLM route. Every claim names its file or URL; where a claim could not be verified from code or a primary page, it says so.

## Proposal

Keep the architecture; adopt three mechanisms from ruflo as slices, and keep the comparison dated. The verdict is: mostly yes, and not for the reasons a pitch gives. Ruflo and this harness solve different problems that look alike from a README. Ruflo maximises what a Claude Code subscription can be made to do: it adds coordination, memory, and a plugin marketplace on top of the vendor's loop and has real distribution. This harness owns the loop, the log, and the certificate and has no distribution channel of its own. On the criteria a European lab sells against, one authority for state, checks authored before the work, a reward the implementer cannot reach, paired-seed experiments, and a coverage gate, ruflo has essentially nothing, and its own architecture records say so.

The slices this note queues:

1. A signed witness over the composition manifest, per platform, verified before release: `packages/components` and `packages/bundle`.
2. Reporting rules in the observatory's render path, so an unlabelled metric, an undisclosed best-of-N, or an aggregate hiding no-work passes is unpublishable by construction: `dsh-observatory` and `dsh-scorekeeper`.
3. The fate of a shift's output on its ledger, with a trailing merge or use rate the observatory shows, so a district producing unused work is visible: `dsh-shifts`.

## What ruflo is

- **A meta-harness over Claude Code.** Its `CLAUDE.md` (lines 86 to 88) requires agents to be spawned through Claude Code's Task tool and forbids MCP tools from executing alone, so the vendor product owns the agent loop, the tool pipeline, the context window, and the permission model. Real child execution is `spawn('claude', ['--print', '--output-format', 'json'])` in `v3/@claude-flow/cli/src/services/headless-worker-executor.ts`.
- **A coordination library.** `v3/@claude-flow/swarm/src/` holds a queen coordinator for a fifteen-agent swarm, a topology manager, a message bus, and Raft, Byzantine, and gossip consensus. The consensus runs over coordinator state, not over model output that gates anything.
- **A mutable memory as the authority for state.** `v3/@claude-flow/memory/src/` (an AgentDB backend, an HNSW index, a graph, a model-driven consolidator) and the `agentdb.rvf` container at the root. Encryption at rest is off by default.
- **Plugins and skills as vendor artefacts.** 35 plugins advertised (40 directories), 39 skills and 33 agent definitions as Markdown the vendor product loads; no runtime registry, identity, or lineage. About 309 MCP tool registrations across 47 modules; the README says 314 in one place and about 210 in another.
- **A verification directory that is not task verification.** `verification/` attests, per operating system, that a documented fix still exists: SHA-256, marker, Ed25519 signature, append-only history, and a `witness-verify` job that blocks publish. It exists because three May 2026 regressions passed unit tests and broke installs.
- **No coverage gate.** 563 test files, and every coverage threshold in `v3/vitest.config.ts` is commented out. MIT licence, a single author in the clone's history, ten patch releases between 2026-08-12 and 09-02, 648 open issues and 293 open pull requests on 2026-09-07.

## Provenance of the headline claims

- **SWE-bench 84.8 percent** appears in `.claude-plugin/README.md`, the plugin summary, the changelog, and three skills, with no harness, run artefact, seed, date, or model anywhere in the tree. `v3/docs/adr/ADR-171` states that ruflo has no SWE-bench oracle and that its historical `resolved` was structural confidence, a proxy.
- **32.3 percent token reduction and 2.8 to 4.4 times WASM speedup** carry the same absence of method. Adjacent figures were found fabricated by ruflo's own audit: a 2.49 to 7.47 times attention speedup computed as `2.49 + Math.random() * 4.98` (`docs/reviews/intelligence-system-audit-2026-05-29.md`), and a cold-start benchmark whose every number, including a 5.00 times speedup, came from `setTimeout()` chains (`docs/dream-cycle/dream-gist-2026-09-05.md`). Both were corrected by the same loop.
- **Adoption.** 71.2k stars is verifiable on the repository page; 9.56 million npm downloads over twelve months has a named source and method. The README's git-clone badge links to a ledger in which every snapshot reads `fetch-failed` with zero clones.
- **The always-on loop.** `docs/dream-cycle/LEDGER.md`: 80 nightly research issues from 2026-05-25 to 08-13 produced 4 shipped (5 percent), 1 rejected, 75 never touched; under v2, every night from 2026-08-24 to 09-05 produced an evaluated accept whose pull request was still unmerged at the head commit.

## Criteria matrix

| Criterion | ruflo | this harness | Evidence |
| --- | --- | --- | --- |
| Single authority for state | mutable vector and SQLite memory plus per-plugin JSON | append-only session event log; model history is a projection of it | `memory/src/agentdb-backend.ts`; `docs/architecture.md` |
| Model-visible equals logged | no such rule; hooks and memory inject context the product never records durably | invariant: a new model-visible input requires a session event | ruflo `CLAUDE.md`; `docs/architecture.md` |
| Standard authored before work | none | `ctx.completionStandards`; certificate only from a fully passing run | `verification/README.md` (ruflo); `packages/verification/verification/README.md` |
| Tamper resistance of rewards | no read barrier, no validator-owned tree; structural confidence is a stated proxy | validator-owned tree, per-run reservations, denies at every path-opening capability, lineage-free judge | ADR-171; `packages/verification/read-barrier/README.md` |
| Sandbox and isolation | no OS-level confinement found in the TypeScript tree | sandbox seam with local, policy, and Windows ACL providers | grep over `v3/@claude-flow`; `packages/README.md` |
| Multi-agent coordination | queen hierarchy with consensus over coordinator state; execution delegated to the vendor's Task tool | subagent seam with six providers behind one interface; delegation and continuation are events | `swarm/src/`; `packages/subagent/README.md` |
| Knowledge as versioned components | RVF containers and rows; no content address, lineage, or membership | `ctx.components`: id, content address, provenance, lineage, membership | `plugins/ruflo-rvf/README.md`; `packages/components/README.md` |
| Model agnosticism | six auxiliary providers; the agentic loop is Claude Code or Codex only | LLM seam with DeepSeek, multi-provider, and Claude Code routes as packages | `providers/src/`; `packages/llm/README.md` |
| Subscription through the vendor CLI | yes, as the primary path | yes, as one route among several | `headless-worker-executor.ts`; `village-live/cordis.yml` |
| RL data path | proposed in ADRs 171 and 173; no exporter in tree | `ctx.trajectories` exports certificate-decided rewards with stamps; held-out withheld | ADR-171; `packages/improvement/README.md` |
| Paired-seed evaluation | none found | frozen plan digest, two arms at the same indexes, bootstrap interval, verdict | `docs/benchmarks/`; `packages/improvement/experiments/README.md` |
| Always-on and resume | nightly external routine; ledger reaches `main` only by merge | cadenced, spend-windowed shifts with a ledger in the slot's session log; resume by ledger | `LEDGER.md`; `packages/improvement/shifts/README.md` |
| Gates and coverage | thresholds commented out | per-file 100 percent coverage gate beside typecheck, lint, duplication, hygiene, doc-sync, snapshots | `v3/vitest.config.ts`; `AGENTS.md` |
| Documentation | 1,884 Markdown files; careful ADRs, README claims that contradict them | bilingual, budgeted, gated; one home per fact | README lines 38 and 256; `docs/AGENTS.md` |
| Licence and governance | MIT; single-author history | MIT-lineage fork; curator, data-use terms, sign-off records | `LICENSE`; `packages/governance/` |
| Adoption | 71.2k stars, 8.4k forks, 35 plugins, 9.6M downloads | fork of a 214.7k-star upstream; no channel of its own | repository pages |

## Three, three, and three

**Ruflo does better today:** distribution through the Claude Code plugin marketplace (`.claude-plugin/marketplace.json`); signed per-platform attestation of released artefacts with a publish-blocking check (`verification/README.md`); a binding standard for every published number (`v3/docs/adr/ADR-169-benchmark-reporting-integrity-standard.md`, 2026-07-03).

**This harness does and ruflo cannot:** reconstruct exactly what the model saw (`docs/architecture.md`, with a runtime invariant); gate completion on a certificate behind a validator-owned read barrier (`packages/verification/verification`, `packages/verification/read-barrier`); decide a change with a frozen, paired, bootstrap-interval experiment (`packages/improvement/experiments`).

**Worth adopting:** the three slices listed under the proposal, with their evidence at `verification/README.md`, ADR-169, and `docs/dream-cycle/LEDGER.md` respectively.

## The caution

Ruflo's failure mode is one this harness is exposed to: 80 issues at a 5 percent ship rate, then ten consecutive certified-good pull requests nobody merged. Certificates raise the quality of a shift's output; they do not create the human capacity to land it. That is a staffing and sales plan item, and the architecture does not solve it.

## Alternatives considered

- **Dismiss ruflo as marketing.** Rejected: its distribution, its signed attestation, and its reporting standard are real gaps on our side, whatever its README claims.
- **Adopt ruflo as an orchestration layer over this harness.** Rejected: it requires the vendor product to own the loop, which breaks model-visible equals logged and model agnosticism, the two properties clients buy.
- **Ship a marketplace plugin of our own now.** Deferred: bundles have no release path yet; the distribution gap is recorded here and belongs to the release slice, not to this comparison.

## Acceptance criteria

- The witness slice lands with a signature per platform over the composition manifest and a gate that refuses a release whose witness does not verify.
- The reporting slice lands with a test that the observatory refuses to render an unlabelled metric, an undisclosed best-of-N, or an aggregate hiding no-work passes.
- The ledger slice lands with the fate of each shift output recorded as a durable event and a trailing use rate on the observatory page.
- The comparison names its commit and is refreshed when ruflo's next major version changes its architecture.

## Risks

- Ruflo moves fast, ten releases in three weeks, so the matrix dates quickly; the commit hash and the dates in this note bound its validity.
- A signing scheme adds a dependency and key management to the release path.
- Reporting rules could block a legitimate exploratory number; they gate publication, never computation.
- The staffing caution above: certified output nobody lands is the failure this harness shares with ruflo, and no slice here removes it.

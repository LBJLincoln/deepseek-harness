# Enterprise ticket queue

English | [中文](README.zh.md)

This directory is the enterprise's work queue: one JSON file per ticket, `T-0001.json` onwards, each a small, verifiable change to one deliverable a roster seat owns. Intake writes tickets from evidence already in the tree; the seats work them through the harness's program workflow in their own worktrees; the ticket's acceptance commands, a scope check, and an independent reviewer decide whether the result merges. The seats come from the [enterprise roster](../README.md).

## Who writes and who works

- **Intake** writes tickets. Every ticket starts from something the tree already says needs doing, in order of preference: a package README's `Known Limitations and Deferred Work` bullet, a `FIXME`/`TODO`/`XXX` marker in the package's `src/`, a proposed Agent Note that names the package, a failing or skipped test, a skill or note whose stated facts no longer match the code or paths it describes, or a gate that fails for reasons unrelated to what it checks. Intake reads the code behind a candidate before writing it up and drops anything one implementer cannot finish in about thirty minutes of focused work or that no command can verify.
- **The coordinators' intake** writes tickets beside the hand-written intakes when the queue runs low: `pnpm run enterprise:intake` asks the Program Departments coordinators for tickets in their own package groups and files only the proposals admission accepts, which requires every check of the ticket's own to fail on a clean checkout of the tip, its seat's `source` to cover its scope, and no open or shipped ticket to carry the same source path and anchor. Admitted tickets take the next ids in admission order. The [enterprise-intake fixture](../../../examples/headless-agent/tests/fixtures/enterprise-intake/README.md) documents the rules and the record each run leaves.
- **Seats** work tickets. `seat` names the roster seat whose `source` covers the deliverable; the implementer works the ticket in its own worktree, changes only paths under `scope`, and stops with a report instead of widening the change when the ticket turns out to be larger than written.
- **The engine** verifies and merges. It runs every `acceptance` command at the worktree root, checks that the diff stays inside `scope`, hands the result to an independent reviewer, and merges what the reviewer approves.

## Divisions in the queue

| Division | Seats that hold tickets | What a ticket is drawn from |
|---|---|---|
| `harness-core` | package stewards | the stewarded package's README limitations, `src/` markers, proposed notes, and failing or skipped tests |
| `knowledge` | skill keepers | a `SKILL.md` statement that no longer matches the script, manifest, hook, or test it describes |
| `governance` | standard authors | a gate, manifest, or policy document whose rule the tree no longer satisfies, or a gate that fails for reasons unrelated to what it checks |
| `curation-data` | note curators | an implemented Agent Note whose paths or names no longer exist in the tree, which [the notes README](../../../.agents/notes/README.md) requires to be kept current |
| `program-departments` | subsystem coordinators | a group README that misdescribes its family, a package README limitation that the tree has since resolved, or a `src/` marker whose stated trigger has occurred |

Proving Ground and Code Safety hold no ticket while their deliverables verify clean: the bench's `admit.mjs` admits every curated environment and the code-safety knowledge packs match the fixture that mounts them, so intake records that finding instead of inventing work.

The engine takes open tickets by `priority`, so intake assigns priorities so that consecutive shifts alternate divisions: the first ticket of each division at `1`, the second at `2`, the rest at `3`. Priority `0` belongs to a ticket answering one of the owner's [requests](../requests/README.md), which the engine therefore takes before every untried ticket; the validator refuses it on any other ticket.

## The ticket file

```json
{
  "id": "T-0001",
  "title": "...",
  "division": "harness-core",
  "seat": "<roster seat id>",
  "kind": "fix|test|docs|feature|chore",
  "source": { "path": "<repository path the ticket comes from>", "anchor": "<section heading, TODO text, or note heading>" },
  "task": "<the full instruction for the implementer>",
  "scope": ["<path prefixes the change may touch>"],
  "acceptance": [{ "id": "<check id>", "run": "<shell command run at the worktree root; exit 0 = pass>" }],
  "budget": { "maxTotalTokens": 8000000, "maxWallMs": 2700000 },
  "priority": 1
}
```

| Field | Rule |
|---|---|
| `id` | `T-` and four digits; equals the file name; the queue is numbered without gaps from `T-0001`. |
| `title` | One line naming the change. |
| `division`, `seat` | A division id and a seat id from `roster.json`; the seat belongs to the division. |
| `kind` | One of `fix`, `test`, `docs`, `feature`, `chore`. |
| `source` | `path` exists in the tree and its content contains `anchor` verbatim, unless the ledger records the ticket as shipped. |
| `task` | The problem with its evidence as `path:line`, the required behaviour, the repository rules that constrain it, and what not to touch. |
| `scope` | Non-empty; every prefix exists, unless the ledger records the ticket as shipped; the reviewer rejects a diff outside it. |
| `acceptance` | Non-empty; check ids unique within the ticket; always includes the package's per-file coverage run and `pnpm run typecheck`, plus `pnpm run doc-sync` when the ticket touches documentation. Every command takes one of the forms of [`scripts/enterprise-acceptance.ts`](../../../scripts/enterprise-acceptance.ts) — `pnpm run` of `typecheck`, `doc-sync`, `lint`, `test:snapshot` or a `verify-*` script, `pnpm exec vitest run`, `pnpm exec tsc`, `grep`, `test`, `git diff`, joined by `&&`, `||` and `|` with literal words only — or the engine refuses to work the ticket. |
| `budget` | Positive integers: the token and wall-clock ceilings of one attempt. |
| `priority` | `1` (first) to `3` (last), or `0` when `source.path` is a request under `data/enterprise/requests/`. |

The parser accepts exactly these fields; a ticket carrying any other field is invalid.

## Acceptance that means something

An acceptance command that passes on the untouched tree certifies nothing, so a ticket's checks are written to fail before the change wherever the change allows it: a named spec file the steward must add (`test -f <spec> && pnpm exec vitest run <spec>`), a `grep` asserting that a documented contract now exists, or a `grep` asserting that a removed symbol is gone. The coverage and typecheck runs pass before and after; they guard the package, not the ticket. Where every check passes untouched, the task text says why the review is the real gate.

A coverage check names the tests that own the package's `src`: its own `tests/` directory, written with a trailing slash because a bare path prefix also selects sibling packages, plus the sibling or consumer specs that reach the lines its own tests do not, so that the per-file 100% threshold holds on a correct tree. A hand-written intake proves that set by running it before the ticket is filed; the coordinators' intake does not run it, so a coordinator's ticket naming the wrong set fails at the engine's verification. A ticket whose deliverable lies outside `packages/` (a skill, an Agent Note, a repository script) names the coverage run of the nearest package that consumes that class of deliverable — `dsh-skill-filesystem` for skill directories, `dsh-app-boot` for the boot composition — and its task says so; the run guards that package, not the ticket, and the ticket's own checks are the ones that fail before the change. Acceptance commands assume the CI host: Linux, a non-root user, and an installed workspace; a test that needs what the host cannot express self-skips there, as [docs/testing.md](../../../docs/testing.md) prescribes.

## Status comes from the ledger

A ticket file never records progress. The engine appends what happens to a ticket (the department's outcome, its checks, the review verdict, the integration, the shipped commit) to `data/enterprise/ledger.jsonl`, one JSON line per ticket per shift naming the ticket `id`, and a ticket's status is derived from its most recent ledger line; a ticket with no line is open. The line format belongs to the engine and is stated in [the ledger section](../README.md#the-ledger-and-the-shifts); the queue's rule is only that status is read from the ledger and never written into a ticket. Editing a ticket after its first ledger line changes the work, not the status, and needs a new review.

## A ticket is real only if its source exists

`source.path` must exist in the tree and contain `source.anchor`, so a ticket cannot outlive the limitation, marker, or note it came from: when the source is resolved or deleted, the ticket is closed through the ledger or deleted, never left pointing at nothing. A ticket the ledger records as shipped is exempt from the source and scope existence checks, because its own change may have moved its source, rewritten the text its anchor quotes, or removed a scope prefix. [`scripts/enterprise-tickets.spec.ts`](../../../scripts/enterprise-tickets.spec.ts) enforces the schema, the seat and its division, the source path and anchor, the non-empty scope and acceptance, and the mandatory coverage and typecheck checks over every committed ticket; `pnpm run test` runs it with the other repository script specs, and `pnpm exec vitest run scripts/enterprise-tickets.spec.ts` runs it alone.

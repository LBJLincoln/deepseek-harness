# Code-safety runs

English | [中文](README.zh.md)

Records of real code-safety reviews: one program per record, kept exactly as the harness released it. A record holds the report the program published, the union of findings behind it, the verdict the committed examiner gave over the merged head, every session log, and a manifest with the repository head, the composition, the locked target and every file's digest. Nothing in a record is edited after the run; the table below is read from those files.

The program is [`examples/headless-agent/tests/fixtures/program-code-safety/`](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md), which also documents what a finding has to be and what the examiner refuses.

## Layout

```
data/code-safety/
  <date>-<target>/
    manifest.json      repository head, composition, locked target, per-department outcome, findings per severity and confidence, per-file bytes and SHA-256
    result.json        the driver's result line: the ledger, the member sessions, the barrier refusals, the released file list
    SAFETY-REPORT.md   the report the program released, verbatim
    findings.json      the union of every department's findings, as released
    verifier.txt       the committed examiner's exit code and output over the released worktree
    stderr.txt         what the driver wrote to stderr, when it wrote anything
    sessions/          every session log: the ledger, the six departments and the integration, named by session id
  targets/<target>.ground-truth.json   a target's own documented defects, for reading a record's recall against; never part of the release gate
  tools/record-run.mjs                 copies one run directory into a record and writes its manifest
```

## Running one, and recording it

```sh
pnpm run code-safety -- /path/to/target --out .code-safety/<name> --model sonnet
node data/code-safety/tools/record-run.mjs .code-safety/<name> <date>-<target> \
  --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml
```

The recorder refuses to overwrite an existing record. Add a row below afterwards, and keep whatever the run exposed — a department that ran out of rounds, an integration that never passed the examiner — beside it rather than rerunning until it looks clean.

## Runs

| Run | Head | Target | Model | Certified | Findings | Examiner | Elapsed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [2026-09-19-nodegoat](2026-09-19-nodegoat/manifest.json) | `be507df30` | OWASP NodeGoat, 111 files | `sonnet` | 7 of 7 | 42 (5 critical, 17 high, 13 medium, 5 low, 2 info) | exit 0 | 1301 s |

## What a record proves

That every finding in `findings.json` existed at the line it cites, in the tree `manifest.json` locks, at the moment the examiner ran; that the report's own counts are the union's; and that nothing a department reported was dropped without being named. It does not prove that a listed finding is exploitable, that an unlisted defect is absent, or that the review read any file it does not say it read. `## Scope and method` and `## What was not covered` in each report are the bounds, and they are part of the record for that reason.

A record's recall against a target's documented defects is a separate reading, taken from `targets/<target>.ground-truth.json` beside the record rather than inside the release gate: a gate that scored recall could only run on targets whose defects are already known, which is not the case this program exists for.

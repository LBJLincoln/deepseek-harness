# Code-safety runs

English | [中文](README.zh.md)

Records of real code-safety reviews: one program per record, kept exactly as the harness released it. A record holds the report the program published, the union of findings behind it, the verdict the committed examiner gave over the merged head, every session log, and a manifest with the repository head, the composition, the locked target and every file's digest. Nothing in a record is edited after the run; the table below is read from those files. One thing is changed before a record is committed: private key material and example cloud keys that a department read out of the target are replaced in the findings, the result and the session logs by a redaction marker, and `manifest.json` lists under `redactions` which files were touched and how many blocks; the lines the examiner verified are never among them.

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
  tools/recall.mjs                     reads a record's recall against a ground-truth list; never part of the release gate
  tools/compare.mjs                    scores any findings list against a ground truth, the rule recall.mjs uses, for a cross-tool comparison
  tools/trajectory.mjs                 reads a record's session logs for its provenance and each finding's read trail
  tools/assemble-comparison.mjs        assembles one target's three-tier comparison into comparisons/<date>-<target>/comparison.json
  comparisons/<date>-<target>/         a target reviewed three ways — a scanner, one model, the enterprise — scored against one ground truth
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
| [2026-09-19-dvja](2026-09-19-dvja/manifest.json) | `3d386bac2` | dvja (Java, Struts 2 and Spring), 174 files | `sonnet` | 7 of 7 | 40 (9 critical, 10 high, 13 medium, 7 low, 1 info) | exit 0 | 1414 s |
| [2026-09-19-nodegoat-2](2026-09-19-nodegoat-2/manifest.json) | `5a59895fa` | OWASP NodeGoat, 111 files, started through the feed's `POST /safety` | `sonnet` | 7 of 7 | 38 (4 critical, 16 high, 14 medium, 4 low) | exit 0 | 1225 s |
| [2026-09-21-nodegoat-3](2026-09-21-nodegoat-3/manifest.json) | `a47c8f519` | OWASP NodeGoat, 111 files, started through the hosted mirror relay's `POST /safety` | `sonnet` | 7 of 7 | 47 (4 critical, 18 high, 17 medium, 7 low, 1 info) | exit 0 | 1356 s |

## What a record proves

That every finding in `findings.json` existed at the line it cites, in the tree `manifest.json` locks, at the moment the examiner ran; that the report's own counts are the union's; and that nothing a department reported was dropped without being named. It does not prove that a listed finding is exploitable, that an unlisted defect is absent, or that the review read any file it does not say it read. `## Scope and method` and `## What was not covered` in each report are the bounds, and they are part of the record for that reason.

A record's recall against a target's documented defects is a separate reading, taken from `targets/<target>.ground-truth.json` beside the record rather than inside the release gate: a gate that scored recall could only run on targets whose defects are already known, which is not the case this program exists for. `node data/code-safety/tools/recall.mjs <record> <ground truth>` prints that reading: a known issue counts as found when a released finding cites its file within three lines of its range or one of the other locations the ground truth lists for the same defect. On the NodeGoat record it reads 14 of 18: the four the review missed are the log injection on the login path, the distinct error messages that enumerate users, the one-character password policy, and the catastrophic regular expression on the routing number, and 12 of the 42 released findings are defects the ground truth does not list, among them the hard-coded administrator password the reset script seeds, the private key committed under `artifacts/`, the session that is not regenerated at login, and the dependency advisories read from the lockfile. The dvja record (a Java Struts 2 application, 174 files, reviewed before the departments were told to run semgrep first) reads 13 of 14: the one issue the review missed is the profile update that trusts a caller-supplied user id, and 14 of its 40 findings are beyond the list, among them the Log4Shell-era log4j, the cookie-gated bulk export of every user's personal data, and the root password committed in the compose file.

Two reviews of the same NodeGoat revision on the same composition, three hours apart, are the repeatability reading: the second released 38 findings to the first's 42; 38 of the first's 42 have a second-run finding within three lines of the same file, 31 of them with the same CWE, and 33 of the second's 38 have a first-run match; both read 14 of 18 with the same four misses, and they cite 15 files in common. The runs differ in the low-severity tail and in how one defect is split into findings, not in the certified core. A third NodeGoat review on 2026-09-21, on the same composition and started through the hosted mirror relay, released 47 findings and reads 13 of 18; its misses are on the session (three), research and profile routes.

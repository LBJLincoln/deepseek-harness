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
  tools/record-run.mjs                 copies one run directory into a record, redacts it, and writes its manifest
  tools/redact-record.mjs              replaces private-key bodies and example cloud keys in a record and refreshes its manifest; record-run.mjs runs it before digesting
  tools/recall.mjs                     reads a record's recall against a ground-truth list; never part of the release gate
  tools/compare.mjs                    scores any findings list against a ground truth, the rule recall.mjs uses, for a cross-tool comparison
  tools/trajectory.mjs                 reads a record's session logs for its provenance and each finding's read trail
  tools/assemble-comparison.mjs        assembles one target's three-tier comparison into comparisons/<date>-<target>/comparison.json
  tools/seed-defects.mjs               plants N defects drawn from the mutation catalogue into a copy of a target, for seeded-recall estimation; never part of the release gate
  tools/seeded-recall.mjs              scores a findings list against a seed-defects.mjs ground truth, with a Wilson 95% interval, overall and per CWE class
  tools/seed-catalogue.json            the mutation catalogue seed-defects.mjs draws from: one CWE class, language, site pattern, and insertion template per entry
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
| [2026-09-22-nodegoat-4-improved](2026-09-22-nodegoat-4-improved/manifest.json) | `c0efe64a3` | OWASP NodeGoat, 111 files, the improvement loop's first iteration: the injection skill widened after [the three-tier comparison](comparisons/2026-09-22-nodegoat/README.md) | `sonnet` | 7 of 7 | 44 (6 critical, 18 high, 12 medium, 7 low, 1 info) | exit 0 | 1426 s |

## What a record proves

That every finding in `findings.json` existed at the line it cites, in the tree `manifest.json` locks, at the moment the examiner ran; that the report's own counts are the union's; and that nothing a department reported was dropped without being named. It does not prove that a listed finding is exploitable, that an unlisted defect is absent, or that the review read any file it does not say it read. `## Scope and method` and `## What was not covered` in each report are the bounds, and they are part of the record for that reason.

A record's recall against a target's documented defects is a separate reading, taken from `targets/<target>.ground-truth.json` beside the record rather than inside the release gate: a gate that scored recall could only run on targets whose defects are already known, which is not the case this program exists for. `node data/code-safety/tools/recall.mjs <record> <ground truth>` prints that reading: a known issue counts as found when a released finding cites its file within three lines of its range or one of the other locations the ground truth lists for the same defect. On the NodeGoat record it reads 14 of 18: the four the review missed are the log injection on the login path, the distinct error messages that enumerate users, the one-character password policy, and the catastrophic regular expression on the routing number, and 12 of the 42 released findings are defects the ground truth does not list, among them the hard-coded administrator password the reset script seeds, the private key committed under `artifacts/`, the session that is not regenerated at login, and the dependency advisories read from the lockfile. The dvja record (a Java Struts 2 application, 174 files, reviewed before the departments were told to run semgrep first) reads 13 of 14: the one issue the review missed is the profile update that trusts a caller-supplied user id, and 14 of its 40 findings are beyond the list, among them the Log4Shell-era log4j, the cookie-gated bulk export of every user's personal data, and the root password committed in the compose file.

Two reviews of the same NodeGoat revision on the same composition, three hours apart, are the repeatability reading: the second released 38 findings to the first's 42; 38 of the first's 42 have a second-run finding within three lines of the same file, 31 of them with the same CWE, and 33 of the second's 38 have a first-run match; both read 14 of 18 with the same four misses, and they cite 15 files in common. The runs differ in the low-severity tail and in how one defect is split into findings, not in the certified core. A third NodeGoat review on 2026-09-21, on the same composition and started through the hosted mirror relay, released 47 findings and reads 13 of 18; its misses are on the session (three), research and profile routes.

## Recall without a ground truth: seeded defects

`targets/nodegoat.ground-truth.json` and dvja's counterpart are the only two targets with a documented defect list, because they are the only two anyone has counted. A client's own application has neither, so a review of it releases a finding count and a set of severities with nothing to read them against. **Seeded-defect (canary) estimation** gives a reading anyway: plant a known number of synthetic defect instances, of the classes the departments' skills already look for, at recorded locations in a full copy of the target; run the review on the copy without telling it; score the fraction of the planted locations a released finding lands on, by the same three-line-tolerance rule `compare.mjs` and `recall.mjs` already use. The fraction is a recall estimate on that codebase, for those classes, with a stated confidence interval.

`tools/seed-defects.mjs` plants from a **mutation catalogue** at `tools/seed-catalogue.json`: each entry names one CWE, one language, a regex that finds a realistic insertion site, and a string template that adds one line at that site. Seven of the catalogue's eight JavaScript/Express entries share one site — any line already reading `req.query`/`req.body`/`req.params.<field>` — and insert a new line that carries that same field into the class's sink: an `eval()` of it (mirroring NodeGoat's own `contributions.js`), a NoSQL `$where` filter built from it, a bare `fetch()` of it, a `console.log()` of it, a `res.redirect()` to it, a `new RegExp()` compiled from it, or a `res.send()` concatenated with it. The eighth, hardcoded credentials, instead anchors to a file's own `require(...)` line and adds a fallback-secret declaration matching the secrets skill's own `process.env.JWT_SECRET || 'literal'` example. Every inserted line is validated with `node --check` immediately; a site whose file fails to parse afterward is undone and does not count toward N. No two planted sites in one file land within 10 lines of each other. Selection is a seeded shuffle of every candidate, so the same seed and target always plant the same set; `--max-per-entry` caps one class's share of a small N; and `--avoid <ground-truth.json>` keeps a planted site three lines clear of a target's own already-documented issues, so a hit on a real, pre-existing defect is never mistaken for a hit on a synthetic one. `--dry-run` lists every candidate site, with the seeded selection marked, and touches nothing. The tool never modifies the original target: it copies the whole tree to `<out dir>/repo`, and writes `seeded.ground-truth.json` (the planted locations, in `nodegoat.ground-truth.json`'s own id/category/cwe/file/lines format) and `seed-manifest.json` (seed, catalogue digest, sites considered, sites planted, per-entry counts) beside it — never inside it, so the review the estimate scores is never pointed at its own answer key.

`tools/seeded-recall.mjs` scores a findings list — a plain JSON file, a `record-run.mjs` record directory, or a raw `pnpm run code-safety --out <dir>` run directory read straight from its `stdout.jsonl` — against that answer key with `compare.mjs`'s exact match rule, and prints caught/N as a Wilson 95% confidence interval, overall and per CWE class. Wilson, not a normal-approximation interval, because it stays inside [0, 1] and does not collapse to zero width at the small counts one seeding run produces (`k = 0` or `k = n`).

### What the number means, and what it does not

A seeded-recall reading is recall **on the seeded classes, at the seeded sites**: evidence that a review notices this defect pattern at an arbitrary, realistic point in this codebase. It is not the base rate of real, undiscovered defects in the target — the target certainly holds defects outside the classes the catalogue models, and a high reading says nothing about those. A planted defect the seeder made obvious would inflate the number without saying anything about the review's real ability: a comment naming the vulnerability, a variable named for it, or a value resembling a documented placeholder a review's own skill would filter as a known non-finding (an `AKIA...EXAMPLE`-style key, a literal `devsecret`) all read as an answer, not a test. The catalogue avoids this three ways: every template mirrors a pattern already documented in a department skill or already a real defect in a public target, no inserted line carries a comment or an identifier that names the defect, and the hardcoded-credential class's fallback value is a seeded pseudo-random 32-character hex string rather than a string a placeholder filter would recognize.

### The NodeGoat dry run

A run with `--seed 1 --n 12 --avoid targets/nodegoat.ground-truth.json` against a copy of NodeGoat at the ground truth's own revision (`c5cb68a`) planted all 12 requested sites from 37 eligible candidates (6 rejected for landing within 10 lines of another accepted site, 0 rejected by `node --check`), across 11 files. `--avoid` and NodeGoat's small size interacted: excluding the 18 documented locations left exactly one surviving site anywhere in the tree for the seven request-flow classes combined (`app/routes/memos.js`'s `req.body.memo`), so 11 of the 12 planted sites are the hardcoded-credential class, which needs no request data flow and has many eligible `require(...)` lines; a customer's larger codebase will not have this constraint bind the same way. A single sonnet pass with read-only tools (`Read`, `Grep`, `Glob`, the same prompt and flags as the unseeded single-model tier in [the three-tier comparison](comparisons/2026-09-22-nodegoat/README.md), never told the copy was seeded) released 50 findings against the seeded copy in 265 s and read **12 of 12 (100%)**, 95% CI **[0.758, 1.0]**; by class, hardcoded credentials (CWE-798) read 11 of 11 (95% CI [0.741, 1.0]) and log injection (CWE-117) read 1 of 1 (95% CI [0.207, 1.0]). Every planted site was named individually in the model's own vocabulary ("Hardcoded fallback secret value (appSecret4) committed to source," "Unsanitized memo content written to console.log, enabling log injection"), with no indication anywhere in its output that it recognized the copy as seeded.

This dry run is the single-model tier only, run because the six-department program's subscription was shared with other work that evening. Reproduce it, or run it against another target:

```sh
node data/code-safety/tools/seed-defects.mjs <target> <out dir> --seed <seed> --n <count> --avoid data/code-safety/targets/nodegoat.ground-truth.json
node data/code-safety/tools/seeded-recall.mjs <findings.json, or a record or raw run dir> <out dir>/seeded.ground-truth.json
```

The full six-department program's own seeded-recall reading, not yet run:

```sh
pnpm run code-safety -- <out dir>/repo --out .code-safety/<name>-seeded --model sonnet
node data/code-safety/tools/seeded-recall.mjs .code-safety/<name>-seeded <out dir>/seeded.ground-truth.json
```

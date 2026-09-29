# Security assessment: OWASP NodeGoat

Code-safety review record 2026-09-27-nodegoat-12-base-d

> **Training target, not a client system.** OWASP NodeGoat is an intentionally vulnerable Node.js and Express web application that the OWASP project publishes for security training. Its defects were put there on purpose, and its tutorial documents them. This assessment demonstrates the review; it assesses no client code.

| Item | Value |
| --- | --- |
| Target | OWASP NodeGoat: the tree the record locks, 111 files, read-only; the documented issues are pinned to revision c5cb68a |
| Review ran | 28 September 2026, 00:06 to 00:33 UTC (1,636 s) |
| Reviewer | The Daliesk code-safety program: 6 departments and an integration on the model `sonnet` through the operator's Claude Code login; 6 of 6 departments and the integration certified |
| Program revision | `745d904b1`, knowledge pack `cfea561b…` |
| Examiner | Exit 0: every one of the 49 findings is line-verified |
| Classification | Public: the record and this assessment are published in a public repository |
| Generated from | [data/code-safety/2026-09-27-nodegoat-12-base-d](../../2026-09-27-nodegoat-12-base-d) by [client-report.mjs](../../tools/client-report.mjs) |

## 1. Executive summary

| Critical | High | Medium | Low | Info | Total |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 9 | 16 | 15 | 9 | 0 | 49 |

- **49 findings:** 9 critical, 16 high, 15 medium, 9 low, 0 info. **Line-verified** means the committed examiner found each finding's quoted text at the cited line of the cited file in the locked tree (exit 0). It does not show that a finding is exploitable: nothing was executed.
- **15 of the 18 documented issues found (83%).** A documented issue counts as found when a finding cites its file within three lines of it. Missed: NG-A1-3 (A1 Injection (log)); NG-A2-2a (A2 Broken authentication (user enumeration)); NG-A2-2b (A2 Broken authentication (password policy)).
- **31 findings land on a documented issue; 18 are beyond the documented list** and have not been triaged. Treat those as candidates for your security team to confirm or dismiss, not as established defects.
- **Confidence is the department's own label.** 48 of 49 findings are labelled confirmed; no reproduction or human triage stands behind that label. In the one review whose findings were triaged, four findings labelled confirmed were false positives ([the triage](../../targets/README.md#the-2026-09-28-review-and-its-triage)).

### The five most urgent remediations

| # | Severity | Remediation | Where | Findings |
| --- | --- | --- | --- | --- |
| 1 | Critical | **Upgrade or replace the 16 dependencies with known advisories or no maintenance** Move each package named in the dependency findings to a release its advisories list as fixed, or replace an unmaintained package, then re-run the dependency audit against the new lockfile. | `package.json` | F-03, F-04, F-05, F-06, F-16, F-17, F-18, F-19, F-31, F-32, F-33, F-34, F-42, F-43, F-44, F-45 |
| 2 | Critical | **Passwords are stored in plaintext** Hash the password with bcrypt.hashSync (or argon2) at signup and verify with bcrypt.compareSync at login; never store or compare the raw password. | `app/data/user-dao.js:25` | F-02 |
| 3 | Critical | **NoSQL injection in allocations lookup via unsanitized `threshold` interpolated into a MongoDB `$where` JS expression** Never build a `$where` clause from request input. Validate `threshold` as a number (e.g. `parseInt(threshold, 10)` with a bounds check) and use a normal comparison query such as `{ userId: parsedUserId, stocks: { $gt: parsedThreshold } }` instead of `$where`. | `app/data/allocations-dao.js:78` | F-07 |
| 4 | Critical | **Server-side code injection via `eval()` on contribution percentages from the request body** Replace `eval(req.body.preTax)` with `parseInt(req.body.preTax, 10)` (as already sketched, but disabled, in the surrounding comment) and validate the parsed number before use; never call `eval` on request data. | `app/routes/contributions.js:32` | F-08 |
| 5 | Critical | **Session-signing secret is a hard-coded literal used unchanged in production** Read cookieSecret from an environment variable or secret manager at startup, generate a long random value per deployment, and rotate it; never commit the value used in production. | `config/env/all.js:8` | F-01 |

## 2. Scope and method

- **Target.** OWASP NodeGoat, 111 files locked read-only; the examiner re-hashed every locked file before accepting any finding. The locked tree's SHA-256 is in Appendix A.
- **Departments.** 6 departments ran in parallel, each in its own worktree and session: secrets (hard-coded credentials, tokens and keys, leaked .env and configuration); injection (SQL, NoSQL, command, template and code injection, XSS, path traversal, SSRF, log injection, ReDoS); access (authentication (including account enumeration and password policy), session handling, authorization, IDOR, CSRF); data (sensitive-data exposure, PII in logs, cleartext transport, weak crypto, password storage); dependencies (vulnerable and outdated packages, from npm audit --json or the manifest); platform (headers, CORS, cookies, error handling, rate limiting, misconfiguration, client-side code). An integration merged their findings, removed duplicates by file, line and CWE, and wrote the report.
- **Tools.** Each department ran the static scanner `semgrep` with the program's local rules and the `p/owasp-top-ten` registry pack, reading every hit before it became a finding; the dependencies department ran `npm audit --json` against the target's lockfile.
- **Model and usage.** Every department and the integration ran through the operator's Claude Code login. The record's session logs carry 11,108,977 tokens (228,141 output, 10,177,374 cache read, 703,112 cache write, 350 uncached input).
- **Verification.** The committed examiner checks that every finding's file exists in the locked tree, the line is inside it, the quoted snippet matches the code at that line, the identifiers are well formed, and the report cites every finding with the same counts; its output is `ok: SAFETY-REPORT.md and findings.json verified against /root/targets/NodeGoat`.
- **Recall.** Read after the review from [data/code-safety/targets/nodegoat.ground-truth.json](../../targets/nodegoat.ground-truth.json), 18 issues the application documents, never shown to the review.

## 3. Findings

Ranked by severity, then in the order the record lists them. Severity follows the program's written rubric as a model applied it; your security team sets the final severity.

| Ref | Severity | Finding | Location | CWE | Documented issue |
| --- | --- | --- | --- | --- | --- |
| F-01 | Critical | Session-signing secret is a hard-coded literal used unchanged in production | `config/env/all.js:8` | CWE-798 | beyond the list, untriaged |
| F-02 | Critical | Passwords are stored in plaintext | `app/data/user-dao.js:25` | CWE-256 | NG-A2-1 |
| F-03 | Critical | mongodb driver is pinned to a legacy 2.x range with a denial-of-service advisory that only a major upgrade fixes | `package.json:18` | CWE-400 | NG-A9 |
| F-04 | Critical | underscore is pinned to a range with a critical arbitrary-code-execution advisory (CVE-2021-23358) | `package.json:23` | CWE-94 | NG-A9 |
| F-05 | Critical | swig's entire published range carries an unpatched arbitrary local file read advisory | `package.json:22` | CWE-22 | NG-A9 |
| F-06 | Critical | forever, declared as a production dependency, is two majors behind and carries five transitive advisories | `package.json:15` | CWE-1104 | NG-A9 |
| F-07 | Critical | NoSQL injection in allocations lookup via unsanitized `threshold` interpolated into a MongoDB `$where` JS expression | `app/data/allocations-dao.js:78` | CWE-943 | NG-A1-2 |
| F-08 | Critical | Server-side code injection via `eval()` on contribution percentages from the request body | `app/routes/contributions.js:32` | CWE-95 | NG-A1-1 |
| F-09 | Critical | Hard-coded plaintext admin password is seeded into the live database and accepted by the login route | `artifacts/db-reset.js:18` | CWE-798 | beyond the list, untriaged |
| F-10 | High | Allocations page takes the target user id from the URL with no ownership check | `app/routes/index.js:63` | CWE-639 | NG-A4 |
| F-11 | High | Benefits routes are guarded by isLoggedIn only; the admin-role middleware is defined but never applied | `app/routes/index.js:55` | CWE-862 | NG-A7 |
| F-12 | High | Benefits update trusts a client-supplied user id to modify another user's record | `app/routes/benefits.js:30` | CWE-639 | beyond the list, untriaged |
| F-13 | High | SSN and date of birth are persisted in cleartext despite an available encryption path | `app/data/profile-dao.js:61` | CWE-312 | NG-A6-1 |
| F-14 | High | Full application config, including the session-cookie secret and crypto key, is logged to stdout on every startup | `config/config.js:13` | CWE-532 | beyond the list, untriaged |
| F-15 | High | Entire application, including login credentials and session cookies, is served only over cleartext HTTP | `server.js:145` | CWE-319 | NG-A6-2 |
| F-16 | High | express is pinned to a range with known open-redirect and response.redirect() XSS advisories, plus 14 further transitive advisories | `package.json:13` | CWE-601 | NG-A9 |
| F-17 | High | body-parser is pinned to a range with two denial-of-service advisories, plus a transitive advisory in qs | `package.json:9` | CWE-770 | NG-A9 |
| F-18 | High | marked is pinned to an exact, eleven-year-old version with six known XSS/ReDoS advisories | `package.json:17` | CWE-1333 | NG-A9 |
| F-19 | High | helmet is pinned to a 2.x range, six majors behind, pulling in separately-vulnerable connect and helmet-csp | `package.json:16` | CWE-1357 | NG-A9 |
| F-20 | High | SSRF in stock research lookup: outbound request URL is built entirely from request query parameters | `app/routes/research.js:16` | CWE-918 | NG-SSRF |
| F-21 | High | Catastrophic-backtracking regular expression applied to attacker-controlled `bankRouting` field | `app/routes/profile.js:59` | CWE-1333 | NG-REDOS |
| F-22 | High | Stored XSS: user-submitted memo Markdown is rendered to every user via `marked()` with autoescape disabled | `app/views/memos.html:31` | CWE-79 | beyond the list, untriaged |
| F-23 | High | Session cookie has no httpOnly, secure or sameSite flag, no maxAge, and uses the default cookie name | `server.js:78` | CWE-1004 | NG-A2-3 |
| F-24 | High | CSRF protection middleware is imported but never mounted, leaving state-changing routes unprotected | `server.js:7` | CWE-352 | NG-A5 |
| F-25 | High | Stored XSS via profile lastName, rendered unescaped on every page's navigation bar | `app/views/layout.html:75` | CWE-79 | beyond the list, untriaged |
| F-26 | Medium | Session id is not regenerated after successful login (session fixation) | `app/routes/session.js:116` | CWE-384 | beyond the list, untriaged |
| F-27 | Medium | No CSRF protection on the state-changing profile-update route (and every other state-changing route) | `app/routes/index.js:48` | CWE-352 | NG-A8 |
| F-28 | Medium | Login route has no rate limiting or lockout, enabling unlimited password guessing | `app/routes/index.js:34` | CWE-307 | beyond the list, untriaged |
| F-29 | Medium | Database seed script logs every user record, including plaintext passwords, to the console | `artifacts/db-reset.js:99` | CWE-532 | beyond the list, untriaged |
| F-30 | Medium | Raw internal error objects are rendered unescaped straight into the error page sent to the client | `app/views/error-template.html:11` | CWE-209 | beyond the list, untriaged |
| F-31 | Medium | cypress, a build/test-only dependency, is thirteen majors behind and carries the largest transitive advisory chain in the project | `package.json:44` | CWE-1357 | NG-A9 |
| F-32 | Medium | async, a devDependency, is pinned to a pre-release range with a known prototype-pollution advisory (CVE-2021-43138) | `package.json:42` | CWE-1321 | NG-A9 |
| F-33 | Medium | grunt, a devDependency, is pinned to a range with an arbitrary-code-execution advisory, plus 13 transitive advisories | `package.json:45` | CWE-1188 | NG-A9 |
| F-34 | Medium | bcrypt-nodejs, used for password hashing, is the author's own thirteen-year-old, single-release, deprecated package | `package.json:8` | CWE-1104 | NG-A9 |
| F-35 | Medium | Open redirect on /learn takes the destination directly from the `url` query parameter | `app/routes/index.js:72` | CWE-601 | NG-A10 |
| F-36 | Medium | Reflected XSS: failed-login page echoes `userName` into an HTML attribute with autoescape disabled | `app/views/login.html:110` | CWE-79 | beyond the list, untriaged |
| F-37 | Medium | Reflected XSS: profile page renders unescaped `firstName` into an `href` attribute | `app/views/profile.html:78` | CWE-79 | NG-A3 |
| F-38 | Medium | Helmet security-headers middleware is imported but never mounted | `server.js:10` | CWE-693 | NG-A5 |
| F-39 | Medium | Global error handler renders the raw Error object to the client | `app/routes/error.js:10` | CWE-209 | beyond the list, untriaged |
| F-40 | Medium | Full application config, including the session cookie secret and crypto key, is printed to stdout on every startup | `config/config.js:12` | CWE-532 | beyond the list, untriaged |
| F-41 | Low | Password comparison uses a non-constant-time equality check | `app/data/user-dao.js:61` | CWE-208 | beyond the list, untriaged |
| F-42 | Low | swig has had no release since 2014 and the registry marks it "no longer maintained" | `package.json:22` | CWE-1104 | NG-A9 |
| F-43 | Low | csurf is archived and no longer maintained upstream, and carries a transitive cookie advisory | `package.json:11` | CWE-1357 | NG-A9 |
| F-44 | Low | express-session pulls a vulnerable cookie and on-headers into the session middleware | `package.json:14` | CWE-1357 | NG-A9 |
| F-45 | Low | node-esapi has had exactly one release, in 2014, with no update in the twelve years since | `package.json:20` | CWE-1104 | NG-A9 |
| F-46 | Low | Environment defaults to "development" when NODE_ENV is unset, silently enabling development configuration in an unconfigured deployment | `config/config.js:5` | CWE-1188 | beyond the list, untriaged |
| F-47 | Low | Hard-coded AES key intended to protect SSN/DOB/bank data, currently unreachable because the encrypt/decrypt code is commented out | `config/env/all.js:9` | CWE-321 | beyond the list, untriaged |
| F-48 | Low | RSA private key committed to the repository for the TLS certificate, currently unused because the HTTPS listener is commented out | `artifacts/cert/server.key:1` | CWE-321 | beyond the list, untriaged |
| F-49 | Low | OWASP ZAP proxy API key hard-coded in committed test/dev configuration | `config/env/development.js:6` | CWE-798 | beyond the list, untriaged |

## 4. Recall against the documented issues

15 of 18. A documented issue counts as found when a finding cites its file within three lines of the issue's lines or of another location the list gives for the same defect.

| Issue | Category | CWE | Where | Found by |
| --- | --- | --- | --- | --- |
| NG-A1-1 | A1 Injection (server-side JavaScript) | CWE-95 | `app/routes/contributions.js:32-34` | F-08 |
| NG-A1-2 | A1 Injection (NoSQL) | CWE-943 | `app/data/allocations-dao.js:78-78` | F-07 |
| NG-A1-3 | A1 Injection (log) | CWE-117 | `app/routes/session.js:64-64` | missed |
| NG-A2-1 | A2 Broken authentication (password storage) | CWE-256 | `app/data/user-dao.js:25-25` | F-02 |
| NG-A2-2a | A2 Broken authentication (user enumeration) | CWE-204 | `app/routes/session.js:85-94` | missed |
| NG-A2-2b | A2 Broken authentication (password policy) | CWE-521 | `app/routes/session.js:144-144` | missed |
| NG-A2-3 | A2 Session management (cookie flags) | CWE-1004 | `server.js:78-102` | F-23 |
| NG-A3 | A3 Cross-site scripting | CWE-79 | `server.js:137-137` | F-37 |
| NG-A4 | A4 Insecure direct object reference | CWE-639 | `app/routes/allocations.js:16-18` | F-10 |
| NG-A5 | A5 Security misconfiguration (headers) | CWE-16 | `server.js:38-62` | F-24, F-38 |
| NG-A6-1 | A6 Sensitive data exposure (at rest) | CWE-311 | `app/data/profile-dao.js:55-66` | F-13 |
| NG-A6-2 | A6 Sensitive data exposure (in transit) | CWE-319 | `server.js:145-145` | F-15 |
| NG-A7 | A7 Missing function-level access control | CWE-862 | `app/routes/index.js:55-56` | F-11 |
| NG-A8 | A8 Cross-site request forgery | CWE-352 | `server.js:104-113` | F-27 |
| NG-A9 | A9 Components with known vulnerabilities | CWE-1104 | `package.json:1-1` | F-03, F-04, F-05, F-06, F-16, F-17, F-18, F-19, F-31, F-32, F-33, F-34, F-42, F-43, F-44, F-45 |
| NG-A10 | A10 Unvalidated redirect | CWE-601 | `app/routes/index.js:72-72` | F-35 |
| NG-SSRF | Server-side request forgery | CWE-918 | `app/routes/research.js:15-16` | F-20 |
| NG-REDOS | Regular expression denial of service | CWE-1333 | `app/routes/profile.js:59-59` | F-21 |

This record is one of 12 reviews of OWASP NodeGoat on file. Grouped by the knowledge pack the departments read:

| Knowledge pack | Reviews | Documented issues found | Note |
| --- | --- | --- | --- |
| not recorded | 4 | 13 to 14 of 18 |  |
| `cfea561b…` | 6 | 13 to 15 of 18 | includes this record |
| `0ec2cc9b…` | 2 | 18 of 18 | in-sample: the diagnosed checklists, written from the misses of earlier reviews of this target |

## 5. Limitations

- **A training application.** OWASP NodeGoat was written to contain these defects. How the review performs on a production codebase, with no documented list to score against, is measured by planting defects in a copy of it ([seeded recall](../../README.md#recall-without-a-ground-truth-seeded-defects)).
- **Static review only.** Nothing was run, fuzzed or exploited. A line-verified finding shows that the cited code is present, not that an attacker can reach it.
- **One run.** A model-driven review varies from run to run: two reviews of the same NodeGoat revision on one composition matched 38 of the first run's 42 findings with a finding within three lines of the same file, 31 of them with the same CWE ([the records](../../README.md#what-a-record-proves)).
- **Untriaged findings and department confidence.** No finding in this record was triaged by a person or reproduced; the confidence labels are the departments' own.
- **Coverage.** The record's own report lists what the review did not reach, such as dynamic testing, git history and vendored front-end code, under `## What was not covered` ([SAFETY-REPORT.md](../../2026-09-27-nodegoat-12-base-d/SAFETY-REPORT.md)).

## 6. Data handling

Every model request of this review, with the text of each file a department read, went to Anthropic's model API under the operator's Claude Code login, and the record, session logs included, is committed to a public repository. That is acceptable for a public training application and not for client code. [Data handling](../../../../docs/client/data-handling.md) states every destination, the terms of each, and what a client engagement requires first: an API organisation under a data processing agreement with zero data retention, and records kept out of the public repository.

## Appendix A. Record, paths and digests

| Item | Value |
| --- | --- |
| Record | [data/code-safety/2026-09-27-nodegoat-12-base-d](../../2026-09-27-nodegoat-12-base-d/manifest.json) |
| Program id | `program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672` |
| Repository head | `745d904b1c35aff49a845d0f0b32e016b4499633` |
| Merged revision of the report repository | `9ee8864c555d7edbae680b9eee2df0bba089418c` |
| Locked target | `/root/targets/NodeGoat`, 111 files, SHA-256 `78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3` |
| Knowledge pack | `data/knowledge/code-safety`, 13 files, SHA-256 `cfea561b10e97bda53a808c96078984b6eee9ea7399f7aa379aad325ae2d9450` |
| Composition | `examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml` |

| Record file | Bytes | SHA-256 |
| --- | --- | --- |
| `result.json` | 166,291 | `da190e02a1a3f06654ef86e391a934c1897ae0337381c3550b328b940b625367` |
| `SAFETY-REPORT.md` | 45,997 | `6dbf3846c57e48aafa84018c3c24900554c995bd409e9cb4f09a82b6def95822` |
| `findings.json` | 75,948 | `e7cee551619c650052edee9137a1d5dcece17fc26fa158155d5f82aa0aee296c` |
| `verifier.txt` | 86 | `72a90ce8ffe90468aac032053950eefd0b67b96d05013ff69c722d07032e4756` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672.jsonl` | 26,442 | `c06896fbedab7411551651764296ff0e66f3fa88035bffea525930443f7124bd` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672-~0040integration.jsonl` | 969,535 | `5b0b757e177521d6f9decdaaaacf569a1121be22fd38a6e929a100668f7a32b7` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672-access.jsonl` | 424,216 | `22f5370f0dd4baa74705a4c47e34f905b1d77cc58cbdd5d46e774e43d3b3541a` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672-data.jsonl` | 505,917 | `69afa2659853d46bc018a6ee8b302be29f5e209a98527872780c2f435e4376f7` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672-dependencies.jsonl` | 448,040 | `93657f926c056a9085ebe3dad02a5185b1acc7dfd689c7e47a43ffdd4b72ce9c` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672-injection.jsonl` | 618,583 | `30eca1375b7f47ccdb277e99bd68a1ccdc5d8baaeec340456262cf09fe2996bd` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672-platform.jsonl` | 410,834 | `748413cba6810e16156c03bc9525a6b486b2f5c1282d853fabbb08e91b93fda8` |
| `sessions/program-4b9874c397f12ea5608efab69ddec460cfc94c863c0226b995797a6fcef8e672-secrets.jsonl` | 520,913 | `e4c347e27d62a7b6f4fb4002703fb46371d77d7db3b310518a6ea9de707a77bd` |

## Appendix B. Finding details

### F-01. Critical: Session-signing secret is a hard-coded literal used unchanged in production

- **Location:** `config/env/all.js:8`; CWE-798; A07:2021 Identification and Authentication Failures; department confidence confirmed; beyond the documented list, untriaged

```
cookieSecret: "session_cookie_secret_key_here",
```

**Evidence.** config/config.js:7-10 merges config/env/all.js with config/env/&lt;NODE_ENV&gt;.js. config/env/production.js exports `{}` and config/env/development.js never sets cookieSecret, so the literal at all.js:8 is the value that reaches express-session in every environment, including production, via server.js:82 `secret: cookieSecret`. The session middleware chain read at server.js:78-102 has no other secret source (no genid override, no env-var read) in front of it.

**Impact.** Anyone who has read the source (it is the public OWASP NodejsGoat repository) can compute a validly signed session cookie for any session id, letting them forge a session and set req.session.userId to any user, including an admin, without ever authenticating.

**Fix.** Read cookieSecret from an environment variable or secret manager at startup, generate a long random value per deployment, and rotate it; never commit the value used in production.

### F-02. Critical: Passwords are stored in plaintext

- **Location:** `app/data/user-dao.js:25`; CWE-256; A02:2021 Cryptographic Failures; department confidence confirmed; documented issue NG-A2-1

```
password //received from request param
```

**Evidence.** addUser (user-dao.js:17-47) builds the stored user document with password taken verbatim from the caller at line 25; the commented-out fix directly above it (lines 26-30) shows the intended `bcrypt.hashSync(password, bcrypt.genSaltSync())` was never applied. validateLogin's comparePassword (lines 60-61) then compares the value read back from MongoDB (findOne at lines 91-93) to the submitted password with plain `===`, which only works if the stored value is the raw password rather than a hash.

**Impact.** Reading the users collection — via a database backup, a compromised operator account, or an unrelated injection bug — discloses every user's password in cleartext, enabling full account takeover across the entire user base, including admin accounts.

**Fix.** Hash the password with bcrypt.hashSync (or argon2) at signup and verify with bcrypt.compareSync at login; never store or compare the raw password.

### F-03. Critical: mongodb driver is pinned to a legacy 2.x range with a denial-of-service advisory that only a major upgrade fixes

- **Location:** `package.json:18`; CWE-400; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"mongodb": "^2.1.18",
```

**Evidence.** npm audit reports the declared range ^2.1.18 resolves inside mongodb's vulnerable band &lt;=3.1.12: GHSA-mh5c-679w-hh4r, a denial-of-service in the driver, fixed in 3.1.13. Because 2.x and 3.x are different npm majors, ^2.1.18 can never resolve to that fix on its own; npm audit's own remediation suggestion for this entry is a jump straight to mongodb@7.6.0, five majors ahead of what is declared. The entry's `via` also names mongodb-core, adding 2 further transitive advisories.

**Impact.** This is the driver every database access in NodeGoat's DAO layer goes through; a malformed server response or crafted document on this affected code path can crash or hang the process handling the app's database connection, denying service to every user.

**Fix.** Move off the 2.x line; the 3.x line is itself end-of-life, so plan a full driver upgrade to a current major (7.6.0) and the accompanying API changes across the DAO files.

### F-04. Critical: underscore is pinned to a range with a critical arbitrary-code-execution advisory (CVE-2021-23358)

- **Location:** `package.json:23`; CWE-94; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"underscore": "^1.8.3"
```

**Evidence.** npm audit reports the declared range ^1.8.3 resolves inside underscore's vulnerable band &lt;=1.13.7: GHSA-cf4h-3jhx-xvhq (Arbitrary Code Execution via the `template` function, also tracked as CVE-2021-23358, fixed in 1.12.1) and GHSA-qpx9-hpmf-5gmw (unlimited recursion in `_.flatten`/`_.isEqual` leading to denial of service, fixed in 1.13.8). The npm registry's current release is 1.13.8; the declared caret range accepted every intervening vulnerable release published since.

**Impact.** If any code path renders an underscore template with attacker-influenced input, an attacker can execute arbitrary JavaScript on the server; separately, a crafted deeply-nested value passed to the affected utility functions can hang the process.

**Fix.** Bump the declared dependency to underscore@1.13.8 or later.

### F-05. Critical: swig's entire published range carries an unpatched arbitrary local file read advisory

- **Location:** `package.json:22`; CWE-22; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"swig": "^1.4.2",
```

**Evidence.** npm audit flags swig's whole published range (`*`) as vulnerable to GHSA-2rq5-699j-x7p6, an arbitrary local file read during template rendering (CWE-22), and reports `fixAvailable: false` for this entry: there is no patched release at any version, including the current latest (1.4.2, which is also what the declared ^1.4.2 resolves to). The entry's `via` also names optimist and uglify-js, adding 3 further transitive advisories.

**Impact.** If any template path or included fragment is influenced by user input, an attacker can read arbitrary files from the server's filesystem through swig's rendering pipeline.

**Fix.** There is no fixed version to upgrade to; migrate off swig to an actively maintained template engine (for example Nunjucks or EJS) and re-audit every template path for user influence.

### F-06. Critical: forever, declared as a production dependency, is two majors behind and carries five transitive advisories

- **Location:** `package.json:15`; CWE-1104; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"forever": "^2.0.0",
```

**Evidence.** npm audit's entry for forever (matching every published version, range &gt;=0.7.4) carries no advisory directly on forever's own code, but its `via` lists flatiron, forever-monitor, nconf and optimist — each separately flagged, for five distinct advisory URLs in total. npm's own suggested remediation jumps to forever@4.0.3, which the registry also shows as forever's current latest, last published 2022-01-28, two majors ahead of the declared ^2.0.0.

**Impact.** forever is declared in `dependencies`, not `devDependencies`, so its vulnerable chain (flatiron/broadway/nconf/optimist, which includes prototype-pollution-class issues) runs with the same privileges as the deployed application process, not just at build time.

**Fix.** Upgrade forever to 4.0.3, which drops or updates the vulnerable transitive packages; re-verify NodeGoat's process-management usage against the intervening major-version API changes.

### F-07. Critical: NoSQL injection in allocations lookup via unsanitized `threshold` interpolated into a MongoDB `$where` JS expression

- **Location:** `app/data/allocations-dao.js:78`; CWE-943; A03:2021 Injection; department confidence confirmed; documented issue NG-A1-2

```
$where: `this.userId == ${parsedUserId} && this.stocks > '${threshold}'`
```

**Evidence.** app/routes/allocations.js line 20 destructures `const { threshold } = req.query;` from the GET /allocations/:userId route (mounted with only the isLoggedIn middleware in app/routes/index.js line 63), and passes it unmodified as the second argument to allocationsDAO.getByUserIdAndThreshold at line 23. In app/data/allocations-dao.js, that value flows straight into the `searchCriteria()` closure: `threshold` is never parsed or validated (unlike `userId`, which is passed through `parseInt`), and at line 78 it is interpolated verbatim into a template literal that becomes the value of a MongoDB `$where` clause, then executed by `allocationsCol.find(searchCriteria())` at line 86. `$where` runs its string as JavaScript inside the MongoDB server for every document in the collection, so a value such as `' ; return true; var x='` or `' ; while(true){} ; var x='` breaks out of the intended `this.stocks > '<threshold>'` comparison and lets an authenticated user run arbitrary JS against the whole `allocations` collection.

**Impact.** Any logged-in user can inject arbitrary JavaScript that MongoDB evaluates server-side for every allocations document, enabling boolean/blind extraction of other users' allocation records or a denial-of-service (infinite loop) against the database for all users.

**Fix.** Never build a `$where` clause from request input. Validate `threshold` as a number (e.g. `parseInt(threshold, 10)` with a bounds check) and use a normal comparison query such as `{ userId: parsedUserId, stocks: { $gt: parsedThreshold } }` instead of `$where`.

### F-08. Critical: Server-side code injection via `eval()` on contribution percentages from the request body

- **Location:** `app/routes/contributions.js:32`; CWE-95; A03:2021 Injection; department confidence confirmed; documented issue NG-A1-1

```
const preTax = eval(req.body.preTax);
        const afterTax = eval(req.body.afterTax);
        const roth = eval(req.body.roth);
```

**Evidence.** POST /contributions is routed to contributionsHandler.handleContributionsUpdate (app/routes/index.js line 52). The handler reads `req.body.preTax`, `req.body.afterTax` and `req.body.roth` directly from the POST body and passes each straight into `eval()` at lines 32-34, before any validation runs (the `isNaN`/range checks at lines 47-63 execute only after the eval calls). There is no parsing (`parseInt`/`parseFloat`) or type check on these fields anywhere upstream; the commented-out block at lines 37-41 shows the intended, unused fix.

**Impact.** Any authenticated user can submit a value such as `require('child_process').execSync('id')` (or any other JavaScript) as `preTax`, `afterTax` or `roth` and have it executed by the Node.js server process, giving full remote code execution with the privileges of the application.

**Fix.** Replace `eval(req.body.preTax)` with `parseInt(req.body.preTax, 10)` (as already sketched, but disabled, in the surrounding comment) and validate the parsed number before use; never call `eval` on request data.

### F-09. Critical: Hard-coded plaintext admin password is seeded into the live database and accepted by the login route

- **Location:** `artifacts/db-reset.js:18`; CWE-798; A07:2021 Identification and Authentication Failures; department confidence confirmed; beyond the documented list, untriaged

```
"password": "Admin_123",
```

**Evidence.** artifacts/db-reset.js hard-codes the admin account (userName: "admin", isAdmin: true) with the literal password "Admin_123" at line 18, and this script is the app's own database bootstrap: app.json wires it as the Heroku "postdeploy" script (app.json line 13) and docker-compose.yml runs "node artifacts/db-reset.js" before "npm start" on every container start (docker-compose.yml line 9). app/data/user-dao.js stores the password exactly as received (line 25: `password //received from request param`, with the bcrypt.hashSync alternative at line 29 left commented out) and validateLogin's comparePassword does a plain `return fromDB === fromUser;` (user-dao.js line 61), so the seeded plaintext value is compared directly against what the /login route in app/routes/session.js submits. No hashing or salting is on this path.

**Impact.** Anyone who has read this public repository (or any deployment built from it that ran the seed/postdeploy script, e.g. the shipped docker-compose.yml and Heroku app.json) can authenticate as the isAdmin:true account with userName "admin" and password "Admin_123" with no other precondition, reaching the admin-only benefits/allocations routes and every other user's SSN, date of birth and bank account/routing data stored by the app.

**Fix.** Never seed a real admin account with a fixed literal password; generate a random one-time password at provisioning time (or require an out-of-band reset), store only a salted hash (bcrypt.hashSync, already present but commented out in user-dao.js), and change comparePassword to bcrypt.compareSync. Rotate any account created from this script in every existing deployment.

### F-10. High: Allocations page takes the target user id from the URL with no ownership check

- **Location:** `app/routes/index.js:63`; CWE-639; A01:2021 Broken Access Control; department confidence confirmed; documented issue NG-A4

```
app.get("/allocations/:userId", isLoggedIn, allocationsHandler.displayAllocations);
```

**Evidence.** The route's middleware chain is isLoggedIn only, which confirms a session exists but never that req.session.userId matches the requested :userId. displayAllocations (app/routes/allocations.js:16-18) reads userId straight from req.params — the alternative of reading req.session.userId is shown commented out immediately above it (allocations.js:12-15) — and passes it unchecked into allocationsDAO.getByUserIdAndThreshold (allocations.js:23), whose query `{ userId: parsedUserId }` (app/data/allocations-dao.js:81-83) has no filter tying it back to the caller.

**Impact.** Any authenticated user can read any other user's stock/fund/bond allocation percentages by changing the :userId path segment, e.g. GET /allocations/2 while logged in as user 1.

**Fix.** Read the target user id from req.session.userId instead of req.params.userId (the commented-out fix at allocations.js:12-15), or explicitly reject the request when req.params.userId !== req.session.userId.

### F-11. High: Benefits routes are guarded by isLoggedIn only; the admin-role middleware is defined but never applied

- **Location:** `app/routes/index.js:55`; CWE-862; A01:2021 Broken Access Control; department confidence confirmed; documented issue NG-A7

```
app.get("/benefits", isLoggedIn, benefitsHandler.displayBenefits);
    app.post("/benefits", isLoggedIn, benefitsHandler.updateBenefits);
```

**Evidence.** Both the GET and POST /benefits middleware chains are isLoggedIn only. isAdmin (index.js:27, bound to sessionHandler.isAdminUserMiddleware, session.js:25-34) correctly loads the user and checks user.isAdmin, but a repo-wide search for isAdmin shows it is used nowhere in app/routes/index.js's active route registrations — the only place it appears with /benefits is a comment block at index.js:57-60 headed 'Fix for A7 - checks user role to implement Function Level Access Control'. displayBenefits itself (app/routes/benefits.js:13-27) calls benefitsDAO.getAllNonAdminUsers with no role check of its own.

**Impact.** Any authenticated, non-admin user can browse /benefits and see every non-admin employee's name and benefit start date, and reach the POST handler covered by access-005.

**Fix.** Apply the existing isAdmin middleware to both routes: app.get("/benefits", isLoggedIn, isAdmin, ...) and app.post("/benefits", isLoggedIn, isAdmin, ...), as the commented-out lines already show.

### F-12. High: Benefits update trusts a client-supplied user id to modify another user's record

- **Location:** `app/routes/benefits.js:30`; CWE-639; A01:2021 Broken Access Control; department confidence confirmed; beyond the documented list, untriaged

```
const {
            userId,
            benefitStartDate
        } = req.body;

        benefitsDAO.updateBenefits(userId, benefitStartDate, (error) => {
```

**Evidence.** updateBenefits (benefits.js:29-54) destructures userId directly from req.body (line 31) and passes it unchecked into benefitsDAO.updateBenefits(userId, benefitStartDate, ...) at line 35. That DAO method (app/data/benefits-dao.js:23-40) runs usersCol.update({ _id: parseInt(userId) }, { $set: { benefitStartDate: startDate } }) with no check anywhere that userId belongs to the caller or that the caller holds an admin role. The only gate in front of this handler is the isLoggedIn-only route chain covered in access-004.

**Impact.** Any authenticated user can change any other user's benefitStartDate by POSTing a different userId in the body, independent of whichever role check is (or is not) added to the route.

**Fix.** Inside updateBenefits, verify the acting session user is an admin (req.session.userId's user.isAdmin) before writing, rather than trusting req.body.userId for who gets modified.

### F-13. High: SSN and date of birth are persisted in cleartext despite an available encryption path

- **Location:** `app/data/profile-dao.js:61`; CWE-312; A02:2021 Cryptographic Failures; department confidence confirmed; documented issue NG-A6-1

```
if (ssn) {
            user.ssn = ssn;
        }
        if (dob) {
            user.dob = dob;
        }
```

**Evidence.** updateUser() (app/data/profile-dao.js:42-92) is reached from app/routes/profile.js:82-105 handleProfileUpdate, which forwards req.body.ssn and req.body.dob unchanged. The commented-out block at lines 67-76 shows the intended fix (`user.ssn = encrypt(ssn); user.dob = encrypt(dob);` using the AES helper defined in the disabled block at lines 15-40) is dead code, so ssn/dob are written to the `users` collection as plain strings and read back unencrypted by getByUserId (lines 94-110, decrypt() call also commented out).

**Impact.** SSN and date of birth for every user are recoverable in cleartext from a database dump, backup, or any other read access to the `users` collection - both are primary identifiers for identity theft and are not protected by the encryption mechanism already present but disabled in the codebase.

**Fix.** Re-enable the crypto.createCipheriv/createDecipheriv helpers (lines 15-40) with a random IV per record and a key loaded from a secrets manager, not the hardcoded config.cryptoKey, and use them in updateUser/getByUserId.

### F-14. High: Full application config, including the session-cookie secret and crypto key, is logged to stdout on every startup

- **Location:** `config/config.js:13`; CWE-532; A09:2021 Security Logging and Monitoring Failures; department confidence confirmed; beyond the documented list, untriaged

```
console.log(util.inspect(config, false, null));
```

**Evidence.** config is built at line 10 by merging config/env/all.js into envConf; all.js sets `cookieSecret: "session_cookie_secret_key_here"` (line 8) and `cryptoKey: "a_secure_key_for_crypto_here"` (line 9), both present on the merged object. util.inspect(config, false, null) at line 13 recursively serializes the whole object with no field filtering and writes it to console.log, which every deployment (Docker logs, Heroku/PaaS log stream per Procfile, journald, etc.) captures.

**Impact.** Anyone who can read the application's process logs (ops staff, a log-aggregation SaaS, or an attacker who compromises log storage) obtains the express-session signing secret and the AES key in plaintext, letting them forge session cookies to impersonate any user, including admins.

**Fix.** Remove the console.log of the full config object, or log an explicit allowlist of non-secret fields (port, hostName) instead of the whole merged object.

### F-15. High: Entire application, including login credentials and session cookies, is served only over cleartext HTTP

- **Location:** `server.js:145`; CWE-319; A02:2021 Cryptographic Failures; department confidence confirmed; documented issue NG-A6-2

```
http.createServer(app).listen(port, () => {
```

**Evidence.** server.js only calls http.createServer(app).listen(...) (line 145); the https.createServer(httpsOptions, app) alternative that would load artifacts/cert/server.key and server.crt is fully commented out (lines 18-28 and 149-155). The express-session middleware configured at lines 78-102 has no `cookie: { secure: true }` (that block is also commented out at lines 92-100), so the session cookie carrying req.session.userId (set at app/routes/session.js:116,235) and the userName/password POSTed to /login (app/routes/session.js:53-57) all travel over this same unencrypted HTTP listener.

**Impact.** Anyone able to observe network traffic between a client and the server (a shared Wi-Fi, a compromised router, an ISP, or a man-in-the-middle) can read login credentials, session cookies, and every other field submitted by the app, including the SSN/DOB/bank fields from the profile form, in plaintext.

**Fix.** Serve the app exclusively over HTTPS using the already-present artifacts/cert/server.key and server.crt, and set the session cookie's `secure: true` (and `httpOnly: true`) flag once HTTPS is enabled.

### F-16. High: express is pinned to a range with known open-redirect and response.redirect() XSS advisories, plus 14 further transitive advisories

- **Location:** `package.json:13`; CWE-601; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"express": "^4.13.4",
```

**Evidence.** npm audit --json, run against this target's own package-lock.json on 2026-09-28 with the registry reachable, reports the declared range ^4.13.4 resolves inside express's vulnerable band &lt;=4.21.2. Two advisories are direct on express itself: GHSA-qw6h-vgh9-j6wx (XSS via response.redirect(), CWE-79, fixed in 4.20.0) and GHSA-rv95-896h-c2vc (Open Redirect in malformed URLs, CWE-601, fixed in 4.19.2). The same audit entry's `via` list also names body-parser, cookie, path-to-regexp, qs, send and serve-static as separately-vulnerable packages inside express's own dependency tree, for 14 further distinct advisory URLs riding in through this one direct dependency.

**Impact.** A request handled by this app on an unpatched express in this range can be redirected to an attacker-controlled host via a malformed URL, or have attacker-controlled content reflected into a redirect response, both usable for phishing and stored/reflected XSS.

**Fix.** Raise the declared range to at least express@4.20.0 to pick up both direct fixes; the current stable major is 5.2.1 and is the better long-term target since it also carries newer body-parser/path-to-regexp/qs.

### F-17. High: body-parser is pinned to a range with two denial-of-service advisories, plus a transitive advisory in qs

- **Location:** `package.json:9`; CWE-770; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"body-parser": "^1.15.1",
```

**Evidence.** npm audit reports the declared range ^1.15.1 resolves inside body-parser's vulnerable band &lt;=1.20.5: GHSA-qwcr-r2fm-qrc7 (denial of service when urlencoded parsing is enabled, CWE-405, fixed in 1.20.3) and GHSA-v422-hmwv-36x6 (an invalid `limit` value silently disables size enforcement, CWE-770, fixed in 1.20.6). The entry's `via` also names qs, contributing further advisories (8 distinct advisory URLs total in this dependency's tree).

**Impact.** A crafted request body can exhaust server memory or CPU (denial of service) against every route that parses a body, or silently bypass a configured body-size limit if one was set expecting enforcement.

**Fix.** Upgrade body-parser to 1.20.6 or later within the 1.x line; upgrading express first (see the express finding) will pull a compatible, patched body-parser as well.

### F-18. High: marked is pinned to an exact, eleven-year-old version with six known XSS/ReDoS advisories

- **Location:** `package.json:17`; CWE-1333; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"marked": "0.3.5",
```

**Evidence.** The dependency is pinned to the exact string "0.3.5" (no caret or tilde), a version the npm registry's own metadata shows was published 2015-07-31. npm audit's entry for marked (matching range &lt;=4.0.9) lists six direct advisories: GHSA-7px7-7xjx-hxm8 and GHSA-vfvf-mqq8-rwqc (XSS, CWE-79, fixed in 0.3.7/0.3.6), and GHSA-x5pg-88wf-qq4p, GHSA-p9wx-2529-fp83, GHSA-rrrm-qjm4-v8hf and GHSA-5v2h-r2cx-5xgj (ReDoS, CWE-400/CWE-1333, fixed across 0.3.9 through 4.0.10). Because the version is pinned exactly, no `npm install` will ever move it forward on its own.

**Impact.** Markdown rendered through this version of marked can be crafted to execute script in a viewer's browser (XSS), or to hang the rendering process with a pathological input (ReDoS) — both directly reachable wherever this app renders user-supplied markdown (for example a memo body).

**Fix.** Unpin the version and upgrade past 4.0.10 at minimum; the current release is 18.0.14, but expect breaking API changes across that many majors and re-test every render call site.

### F-19. High: helmet is pinned to a 2.x range, six majors behind, pulling in separately-vulnerable connect and helmet-csp

- **Location:** `package.json:16`; CWE-1357; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"helmet": "^2.0.0",
```

**Evidence.** npm audit's entry for helmet (matching range 0.3.0-3.20.1) carries no advisory directly on helmet's own code, but its `via` lists connect and helmet-csp, each separately vulnerable (4 distinct advisory URLs total in this dependency's tree). The npm registry's current helmet major is 8.3.0; helmet dropped the connect dependency and the cookie-based CSP middleware entirely starting with its 4.x line, which is the actual fix for this chain — a fix ^2.0.0 can never reach.

**Impact.** The security-header middleware this app relies on ships through an outdated, separately-vulnerable dependency chain, and misses default protections added in later majors (modern CSP directives, COOP/COEP headers, and others).

**Fix.** Upgrade the declared range to helmet@8.x and re-apply its configuration, which changed shape across the major-version jumps from 2.x.

### F-20. High: SSRF in stock research lookup: outbound request URL is built entirely from request query parameters

- **Location:** `app/routes/research.js:16`; CWE-918; A10:2021 Server-Side Request Forgery (SSRF); department confidence confirmed; documented issue NG-SSRF

```
return needle.get(url, (error, newResponse, body) => {
```

**Evidence.** GET /research is routed to researchHandler.displayResearch (app/routes/index.js line 76). At line 15 the handler builds `const url = req.query.url + req.query.symbol;` directly from two request query parameters with no host allowlist, scheme check, or private-IP block, then at line 16 hands that string straight to `needle.get(url, ...)`, a server-side HTTP client. The response body is then written back to the client verbatim at line 25 (`res.write(body)`), so the response of the server-side fetch is also reflected to the requester.

**Impact.** An authenticated user can make the NodeGoat server issue arbitrary outbound HTTP requests, including to internal-only services or a cloud metadata endpoint (e.g. `http://169.254.169.254/...`), and read the response through the reflected `res.write(body)`, enabling internal network reconnaissance and potential credential theft.

**Fix.** Never let the request choose the outbound host. Validate `req.query.url` against an allowlist of known stock-data hosts, resolve and re-check the destination IP is not link-local/private/loopback before the request, and drop the raw response passthrough.

### F-21. High: Catastrophic-backtracking regular expression applied to attacker-controlled `bankRouting` field

- **Location:** `app/routes/profile.js:59`; CWE-1333; A03:2021 Injection; department confidence confirmed; documented issue NG-REDOS

```
const regexPattern = /([0-9]+)+\#/;
```

**Evidence.** POST /profile is routed to profileHandler.handleProfileUpdate (app/routes/index.js line 48), which destructures `bankRouting` straight from `req.body` (line 49 of profile.js) with no length cap. Line 61 runs `regexPattern.test(bankRouting)` using the pattern compiled at line 59, whose nested quantifier `([0-9]+)+` causes exponential backtracking on an input like a long run of digits with no trailing `#` (e.g. `"1".repeat(30)`). The comment at lines 52-58 explicitly names this as the vulnerable ReDoS pattern the fixed version (single `+`, commented out) is meant to replace.

**Impact.** Any authenticated user can submit a crafted `bankRouting` value in a single POST /profile request that pins the Node.js event loop at 100% CPU for seconds to minutes, causing a denial of service for every user of the shared, single-threaded server.

**Fix.** Remove the redundant outer quantifier so the pattern is linear, e.g. `/[0-9]+#/`, or cap `bankRouting`'s length before testing it and/or run the match through a linear-time engine.

### F-22. High: Stored XSS: user-submitted memo Markdown is rendered to every user via `marked()` with autoescape disabled

- **Location:** `app/views/memos.html:31`; CWE-79; A03:2021 Injection; department confidence likely; beyond the documented list, untriaged

```
{{ marked(doc.memo) }}
```

**Evidence.** POST /memos (app/routes/memos.js `addMemos`) inserts `req.body.memo` verbatim into the `memos` collection via memos-dao.js `insert`, with no sanitization. `getAllMemos` then returns every user's memos with no per-user filtering, and `displayMemos` renders them all in `memosList` for GET /memos, which any logged-in user can view. Template line 31 calls the Markdown renderer `marked(doc.memo)` and outputs the result through `{{ }}`, which server.js line 137 has left unescaped (`autoescape: false`). server.js lines 126-128 do set `marked.setOptions({ sanitize: true })` as a mitigation, but `sanitize` is marked's now-deprecated, best-effort HTML stripping option; I did not read marked's own source to confirm it blocks every vector (e.g. `javascript:`-scheme Markdown links), so the strength of that guard on this specific path is inferred rather than verified.

**Impact.** If `marked`'s sanitize option does not block the attacker's payload, any authenticated user can post a memo that runs JavaScript in every other user's (including an admin's) browser when they view /memos, enabling session/cookie theft or full account takeover across the user base.

**Fix.** Do not rely on marked's deprecated `sanitize` option. Render Markdown to HTML and then pass the result through an allowlist HTML sanitizer (e.g. DOMPurify server-side) immediately before output, keeping Swig's default autoescape enabled for every other field.

### F-23. High: Session cookie has no httpOnly, secure or sameSite flag, no maxAge, and uses the default cookie name

- **Location:** `server.js:78`; CWE-1004; A05:2021 Security Misconfiguration; department confidence confirmed; documented issue NG-A2-3

```
app.use(session({
        // genid: (req) => {
        //    return genuuid() // use UUIDs for session IDs
        //},
        secret: cookieSecret,
        // Both mandatory in Express v4
        saveUninitialized: true,
        resave: true
        /*
        // Fix for A5 - Security MisConfig
        // Use generic cookie name
        key: "sessionId",
        */

        /*
        // Fix for A3 - XSS
        // TODO: Add "maxAge"
        cookie: {
            httpOnly: true
            // Remember to start an HTTPS server to get this working
            // secure: true
        }
        */

    }));
```

**Evidence.** The only options actually passed to express-session are secret, saveUninitialized and resave; the key: "sessionId" override and the cookie: { httpOnly: true } block are both commented out, so express-session keeps its documented default cookie name connect.sid and its default cookie options, which do not set Secure, SameSite or an expiry. This is the same session cookie a stored XSS finding in this report (app/views/layout.html:75) can already read from document.cookie because HttpOnly is absent.

**Impact.** The session cookie is readable by any script that runs in the page (e.g. via the stored XSS below), is sent over plain HTTP since Secure is unset, and never expires client-side; an attacker who reads or replays it can take over the victim's session.

**Fix.** Set an explicit cookie: { httpOnly: true, secure: true, sameSite: "strict", maxAge: &lt;value&gt; } and a non-default key, e.g. key: "sessionId".

### F-24. High: CSRF protection middleware is imported but never mounted, leaving state-changing routes unprotected

- **Location:** `server.js:7`; CWE-352; A01:2021 Broken Access Control; department confidence confirmed; documented issue NG-A5

```
// const csrf = require('csurf');
```

**Evidence.** csurf is a listed dependency in package.json but the require is commented out, and the block at lines 104-113 that would call app.use(csrf()) and expose res.locals.csrftoken is also commented out. app/views/profile.html:73 still renders a hidden input value="{{csrftoken}}" expecting that token, but since no csrf middleware ever runs, req.csrfToken does not exist and no token is validated on the state-changing POST routes registered in app/routes/index.js (/profile, /contributions, /benefits, /memos).

**Impact.** Any authenticated user can be tricked by a hostile page into submitting a cross-site POST to /profile, /benefits, /contributions or /memos, changing their bank account, allocations or benefits data without their consent.

**Fix.** Uncomment app.use(csrf()) and the res.locals.csrftoken assignment, mounted before the routes that render or check the token.

### F-25. High: Stored XSS via profile lastName, rendered unescaped on every page's navigation bar

- **Location:** `app/views/layout.html:75`; CWE-79; A03:2021 Injection; department confidence confirmed; beyond the documented list, untriaged

```
<a href="#" class="dropdown-toggle" data-toggle="dropdown"><i class="fa fa-user"></i> {{firstName}} {{lastName}} <b class="caret"></b></a>
```

**Evidence.** req.body.lastName from the POST /profile handler (app/routes/profile.js:44-50) is passed unmodified to profile.updateUser, which stores it verbatim as user.lastName in MongoDB (app/data/profile-dao.js:49-51) with no encoding. The same value comes back through profile.js:100-103 (return res.render("profile", {...user, ...})) and is rendered site-wide in the shared layout.html at line 75. server.js:137 sets swig.setDefaults({ autoescape: false }) globally, so {{lastName}} is emitted without HTML-encoding; unlike the website field two lines above it in profile.js:28, lastName has no ESAPI.encoder().encodeForHTML() call at all.

**Impact.** A user who sets a script payload as their last name gets it executed in their own browser on every subsequent page (dashboard, profile, benefits, etc.) that includes the shared layout header, until the field is changed again.

**Fix.** Re-enable swig.setDefaults({ autoescape: true }) globally, or explicitly HTML-encode firstName/lastName (and every other user-supplied field) before interpolating them into templates.

### F-26. Medium: Session id is not regenerated after successful login (session fixation)

- **Location:** `app/routes/session.js:116`; CWE-384; A07:2021 Identification and Authentication Failures; department confidence confirmed; beyond the documented list, untriaged

```
req.session.userId = user._id;
```

**Evidence.** handleLoginRequest (session.js:53-119) validates credentials with userDAO.validateLogin and then, on success, sets req.session.userId directly on the pre-existing session at line 116 with no req.session.regenerate() call in between. The comment block immediately above it (lines 104-115) names exactly this missing fix. The signup handler in the same file does call req.session.regenerate() before setting userId (line 234), confirming the login path is the one that omits it.

**Impact.** An attacker who gets a victim's browser to carry a session id issued before login (e.g. by setting the cookie themselves, since the app is also served over plain HTTP per server.js:145) inherits the authenticated session as soon as the victim logs in with that id.

**Fix.** Wrap the post-validation state change in req.session.regenerate(() =&gt; { req.session.userId = user._id; ... }), the same pattern already used in handleSignup at line 234.

### F-27. Medium: No CSRF protection on the state-changing profile-update route (and every other state-changing route)

- **Location:** `app/routes/index.js:48`; CWE-352; A01:2021 Broken Access Control; department confidence confirmed; documented issue NG-A8

```
app.post("/profile", isLoggedIn, profileHandler.handleProfileUpdate);
```

**Evidence.** server.js:6 and server.js:105-113 show the entire csurf() setup (the require, app.use(csrf()), and the res.locals.csrftoken helper) commented out; a repo-wide search for csrf finds no other CSRF middleware or per-request token check anywhere in app/ or config/. The middleware chain actually in front of this route is isLoggedIn only (index.js:48); handleProfileUpdate (app/routes/profile.js:40-107) reads firstName, lastName, ssn, dob, address, bankAcc and bankRouting straight from req.body and persists them via profile.updateUser with nothing but the session cookie authorizing the write. The same absent protection covers POST /contributions (index.js:52), POST /benefits (index.js:56) and POST /memos (index.js:67).

**Impact.** A page visited by an authenticated victim can auto-submit a cross-site POST to /profile that silently rewrites their bank account number, routing number, SSN, address or name, since only the ambient session cookie is required.

**Fix.** Uncomment and mount csurf() before the routes are registered (server.js:105-113), expose req.csrfToken() to every form, and include the hidden csrf field in the profile, contributions, benefits and memos forms.

### F-28. Medium: Login route has no rate limiting or lockout, enabling unlimited password guessing

- **Location:** `app/routes/index.js:34`; CWE-307; A07:2021 Identification and Authentication Failures; department confidence confirmed; beyond the documented list, untriaged

```
app.post("/login", sessionHandler.handleLoginRequest);
```

**Evidence.** The middleware chain in front of the login handler is empty — no rate-limiting or throttling middleware is registered here or anywhere else in index.js. handleLoginRequest (app/routes/session.js:53-119) calls userDAO.validateLogin (app/data/user-dao.js:57-94), which performs a single findOne and a comparison with no attempt counter, delay, or lockout field read or written anywhere in user-dao.js. package.json's dependencies (checked) contain no rate-limiting package such as express-rate-limit or express-brute.

**Impact.** An attacker can submit unlimited login attempts against any known or guessed username with no delay or block, which is especially severe combined with the plaintext password storage in access-008.

**Fix.** Add an account- and IP-aware rate limiter (e.g. express-rate-limit plus a per-username failed-attempt counter) in front of POST /login, and lock out or delay after a small number of consecutive failures.

### F-29. Medium: Database seed script logs every user record, including plaintext passwords, to the console

- **Location:** `artifacts/db-reset.js:99`; CWE-532; A09:2021 Security Logging and Monitoring Failures; department confidence confirmed; beyond the documented list, untriaged

```
USERS_TO_INSERT.forEach((user) => console.log(JSON.stringify(user)));
```

**Evidence.** USERS_TO_INSERT (lines 12-37) contains literal fields such as `"password": "Admin_123"` (line 18) and `"password": "User1_123"` (line 27). Line 99 JSON.stringifies each of those objects, password field included, and writes it to console.log before insertMany() persists them (matching the plaintext storage in app/data/user-dao.js:25).

**Impact.** Whoever can read the output of this script (CI logs, an operator's terminal history, or a captured build log) gets the admin and seed-user passwords in cleartext, which double as valid credentials against a freshly reset instance.

**Fix.** Log only non-secret identifiers (userName, _id) when reporting seeded users, and generate the seeded admin password at reset time rather than hardcoding it.

### F-30. Medium: Raw internal error objects are rendered unescaped straight into the error page sent to the client

- **Location:** `app/views/error-template.html:11`; CWE-209; A05:2021 Security Misconfiguration; department confidence confirmed; beyond the documented list, untriaged

```
<br>{{error}}
```

**Evidence.** app/routes/error.js's errorHandler (lines 3-13) takes whatever err reaches it from any route's next(err) call (e.g. a MongoDB callback error from app/data/*.js DAOs) and renders it with `res.render("error-template", { error: err })` (line 10-12) with no message sanitization. server.js:135-142 sets swig.setDefaults({ autoescape: false }), so the template's `{{error}}` at error-template.html:11 emits the error's string form (name + message, and any custom fields such as user-dao.js's invalidPasswordError) directly into the HTML with no HTML-encoding.

**Impact.** Any unhandled error on any route (a malformed id causing a Mongo cast error, a DB connectivity failure, etc.) discloses internal error text - library names, query/field context, or stack-adjacent detail - to the requesting client, and because autoescape is disabled, an error message that happens to contain HTML/script-like content would also render unescaped.

**Fix.** Render a generic, static error message to the client and log the actual err.message/err.stack server-side only (as errorHandler already does at lines 7-8); never pass the raw error object into a client-rendered template.

### F-31. Medium: cypress, a build/test-only dependency, is thirteen majors behind and carries the largest transitive advisory chain in the project

- **Location:** `package.json:44`; CWE-1357; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"cypress": "^3.3.1",
```

**Evidence.** npm audit's entry for cypress (matching range 0.1.0-15.15.0) carries no advisory directly on cypress's own code, but walking its `via` (debug, extract-zip, getos, lodash, minimist, moment, request, tmp) and their own transitive advisories yields 43 distinct advisory URLs inside cypress's dependency tree — the largest chain of any dependency declared in this project. npm's suggested fix is cypress@16.1.0, thirteen majors ahead of the declared ^3.3.1.

**Impact.** cypress only runs during `npm run test:e2e`/CI, not inside the deployed application, so this chain does not expose NodeGoat's production runtime directly; it is a supply-chain risk to whichever machine (developer laptop or CI runner) executes the test suite, which is why this is scored below the production-dependency findings above despite the audit's own "critical" label on the aggregate.

**Fix.** Upgrade cypress to a current major; given the size of the jump, budget time for the end-to-end test suite's API changes across thirteen majors.

### F-32. Medium: async, a devDependency, is pinned to a pre-release range with a known prototype-pollution advisory (CVE-2021-43138)

- **Location:** `package.json:42`; CWE-1321; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"async": "^2.0.0-rc.4",
```

**Evidence.** npm audit reports the declared range ^2.0.0-rc.4 resolves inside async's vulnerable band 2.0.0-2.6.3: GHSA-fwr7-v2mv-hh25, Prototype Pollution in async (also CVE-2021-43138), fixed in 2.6.4. async is declared under `devDependencies`, so this runs at build/test time rather than in the deployed app; the current release is 3.2.6.

**Impact.** If any build or test script passes attacker-influenced data through async's affected functions, an object's prototype can be polluted, potentially altering behavior across the whole process for the rest of that build/test run.

**Fix.** Bump the declared range to at least async@2.6.4, or move to the current 3.x major.

### F-33. Medium: grunt, a devDependency, is pinned to a range with an arbitrary-code-execution advisory, plus 13 transitive advisories

- **Location:** `package.json:45`; CWE-1188; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"grunt": "^1.0.3",
```

**Evidence.** npm audit reports the declared range ^1.0.3 resolves inside grunt's vulnerable band &lt;=1.6.1: GHSA-m5pj-vjjf-4m3h (Arbitrary Code Execution via insecure default option handling, CWE-1188, fixed in 1.3.0), GHSA-rm36-94g8-835r (race condition, fixed in 1.5.3) and GHSA-j383-35pm-c5h4 (path traversal, fixed in 1.5.2). Its `via` also names grunt-legacy-util, js-yaml and minimatch, contributing 13 further transitive advisories. grunt is declared under `devDependencies` and is this project's own build/test entry point (see package.json's `test` and `db:seed` scripts); the current release is 1.6.3.

**Impact.** Running grunt on this range exposes the developer's or CI's machine to the listed advisories when the build/test scripts execute; this is a build-time risk to whoever runs `npm test` or `npm run db:seed`, not a risk to the deployed application's own runtime.

**Fix.** Upgrade the declared range to grunt@1.6.3 or later, staying within the same major.

### F-34. Medium: bcrypt-nodejs, used for password hashing, is the author's own thirteen-year-old, single-release, deprecated package

- **Location:** `package.json:8`; CWE-1104; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"bcrypt-nodejs": "0.0.3",
```

**Evidence.** The dependency is pinned to the exact string "0.0.3", the only version bcrypt-nodejs has ever published, released 2013-02-25 per the npm registry's own version-time metadata, with no release since. The registry's deprecation notice for it reads: "bcrypt-nodejs is no longer actively maintained. Please use bcrypt or bcryptjs." npm audit does not carry an open advisory against this exact package, so this finding is about maintenance, not a disclosed CVE: a thirteen-year-old, single-release, author-deprecated implementation of the primitive this app hashes and checks every user's password against is a standing risk independent of any currently-known advisory.

**Impact.** Any weakness found in this implementation in the future — timing behavior, salt/round handling, or a platform incompatibility on a newer Node runtime — has no upstream maintainer to fix it; NodeGoat's password hashing has no remediation path except switching packages.

**Fix.** Migrate to the actively maintained `bcrypt` or `bcryptjs` package, exactly as bcrypt-nodejs's own deprecation notice recommends, and re-test the password-hashing round trip in app/data/user-dao.js.

### F-35. Medium: Open redirect on /learn takes the destination directly from the `url` query parameter

- **Location:** `app/routes/index.js:72`; CWE-601; A01:2021 Broken Access Control; department confidence confirmed; documented issue NG-A10

```
return res.redirect(req.query.url);
```

**Evidence.** The GET /learn route handler (app/routes/index.js lines 70-73) reads `req.query.url` and passes it directly to `res.redirect()` with no allowlist, host check, or same-origin validation; the preceding comment ('Insecure way to handle redirects by taking redirect url from query string') confirms this is the intended path with no sanitizer anywhere between the query parameter and the redirect call.

**Impact.** An attacker can craft a link such as `/learn?url=https://evil.example.com` hosted on the trusted nodegoat domain to redirect a logged-in victim to an attacker-controlled phishing or malware site.

**Fix.** Validate `req.query.url` against an allowlist of known-good destinations (or internal path prefixes) before calling `res.redirect`, and reject or ignore any value that does not match.

### F-36. Medium: Reflected XSS: failed-login page echoes `userName` into an HTML attribute with autoescape disabled

- **Location:** `app/views/login.html:110`; CWE-79; A03:2021 Injection; department confidence confirmed; beyond the documented list, untriaged

```
<input type="text" class="form-control" id="userName" name="userName" value="{{userName}}" placeholder="Enter User Name">
```

**Evidence.** POST /login is handled by sessionHandler.handleLoginRequest (app/routes/session.js). On an unknown-user login attempt, line 83 renders the login view with `userName: userName` taken verbatim from `req.body` (destructured at line 55) with no escaping or validation. The Swig template engine's global default is set with `autoescape: false` at server.js line 137, so the `{{userName}}` output at login.html line 110 is emitted into the page raw, inside a double-quoted HTML attribute with no separate escaping applied in the template.

**Impact.** An attacker who gets a victim to submit a crafted `userName` (e.g. via an auto-submitting cross-site form, since csrf protection is commented out in server.js) such as `" autofocus onfocus=alert(document.cookie) x="` breaks out of the `value` attribute and executes arbitrary JavaScript in the victim's browser in the application's origin.

**Fix.** Re-enable Swig's `autoescape: true` default (or use an explicit `{% autoescape true %}`/escaping filter around user-controlled values) so `{{userName}}` is HTML-attribute-escaped before it reaches the page.

### F-37. Medium: Reflected XSS: profile page renders unescaped `firstName` into an `href` attribute

- **Location:** `app/views/profile.html:78`; CWE-79; A03:2021 Injection; department confidence confirmed; documented issue NG-A3

```
<a href="{{firstNameSafeString}}">Google search this profile by name</a>
```

**Evidence.** In app/routes/profile.js, `handleProfileUpdate` reads `firstName` from `req.body` (line 44) and, on the bank-routing validation-failure branch, assigns it unmodified to `firstNameSafeString` at line 64 (`const firstNameSafeString = firstName;` -- no encoding despite the name) before rendering the `profile` view with it at line 65. Because server.js line 137 sets Swig's `autoescape: false` globally, `{{firstNameSafeString}}` at profile.html line 78 is written into the page raw, inside an `href` attribute with no context-appropriate encoding applied anywhere on this path.

**Impact.** A logged-in user who submits a crafted first name such as `" onmouseover=alert(document.cookie) x="` (or a `javascript:` URI once the attribute is broken out of) gets arbitrary JavaScript executed in their own profile page; combined with the same field being stored via profile-dao.js `updateUser`, the payload persists across profile views.

**Fix.** HTML-attribute-escape `firstName` before rendering, and if it is genuinely meant to build a URL, use URL encoding (`encodeURIComponent`) for that context instead of `firstNameSafeString`'s unescaped passthrough or the HTML-only ESAPI encoding already misapplied to `website` in the same file.

### F-38. Medium: Helmet security-headers middleware is imported but never mounted

- **Location:** `server.js:10`; CWE-693; A05:2021 Security Misconfiguration; department confidence confirmed; documented issue NG-A5

```
// const helmet = require("helmet");
```

**Evidence.** helmet is a listed dependency in package.json but its require is commented out here, and the whole block at lines 38-65 that would call app.use(helmet.frameguard()), helmet.noCache(), helmet.contentSecurityPolicy(), helmet.hsts() and the dont-sniff-mimetype nosniff() middleware is commented out as well. I read the full middleware stack that does run (favicon at line 68, bodyParser at 71-75, session at 78-102, express.static at 121, routes at 132) and none of it sets X-Frame-Options, Content-Security-Policy, X-Content-Type-Options or Strict-Transport-Security, and app.disable("x-powered-by") at line 42 is also commented out so the framework fingerprint header ships by default.

**Impact.** Responses carry no clickjacking, MIME-sniffing or content-security-policy protection and advertise Express via X-Powered-By, making the app easier to fingerprint and its pages embeddable in a hostile iframe.

**Fix.** Uncomment and mount helmet() (or an equivalent explicit header set) before the routes are registered, and call app.disable("x-powered-by").

### F-39. Medium: Global error handler renders the raw Error object to the client

- **Location:** `app/routes/error.js:10`; CWE-209; A05:2021 Security Misconfiguration; department confidence confirmed; beyond the documented list, untriaged

```
res.render("error-template", {
        error: err
    });
```

**Evidence.** The errorHandler receives whatever err next(err) was called with anywhere in the app (route handlers pass through DAO/MongoDB callback errors unchanged, e.g. app/routes/profile.js:21 and 93 do `if (err) return next(err)`), and forwards the entire err object into the error-template view, which prints it directly at app/views/error-template.html:11 (`<br>{{error}}`) with the same autoescape: false template configuration (server.js:137). No message allow-list or generic replacement happens between the caught error and the render call.

**Impact.** Whatever the underlying error's message contains, including MongoDB driver messages or internal path/field details, is returned straight to the browser instead of a generic message, helping an attacker map the backend.

**Fix.** Log err.message and err.stack server-side only (as is already done at lines 7-8) and render a fixed, generic error message with a correlation id to the client.

### F-40. Medium: Full application config, including the session cookie secret and crypto key, is printed to stdout on every startup

- **Location:** `config/config.js:12`; CWE-532; A09:2021 Security Logging and Monitoring Failures; department confidence confirmed; beyond the documented list, untriaged

```
console.log(`Current Config:`);
console.log(util.inspect(config, false, null));
```

**Evidence.** config.js builds `config` at line 10 by merging config/env/all.js (which holds the literal cookieSecret and cryptoKey read above) with the environment file, then lines 12-13 unconditionally console.log a full util.inspect() dump of that merged object every time this module is required, i.e. on every server start (server.js line 17 requires ./config/config, and this module has no debug/NODE_ENV guard around the console.log calls).

**Impact.** cookieSecret and cryptoKey land in process stdout on every boot; anywhere those logs are collected (container logs, PaaS log drains such as Heroku's, CI job output, log aggregation) becomes a second place those secrets are exposed to whoever can read logs, independent of source-code access, widening who can steal them and complicating rotation.

**Fix.** Remove the console.log of the full config object, or redact known-sensitive keys (cookieSecret, cryptoKey) before logging, and never log secret values even at debug level.

### F-41. Low: Password comparison uses a non-constant-time equality check

- **Location:** `app/data/user-dao.js:61`; CWE-208; A02:2021 Cryptographic Failures; department confidence confirmed; beyond the documented list, untriaged

```
return fromDB === fromUser;
```

**Evidence.** comparePassword (user-dao.js:60-61) implements the credential check as a plain string `===` between the value read from MongoDB and the value from the login POST body. The commented alternative directly below it (lines 62-66) shows bcrypt.compareSync was the intended, constant-time verification and was never enabled.

**Impact.** JavaScript's === short-circuits at the first differing byte, so a remote attacker able to measure response timing precisely gets a per-character oracle on the stored password, independent of the plaintext-storage issue in access-008.

**Fix.** Once passwords are hashed, verify with the hashing library's constant-time compare (bcrypt.compareSync); never compare secrets with ===.

### F-42. Low: swig has had no release since 2014 and the registry marks it "no longer maintained"

- **Location:** `package.json:22`; CWE-1104; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"swig": "^1.4.2",
```

**Evidence.** The npm registry's latest published version of swig is 1.4.2, released 2014-08-04 per the registry's own version-time metadata; there has been no further release in the twelve years since, and the registry's deprecation notice for the package reads: "This package is no longer maintained." The declared range ^1.4.2 already resolves to this final, deprecated release.

**Impact.** The unpatched arbitrary-file-read advisory found alongside this finding (GHSA-2rq5-699j-x7p6) will never receive an upstream fix, and any future issue discovered in swig carries the same guarantee.

**Fix.** Treat swig as end-of-life and schedule its replacement rather than waiting on an upstream patch that will not arrive.

### F-43. Low: csurf is archived and no longer maintained upstream, and carries a transitive cookie advisory

- **Location:** `package.json:11`; CWE-1357; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"csurf": "^1.8.3",
```

**Evidence.** npm audit's entry for csurf (matching range &gt;=1.3.0) names cookie in its `via`: csurf's own declared cookie dependency falls inside a vulnerable range. Separately, the npm registry's deprecation notice for csurf's latest published version reads: "This package is archived and no longer maintained. For support, visit https://github.com/expressjs/express/discussions."

**Impact.** The CSRF-protection middleware this app relies on for every state-changing route (allocations, benefits, contributions, profile, memos) depends on a vulnerable cookie-parsing package and will receive no further fixes from its own maintainers.

**Fix.** Migrate to a maintained CSRF middleware, per csurf's own archival notice; as a stopgap, pin the cookie transitive dependency to a patched version.

### F-44. Low: express-session pulls a vulnerable cookie and on-headers into the session middleware

- **Location:** `package.json:14`; CWE-1357; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"express-session": "^1.13.0",
```

**Evidence.** npm audit's entry for express-session (matching range 1.0.1-1.18.1) names cookie and on-headers in its `via`, both separately-vulnerable packages inside express-session's own dependency tree (2 distinct advisory URLs). The npm registry's current release is 1.19.0.

**Impact.** The session-cookie handling for every authenticated request in this app runs through this outdated chain; a fix published upstream in cookie or on-headers never reaches this app until express-session itself is upgraded past 1.18.1.

**Fix.** Upgrade the declared range past 1.18.1 (current release 1.19.0), which pulls patched cookie and on-headers versions.

### F-45. Low: node-esapi has had exactly one release, in 2014, with no update in the twelve years since

- **Location:** `package.json:20`; CWE-1104; A06:2021 Vulnerable and Outdated Components; department confidence confirmed; documented issue NG-A9

```
"node-esapi": "0.0.1",
```

**Evidence.** The dependency is pinned to "0.0.1", the only version node-esapi has ever published on npm, released 2014-01-31 per the registry's own version-time metadata. There is no second release and no formal registry deprecation notice, which points to the package having simply been abandoned rather than sunset with guidance.

**Impact.** Any encoding or escaping guarantee this app relies on from an ESAPI-style library for output-encoding defenses has not been reviewed or updated against a decade of newly discovered encoding-bypass techniques, and no fix will arrive from upstream.

**Fix.** Confirm which call sites still use node-esapi; where its encoding functions are load-bearing for XSS defense, replace it with a maintained encoding library (for example `he` or `escape-html`).

### F-46. Low: Environment defaults to "development" when NODE_ENV is unset, silently enabling development configuration in an unconfigured deployment

- **Location:** `config/config.js:5`; CWE-1188; A05:2021 Security Misconfiguration; department confidence confirmed; beyond the documented list, untriaged

```
const finalEnv = process.env.NODE_ENV || "development";
```

**Evidence.** config/env/development.js is merged in whenever NODE_ENV is not explicitly set to "production"; it injects a livereload &lt;script&gt; tag into every rendered page via environmentalScripts (development.js:9-13) and sets ZAP proxy credentials (zapHostName, zapApiKey at development.js:3-6). docker-compose.yml:7 passes NODE_ENV: with no value, so a compose deployment that forgets to export it falls back to this same development default.

**Impact.** A production deployment that omits NODE_ENV=production silently ships development-only script injection and debug settings instead of config/env/production.js (which is empty), increasing the attack surface without any error or warning.

**Fix.** Default to a safe/production configuration when NODE_ENV is unset, or fail startup loudly instead of silently falling back to development.

### F-47. Low: Hard-coded AES key intended to protect SSN/DOB/bank data, currently unreachable because the encrypt/decrypt code is commented out

- **Location:** `config/env/all.js:9`; CWE-321; A02:2021 Cryptographic Failures; department confidence confirmed; beyond the documented list, untriaged

```
    cryptoKey: "a_secure_key_for_crypto_here",
```

**Evidence.** config/env/all.js line 9 hard-codes cryptoKey as the literal "a_secure_key_for_crypto_here". The only place this value is consumed is app/data/profile-dao.js lines 15-40, where the createIV/encrypt/decrypt helpers that call crypto.pbkdf2Sync(config.cryptoKey, ...) and crypto.createCipheriv(config.cryptoAlgo, config.cryptoKey, ...) are wrapped in a `/* ... */` block comment (opens line 15, closes line 40), and the call sites at lines 70-75 and 103-104 that would invoke encrypt()/decrypt() on ssn/dob are commented out too. this.updateUser (line 42) stores ssn/dob/bankAcc/bankRouting in plaintext instead. So the key is currently dead configuration, not an active cryptographic control.

**Impact.** As shipped, this key protects nothing today because the encryption path is disabled (ssn/dob/bank fields are stored in plaintext in MongoDB per profile-dao.js's active code). The risk is latent: if an operator uncomments the encrypt/decrypt block to "fix" the sensitive-data-exposure issue without also changing this literal, every deployment that does so would share the same publicly-known key, letting anyone with the source decrypt the resulting ciphertext.

**Fix.** If the encryption path is enabled, source cryptoKey from a secrets manager or environment variable with no hard-coded value, and use a unique key per deployment; do not ship a working literal default in committed config.

### F-48. Low: RSA private key committed to the repository for the TLS certificate, currently unused because the HTTPS listener is commented out

- **Location:** `artifacts/cert/server.key:1`; CWE-321; A02:2021 Cryptographic Failures; department confidence confirmed; beyond the documented list, untriaged

```
-----BEGIN RSA PRIVATE KEY-----
```

**Evidence.** artifacts/cert/server.key is a full committed PEM private key (lines 1-15, BEGIN/END RSA PRIVATE KEY). server.js lines 18-28 show the only consumer: a commented-out block that would `fs.readFileSync(...)` this exact path into `httpsOptions.key` and start an `https.createServer(httpsOptions, app)` (also commented out at lines 149-155); the code that actually runs starts a plain `http.createServer(app)` at line 145. So the key is not loaded by the running server today, but it is real, non-placeholder key material sitting in version control alongside its matching server.crt.

**Impact.** Anyone who has cloned this repository holds the private half of the certificate. If an operator re-enables the commented HTTPS block without generating a fresh key/cert pair, every such deployment would share this one public, already-disclosed private key, letting anyone intercept or impersonate its TLS endpoint.

**Fix.** Remove the committed key/cert pair from the repository and history; generate certificates per environment via a CA or ACME client and load them from outside version control (e.g. mounted secret/volume), never from a path checked into git.

### F-49. Low: OWASP ZAP proxy API key hard-coded in committed test/dev configuration

- **Location:** `config/env/development.js:6`; CWE-798; A05:2021 Security Misconfiguration; department confidence confirmed; beyond the documented list, untriaged

```
   zapApiKey: "v9dn0balpqas1pcc281tn5ood1",
```

**Evidence.** config/env/development.js line 6 (and the identical value at config/env/test.js line 6) hard-codes zapApiKey. It is read as `config.zapApiKey` in test/security/profile-test.js line 28 and used live to authenticate every ZAP API call in that script (e.g. zaproxy.core.newSession(..., zapApiKey, ...) at line 87, zaproxy.ascan.scan(..., zapApiKey, ...) at line 211), against a ZAP proxy on the private lab address zapHostName "192.168.56.20" (line 3) — not a production endpoint.

**Impact.** This key only authorizes calls to a local/lab OWASP ZAP proxy instance used for the project's own security regression tests, not a production service or customer data; the exposure is that anyone with the repository knows the API key a locally-run ZAP instance would need to be configured with, which is a low-value target but still a credential committed to source instead of local, uncommitted developer configuration.

**Fix.** Generate the ZAP API key per developer/CI run (ZAP can auto-generate one) and inject it via an environment variable or an untracked local config file rather than committing it.

## Appendix C. Regenerate this assessment

```sh
node data/code-safety/tools/client-report.mjs data/code-safety/2026-09-27-nodegoat-12-base-d
node data/code-safety/tools/recall.mjs data/code-safety/2026-09-27-nodegoat-12-base-d data/code-safety/targets/nodegoat.ground-truth.json
```

## Résumé exécutif

Cette revue de sécurité porte sur OWASP NodeGoat, une application Express.js/MongoDB
délibérément vulnérable, au sein de l'arborescence verrouillée
`/home/user/targets/NodeGoat` (111 fichiers, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Six départements
ont lu le code (access, data, dependencies, injection, platform, secrets), chacun
outillé par `semgrep 1.177.0` (règles locales du paquet plus `p/owasp-top-ten`) et,
pour le département dependencies, par `npm audit` contre le registre npm réel ; chaque
signal d'outil a servi de point de lecture, jamais de constat direct. L'intégration a
fusionné les six fichiers `findings/<departement>.json`, dédupliqué par fichier + ligne
+ CWE, et vérifié chaque constat retenu avec l'examinateur mécanique
`verify-safety-report.mjs`, qui confirme que chaque `fichier:ligne` cité existe dans
l'arbre verrouillé et que l'extrait cité correspond au texte réel. 38 constats sont
retenus : 4 critiques, 16 hauts, 14 moyens, 4 faibles. Les trois plus importants : (1)
une injection de code côté serveur via `eval()` sur les pourcentages de cotisation
(`app/routes/contributions.js:32`), permettant l'exécution de JavaScript arbitraire
dans le processus Node pour tout utilisateur authentifié ; (2) les mots de passe de
tous les comptes sont stockés et comparés en clair, jamais hachés
(`app/data/user-dao.js:25`) ; (3) le compte administrateur est initialisé avec un mot
de passe en clair codé en dur (`artifacts/db-reset.js:18`) que le chemin de connexion
réel accepte tel quel. Neuf constats en double (même fichier, même ligne, même CWE,
rédigés indépendamment par deux départements) ont été fusionnés en un seul, l'entrée
retenue étant listée sous « Ce qui n'a pas été couvert ». Cette revue est une lecture
statique par un modèle de langage, appuyée par un analyseur statique et par
l'examinateur mécanique commité ; elle ne couvre ni le comportement d'exécution réel,
ni l'historique Git, ni l'intégralité de l'arbre de dépendances transitives.

- critical: 4
- high: 16
- medium: 14
- low: 4
- info: 0

## Executive summary

This review covers OWASP NodeGoat, a deliberately vulnerable Express.js/MongoDB
application, over the locked tree at `/home/user/targets/NodeGoat` (111 files, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Six departments
read the code (access, data, dependencies, injection, platform, secrets), each using
`semgrep 1.177.0` (the local department rule pack plus `p/owasp-top-ten`) and, for the
dependencies department, `npm audit` against the live npm registry; every tool hit was
treated as a lead to read, never reported as a finding on its own strength. The
integration merged all six `findings/<department>.json` files, deduplicated by file +
line + CWE, and verified every retained finding with the mechanical examiner
`verify-safety-report.mjs`, which confirms every cited `file:line` exists in the locked
tree and that the quoted snippet matches the real text. 38 findings are retained: 4
critical, 16 high, 14 medium, 4 low. The three most important: (1) server-side code
injection via `eval()` on submitted contribution percentages
(`app/routes/contributions.js:32`), giving any authenticated user arbitrary JavaScript
execution inside the Node process; (2) every account's password is stored and compared
in cleartext, never hashed (`app/data/user-dao.js:25`); (3) the admin account is seeded
with a hard-coded plaintext password (`artifacts/db-reset.js:18`) that the live login
path accepts as-is. Nine duplicate findings (same file, line, and CWE, written
independently by two departments) were folded into one each; the id dropped from each
pair is listed under "What was not covered". This review is a static read by a
language model, grounded by a static analyzer and by the committed mechanical
examiner; it does not cover runtime behavior, git history, or the full transitive
dependency tree.

- critical: 4
- high: 16
- medium: 14
- low: 4
- info: 0

## Scope and method

Target: `/home/user/targets/NodeGoat` (OWASP NodeGoat), the tree locked by
`target.json` — 111 files, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3` — read-only for
every department and for this integration. Six departments ran on this tree and each
committed `findings/<department>.json` plus `report/<department>.md`: **access**
(authentication, session, authorization — 8 raw findings), **data** (sensitive data
exposure, crypto, logging — 7 raw findings), **dependencies** (manifest/lockfile
advisory audit — 11 raw findings), **injection** (SQLi/NoSQLi/eval/SSRF/XSS/redirect —
6 raw findings), **platform** (security misconfiguration, headers, cookies, error
handling — 8 raw findings), **secrets** (hard-coded credentials and keys — 7 raw
findings). Tooling: `semgrep 1.177.0`, run by every department with the program's local
rule pack plus the registry pack `p/owasp-top-ten` (both reachable), `--metrics off
--json`, over the target tree — 113 rules across 72 git-tracked files, 29 raw hits per
run, each hit read as a lead and independently confirmed or discarded, never reported
on the strength of the pattern match alone. The dependencies department additionally
ran `npm audit --json` against `package-lock.json`'s resolved graph through the live
npm registry (145 advisory-flagged packages found) and `npm view <pkg> deprecated` /
`npm view <pkg> time` to confirm two maintenance claims. This integration ran
`node verify-safety-report.mjs --findings findings/<department>.json --list-invalid`
for every department (no id was refused) and `node verify-safety-report.mjs --report`
against the merged output before committing.

Files actually read line-by-line across the six departments (the request-handling and
configuration surface of the application): `server.js`; the full route table in
`app/routes/index.js` and every handler under `app/routes/` (`allocations`, `benefits`,
`contributions`, `error`, `memos`, `profile`, `research`, `session`, `tutorial`); every
DAO under `app/data/` (`allocations`, `benefits`, `contributions`, `memos`, `profile`,
`research`, `user`); the Swig templates `app/views/profile.html`, `app/views/memos.html`,
`app/views/error-template.html`, `app/views/layout.html`, `app/views/dashboard.html`,
`app/views/benefits.html`; `config/config.js` and every file in `config/env/`;
`package.json` and `package-lock.json`; `artifacts/db-reset.js` and
`artifacts/cert/server.key`; `docker-compose.yml`, `Dockerfile`, `app.json`, `Procfile`,
`.dockerignore`, `nodemon.json`; `test/security/profile-test.js` and selected
`test/e2e/` fixtures, for context only. This is a review by a language model, grounded
by the semgrep static scanner and by the committed mechanical examiner
`verify-safety-report.mjs`; it is not a dynamic test of a running instance, and it does
not establish what a real deployment's environment variables, reverse proxy, or WAF
configuration are.

## Findings

### critical

- `data-001-plaintext-password-storage` — User passwords are stored and compared in cleartext (`app/data/user-dao.js:25`, CWE-256, confirmed) — anyone reading the `users` collection gets every real password in plaintext; hash with bcrypt before insert and compare with a constant-time verify.
- `dependencies-underscore-rce` — underscore resolves to 1.9.1, inside the range for a template-injection RCE and an unbounded-recursion DoS (`package.json:23`, CWE-94, confirmed) — upgrade to >=1.13.7.
- `injection-eval-contributions-update` — Server-side code injection via `eval()` on contribution percentages (`app/routes/contributions.js:32`, CWE-95, confirmed) — any authenticated user gets arbitrary JavaScript execution in the server process; parse with `parseInt`/`parseFloat` instead.
- `secrets-admin-password-plaintext` — Admin account seeded with a hard-coded plaintext password the live login path checks verbatim (`artifacts/db-reset.js:18`, CWE-798, confirmed) — never seed real-shaped credentials; generate a random admin password at first run.

### high

- `access-benefits-missing-admin-check` — Any authenticated user, not just an admin, can update another employee's benefits record (`app/routes/index.js:56`, CWE-862, confirmed) — re-attach the existing `isAdmin` middleware.
- `access-idor-allocations` — Allocations page loads another user's data from a client-supplied `userId` with no ownership check (`app/routes/index.js:63`, CWE-639, confirmed) — key the query off `req.session.userId`, not the route parameter.
- `access-login-no-rate-limit` — Login endpoint has no attempt limit, lockout, or delay (`app/routes/index.js:34`, CWE-307, confirmed) — add a per-account/per-IP rate limiter.
- `data-002-plaintext-ssn-dob-bank-storage` — SSN, date of birth and bank account/routing numbers are persisted unencrypted (`app/data/profile-dao.js:61`, CWE-312, confirmed) — re-enable the existing (commented-out) encrypt/decrypt helpers.
- `dependencies-body-parser-dos` — body-parser resolves to 1.18.3, matching two DoS advisories (`package.json:9`, CWE-405, confirmed) — upgrade to >=1.20.6.
- `dependencies-express-redirect-and-transitive` — express resolves to 4.16.4 with its own redirect/XSS advisories and 6 vulnerable transitive packages (`package.json:13`, CWE-601, confirmed) — upgrade to >=4.21.2.
- `dependencies-forever-transitive-critical` — forever resolves to 2.0.0 and pulls in a prototype-pollution advisory in nconf (`package.json:15`, CWE-1321, confirmed) — upgrade to >=4.0.3 or replace with a maintained supervisor.
- `dependencies-marked-redos-xss` — marked is exact-pinned to 0.3.5 and carries six advisories: two XSS bypasses and four ReDoS (`package.json:17`, CWE-1333, confirmed) — upgrade to >=4.0.10.
- `dependencies-mongodb-dos` — mongodb driver resolves to 2.2.36, inside a DoS advisory range, plus a vulnerable transitive bson (`package.json:18`, CWE-400, confirmed) — upgrade past 3.1.13, ideally to the current major.
- `dependencies-swig-abandoned` — swig is pinned to its last-ever release, carries an unpatched arbitrary local file read, and is formally deprecated (`package.json:22`, CWE-22, confirmed) — no fixed version exists; replace with a maintained template engine.
- `injection-nosql-where-allocations-threshold` — NoSQL injection in allocations lookup via unsanitized `$where` JavaScript (`app/data/allocations-dao.js:78`, CWE-943, confirmed) — replace with a structured query.
- `injection-ssrf-research-symbol` — Server-side request forgery in stock research lookup (`app/routes/research.js:15`, CWE-918, confirmed) — do not accept a full destination URL from the client.
- `injection-xss-memos-marked-stored` — Stored XSS in memos via unescaped markdown rendering shared with every user (`app/views/memos.html:31`, CWE-79, likely) — sanitize rendered markdown with a maintained HTML sanitizer and re-enable Swig autoescaping.
- `platform-plaintext-http-only` — The server only ever listens over plain HTTP; the HTTPS setup is fully commented out (`server.js:145`, CWE-319, confirmed) — terminate TLS at the app or a reverse proxy.
- `platform-session-cookie-insecure-flags` — Session cookie has no `httpOnly`, `secure`, `sameSite`, or expiry, and keeps the default cookie name (`server.js:78`, CWE-614, confirmed) — set a full `cookie:` options block once served over HTTPS.
- `secrets-cookie-secret` — Express session secret is a hard-coded literal with no environment override (`config/env/all.js:8`, CWE-798, confirmed) — read from a required environment variable and rotate the committed value.

### medium

- `access-csrf-disabled-profile-update` — State-changing profile update (bank account/routing, SSN, DOB) has no CSRF protection (`app/routes/index.js:48`, CWE-352, confirmed) — re-enable `csurf` or an equivalent check.
- `access-login-no-session-regeneration` — Session id is not regenerated after successful login, session fixation (`app/routes/session.js:116`, CWE-384, confirmed) — call `req.session.regenerate()` before assigning `req.session.userId`.
- `access-non-constant-time-password-compare` — Login compares passwords with plain `===` instead of a constant-time verify (`app/data/user-dao.js:61`, CWE-916, confirmed) — verify hashes with `bcrypt.compareSync`.
- `data-004-hardcoded-crypto-key` — AES encryption key for PII is a hard-coded literal (`config/env/all.js:9`, CWE-321, confirmed) — generate a random, deployment-specific key from a secret manager.
- `data-007-seed-script-logs-plaintext-passwords` — Database seed script prints every account's plaintext password to the console (`artifacts/db-reset.js:99`, CWE-532, confirmed) — log only non-secret fields.
- `dependencies-grunt-devtooling-rce` — grunt (build/dev tooling) resolves to 1.0.3, inside the range for an RCE advisory plus a race condition and path traversal (`package.json:45`, CWE-94, confirmed) — upgrade to >=1.6.1.
- `dependencies-helmet-outdated-major` — helmet pinned to the 2.x line, whose bundled helmet-csp has a CSP-override advisory (`package.json:16`, CWE-693, likely) — upgrade to a current major and rewrite the config call.
- `injection-open-redirect-learn` — Open redirect via unvalidated query parameter on `/learn` (`app/routes/index.js:72`, CWE-601, confirmed) — validate the target against an allowlist.
- `injection-xss-profile-firstname-reflected` — Reflected XSS in profile form via unescaped `firstName` on validation failure (`app/views/profile.html:41`, CWE-79, confirmed) — re-enable Swig's default autoescaping.
- `platform-error-handler-discloses-error` — Global error handler renders the raw `Error` object into the HTML response (`app/routes/error.js:10`, CWE-209, confirmed) — render a fixed generic message instead.
- `platform-missing-security-headers` — helmet is installed but never mounted, so no security headers are set on any response (`server.js:10`, CWE-693, confirmed) — uncomment and mount `helmet()`.
- `platform-node-env-default-development` — `NODE_ENV` silently defaults to `"development"` when unset, and the production config adds no hardening (`config/config.js:5`, CWE-1188, likely) — fail startup when unset.
- `secrets-committed-rsa-private-key` — RSA private key committed at the exact path the (disabled) HTTPS setup loads (`artifacts/cert/server.key:1`, CWE-321, confirmed) — remove from source control, treat as compromised, reissue.
- `secrets-config-logged-to-console` — Full configuration object, including the cookie secret and crypto key, is printed to stdout on every startup (`config/config.js:12`, CWE-532, confirmed) — never log a config object wholesale; redact secret fields.

### low

- `dependencies-csurf-deprecated` — csurf is archived and formally deprecated by its maintainers, with no forward-fix path (`package.json:11`, CWE-1104, confirmed) — migrate to a maintained CSRF package.
- `dependencies-floating-devdeps` — Two devDependencies float on a mutable reference instead of a pinned version (`package.json:50`, CWE-829, confirmed) — pin to an explicit version or immutable commit.
- `secrets-zap-api-key-development` — OWASP ZAP API key hard-coded in the committed development config (`config/env/development.js:6`, CWE-798, confirmed) — read from an environment variable with no default.
- `secrets-zap-api-key-test` — OWASP ZAP API key hard-coded in the committed test config, duplicate of the development value (`config/env/test.js:6`, CWE-798, confirmed) — read from an environment variable with no default.

## What was not covered

**Findings dropped during deduplication.** Nine findings were written independently by
two departments on the same `file:line:CWE` and were merged into one entry each; no
finding from `verify-safety-report.mjs --list-invalid` was refused (it printed no ids
for any of the six department files), so every drop below is a dedup fold, not an
examiner rejection:

- `access-plaintext-password-storage` — duplicate of `data-001-plaintext-password-storage` (`app/data/user-dao.js:25`, CWE-256); the data department's `critical`-severity write-up was kept over the access department's `high`-severity one, both `confirmed`.
- `data-003-hardcoded-cookie-secret` — duplicate of `secrets-cookie-secret` (`config/env/all.js:8`, CWE-798); both `high`/`confirmed`, the secrets department's entry was kept as the department that owns hard-coded-credential findings.
- `secrets-dead-crypto-key` — duplicate of `data-004-hardcoded-crypto-key` (`config/env/all.js:9`, CWE-321); the data department's `medium`-severity write-up was kept over the secrets department's `low`-severity one, both `confirmed`.
- `data-005-secrets-logged-at-startup` — duplicate of `secrets-config-logged-to-console` (`config/config.js:12`, CWE-532); both `medium`/`confirmed`, the secrets department's entry was kept.
- `platform-verbose-config-log` — duplicate of `secrets-config-logged-to-console` (`config/config.js:12`, CWE-532); the secrets department's `medium`-severity write-up was kept over the platform department's `low`-severity one.
- `data-006-cleartext-http-transport` — duplicate of `platform-plaintext-http-only` (`server.js:145`, CWE-319); both `high`/`confirmed`, the platform department's entry was kept as the department that owns transport configuration.
- `access-session-cookie-not-secure-no-expiry` — duplicate of `platform-session-cookie-insecure-flags` (`server.js:78`, CWE-614); the platform department's `high`-severity write-up was kept over the access department's `medium`-severity one.
- `platform-session-fixation-login` — duplicate of `access-login-no-session-regeneration` (`app/routes/session.js:116`, CWE-384); both `medium`/`confirmed`, the access department's entry was kept as the department that owns session-management findings.
- `platform-no-rate-limit-login` — duplicate of `access-login-no-rate-limit` (`app/routes/index.js:34`, CWE-307); both `high`/`confirmed`, the access department's entry was kept as the department that owns authentication-throttling findings.

**Departments and classes of defect not run at all.** No department reviewed
memory-safety bugs (buffer overflows, use-after-free): this codebase has no native
module, so that class has no applicable target here, not a confirmed absence of risk.
No department ran a mobile-platform (Swift/Kotlin) review; NodeGoat has no mobile
client. No fuzzing, penetration testing, or dynamic scanning of a running instance was
performed by any department; every finding is a static read of the source in the
locked tree.

**Checks that did not run.**
- Git history was not scanned (no gitleaks/trufflehog run); a rotated secret could
  still exist in an earlier commit the working tree does not show.
- `node_modules` was never installed or inspected; the dependency audit ran against
  `package-lock.json`'s resolved graph only, so no install-time script
  (`postinstall`, etc.) was reviewed.
- Only the direct dependency `grunt` was written up as a representative devDependency
  finding; `cypress`, `mocha`, `selenium-webdriver`, `nodemon`, `jshint`,
  `grunt-retire`, and `zaproxy` also carry `npm audit` advisories but were not each
  turned into a separate finding, since they run only in build/CI/test, not the
  deployed application.
- Of the 145 packages `npm audit` flagged, only the ones matching a direct dependency
  were written up; the remaining transitive packages (`qs`, `path-to-regexp`, `cookie`,
  `send`, `serve-static`, `bson`, and others) are named only in prose under the direct
  package that pulls them in, per the department's grouping rule.
- Typosquatting was checked by visual read of the 34 direct dependency names, not by
  an automated similarity comparison against a package-name database.
- `marked` 0.3.5's own source was not read to confirm whether its `sanitize: true`
  option resists every markdown-syntax XSS vector; `injection-xss-memos-marked-stored`
  is marked `likely` for exactly this reason.
- Runtime and deployment configuration — actual environment variables on a real
  deployment, a reverse proxy adding TLS or headers, WAF/CDN rules — was not observed;
  only the source defaults in this repository were read.
- CI/CD workflow files (`.github/workflows/*.yml`, `.travis.yml`) and the
  `Dockerfile`/`docker-compose.yml` supply chain were only skimmed by semgrep's
  mutable-action-tag rule, not fully reviewed for build-time secrets or base-image
  pinning.
- Vendored front-end assets under `app/assets/vendor/**` (jQuery, Bootstrap, Raphael,
  Morris, FontAwesome) were not reviewed as first-party code; they belong to the
  dependency surface, not to this codebase's own logic.
- SQL injection checks did not apply: NodeGoat's persistence layer is exclusively
  MongoDB through the native driver, so no SQL-string-building code exists in the tree.
- Command injection and path traversal were checked only by grepping for
  `child_process`, `exec`/`execSync`/`spawn`, `fs.*`, and `sendFile`; every hit resolved
  to a literal, non-request-derived path, so neither class was traced further.

## Certificate

Verified findings: 38
Target tree: 78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3

`node verify-safety-report.mjs --report` mechanically checked that every finding in
`findings.json` resolves to a real file and an existing line in the locked target tree
and that its quoted snippet matches that line's actual text; that every finding id is
unique; that no two findings share file, line, and CWE; that every id present in a
department's `findings/<department>.json` but absent from `findings.json` is disclosed
above; and that the severity counts stated in both summaries match `findings.json`
exactly.

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".

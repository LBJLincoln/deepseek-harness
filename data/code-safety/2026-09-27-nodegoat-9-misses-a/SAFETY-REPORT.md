## Résumé exécutif

Cette revue intégrée porte sur NodeGoat, une application Express/MongoDB volontairement
vulnérable de l'OWASP, sur l'arbre verrouillé dans `target.json` (111 fichiers,
sha256 `78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Six
départements ont chacun mené leur propre lecture du code — accès (authentification,
session, autorisation), données (exposition de données sensibles et cryptographie),
injection, plateforme (configuration du serveur web), secrets (identifiants en dur)
et dépendances (manifeste et verrou npm) — et cette intégration fusionne leurs 71
constats en 70 après déduplication par fichier, ligne et CWE. La répartition par
sévérité est : 14 critiques, 24 majeurs, 20 moyens, 10 faibles et 2 informatifs.
Les trois constats les plus importants : (1) trois appels `eval()` directs sur des
champs de formulaire non validés dans `app/routes/contributions.js` (lignes 32 à
34), qui donnent à tout utilisateur authentifié l'exécution de code arbitraire côté
serveur ; (2) le mot de passe est stocké et comparé en clair dans
`app/data/user-dao.js:25`, alors que le code de hachage bcrypt correct existe déjà
en commentaire ; (3) un compte administrateur est créé avec un mot de passe en clair
codé en dur dans `artifacts/db-reset.js:18`, exécuté par le script de démarrage
Docker et Heroku de ce dépôt. La méthode a consisté, pour chaque département, à
lire les points d'entrée avant tout le reste, à s'appuyer sur l'analyseur statique
`semgrep` (et sur `npm audit` pour les dépendances) uniquement pour repérer des
lignes à relire — jamais comme preuve en elle-même —, puis à tracer chaque constat
retenu de la source jusqu'au point d'exécution cité, avec un niveau de confiance
déclaré. Cette intégration a en outre interrogé l'examinateur mécanique
`verify-safety-report.mjs` sur chacun des six fichiers de constats : aucun
identifiant n'a été jugé invalide par cet examinateur. Un unique constat a été
retiré de l'union pour cause de doublon strict (même fichier, même ligne, même CWE)
et est nommé, avec sa raison, dans « Ce qui n'a pas été couvert ». Cette revue n'a
pas couvert l'exécution dynamique de l'application, l'infrastructure de déploiement
réelle, ni l'historique Git antérieur au commit verrouillé (voir cette même
section pour le détail).

- critical: 14
- high: 24
- medium: 20
- low: 10
- info: 2

## Executive summary

This integrated review covers NodeGoat, OWASP's intentionally vulnerable
Express/MongoDB training application, over the tree locked in `target.json` (111
files, sha256 `78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`).
Six departments each read the code independently — access (authentication,
session handling, authorization), data (sensitive-data exposure and
cryptography), injection, platform (web-server configuration), secrets
(hard-coded credentials) and dependencies (manifest and lockfile) — and this
integration merges their 71 findings into 70 after deduplicating by file, line
and CWE. The severity breakdown is: 14 critical, 24 high, 20 medium, 10 low and
2 info. The three most important findings: (1) three direct `eval()` calls on
unvalidated form fields in `app/routes/contributions.js` (lines 32-34), giving
any authenticated user server-side arbitrary code execution; (2) the password is
stored and compared in plaintext at `app/data/user-dao.js:25`, immediately above
the correct, commented-out bcrypt-hashing code; (3) an admin account is seeded
with a hard-coded plaintext password in `artifacts/db-reset.js:18`, run by this
repository's own Docker and Heroku startup scripts. Method: each department read
its entry points before anything else, used the static scanner `semgrep` (and
`npm audit` for dependencies) only to flag lines worth reading — never as
evidence on its own — and then traced every kept finding from source to the
cited sink, stating a confidence level for each. This integration additionally
asked the mechanical examiner `verify-safety-report.mjs` to evaluate every one of
the six department findings files; it flagged zero ids as invalid. One finding
was dropped from the union for being an exact duplicate (same file, line and
CWE) and is named, with the reason, under "What was not covered". This review
did not exercise the running application, the real deployment infrastructure, or
the git history before the locked commit (see that same section for detail).

- critical: 14
- high: 24
- medium: 20
- low: 10
- info: 2

## Scope and method

**Target:** `/root/targets/NodeGoat` (OWASP NodeGoat), locked in `target.json` to
111 files (excluding `.git`) at tree hash
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`. The target
was read-only for every department; `verify-safety-report.mjs` re-hashes every
locked file before deciding any findings file or this report, and the target
tree was unchanged when this integration ran.

**Departments that ran, on their own branches, each committing
`findings/<department>.json` and `report/<department>.md`:** `access`, `data`,
`injection`, `platform`, `secrets`, `dependencies`. This file and `findings.json`
are the integration's own output, merging all six.

**Tools that ran:** every department that committed a report ran `semgrep`
(reported version `1.177.0`) with a local rule pack plus the reachable registry
pack `p/owasp-top-ten`, over the target tree, and treated every hit as a
candidate line to read rather than as a finding by itself. The `dependencies`
department additionally ran `npm audit --json` against the target's
`package.json`/`package-lock.json` (registry reachable, full report returned) and
made individual `npm view <pkg> time|deprecated|version` registry queries to
confirm maintenance status. This integration ran the committed examiner,
`node verify-safety-report.mjs --findings <file> --list-invalid`, against each of
the six department findings files before building the union, and
`node verify-safety-report.mjs --report` against this report and `findings.json`
before committing.

**What was actually read, by department, per their own reports:** `access` read
`server.js`, every file under `app/routes/`, `app/data/user-dao.js`,
`app/data/profile-dao.js`, `app/data/benefits-dao.js`, `config/config.js`,
`config/env/all.js` and `package.json`. `data` read the same session/profile/
benefits/config chain plus `app/routes/error.js`, `artifacts/db-reset.js` and the
views that render a full DB document. `injection` read `server.js`, all ten route
handlers, all seven DAOs under `app/data/`, and every view under `app/views/`
that a route renders. `platform` read `server.js` end to end, `config/config.js`
and `config/env/*.js`, every file under `app/routes/`, `package.json`/
`package-lock.json`, `Dockerfile` and `docker-compose.yml`. `secrets` read the
`config/env/*.js` family, `config/config.js`, `server.js`, the user/profile DAOs,
`app/routes/session.js`, `artifacts/db-reset.js`, `artifacts/cert/server.key`,
`docker-compose.yml`, `Dockerfile`, `app.json`, `Procfile`, `package.json`, the
`test/e2e/fixtures/users/*.json` fixtures, `test/security/profile-test.js`, one
e2e support file and spec, and both GitHub Actions workflow files. `dependencies`
read `package.json` in full and cross-referenced `package-lock.json`'s resolved
versions and dependency graph for every declared package, without tracing
application code paths except to name which route or module loads a given
package.

This is a review by a language model, grounded by the static scanner `semgrep`
(and `npm audit` for dependency advisories) and by the committed mechanical
examiner `verify-safety-report.mjs`, over the files each department states above
that it actually read — not over every file `target.json` lists as present.

## Findings

### critical

- `data-password-plaintext-storage` — User passwords are stored and compared in plaintext instead of being hashed (`app/data/user-dao.js:25`, CWE-256, confirmed)
- `data-pii-financial-plaintext-storage` — SSN and date of birth are written to the database in plaintext; encryption code exists but is disabled (`app/data/profile-dao.js:61-66`, CWE-311, confirmed)
- `injection-eval-pretax` — Server-side code execution via eval() on the contributions preTax field (`app/routes/contributions.js:32`, CWE-95, confirmed)
- `injection-eval-aftertax` — Server-side code execution via eval() on the contributions afterTax field (`app/routes/contributions.js:33`, CWE-95, confirmed)
- `injection-eval-roth` — Server-side code execution via eval() on the contributions roth field (`app/routes/contributions.js:34`, CWE-95, confirmed)
- `injection-ssrf-research` — SSRF in the research page via unvalidated url query parameter fetched server-side (`app/routes/research.js:15-16`, CWE-918, confirmed)
- `secrets-001` — Admin account seeded with a hard-coded plaintext password used by the live login flow (`artifacts/db-reset.js:18`, CWE-798, confirmed)
- `dep-forever` — forever ^2.0.0 resolves to 2.0.0 (2015-era), a critical-severity direct dependency carrying 35 additional vulnerable transitive packages (`package.json:15`, CWE-1357, confirmed)
- `dep-mongodb` — mongodb ^2.1.18 resolves to 2.2.36, a critical-severity driver bundling a bson deserialization flaw (`package.json:18`, CWE-502, confirmed)
- `dep-swig` — swig ^1.4.2 is deprecated upstream with an unfixed critical arbitrary-file-read advisory (`package.json:22`, CWE-22, confirmed)
- `dep-underscore` — underscore ^1.8.3 resolves to 1.9.1, inside the range vulnerable to critical arbitrary code execution via template() (`package.json:23`, CWE-94, confirmed)
- `dep-cypress` — cypress ^3.3.1 resolves to 3.3.1, a critical-severity release 13 majors behind current, carrying 29 further vulnerable packages (`package.json:44`, CWE-1357, confirmed)
- `dep-grunt` — grunt ^1.0.3 resolves to 1.0.3, vulnerable to arbitrary code execution, a race condition and path traversal (`package.json:45`, CWE-94, confirmed)
- `dep-mocha` — mocha ^2.4.5 resolves to 2.5.3, inside the critical range because its bundled growl allows command injection (`package.json:57`, CWE-78, confirmed)

### high

- `access-benefits-missing-admin-check` — POST /benefits lets any logged-in user modify any other user's benefit record with no admin check (`app/routes/index.js:56`, CWE-862, confirmed)
- `access-allocations-idor` — GET /allocations/:userId loads any user's allocation data by id with no ownership check (`app/routes/index.js:63`, CWE-639, confirmed)
- `access-plaintext-password-storage` — Signup stores the user's password in plaintext with no hashing (`app/data/user-dao.js:25`, CWE-916, confirmed)
- `access-csrf-missing-profile-update` — State-changing profile update (bank account, routing, SSN) has no CSRF protection (`app/routes/index.js:48`, CWE-352, confirmed)
- `data-http-cleartext-transport` — Application server only accepts plaintext HTTP, exposing every credential and session cookie in transit (`server.js:145`, CWE-319, confirmed)
- `injection-nosql-where-allocations` — NoSQL injection via MongoDB $where built from the allocations threshold query parameter (`app/data/allocations-dao.js:78`, CWE-943, confirmed)
- `injection-redos-bankrouting` — Catastrophic-backtracking regular expression validates the profile bankRouting field (`app/routes/profile.js:59-61`, CWE-1333, confirmed)
- `injection-stored-xss-memo` — Stored XSS: memo body is rendered through marked() with template auto-escaping disabled (`app/views/memos.html:31`, CWE-79, confirmed)
- `platform-no-https` — Application only listens over plain HTTP, so credentials and the session cookie travel in cleartext (`server.js:144-145`, CWE-319, confirmed)
- `platform-session-cookie-flags` — Session cookie is issued without HttpOnly, Secure or a non-default name, and never expires (`server.js:78-102`, CWE-1004, confirmed)
- `platform-csrf-disabled` — CSRF protection (csurf) is installed but never mounted, and no CSRF token is issued to any form (`server.js:104-113`, CWE-352, confirmed)
- `platform-template-autoescape-disabled` — Swig template auto-escaping is disabled application-wide (`server.js:135-142`, CWE-79, likely)
- `secrets-002` — Session cookie secret is hard-coded in the committed configuration (`config/env/all.js:8`, CWE-798, confirmed)
- `dep-body-parser` — body-parser range ^1.15.1 resolves to 1.18.3, vulnerable to two denial-of-service advisories (`package.json:9`, CWE-405, confirmed)
- `dep-express` — express range ^4.13.4 resolves to 4.16.4, an old 4.x with open XSS/open-redirect advisories and 10 transitive advisory-carrying packages (`package.json:13`, CWE-79, confirmed)
- `dep-helmet` — helmet ^2.0.0 resolves to 2.3.0, six majors behind current (8.x), with a moderate configuration-override advisory in its bundled helmet-csp (`package.json:16`, CWE-1357, confirmed)
- `dep-marked` — marked is pinned to the exact version 0.3.5, vulnerable to ReDoS and two XSS-sanitization bypasses (`package.json:17`, CWE-1333, confirmed)
- `dep-async` — async ^2.0.0-rc.4 resolves to 2.6.1, inside the range vulnerable to prototype pollution (`package.json:42`, CWE-1321, confirmed)
- `dep-grunt-if` — grunt-if is installed from a GitHub tarball pinned to the moving "master" branch, not a versioned registry release (`package.json:51`, CWE-829, confirmed)
- `dep-grunt-contrib-jshint` — grunt-contrib-jshint ^3.0.0 resolves to 3.2.0 and pulls a high-severity ReDoS via its own bundled jshint (`package.json:48`, CWE-400, confirmed)
- `dep-grunt-contrib-watch` — grunt-contrib-watch >=0.5.0 is flagged high severity and its resolved subtree carries 12 further vulnerable packages (`package.json:49`, CWE-1357, confirmed)
- `dep-jshint` — jshint is pinned to the exact version 2.12.0 and carries a high-severity ReDoS via its bundled minimatch (`package.json:56`, CWE-400, confirmed)
- `dep-nodemon` — nodemon ^1.19.1 resolves to 1.19.1, a high-severity release with 36 further vulnerable packages in its resolved subtree (`package.json:58`, CWE-1357, confirmed)
- `dep-selenium-webdriver` — selenium-webdriver ^2.53.2 resolves to 2.53.3, pulling adm-zip's uncontrolled-memory-allocation and ws's memory-exhaustion advisories (`package.json:59`, CWE-789, confirmed)

### medium

- `access-session-fixation-login` — Login handler does not regenerate the session id after authentication (session fixation) (`app/routes/session.js:116`, CWE-384, confirmed)
- `access-login-account-enumeration` — Login failure branches render different messages for an unknown user versus a wrong password (`app/routes/session.js:85`, CWE-204, confirmed)
- `access-weak-signup-password-policy` — Signup password validator accepts a single-character password (`app/routes/session.js:144`, CWE-521, confirmed)
- `access-login-no-rate-limit` — Login endpoint has no attempt limit, lockout or delay (`app/routes/index.js:34`, CWE-307, confirmed)
- `access-session-cookie-not-hardened` — Session cookie is issued with no Secure flag and no absolute expiry (`server.js:78-102`, CWE-613, confirmed)
- `data-secrets-logged-at-startup` — The session-signing secret and the AES encryption key are printed to the console on every application start (`config/config.js:13`, CWE-532, confirmed)
- `data-seed-passwords-logged` — Database seed script logs full user records, including plaintext passwords, to the console (`artifacts/db-reset.js:99`, CWE-532, confirmed)
- `data-benefits-unprojected-pii-query` — Admin benefits page loads full user documents -- including plaintext passwords, SSN and bank details -- with no field projection (`app/data/benefits-dao.js:16-20`, CWE-200, likely)
- `injection-open-redirect-learn` — Open redirect on /learn via unvalidated query-string URL (`app/routes/index.js:72`, CWE-601, confirmed)
- `injection-reflected-xss-profile-firstname` — Reflected XSS: unescaped firstName echoed into an href attribute on the profile page (`app/views/profile.html:78`, CWE-79, confirmed)
- `injection-reflected-xss-allocations-userid` — Reflected XSS: unescaped path parameter userId echoed into a form action attribute (`app/views/allocations.html:15`, CWE-79, confirmed)
- `platform-security-headers-disabled` — Helmet is installed but never mounted: no CSP, no clickjacking protection, no HSTS, no MIME-sniffing protection, and X-Powered-By is left on (`server.js:38-65`, CWE-693, confirmed)
- `platform-open-redirect` — The /learn route redirects to a URL taken directly from the query string (`app/routes/index.js:70-73`, CWE-601, confirmed)
- `platform-error-handler-exposure` — The global error handler renders the raw Error object to the client (`app/routes/error.js:10-12`, CWE-209, confirmed)
- `secrets-003` — Full application config, including the session-cookie secret, is printed to the console on every startup (`config/config.js:12-13`, CWE-532, confirmed)
- `dep-grunt-cli` — grunt-cli ^1.2.0 resolves to 1.3.2, inside the moderate-severity range via its liftoff dependency (`package.json:46`, CWE-1357, confirmed)
- `dep-grunt-env` — grunt-env is declared as the floating range "latest" and its currently-resolved version pulls a critical lodash advisory (`package.json:50`, CWE-1357, confirmed)
- `dep-grunt-npm-install` — grunt-npm-install bundles an old npm CLI with permission and arbitrary-file-write advisories (`package.json:54`, CWE-732, confirmed)
- `dep-grunt-retire` — grunt-retire, the task meant to catch outdated dependencies, is itself years out of date and pulls a critical advisory through its own underscore dependency (`package.json:55`, CWE-1104, confirmed)
- `dep-zaproxy` — zaproxy <=1.0.1 pulls lodash's critical code-injection advisory and request's SSRF-class advisories (`package.json:61`, CWE-94, confirmed)

### low

- `injection-log-forging-username` — Unauthenticated login username written to the log without neutralizing control characters (`app/routes/session.js:64`, CWE-117, confirmed)
- `secrets-004` — RSA private key committed to the repository in plaintext (`artifacts/cert/server.key:1-15`, CWE-321, confirmed)
- `secrets-005` — OWASP ZAP API key hard-coded in the default (development) environment config (`config/env/development.js:6`, CWE-798, confirmed)
- `dep-bcrypt-nodejs` — bcrypt-nodejs is unmaintained: last published in 2013, superseded by bcrypt/bcryptjs (`package.json:8`, CWE-1104, confirmed)
- `dep-csurf` — csurf is deprecated/archived upstream and pulls a vulnerable cookie parser (`package.json:11`, CWE-74, confirmed)
- `dep-express-session` — express-session ^1.13.0 resolves to 1.15.6 and bundles a vulnerable cookie parser and on-headers (`package.json:14`, CWE-241, confirmed)
- `dep-needle` — needle is pinned to the exact version 2.2.4 and carries a moderate-severity ReDoS in its bundled debug dependency (`package.json:19`, CWE-1104, confirmed)
- `dep-node-esapi` — node-esapi is an unfinished, single-release ESAPI port with no release since 2014 (`package.json:20`, CWE-1104, confirmed)
- `dep-serve-favicon` — serve-favicon ^2.3.0 resolves to 2.5.0 and pulls a moderate-severity ReDoS via ms (`package.json:21`, CWE-1104, confirmed)
- `dep-cross-env` — cross-env ^7.0.2 pulls a high-severity command-injection-adjacent flaw in cross-spawn (`package.json:43`, CWE-1357, confirmed)

### info

- `dep-consolidate` — consolidate ^0.14.1 carries no current advisory but is templated around the also-abandoned swig engine (`package.json:10`, CWE-1104, possible)
- `dep-dont-sniff-mimetype` — dont-sniff-mimetype has no open advisory but has seen no release since 2015 (`package.json:12`, CWE-1104, possible)

## What was not covered

- **Dropped finding, disclosed per the dedup rule:** `platform-no-login-rate-limit`
  (`app/routes/index.js:34`, CWE-307) is an exact duplicate — same file, same
  line, same CWE — of `access-login-no-rate-limit`, which the `access`
  department filed against the same route for the same reason. Both carry
  `confidence: confirmed`, so the tie was broken by keeping the `access`
  department's entry (authentication/rate-limiting is squarely that
  department's remit) and dropping the `platform` duplicate from
  `findings.json`. No information is lost: the finding itself is fully present
  under `access-login-no-rate-limit` above.
- **No mechanically invalid findings.** `node verify-safety-report.mjs
  --findings <file> --list-invalid` printed no ids for any of the six
  department findings files; every finding that exists resolves to a real
  file and line with a matching snippet. Nothing was dropped for failing that
  check.
- **Departments and their own stated gaps:** `access` did not cover injection
  classes (SSRF, eval, ReDoS), security headers/CSP, MFA (not implemented in
  this app), or JWTs (not used here — session cookies only). `data` left
  NoSQL injection, SSRF, session-cookie flags and session fixation to the
  `injection`/`access`/`platform` departments, and did not assess dependency
  CVEs. `injection` found no SQL surface (Mongo only), no `child_process`/
  `exec` call anywhere in the app, and no unsafe-deserialization call
  (`pickle`/`yaml.load`/`node-serialize` equivalents); it also did not deep-read
  every vendor script under `app/assets/vendor/`. `platform` did not audit
  dependency versions for CVEs (left to `dependencies`) and did not trace
  individual XSS sinks downstream of the disabled Swig autoescape (left to
  `injection`); it found no CORS configuration present at all (no `cors`
  package, no `Access-Control-*` header) so there was nothing permissive to
  report there. `secrets` did not audit third-party dependency source for
  embedded secrets (left to `dependencies`) and did not run a git-history
  secret scanner (gitleaks/trufflehog) against commits before the locked
  tree. `dependencies` did not trace which advisories are actually reachable
  from an HTTP-facing input (that per-sink tracing is `injection`'s and
  `access`'s work) and did not independently review native/binary bindings
  (e.g. `bcrypt-nodejs`'s native code) for cryptographic soundness beyond
  noting the package is unmaintained.
- **File kinds nobody opened as attack surface, across all six departments:**
  binary and image assets (`app/assets/favicon.ico`, `app/assets/images/*.png`,
  the bundled fonts under `app/assets/vendor/theme/font-awesome/fonts/`); the
  vendor JavaScript/CSS bundles (`jquery.min.js`, `bootstrap.js`,
  `bootstrap-tour.js`, `morris-0.4.3.min.js`, `raphael-min.js`,
  `html5shiv.js`, `font-awesome.min.css`, `sb-admin.css`) were only skimmed by
  `injection` for obvious DOM sinks, not reviewed line by line; `LICENSE`,
  `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `README.md`, `.jshintrc`,
  `.jshintignore`, `.gitignore`, `.dockerignore`, `cypress.json` and
  `nodemon.json` were not read by any department as they carry no runtime
  logic; `test/e2e/**` (fixtures, integration specs, support files) and
  `test/security/profile-test.js` were opened only far enough to confirm they
  are test-only credentials and harness code, not production paths; both
  `.github/workflows/*.yml` files and `.travis.yml` were noted to exist
  (semgrep flagged mutable Action tags in the former) but not reviewed as CI/CD
  security configuration; `Procfile`, `app.json`, `Dockerfile` and
  `docker-compose.yml` were read only for what they run (confirming
  `artifacts/db-reset.js` executes on every start), not for container-hardening
  practice generally.
- **Classes of defect no department owns in this review:** memory-safety bugs
  (not applicable — no native/compiled code in the reviewed tree beyond
  `bcrypt-nodejs`'s native binding, which was not independently audited);
  business-logic flaws beyond the specific authorization gaps found (e.g.
  whether the contributions math itself, once `eval()` is replaced, enforces
  correct tax-bracket limits, was not assessed); race conditions/TOCTOU beyond
  the ones explicitly named; a full authorization matrix across every route and
  role (only the admin/non-admin boundary on `/benefits` was checked; no
  department enumerated every route against every possible role); typosquatting
  or supply-chain-provenance analysis of the npm packages beyond the one
  GitHub-tarball dependency (`grunt-if`) that was flagged; and dependency
  confusion (private-package-name collision) was not assessed at all.
- **Checks that did not run:** the application was never started, so no
  dynamic testing, fuzzing, or live exploitation of any finding (the SSRF, the
  `eval()` RCE, the NoSQL injection, the ReDoS) was performed to confirm
  real-world impact beyond static code tracing; no penetration test or DAST
  scan (OWASP ZAP itself, despite `zaproxy`/`zapApiKey` being present in this
  codebase's own test tooling, was not run by this review); no review of the
  actual deployed environment (environment variables in use, network topology,
  whether a reverse proxy adds TLS/headers in front of the plain-HTTP listener
  this code starts); no confirmation that a production build strips
  `devDependencies` at deploy time; and no dependency-scanning tool other than
  `npm audit` and manual `npm view` registry queries was run (no OSV or Snyk
  cross-check).

## Certificate

Verified findings: 70
Target tree: 78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3

`node verify-safety-report.mjs --report` mechanically confirmed, over the files
listed in "Scope and method": that every one of the 70 findings in
`findings.json` resolves to a real file and line in the locked target tree with
its quoted snippet matching the target's own text at that location; that all 70
ids are unique; that no two findings share file, line and CWE; that every
`file:line` citation anywhere in this report resolves in the locked tree; and
that the severity counts stated above match `findings.json` exactly.

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".

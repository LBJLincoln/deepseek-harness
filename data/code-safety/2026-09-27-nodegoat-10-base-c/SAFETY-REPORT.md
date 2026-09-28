## Résumé exécutif

Cette revue intègre les constats de six départements (accès, données, dépendances,
injection, plateforme, secrets) sur NodeGoat, une application Express.js/MongoDB
volontairement vulnérable, dans l'arborescence en lecture seule
`/root/targets/NodeGoat` (111 fichiers verrouillés par `target.json`, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Après fusion et
déduplication par fichier, ligne et CWE, l'union retient 45 constats : 6 critiques,
20 hauts, 13 moyens, 5 faibles et 1 informatif. Les plus importants : (1) le secret
de session express-session est une chaîne codée en dur dans le dépôt
(`config/env/all.js:8`), permettant de forger la session de n'importe quel
utilisateur, y compris administrateur ; (2) un compte administrateur par défaut
(`admin`/`Admin_123`) est inséré par le script de seed exécuté à chaque démarrage
documenté (`artifacts/db-reset.js:15-20`) ; (3) trois champs de requête distincts
(`preTax`, `afterTax`, `roth`) passent par `eval()` sans aucune validation
(`app/routes/contributions.js:32-34`), donnant l'exécution de code arbitraire côté
serveur à quiconque peut soumettre le formulaire de cotisations. Chaque département
a lu les fichiers qu'il cite comme constat et documenté sa propre méthode ; cette
intégration n'a pas relu le code source elle-même au-delà de la vérification
mécanique. Cinq constats valides ont été retirés de l'union uniquement parce qu'ils
doublonnaient, au sens strict fichier+ligne+CWE, un autre constat conservé ; aucun
constat n'a été jugé invalide par l'examinateur mécanique. Cette revue ne couvre ni
les tests dynamiques, ni l'historique Git, ni les ressources statiques tierces
vendues (voir « Ce qui n'a pas été couvert »). Méthode : lecture des points
d'entrée par chaque département, suivi de la donnée de la source au point
d'exécution, un constat par point d'exécution, ligne citée exactement et niveau de
confiance déclaré ; `semgrep` (v1.177.0, règles locales du dépôt plus
`p/owasp-top-ten`) et `npm audit` (registre atteignable) ont servi de repérage et de
base d'avis, jamais de preuve suffisante à eux seuls, et `verify-safety-report.mjs`
a vérifié mécaniquement chaque fichier et chaque ligne cités.

- critical: 6
- high: 20
- medium: 13
- low: 5
- info: 1

## Executive summary

This report integrates the findings of six departments (access, data,
dependencies, injection, platform, secrets) over NodeGoat, a deliberately
vulnerable Express.js/MongoDB application, in the read-only tree
`/root/targets/NodeGoat` (111 files locked by `target.json`, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). After merging
and deduplicating by file, line and CWE, the union holds 45 findings: 6 critical,
20 high, 13 medium, 5 low, 1 informational. The most significant: (1) the
express-session secret is a hard-coded literal committed to the repository
(`config/env/all.js:8`), letting anyone forge any user's session, including an
admin's; (2) a default admin credential (`admin`/`Admin_123`) is inserted by the
seed script every documented deployment path runs at startup
(`artifacts/db-reset.js:15-20`); (3) three request fields (`preTax`, `afterTax`,
`roth`) are passed straight to `eval()` with no validation
(`app/routes/contributions.js:32-34`), giving arbitrary server-side code execution
to anyone who can submit the contributions form. Each department read the files it
cites as evidence and documented its own method; this integration did not re-read
the source itself beyond the mechanical verification. Five valid findings were
removed from the union only because they duplicated, strictly by file+line+CWE,
another finding that was kept; no finding was judged invalid by the mechanical
examiner. This review covers none of dynamic testing, git history, or vendored
third-party static assets (see "What was not covered"). Method: each department
read its own entry points, traced data from source to sink, filed one finding per
sink, quoted the exact line, and stated a confidence level; `semgrep` (v1.177.0,
the repository's local rules plus `p/owasp-top-ten`) and `npm audit` (registry
reachable) were used as leads and as an advisory source, never as sufficient proof
on their own, and `verify-safety-report.mjs` mechanically checked every cited file
and line.

- critical: 6
- high: 20
- medium: 13
- low: 5
- info: 1

## Scope and method

Target: `/root/targets/NodeGoat`, the tree locked in `target.json` next to this
report — 111 files, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`, read-only for
every department and re-hashed unchanged by `verify-safety-report.mjs` at the time
this report was written.

Six departments ran and each committed `findings/<department>.json` and
`report/<department>.md` on its own branch, merged into this worktree:

- **access** — authentication, session handling, authorization. Read `server.js`
  (session bootstrap), every module under `app/routes/`, and the DAO layer under
  `app/data/` insofar as it implements an authentication or authorization
  decision (`user-dao.js`, `benefits-dao.js`, `allocations-dao.js`), plus the
  view templates that show what each route exposes.
- **data** — sensitive-data exposure, logging, cryptography at rest and in
  transit. Read `server.js`, `config/config.js`, all of `config/env/*.js`, the
  route/DAO pairs handling passwords and profile PII, `app/routes/error.js`,
  `artifacts/db-reset.js`, `docker-compose.yml`, `Dockerfile`.
- **dependencies** — the manifest and lockfile. Read `package.json` in full and
  queried `package-lock.json` programmatically for each cited package; ran
  `npm audit --json` inside the target (registry reachable, 145 advisory-carrying
  packages returned across 1479 resolved dependencies).
- **injection** — SQL/NoSQL/command/eval injection, XSS, SSRF, open redirect,
  path/template injection. Read every route handler, every DAO, `server.js`, and
  the templates each handler renders, tracing `req.query`/`req.body`/`req.params`
  to each sink.
- **platform** — security headers, CORS, cookies, error handling, rate limiting,
  debug/deployment configuration. Read `server.js` end to end first, then
  `config/config.js`, `config/env/*.js`, `app/routes/*.js`'s mounting order,
  `app/routes/error.js`, `Dockerfile`, `docker-compose.yml`.
- **secrets** — credentials and keys in the committed tree. Read `config/config.js`
  and all of `config/env/`, `server.js`, `app/data/user-dao.js`,
  `app/data/profile-dao.js`, `artifacts/db-reset.js`, `artifacts/cert/*`,
  `docker-compose.yml`, `Dockerfile`, `app.json`, `Procfile`, `.travis.yml`, both
  `.github/workflows/*.yml`, `cypress.json`, `nodemon.json`, `package.json`, and
  the `test/e2e/fixtures/users/*` and `test/security/profile-test.js` files,
  plus targeted greps across the rest of the tree for credential-shaped strings.

Tools that ran: `semgrep` v1.177.0 (the repository's local rule pack plus the
registry pack `p/owasp-top-ten`, reachable; run separately by access, data,
injection, platform and secrets, each treating its hits as places to read rather
than findings in themselves) and `npm audit --json` (run by dependencies, registry
reachable). This program's own mechanical examiner, `verify-safety-report.mjs`,
re-hashed the whole target tree against `target.json` and checked every finding's
`file`, `line` and quoted `snippet` against the tree's actual text; every
department's file passed with zero failures, and `--list-invalid` named no finding
as invalid in any of the six files.

This report is a review written by a language model, grounded by that static
scanner, by `npm audit`'s advisory feed, and by the committed mechanical examiner —
it reflects what the six departments actually opened and read, not an exhaustive
enumeration of the 111-file tree, and not any behavior observed from a running
instance.

## Findings

### Critical

- `data-002` — User passwords are stored and compared in plaintext (`app/data/user-dao.js:25`, CWE-256, confirmed) — Any read of the users collection discloses every password in the clear; enable the commented-out `bcrypt.hashSync`/`bcrypt.compareSync` calls already present in the file.
- `deps-mongodb-bson-deserialization` — mongodb driver pulls a bson version with a critical deserialization advisory, and the driver itself is 4 major versions behind (`package.json:18`, CWE-502, likely) — If attacker-influenced data reaches BSON decoding, memory corruption or a crash is possible; upgrade the mongodb package (only a major-version fix is available).
- `deps-underscore-arbitrary-code-execution` — underscore resolves to a version with a critical arbitrary code execution advisory (`package.json:23`, CWE-94, confirmed) — A reachable `_.template` call could execute arbitrary JavaScript server-side; upgrade underscore past 1.12.1.
- `injection-eval-contributions` — Server-side code injection via eval() on contribution percentages (`app/routes/contributions.js:32-34`, CWE-95, confirmed) — A crafted POST body executes arbitrary JavaScript in the server process; replace `eval()` with `parseInt`/`parseFloat` and range validation, as the file's own commented-out fix already shows.
- `secrets-cookie-secret` — express-session secret is a hard-coded literal used by the running server (`config/env/all.js:8`, CWE-798, confirmed) — Anyone who reads the repository can forge any session cookie, including an admin's; load the secret from the environment with no fallback and rotate it.
- `secrets-admin-default-credential` — Hard-coded default admin credential is seeded into the live application database (`artifacts/db-reset.js:15-20`, CWE-798, confirmed) — Every deployment that follows the documented setup ships a working `admin`/`Admin_123` account; never seed a fixed password, and rotate any database that already has it.

### High

- `access-session-fixation-login` — Session id is not regenerated after successful login (session fixation) (`app/routes/session.js:116`, CWE-384, confirmed) — An attacker who fixes a victim's pre-login session id inherits it once the victim authenticates; call `req.session.regenerate()` on login as signup already does.
- `access-benefits-post-missing-admin-check` — POST /benefits lets any logged-in user change any other user's benefit start date (`app/routes/index.js:56`, CWE-862, confirmed) — Any authenticated user can rewrite another user's benefits record; mount the existing `isAdmin` middleware on this route.
- `access-csrf-missing-profile` — No CSRF protection on state-changing routes; csurf is a dependency but never mounted (`app/routes/index.js:48`, CWE-352, confirmed) — A visited page can silently rewrite a victim's SSN/bank details; mount `csurf` and wire the token into every form.
- `access-plaintext-password-storage-comparison` — Passwords are stored and compared in plaintext instead of hashed (`app/data/user-dao.js:61`, CWE-256, confirmed) — Any database read discloses every password; hash with bcrypt as the file's own commented-out code shows.
- `data-001` — Application config, including the session-cookie secret and crypto key, is logged to stdout on every boot (`config/config.js:12-13`, CWE-532, confirmed) — Anyone with log access recovers the signing secret and AES key; stop logging the full config object or redact secret fields first.
- `data-003` — SSN, date of birth and bank account/routing numbers are stored in cleartext (`app/data/profile-dao.js:55-66`, CWE-312, confirmed) — Database read access discloses PII sufficient for identity theft; re-enable the file's own commented-out encrypt/decrypt helpers.
- `data-004` — The application is served over plaintext HTTP; TLS is fully disabled (`server.js:144-147`, CWE-319, confirmed) — Credentials and the session cookie travel in the clear on the network; enable the already-present, commented-out HTTPS listener.
- `deps-body-parser-dos` — body-parser resolves to a version vulnerable to denial of service via urlencoded body parsing (`package.json:9`, CWE-405, confirmed) — A crafted body can exhaust server resources; upgrade body-parser to >=1.20.6.
- `deps-swig-arbitrary-file-read` — swig template engine is pinned to the exact version with a known arbitrary local file read advisory and has no fix available (`package.json:22`, CWE-22, confirmed) — swig is the app's live view engine with no available patch; replace it with a maintained template engine.
- `deps-forever-prototype-pollution-chain` — forever pulls a chain of 4 vulnerable transitive dependencies, including a critical minimist prototype-pollution advisory, and is itself years past its last compatible release (`package.json:15`, CWE-1321, likely) — A compromised transitive package could pollute prototypes on the process-manager host; upgrade to forever@4.0.3 or replace it.
- `deps-marked-redos-xss` — marked is pinned to an exact version with multiple ReDoS and XSS advisories (`package.json:17`, CWE-1333, confirmed) — Crafted markdown can hang the renderer or bypass sanitization; upgrade marked past 0.3.9.
- `injection-nosql-where-allocations` — NoSQL injection in allocations lookup via unsanitized $where clause (`app/data/allocations-dao.js:77-79`, CWE-943, confirmed) — A crafted `threshold` query parameter is evaluated as server-side JavaScript by MongoDB; replace the `$where` string with a plain query operator.
- `injection-ssrf-research` — Server-side request forgery in stock research lookup (`app/routes/research.js:15-16`, CWE-918, confirmed) — The server fetches an attacker-supplied URL and echoes the response; build the outbound URL server-side against an allow-listed host instead.
- `injection-xss-memos-marked` — Stored XSS in shared memos via unescaped markdown rendering (`app/views/memos.html:31`, CWE-79, confirmed) — Any user's memo can run script in every viewer's browser; re-enable autoescape and sanitize the markdown output.
- `injection-xss-profile-firstname` — Reflected/stored XSS in profile update error page via first name field (`app/views/profile.html:41`, CWE-79, confirmed) — An unescaped first name breaks out of an HTML attribute; re-enable autoescape and encode the field for its context.
- `injection-nosql-login-username` — NoSQL operator injection in login query via unvalidated username (`app/data/user-dao.js:91-93`, CWE-943, confirmed) — A JSON operator object as `userName` can match an arbitrary account; reject non-string login fields before querying.
- `platform-missing-security-headers` — Helmet and every security-header middleware is commented out, so no response carries them (`server.js:38-65`, CWE-693, confirmed) — No clickjacking, MIME-sniffing or CSP protection ships on any response; mount `helmet()` before route registration.
- `platform-session-cookie-not-secure` — Session cookie is never marked Secure, and the server only listens on plain HTTP (`server.js:78-102`, CWE-614, confirmed) — The session cookie can be observed on the network path; terminate TLS and set `cookie.secure: true`.
- `platform-csrf-protection-disabled` — CSRF middleware is commented out even though every state-changing form still submits a _csrf token (`server.js:104-113`, CWE-352, confirmed) — No request is ever checked for a valid CSRF token though the forms already send one; uncomment and mount `csurf()`.
- `platform-missing-rate-limit-login` — No rate limiting or lockout on the login endpoint (`app/routes/index.js:34`, CWE-307, confirmed) — Unlimited password guesses are possible per account; add a rate limiter keyed by account and/or IP in front of login.

### Medium

- `access-benefits-get-missing-admin-check` — GET /benefits exposes the admin benefits roster to any logged-in user, not just admins (`app/routes/index.js:55`, CWE-862, confirmed) — Any authenticated user can browse every other user's benefits data; mount the existing `isAdmin` middleware.
- `access-allocations-idor` — GET /allocations/:userId returns any user's stock allocations by URL parameter, not the caller's own (`app/routes/index.js:63`, CWE-639, confirmed) — Any logged-in user can view another user's financial allocation by changing a path segment; read the target user id from the session instead of the URL.
- `data-005` — Seed script prints every account's plaintext password to the console (`artifacts/db-reset.js:99`, CWE-532, confirmed) — Log access discloses the admin and user passwords on every container start; stop logging the full user objects.
- `deps-express-open-redirect` — express is pinned to a caret range that resolves to a version vulnerable to open redirect and reflected XSS (`package.json:13`, CWE-601, confirmed) — Upgrade express to >=4.20.0.
- `deps-helmet-csp-config-override` — helmet pulls helmet-csp version with a Content-Security-Policy configuration-override advisory, and helmet itself is 5+ major versions behind (`package.json:16`, CWE-693, confirmed) — Upgrade helmet past 3.20.1 and revisit the CSP configuration on a current major.
- `deps-grunt-toolchain-critical-chain` — the grunt build toolchain (grunt and its grunt-* devDependencies) carries a critical prototype-pollution chain and a grunt-level code-execution advisory, scoped to build time only (`package.json:45`, CWE-1188, likely) — Scoped to developer/CI machines; upgrade grunt past 1.6.1.
- `deps-test-tooling-critical-chains` — the test/e2e devDependencies (mocha, cypress, selenium-webdriver, zaproxy, async) are old majors whose transitive dependencies carry dozens of advisories, scoped to build/test time (`package.json:57`, CWE-1104, likely) — Scoped to the test machine; upgrade the test toolchain to current majors.
- `injection-open-redirect-learn` — Open redirect via unvalidated url query parameter (`app/routes/index.js:72`, CWE-601, confirmed) — A crafted link redirects a victim to an attacker's site through the trusted domain; allow-list redirect targets instead of taking a raw URL.
- `platform-open-redirect-learn` — /learn redirects to an attacker-controlled URL taken directly from the query string (`app/routes/index.js:70-73`, CWE-601, confirmed) — Same class as `injection-open-redirect-learn`, cited by platform at the enclosing handler's opening line; allow-list or store the redirect target server-side.
- `platform-error-handler-discloses-error-object` — Global error handler renders the raw caught Error object into the response (`app/routes/error.js:10-12`, CWE-209, confirmed) — Internal error detail reaches the client verbatim; log the error server-side and render a generic message with a correlation id.
- `platform-default-development-config` — Configuration silently falls back to the development environment, which injects a livereload script tag into every page (`config/config.js:5`, CWE-1188, confirmed) — The documented docker-compose deployment silently runs development settings; fail startup when `NODE_ENV` is unset instead of defaulting.
- `secrets-crypto-key` — Hard-coded AES key committed in configuration (currently unused by the running server) (`config/env/all.js:9`, CWE-321, confirmed) — Dead code today, but would silently decrypt SSN/DOB with a public key if ever re-enabled; remove the literal from source.
- `secrets-private-key-committed` — RSA private key committed to the repository (currently unused by the running server) (`artifacts/cert/server.key:1-15`, CWE-321, confirmed) — A real private key is in version control and must be treated as already exposed; remove it from the repository and its history and reissue a fresh key pair.

### Low

- `deps-csurf-deprecated` — csurf is a deprecated, unmaintained package and also carries a low-severity transitive cookie advisory (`package.json:11`, CWE-1104, likely) — Migrate to a maintained CSRF library.
- `deps-express-session-on-headers` — express-session pulls an on-headers version vulnerable to HTTP response header manipulation (`package.json:14`, CWE-241, confirmed) — Upgrade express-session to pick up a patched on-headers.
- `deps-bcrypt-nodejs-unmaintained` — bcrypt-nodejs, the app's password-hashing dependency, has had no release in about a decade (`package.json:8`, CWE-1104, likely) — Migrate to a maintained bcrypt implementation.
- `platform-session-cookie-default-name` — Session cookie keeps the express-session default name, fingerprinting the framework (`server.js:78-102`, CWE-200, confirmed) — Set an application-specific cookie name instead of the express-session default.
- `secrets-zap-api-key` — Hard-coded local DAST-proxy API key in dev/test configuration (`config/env/development.js:6`, CWE-798, confirmed) — Move the key to an environment variable read by the test harness.

### Info

- `deps-node-esapi-abandoned` — node-esapi is pinned at its initial 0.0.1 release with no further releases (`package.json:20`, CWE-1104, likely) — Verify whether it is actually invoked; if so, replace it with a maintained encoding library.

## What was not covered

**Findings dropped by deduplication (valid, but merged into another kept finding sharing the same file, line and CWE):**

- `access-login-no-rate-limit` — same key as `platform-missing-rate-limit-login` (`app/routes/index.js:34`, CWE-307); both `confirmed`, the higher-severity `high` entry (platform) was kept over the `medium` one.
- `access-session-cookie-flags-missing` — same key as `platform-session-cookie-not-secure` (`server.js:78`, CWE-614); both `confirmed`, the higher-severity `high` entry (platform) was kept over the `medium` one.
- `platform-http-only-no-tls` — same key as `data-004` (`server.js:144`, CWE-319); both `confirmed`/`high`, `data-004` was kept as the more directly on-topic statement of what the plaintext transport exposes (credentials, session cookie, PII).
- `data-006` — same key as `platform-error-handler-discloses-error-object` (`app/routes/error.js:10`, CWE-209); the higher-confidence `confirmed` entry (platform) was kept over the `likely` one.
- `platform-hardcoded-cookie-secret` — same key as `secrets-cookie-secret` (`config/env/all.js:8`, CWE-798); both `confirmed`, the higher-severity `critical` entry (secrets) was kept over the `high` one.

**Findings dropped for failing mechanical verification:** none. `node verify-safety-report.mjs --findings <file> --list-invalid` was run against all six department files and printed no id; every submitted finding resolved to a real file, line and matching snippet in the locked tree.

**Departments and tools that ran:** access, data, dependencies, injection, platform and secrets each read and reported; no seventh department (for example, a dedicated mobile, cloud-configuration, or business-logic/fraud department) exists in this program, so those angles were never in scope for anyone. `semgrep` and `npm audit` are the only tools any department ran; no CodeQL, no container/image scanner (Trivy, Grype) against `Dockerfile`, no `gitleaks`/`trufflehog` pass over git history, no dependency query against the OSV database directly, and no DAST tool (OWASP ZAP itself, despite `zapApiKey` being present for it) was executed against a running instance.

**File kinds nobody opened line by line:** the vendored front-end bundles under `app/assets/vendor/` (jQuery, Bootstrap, Raphael, morris.js, html5shiv) and the binary/image assets under `app/assets/images` and `app/assets/favicon.ico`; `LICENSE`, `README.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`; the Cypress end-to-end specs under `test/e2e/integration/` and `test/e2e/support/`; `.travis.yml`, `Procfile`, `app.json` beyond its `postdeploy` hook, `cypress.json`, `nodemon.json`, `.jshintrc`/`.jshintignore`, `.dockerignore`/`.gitignore`. None of these carries request-handling application logic, but none was read line by line by any department either.

**Classes of defect no department owns:** a resource-exhaustion regular expression in the application's own code — the `bankRouting` validation in `app/routes/profile.js` (noted as ReDoS-shaped by the injection department's own report) — was seen during review but never filed by any department, since each treated it as another department's responsibility; it is disclosed here as an uncovered gap rather than as a finding, since no department read the sink and source together and confirmed it as their own. Log-injection (unsanitized user input reaching a log call) was not examined by any department as its own class. CORS configuration was not evaluated by any department beyond the absence of headers noted for other reasons; no department confirmed whether a CORS policy exists or is missing. Business-logic and fraud-specific flaws beyond authorization (IDOR, missing role checks) were not considered as a separate class.

**Checks that did not run:** no dynamic testing, fuzzing, or execution of the application against any finding's proof-of-concept payload; no git-history secret scan; no container or OS-level scan of `Dockerfile`'s base image; no typosquat-database check of the 36 declared npm package names; no live query of npm registry metadata (publish dates, deprecation flags) beyond what `npm audit`'s advisory feed itself returned, so the unmaintained-package findings (`deps-bcrypt-nodejs-unmaintained`, `deps-node-esapi-abandoned`, `deps-csurf-deprecated`) rest on general package-history knowledge, stated `likely`; reachability of the `mongodb`/`bson` deserialization chain and the `forever`/`minimist` prototype-pollution chain from actual attacker-controlled input was not traced line by line, so both remain `likely`; no measurement of the timing behavior of the plaintext `===` password comparison; no verification of actual deployed runtime configuration (a real `NODE_ENV=production`, a TLS-terminating reverse proxy, or a WAF in front of a live deployment could change what an attacker can actually reach, and nothing in this static, read-only review can confirm or rule that out).

## Certificate

Verified findings: 45
Target tree: 78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3

`node verify-safety-report.mjs --report` mechanically checked that every one of the
45 findings in `findings.json` resolves to a real file and line — with a snippet
matching the target's own text at that line — in the tree locked above; that all 45
ids are unique; and that no two findings share `file`, `line` and `cwe`.

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".

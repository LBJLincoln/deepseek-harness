## Résumé exécutif

Cette revue a porté sur `/root/targets/NodeGoat` (l'application pédagogique OWASP
NodeGoat), un arbre de 111 fichiers verrouillé par `target.json` (SHA-256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Six
départements ont chacun lu une partie du code (accès/authentification, données
sensibles, dépendances, injection, plateforme, secrets), chacun épaulé par
`semgrep` (paquets de règles locaux et `p/owasp-top-ten`) et, pour les
dépendances, par `npm audit --json` contre le registre npm ; l'union
dédupliquée de leurs constats, vérifiée mécaniquement par
`verify-safety-report.mjs`, compte 49 constats retenus : 3 constats ont été
fusionnés à cause d'un même triplet fichier+ligne+CWE dans l'analyse ci-dessous
en 5 doublons supprimés au total (voir « Ce qui n'a pas été couvert »). Parmi
les plus importants : (1) une injection de code côté serveur via `eval()` sur
des champs du formulaire de cotisations (`app/routes/contributions.js:32`),
permettant l'exécution de commandes arbitraires sur le serveur par tout
utilisateur connecté ; (2) un compte administrateur réel, semé par le script
de réinitialisation de la base au démarrage du conteneur, avec le mot de passe
en clair `Admin_123` (`artifacts/db-reset.js:18`) ; (3) l'absence totale de
hachage des mots de passe utilisateurs, stockés tels que reçus
(`app/data/user-dao.js:25`). La revue a couvert le code serveur, les routes,
les vues, la configuration, le manifeste de dépendances et son verrou, ainsi
qu'un sous-ensemble de fichiers secrets/artefacts ; elle n'a pas couvert les
scripts de CI, les paquets vendorisés côté client, l'historique git, ni aucun
test dynamique contre une instance en cours d'exécution (voir « Ce qui n'a pas
été couvert »). Méthode : lecture des points d'entrée de chaque route, suivi
de la donnée depuis la source jusqu'au point d'exécution, un constat par point
d'exécution, ligne citée textuellement et vérifiée par un examinateur
mécanique, niveau de confiance déclaré pour chacun.

- critical: 5
- high: 19
- medium: 17
- low: 7
- info: 1

## Executive summary

This review covered `/root/targets/NodeGoat` (the OWASP NodeGoat training
application), a 111-file tree locked by `target.json` (SHA-256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Six
departments each read part of the codebase (access/authentication, sensitive
data, dependencies, injection, platform, secrets), each grounded by `semgrep`
(local rules plus `p/owasp-top-ten`) and, for dependencies, by
`npm audit --json` against the live npm registry; their deduplicated union,
mechanically checked by `verify-safety-report.mjs`, holds 49 findings after 5
duplicates sharing the same file+line+CWE were merged down to one entry each
(see "What was not covered"). Among the most important: (1) server-side code
injection via `eval()` on contribution-form fields
(`app/routes/contributions.js:32`), letting any logged-in user run arbitrary
commands on the server; (2) a real administrator account, seeded at container
startup by the database-reset script, with the plaintext password `Admin_123`
(`artifacts/db-reset.js:18`); (3) user passwords stored with no hashing at all
(`app/data/user-dao.js:25`). The review covered server code, routes, views,
configuration, the dependency manifest and its lockfile, and a subset of
secret-bearing artifacts; it did not cover CI scripts, client-side vendored
packages, git history, or any dynamic test against a running instance (see
"What was not covered"). Method: read each route's entry point, trace the
data from source to sink, one finding per sink, quote the exact line, verify
it mechanically, and state a confidence level for each.

- critical: 5
- high: 19
- medium: 17
- low: 7
- info: 1

## Scope and method

Target: `/root/targets/NodeGoat`, the tree locked in `target.json` — 111
files, SHA-256 `78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`.
`verify-safety-report.mjs` re-hashed every one of those 111 files against the
lock before this report was written and found the tree unchanged.

Six departments ran, each on its own branch, each a review by a language
model grounded by a static scanner and, for one department, an advisory
database, over the files it actually read (not over the tree's full file
list):

- **access** — authentication, session handling, authorization. Read every
  file under `app/routes/` and `app/data/user-dao.js`, `server.js`,
  `config/config.js`, `config/env/all.js`. Ran `semgrep --config <local
  rules> --config p/owasp-top-ten --metrics off --json` (1.177.0, 113 rules,
  29 hits) as a pointer to files to read, not as a source of findings by
  itself.
- **data** — sensitive data exposure, logging, cryptography. Read
  `server.js`, `config/config.js`, `config/env/*.js`, every route under
  `app/routes/` and its paired DAO under `app/data/`, the Swig views those
  routes render, `artifacts/db-reset.js` and the tutorial pages. Ran the same
  semgrep configuration (29 hits, same run).
- **dependencies** — vulnerable and outdated components. Read `package.json`
  and `package-lock.json` (27,514 lines; used to determine installed versions,
  not the manifest ranges), `server.js`, `Procfile`, `app/data/user-dao.js`,
  `app/routes/profile.js`. Ran `npm audit --json` against the live npm
  registry from inside the target tree (node v22.22.2, npm 10.9.7; 1,479
  resolved packages, 145 flagged as vulnerable) and cross-checked deprecation
  notices against the npm registry's own package metadata. Ran the same
  semgrep configuration as a secondary pointer.
- **injection** — SQL/NoSQL/command/template injection, XSS, path traversal,
  SSRF, log injection, ReDoS. Read `server.js`, every file under
  `app/routes/` and `app/data/`, the views `memos.html`, `profile.html`,
  `login.html`, `allocations.html`, `dashboard.html`, `research.html`,
  `config/config.js`, `package.json`/`package-lock.json` (for the `marked`
  version), and `test/security/profile-test.js`. Ran the same semgrep
  configuration (21 hits read in context).
- **platform** — security misconfiguration and the web platform. Read
  `server.js` end to end, `config/config.js`, every file under
  `config/env/`, every route handler, `app/views/error-template.html`,
  `package.json`, `Dockerfile`, `docker-compose.yml`. Ran the same semgrep
  configuration (113 rules, 29 hits).
- **secrets** — credentials and leaked configuration. Read
  `config/env/all.js`, `config/env/development.js`, `config/env/test.js`,
  `config/config.js`, `artifacts/db-reset.js`, `artifacts/cert/server.key`
  and `server.crt`, `server.js`, `package.json`, `docker-compose.yml`,
  `app.json`, `Procfile`, `.travis.yml`, both `.github/workflows/*.yml`
  files, `.dockerignore`, `.gitignore`, `test/e2e/fixtures/users/*.json`, and
  `test/security/profile-test.js`. Ran the same semgrep configuration and
  traced its `dsh-hardcoded-secret` hits.

The integration (this document) merged the six `findings/<department>.json`
files, asked the mechanical examiner which findings it could not verify —
`node verify-safety-report.mjs --findings <file> --list-invalid` printed no
id for any of the six files, so none were dropped for failing verification —
deduplicated the union by `file` + `line` + `cwe` per `REPORTING.md` (5 pairs
shared a key; see "What was not covered" for which id was dropped from each
pair and why), and wrote this report and `findings.json` over that union. No
department wrote into the target tree; `verify-safety-report.mjs` confirms
this by re-hashing it.

This review is a set of reviews by a language model, grounded by a static
scanner (`semgrep`, both a local rule pack and the `p/owasp-top-ten` registry
pack) and, for the dependencies department, by `npm audit` against the live
advisory database, and checked mechanically by the committed examiner,
`verify-safety-report.mjs`. It reports what the six departments actually
read, listed above file by file — not an audit of every file `target.json`
lists as present in the tree.

## Findings

### critical

- `access-plaintext-password-storage` — User passwords are stored in plaintext instead of being hashed (`app/data/user-dao.js:25`, CWE-916, confirmed) — any read access to the users collection discloses every password in the clear; hash with bcrypt before insert.
- `dependencies-mongodb-driver` — MongoDB driver pinned to a version with critical bson deserialization and DoS advisories (`package.json:18`, CWE-1357, confirmed) — a malformed BSON document can crash the process or be exploited via the critical bson deserialization advisory; upgrade the mongodb dependency.
- `dependencies-swig-template-engine` — swig template engine is unmaintained since 2014 and has an unfixed arbitrary file read advisory (`package.json:22`, CWE-1104, confirmed) — an attacker who can influence a template can read arbitrary server files, with no upstream fix ever coming; replace the engine.
- `injection-eval-contributions` — Server-side code injection via eval() of request body fields in contribution update (`app/routes/contributions.js:32`, CWE-95, confirmed) — any logged-in user can achieve full remote code execution as the Node process; parse the values with parseInt instead of eval.
- `secrets-db-reset-admin-password` — Live admin account is seeded with a hard-coded plaintext password by the database reset script (`artifacts/db-reset.js:18`, CWE-798, confirmed) — any deployment that ran the standard bootstrap has a working admin/Admin_123 account; never insert a literal password for a privileged account.

### high

- `access-idor-allocations` — Allocations page loads any user's data from a URL parameter with no ownership check (`app/routes/allocations.js:16`, CWE-639, confirmed) — any authenticated user can read another user's allocation records; take userId from the session, not the URL.
- `access-missing-authz-benefits` — Benefits admin routes require only login, not the admin role (`app/routes/index.js:56`, CWE-862, confirmed) — any user can view and overwrite any other user's benefits; mount the existing isAdmin middleware.
- `data-cleartext-http-server` — Application serves the entire site, including login and PII, over plain HTTP (`server.js:145`, CWE-319, confirmed) — a network intermediary can read or tamper with credentials and PII in transit; enable the existing commented-out HTTPS path.
- `data-password-stored-plaintext` — User passwords are stored in MongoDB as plaintext (`app/data/user-dao.js:25`, CWE-256, confirmed) — same root cause and fix as the plaintext-storage finding above, cited under a data-exposure CWE.
- `data-pii-stored-plaintext` — SSN, date of birth and bank account/routing numbers are stored in the database unencrypted (`app/data/profile-dao.js:55`, CWE-312, confirmed) — a database compromise discloses SSNs and bank numbers in the clear; re-enable the existing (commented-out) field-level encryption.
- `data-pii-in-cleartext-response` — SSN and bank account/routing numbers are rendered into the profile page served over the same unencrypted HTTP connection (`app/views/profile.html:47`, CWE-319, confirmed) — those specific high-value fields cross the network in the clear on every profile view; serve over HTTPS and mask displayed values.
- `dependencies-underscore` — underscore resolves to a version with a critical template arbitrary-code-execution advisory (`package.json:23`, CWE-1357, likely) — if any code path calls underscore's template() on attacker input this is RCE; bump to >=1.13.8.
- `dependencies-body-parser` — body-parser and its bundled qs carry DoS and prototype-pollution advisories on every request (`package.json:9`, CWE-1357, confirmed) — a crafted body or query string can exhaust resources or pollute Object.prototype; upgrade to >=1.20.6.
- `dependencies-express` — Express and its bundled routing/parsing dependencies carry 16 known advisories (`package.json:13`, CWE-1357, confirmed) — ReDoS and open-redirect/XSS advisories reachable on ordinary routes; upgrade to >=4.21.2.
- `dependencies-marked` — marked is pinned to an exact version whose sanitize option is the one a known advisory bypasses (`package.json:17`, CWE-1357, confirmed) — the app's only defense against markdown XSS is the option the advisory defeats; move to a maintained version plus a dedicated sanitizer.
- `dependencies-forever` — Production process supervisor forever bundles a critical prototype-pollution advisory (`package.json:15`, CWE-1321, likely) — forever runs the production server and bundles a vulnerable minimist/nconf subtree; upgrade to >=4.0.3.
- `dependencies-grunt` — Build tool grunt, run by npm test/precommit/db:seed, has its own arbitrary-code-execution advisory (`package.json:45`, CWE-1357, confirmed) — a CI/build-time risk on every contributor and CI machine; upgrade to >=1.6.1.
- `injection-nosql-where-allocations` — NoSQL injection via string-built MongoDB $where clause in allocations threshold search (`app/data/allocations-dao.js:78`, CWE-943, confirmed) — an authenticated user can bypass the filter or hang the database; build the query with $gt instead of interpolating into $where.
- `injection-ssrf-research` — SSRF: server-side HTTP GET to a URL built entirely from query-string parameters (`app/routes/research.js:15`, CWE-918, confirmed) — any logged-in user can pivot the server into internal hosts or the cloud metadata service; fix the outbound host server-side.
- `injection-redos-bank-routing` — Catastrophic-backtracking regular expression applied to request body field bankRouting (`app/routes/profile.js:61`, CWE-1333, confirmed) — a crafted digit string pins the event loop and denies service to every user; remove the nested quantifier.
- `injection-stored-xss-memos` — Stored XSS: memo body is Markdown-rendered and output unescaped to every user (`app/views/memos.html:31`, CWE-79, likely) — a payload that evades marked's sanitize option executes for every user who opens memos; sanitize with a maintained HTML sanitizer.
- `platform-session-cookie-flags` — Session cookie is configured with no httpOnly, secure or sameSite, and keeps the default express-session name (`server.js:78`, CWE-1004, confirmed) — the session cookie can be exfiltrated over the network or via script and replayed; add the cookie flags and a custom name.
- `platform-template-autoescape-disabled` — Swig template auto-escaping is disabled application-wide (`server.js:135`, CWE-79, confirmed) — any user-influenced template value renders as raw HTML/JS across the whole app, not one route; remove the autoescape:false override.
- `secrets-cookie-secret-hardcoded` — Express session signing secret is a hard-coded literal shipped as the production default (`config/env/all.js:8`, CWE-798, confirmed) — anyone who reads the repository can forge signed session cookies against any instance that did not override it; read the secret from the environment with no hard-coded fallback.

### medium

- `access-session-fixation-login` — Login does not regenerate the session id, so a pre-login session id survives authentication (`app/routes/session.js:116`, CWE-384, confirmed) — an attacker who fixes a victim's pre-login session id inherits an authenticated session; call req.session.regenerate() on login as signup already does.
- `access-weak-password-policy` — Signup password validator accepts any 1-to-20-character string, including a single character (`app/routes/session.js:144`, CWE-521, confirmed) — trivially guessable passwords are accepted; enable the stronger commented-out rule.
- `access-missing-csrf` — CSRF middleware is never mounted, leaving every state-changing route unprotected (`server.js:107`, CWE-352, confirmed) — a cross-site form submit can change profile, contributions, benefits or memos data using the victim's session; mount csurf before the routes.
- `access-session-cookie-flags` — Session cookie is configured with no HttpOnly, no Secure and no expiry (`server.js:78`, CWE-614, confirmed) — the cookie is readable by script and sent unencrypted, and never expires; enable the commented-out cookie block and serve over HTTPS.
- `access-no-login-rate-limit` — Login route has no rate limiting, attempt counter or lockout (`app/routes/session.js:58`, CWE-307, confirmed) — unlimited brute-force and credential-stuffing attempts against any username; add a per-account rate limiter.
- `data-config-secrets-logged` — Session cookie secret and crypto key are printed to stdout on every startup (`config/config.js:13`, CWE-532, confirmed) — anyone with log access recovers the signing secret and crypto key; remove the console.log of the resolved config.
- `dependencies-bcrypt-nodejs` — The password-hashing library bcrypt-nodejs is deprecated and unmaintained since 2013 (`package.json:8`, CWE-1104, confirmed) — no known CVE, but the sole password-hashing library will never receive a fix if one is found; migrate to bcrypt or bcryptjs.
- `dependencies-node-esapi` — node-esapi, used for output encoding, has had a single release since 2014 (`package.json:20`, CWE-1104, confirmed) — an unmaintained encoding dependency with no ongoing review; replace with a maintained encoder.
- `dependencies-cypress` — Test tool cypress rolls up 43 transitive advisories, including a critical one (`package.json:44`, CWE-1357, likely) — exposure is limited to developer/CI machines running the test suite; upgrade to a current major.
- `injection-open-redirect-learn` — Open redirect: /learn forwards to a URL taken directly from the query string (`app/routes/index.js:72`, CWE-601, confirmed) — aids phishing by redirecting from a trusted domain; validate the destination against an allowlist.
- `injection-reflected-xss-allocations-userid` — Reflected XSS: route parameter userId echoed unescaped into a form action attribute (`app/views/allocations.html:15`, CWE-79, confirmed) — a crafted path segment executes script in the victim's browser; enable autoescape and validate the parameter.
- `platform-missing-security-headers` — Helmet and all security-header middleware are commented out (`server.js:10`, CWE-693, confirmed) — no CSP, no X-Frame-Options, no HSTS, no nosniff on any response; mount helmet before the routes.
- `platform-error-stack-exposure` — Global error handler renders the raw Error object to the client (`app/routes/error.js:10`, CWE-209, confirmed) — internal error messages reach the response unescaped, and can become an XSS vector; render a generic message and log the full error server-side only.
- `platform-no-rate-limit-auth` — No rate limiting on the login or signup endpoints (`app/routes/index.js:33`, CWE-307, likely) — brute-force and account-enumeration/flooding with no server-side throttling; add a rate limiter in front of both routes.
- `platform-verbose-config-logging` — Full application config, including the session cookie secret, is logged to stdout on every start (`config/config.js:12`, CWE-532, confirmed) — the signing secret and crypto key land in every deployment's log output; remove or redact the console.log.
- `platform-csrf-disabled` — CSRF protection is fully commented out (`server.js:7`, CWE-352, confirmed) — every state-changing POST route accepts cross-site requests backed only by the ambient session cookie; mount csurf and validate its token on every form.
- `secrets-committed-rsa-private-key` — TLS private key material is committed to the repository (`artifacts/cert/server.key:1`, CWE-321, confirmed) — a deployment that follows the app's own in-repo "fix" would serve TLS with a key every reader already has; remove it from the repository and its history and generate material per deployment.

### low

- `access-account-enumeration-login` — Login failure branches render a different error message for an unknown username than for a wrong password (`app/routes/session.js:85`, CWE-204, confirmed) — lets an attacker enumerate valid usernames; render the same generic message for both branches.
- `access-nonconstant-time-password-compare` — Password comparison uses a plain string equality check instead of a constant-time compare (`app/data/user-dao.js:61`, CWE-208, confirmed) — a theoretical timing side channel on password comparison; use bcrypt.compareSync against a hashed password.
- `dependencies-express-session` — express-session's bundled cookie and on-headers packages carry low-severity advisories (`package.json:14`, CWE-1357, confirmed) — low-severity cookie-parsing and header-manipulation issues in bundled dependencies; upgrade express-session.
- `dependencies-csurf` — csurf is archived upstream and installed but disabled in this codebase (`package.json:11`, CWE-1104, confirmed) — no active runtime risk today since it is disabled, but re-enabling it verbatim would reintroduce an unmaintained package; remove it or replace with a maintained alternative.
- `dependencies-helmet` — helmet is declared 6 majors out of date and is installed but disabled in this codebase (`package.json:16`, CWE-1104, confirmed) — the intended security headers are not applied by any currently active code; upgrade to the current major if re-enabled.
- `injection-log-forging-login` — Unauthenticated user-supplied username written to logs without neutralizing control characters (`app/routes/session.js:64`, CWE-117, confirmed) — CRLF injection can forge log lines; strip or encode control characters before logging.
- `secrets-e2e-fixture-admin-password` — Cypress e2e test fixture hard-codes the same admin credential the app seeds live (`test/e2e/fixtures/users/admin.json:3`, CWE-798, confirmed) — discloses the real default credential to anyone reading the test fixture; generate the seeded password randomly and have the fixture read it from the same source.

### info

- `secrets-crypto-key-hardcoded-unused` — Hard-coded AES key literal shipped in config, not currently wired into any executing code path (`config/env/all.js:9`, CWE-321, confirmed) — no exploit path today since no reachable code reads it, but it becomes a live hardcoded key the moment the commented-out encryption block is re-enabled; delete the literal now.

## What was not covered

- **Deduplicated away, not a coverage gap** — five findings shared the exact
  `file` + `line` + `cwe` triplet as another department's finding, both at
  `confirmed` confidence, so `findings.json` keeps one entry per triplet per
  `REPORTING.md`'s dedup rule:
  - `data-session-cookie-insecure-flags` — identical to
    `access-session-cookie-flags` at `server.js:78` (CWE-614); the access
    department's entry is kept.
  - `platform-cleartext-http` — identical to `data-cleartext-http-server` at
    `server.js:145` (CWE-319); the data department's entry is kept.
  - `platform-session-fixation-login` — identical to
    `access-session-fixation-login` at `app/routes/session.js:116` (CWE-384);
    the access department's entry is kept.
  - `platform-open-redirect-learn` — identical to
    `injection-open-redirect-learn` at `app/routes/index.js:72` (CWE-601);
    the injection department's entry is kept.
  - `secrets-config-logged-to-console` — identical to
    `platform-verbose-config-logging` at `config/config.js:12` (CWE-532); the
    platform department's entry is kept.
- **No finding was dropped for failing verification.** Running
  `node verify-safety-report.mjs --findings <file> --list-invalid` against
  each of the six department files printed no id; every submitted finding
  resolved against the locked tree.
- **Client-side and vendored code** — `app/assets/vendor/` (jQuery, Bootstrap,
  the Morris/Raphael chart libraries) and `app/assets/js/` were, at most,
  grepped for secret literals by the secrets department; no department
  reviewed them for DOM-based XSS sinks, outdated-library CVEs, or telemetry
  behavior, and the injection department states this explicitly.
- **Binary and font assets** (`app/assets/favicon.ico`, the PNG logos, the
  FontAwesome font files) were not opened by any department; they carry no
  reviewable source text.
- **CI and build tooling** — `.github/workflows/*.yml`, `.travis.yml`,
  `Gruntfile.js`, `cypress.json`, and `nodemon.json` were, at most, matched
  by semgrep (mutable GitHub Actions tags) and read only far enough by the
  access/platform/injection departments to judge the hits out of their own
  scope; no department claimed CI/CD pipeline security as its own beat, so
  it was not written up.
- **End-to-end and integration test specs** under `test/e2e/integration/`,
  `test/e2e/support/`, and `test/e2e/plugins/` were not opened by any
  department; only the credential fixtures under
  `test/e2e/fixtures/users/` were read, by the secrets department.
- **Repository metadata and docs** — `README.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `LICENSE`, `.dockerignore`, `.gitignore`,
  `.jshintignore`, `.jshintrc` were not reviewed; they carry no application
  behavior.
- **Git history** was not scanned by any department: this program reviews
  only the tree `target.json` locks, so a secret rotated or removed in an
  earlier commit but still reachable via `git log` or loose blobs would not
  be caught here (the secrets department states this explicitly).
- **`package-lock.json`'s full transitive graph** (27,514 lines) was used to
  resolve installed versions and was grepped for connection strings and
  tokens, but was not read line by line; 131 transitive vulnerable packages
  `npm audit` also flagged were rolled up under the direct dependency that
  pulls each in rather than given individual findings, and non-`grunt`/
  `cypress` devDependencies with advisories (`async`, `jshint`, `mocha`,
  `nodemon`, `selenium-webdriver`, `zaproxy`, several `grunt-*` plugins) were
  read in `npm audit`'s output but not written up individually, per the
  dependencies department's own scoping choice.
- **No native or binary code was audited.** `bcrypt-nodejs`'s native
  bindings and `mongodb`'s native bson extension were treated as advisory
  lookups against their JavaScript package identity, not as memory-safety
  review of compiled code.
- **No dynamic testing was performed against a running instance.** Every
  finding here is a static-source claim; nothing confirms these code paths
  behave the same way, or are reachable the same way, once deployed behind a
  real reverse proxy, WAF, or load balancer, and `config/env/production.js`
  is an empty `module.exports = {}` in this tree, so no production-specific
  override was assumed or checked.
- **Business-logic and financial-correctness defects** (e.g., whether the
  contributions/benefits/allocations arithmetic is correct once the `eval`
  and access-control bugs are fixed, beyond the injection and IDOR issues
  already reported) were not assessed; that class of defect has no owning
  department in this review.
- **Race conditions and TOCTOU issues** were not checked by any department;
  no department's brief names this class, and none of the six read the code
  with concurrency in mind.
- **The `marked@0.3.5` `sanitize: true` bypass** cited in
  `injection-stored-xss-memos` was reasoned about from the advisory
  description, not proven with a working payload against this codebase; that
  finding is marked `likely`, not `confirmed`, for exactly this reason.
- **`grunt-if`'s GitHub-tarball dependency** (`package.json:51`,
  `tarball/master`, a floating, unpinned reference) was noted by the
  dependencies department as a supply-chain concern but not written up as a
  finding, since neither `npm audit` nor the registry carry version/advisory
  data for a tarball dependency to cite evidence against.
- **The ZAP API key** in `config/env/development.js:6` and
  `config/env/test.js:6` was traced by the secrets department to a
  local-only ZAP proxy used for security-regression testing, with no path to
  the production application or an external service, and was judged not to
  be a finding rather than silently dropped.
- Only one static analysis tool (`semgrep`, two rule packs) and one advisory
  source (`npm audit` against the npm registry) were run; no additional SAST
  engine (e.g. CodeQL), no DAST scanner, and no fuzzer were used.

## Certificate

Verified findings: 49
Target tree: 78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3

`verify-safety-report.mjs --report` mechanically checked that every one of
the 49 findings in `findings.json` resolves to a real file and an existing
line in the locked target tree above (re-hashed against `target.json` at
verification time), that every finding id is unique, and that no two
findings share `file`, `line` and `cwe`.

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".

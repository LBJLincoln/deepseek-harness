## Résumé exécutif

Cette revue a porté sur OWASP NodeGoat (`/home/user/targets/NodeGoat`), une application
Express.js de démonstration, verrouillée à 111 fichiers (sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Six équipes ont chacune
lu une partie du code source — accès et sessions, exposition de données, dépendances,
injection, plateforme/configuration, et secrets — et ont produit 46 constats au total ;
après déduplication par fichier, ligne et CWE (voir ci-dessous), l'union en retient 42 :
5 critiques, 17 élevés, 13 moyens, 5 faibles et 2 informatifs. Les trois constats les plus
importants : (1) une injection de code côté serveur via `eval()` sur les champs du
formulaire de cotisations, permettant une exécution de code arbitraire dans le processus
serveur (`app/routes/contributions.js:32`) ; (2) un mot de passe administrateur par défaut,
codé en dur et effectivement inséré dans la base de données à chaque déploiement
(`artifacts/db-reset.js:18`) ; (3) une combinaison d'un secret de signature de cookie de
session codé en dur (`config/env/all.js:8`), d'une absence totale de TLS
(`server.js:145`) et de l'absence des attributs `secure`/`sameSite` sur le cookie de
session (`server.js:78`), qui ensemble permettent la falsification et l'interception de
toute session, y compris administrateur. La revue a couvert les points d'entrée HTTP,
l'authentification, les autorisations, le stockage des données, la configuration serveur
et les dépendances déclarées ; elle n'a pas couvert le JavaScript côté client, l'historique
Git, les tests dynamiques contre une instance en cours d'exécution, ni l'intégralité des
dépendances transitives (voir « What was not covered »). Méthode : lecture des points
d'entrée, suivi des données de la source jusqu'au point d'exécution, un constat par point
d'exécution, ligne exactement citée et vérifiée mécaniquement, et niveau de confiance
déclaré pour chacun ; `npm audit` a servi de socle pour les dépendances, et aucun autre
outil automatisé n'a pu être exécuté dans les sessions des six équipes.

- critical: 5
- high: 17
- medium: 13
- low: 5
- info: 2

## Executive summary

This review covered OWASP NodeGoat (`/home/user/targets/NodeGoat`), a deliberately
vulnerable Express.js training application, locked at 111 files (sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Six departments each
read a slice of the source — access/session, data exposure, dependencies, injection,
platform/configuration, and secrets — and produced 46 findings in total; after
deduplicating by file, line and CWE (see below), the union keeps 42: 5 critical, 17 high,
13 medium, 5 low and 2 info. The three most important findings: (1) server-side code
injection via `eval()` on the contributions form fields, giving arbitrary code execution
in the server process (`app/routes/contributions.js:32`); (2) a hard-coded default admin
password that is actually seeded into the live database on every deployment
(`artifacts/db-reset.js:18`); (3) a hard-coded session-cookie signing secret
(`config/env/all.js:8`) combined with no TLS at all (`server.js:145`) and a session
cookie with no `secure`/`sameSite` attributes (`server.js:78`), which together let an
attacker forge or intercept any session, including an administrator's. The review covered
HTTP entry points, authentication, authorization, data storage, server configuration and
declared dependencies; it did not cover client-side JavaScript, git history, dynamic
testing against a running instance, or every transitive dependency (see "What was not
covered"). Method: read entry points, trace data from source to sink, one finding per
sink, cite the exact line and have it mechanically re-verified, and state a confidence
level for each; `npm audit` grounded the dependency findings, and no other automated
scanner was available in any of the six departments' sessions.

- critical: 5
- high: 17
- medium: 13
- low: 5
- info: 2

## Scope and method

Target: `/home/user/targets/NodeGoat`, locked by `target.json` to 111 files (`.git`
excluded), sha256 `78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`. The
target is read-only for this program; `verify-safety-report.mjs` re-hashes every locked
file on every run and refuses a tree that changed since the lock, and it re-hashed clean
for this integration.

All six departments committed on their own branch and ran: **access** (authentication,
session handling, authorization — CSRF, IDOR, session fixation, rate limiting), **data**
(sensitive data exposure, logging, cryptography), **dependencies** (manifest/lockfile
audit), **injection** (SQL/NoSQL/code injection, XSS, SSRF, open redirect, path
traversal), **platform** (headers, TLS, cookies, error handling, misconfiguration), and
**secrets** (hard-coded credentials and keys). Every department's own report states that
`semgrep` was not on `PATH` in its session, so no static-analysis scanner ran anywhere
except the **dependencies** department, which ran `npm audit --json` directly against
`package.json`/`package-lock.json` (registry-backed, no fallback needed) and two read-only
`npm view <pkg> deprecated` lookups. No department started or exercised a running instance
of the application; every finding is a static read of the source as committed, traced from
an HTTP entry point (or, for dependencies, a manifest line) through to the cited sink line.
Every department's own findings file was checked with `node verify-safety-report.mjs
--findings findings/<department>.json` before commit and passed with zero invalid
findings when re-run for this integration (see "What was not covered" for the
deduplication this integration additionally applied). This report is itself a review
written by a language model, grounded by the departments' manual reading, by `npm audit`
for the dependency findings, and by the committed mechanical examiner
`verify-safety-report.mjs`, which re-hashes the target and validates every citation before
this report — and `findings.json` — are accepted. See the review-method discipline: read
entry points first, trace data from source to sink, one finding per sink, quote the exact
line, prefer confirmed findings, and state what was not covered.

Files actually read, in full, across the six departments (union): `server.js`;
`config/config.js` and every file under `config/env/`; every file under `app/routes/`
(`index.js`, `allocations.js`, `benefits.js`, `contributions.js`, `error.js`, `memos.js`,
`profile.js`, `research.js`, `session.js`, `tutorial.js`); every file under `app/data/`
(`allocations-dao.js`, `benefits-dao.js`, `contributions-dao.js`, `memos-dao.js`,
`profile-dao.js`, `research-dao.js`, `user-dao.js`); the views that render request- or
database-derived values (`app/views/layout.html`, `dashboard.html`, `profile.html`,
`benefits.html`, `allocations.html`, `memos.html`, `error-template.html`, `login.html`,
`signup.html`); `artifacts/db-reset.js`, `artifacts/cert/server.key`,
`artifacts/cert/server.crt`; `package.json` and `package-lock.json`; `Procfile`,
`Gruntfile.js`, `Dockerfile`, `docker-compose.yml`, `app.json`, `nodemon.json`; and
`test/security/profile-test.js` and `test/e2e/fixtures/users/*.json` (opened only far
enough to confirm they are test fixtures, not production secrets).

## Findings

### critical

- `dependencies-mongodb` — mongodb driver (^2.1.18, resolved 2.2.36) pulls a critical bson deserialization flaw with no non-major fix (`package.json:18`, CWE-502, confirmed)
- `dependencies-swig` — swig template engine (^1.4.2, resolved 1.4.2) has an unpatched arbitrary local file read and is itself deprecated (`package.json:22`, CWE-22, confirmed)
- `dependencies-underscore` — underscore (^1.8.3, resolved 1.9.1) is in the arbitrary-code-execution range with a non-major fix available (`package.json:23`, CWE-94, confirmed)
- `injection-002` — server-side code injection via eval() of the contributions form fields (`app/routes/contributions.js:32`, CWE-95, confirmed)
- `secrets-db-reset-admin-password` — hard-coded admin password is seeded into the live user database and accepted as a plaintext credential (`artifacts/db-reset.js:18`, CWE-798, confirmed)

### high

- `access-idor-allocations` — allocations page loads any user's financial data from a URL parameter with no ownership check (`app/routes/index.js:63`, CWE-639, confirmed)
- `access-benefits-post-no-admin-check` — any logged-in user can change any other user's benefits start date; the admin-only check is defined but never applied (`app/routes/index.js:56`, CWE-862, confirmed)
- `access-login-no-rate-limit` — login endpoint has no rate limiting or lockout, and the password policy permits single-character passwords (`app/routes/index.js:34`, CWE-307, confirmed)
- `data-plaintext-password-storage` — signup password is stored in the users collection with no hashing (`app/data/user-dao.js:25`, CWE-256, confirmed)
- `data-cleartext-pii-storage` — SSN, date of birth and bank account/routing numbers are stored unencrypted (`app/data/profile-dao.js:55`, CWE-312, confirmed)
- `data-config-secrets-logged` — full application config, including the cookie secret and crypto key, is printed to stdout on every start (`config/config.js:13`, CWE-532, confirmed)
- `dependencies-forever` — forever process supervisor (^2.0.0, resolved 2.0.0) carries critical prototype-pollution advisories with only a major-version fix (`package.json:15`, CWE-1321, likely)
- `dependencies-express` — express (^4.13.4, resolved 4.16.4) ships a vulnerable qs and carries its own XSS/open-redirect advisories (`package.json:13`, CWE-1321, confirmed)
- `dependencies-body-parser` — body-parser (^1.15.1, resolved 1.18.3) is in both of its own denial-of-service ranges (`package.json:9`, CWE-405, confirmed)
- `dependencies-helmet` — helmet (^2.0.0, resolved 2.3.0), the app's own hardening middleware, is itself outdated and its CSP module has a config-override advisory (`package.json:16`, CWE-1333, likely)
- `dependencies-marked` — marked is pinned to an exact, long-superseded 0.3.5 with six of its own advisories (`package.json:17`, CWE-1333, confirmed)
- `injection-001` — NoSQL injection via $where built from the unvalidated 'threshold' query parameter (`app/data/allocations-dao.js:78`, CWE-943, confirmed)
- `injection-003` — SSRF via attacker-controlled URL and symbol concatenated for the stock research proxy (`app/routes/research.js:15`, CWE-918, confirmed)
- `injection-005` — stored XSS: unsanitized profile first/last name rendered unescaped on the admin Benefits page (`app/views/benefits.html:51`, CWE-79, confirmed)
- `platform-no-tls-http-only` — server only ever listens on plain HTTP; the HTTPS listener is fully commented out (`server.js:145`, CWE-319, confirmed)
- `platform-session-cookie-no-secure-samesite` — session cookie is configured with no secure, sameSite or maxAge attributes (`server.js:78`, CWE-614, confirmed)
- `secrets-cookie-secret` — Express session signing secret is a hard-coded literal that ships unchanged to production (`config/env/all.js:8`, CWE-798, confirmed)

### medium

- `access-benefits-get-no-admin-check` — benefits listing page is reachable by any logged-in user, not only admins (`app/routes/index.js:55`, CWE-862, confirmed)
- `access-login-no-session-regenerate` — session id is not regenerated after login, enabling session fixation (`app/routes/session.js:116`, CWE-384, confirmed)
- `access-profile-no-csrf` — sensitive profile update (SSN, bank account, bank routing) has no CSRF protection anywhere in the middleware chain (`app/routes/index.js:48`, CWE-352, confirmed)
- `data-seed-passwords-logged` — database reset script logs every seed user's plaintext password (`artifacts/db-reset.js:99`, CWE-532, confirmed)
- `dependencies-grunt` — grunt (^1.0.3, resolved 1.0.3), the project's build tool, carries its own arbitrary-code-execution, race-condition and path-traversal advisories (`package.json:45`, CWE-94, confirmed)
- `dependencies-async` — async (^2.0.0-rc.4, resolved 2.6.1) is in its own prototype-pollution range (`package.json:42`, CWE-1321, confirmed)
- `injection-004` — open redirect via unvalidated 'url' query parameter on /learn (`app/routes/index.js:72`, CWE-601, confirmed)
- `injection-006` — reflected XSS via unsanitized firstName echoed into an HTML attribute on validation failure (`app/views/profile.html:41`, CWE-79, confirmed)
- `injection-007` — reflected XSS via unsanitized firstName echoed into an href attribute on validation failure (`app/views/profile.html:78`, CWE-79, confirmed)
- `platform-missing-security-headers` — Helmet hardening (CSP, frame options, MIME-sniffing protection, X-Powered-By) is imported but never mounted (`server.js:10`, CWE-693, confirmed)
- `platform-error-handler-leaks-error-object` — global error handler renders the raw caught Error object straight into the HTML response (`app/views/error-template.html:11`, CWE-209, confirmed)
- `platform-default-dev-env-debug-script` — NODE_ENV defaults to "development" and injects a live-reload debug script into every rendered page unless explicitly overridden (`config/config.js:5`, CWE-489, confirmed)
- `secrets-committed-rsa-private-key` — RSA private key for the HTTPS listener is committed to the repository (`artifacts/cert/server.key:1`, CWE-321, confirmed)

### low

- `access-timing-unsafe-password-compare` — login password comparison uses a non-constant-time string equality check (`app/data/user-dao.js:61`, CWE-208, confirmed)
- `dependencies-express-session` — express-session (^1.13.0, resolved 1.15.6) ships an outdated cookie parser with an out-of-bounds-character flaw (`package.json:14`, CWE-74, confirmed)
- `dependencies-csurf` — csurf (^1.8.3, resolved 1.9.0) is archived upstream and shares the same vulnerable cookie parser as express-session (`package.json:11`, CWE-74, confirmed)
- `dependencies-bcrypt-nodejs` — bcrypt-nodejs, used for password hashing, is explicitly unmaintained on the registry (`package.json:8`, CWE-1104, confirmed)
- `secrets-zap-api-key` — OWASP ZAP API key for the regression-test proxy is hard-coded in the test/development config (`config/env/development.js:6`, CWE-798, confirmed)

### info

- `dependencies-devtooling-aggregate` — ten more devDependencies (cypress, mocha, nodemon, selenium-webdriver, jshint, zaproxy and five grunt plugins) carry further advisories, all build/test-time only (`package.json:44`, CWE-1104, possible)
- `secrets-crypto-key-dead-code` — hard-coded AES key is shipped in config even though the code that would use it is currently disabled (`config/env/all.js:9`, CWE-321, confirmed)

## What was not covered

- **Every finding the six departments proposed passed the mechanical examiner.** Running
  `node verify-safety-report.mjs --findings <file> --list-invalid` for each of
  `findings/access.json`, `findings/data.json`, `findings/dependencies.json`,
  `findings/injection.json`, `findings/platform.json` and `findings/secrets.json` printed
  no ids; nothing was dropped for failing mechanical verification.
- **Four findings were dropped as exact duplicates during the union**, deduplicated by
  `file` + `line` + `cwe` per the reporting contract. In every case both entries carried
  `confidence: confirmed`, so the tie was broken by which department's own stated scope
  owns that class of issue (or, where scope was equal, by keeping the higher-severity
  assessment):
  - `data-hardcoded-cookie-secret` — duplicate of `secrets-cookie-secret` at
    `config/env/all.js:8` (CWE-798); kept under `secrets`, the department that owns
    credential exposure.
  - `data-cleartext-http-transport` — duplicate of `platform-no-tls-http-only` at
    `server.js:145` (CWE-319); kept under `platform`, whose own report states it covers
    "the session cookie's transport-level configuration (flags, TLS)".
  - `data-error-object-to-client` — duplicate of
    `platform-error-handler-leaks-error-object` at `app/views/error-template.html:11`
    (CWE-209); both departments read the same file and route, so the higher-severity
    assessment (medium, vs. data's low) was kept.
  - `platform-login-no-rate-limit` — duplicate of `access-login-no-rate-limit` at
    `app/routes/index.js:34` (CWE-307); kept under `access`, which owns
    authentication/brute-force per its own scope.
- **No department ran a static-analysis scanner.** Every department's own report states
  `semgrep` was not on `PATH` in its session; all findings except the `dependencies`
  department's rest on manual reading alone, not a pattern-matching tool's output.
- **No secrets scanner and no git-history scan.** `gitleaks`/`trufflehog` were not run, and
  no department scanned prior commits (`git log -p`) for a secret that may have been
  rotated out of the working tree; the `secrets` department's own report states this
  explicitly. If any credential above was ever rotated, an older value could still exist
  in history that this review does not confirm the absence of.
- **Client-side/DOM-based JavaScript was not reviewed.** `app/assets/js/*` and the vendor
  bundles (`jquery.min.js`, `bootstrap.js`, `morris-0.4.3.min.js`, `raphael-min.js`,
  `bootstrap-tour.js`, `html5shiv.js`) were not read for DOM sinks (`innerHTML`,
  `document.write`, etc.); the `injection` department's report deprioritized them as
  third-party/vendor code under "read entry points first."
- **No dynamic or runtime testing.** No department started the application or exercised it
  over HTTP; every finding is a static read of the source as committed, not an observed
  response from a live server. Whether `NODE_ENV=production` actually suppresses the
  verbose logging and debug-script findings in a real deployment was not confirmed
  dynamically.
- **Dependency coverage is partial by design.** The `dependencies` department grouped 145
  raw `npm audit` advisories by the 24 direct dependencies that pull them in and wrote 14
  findings; the remaining ~121 transitive-only advisories are counted in each finding's
  evidence but not individually opened or cited, and `npm audit fix` was never run against
  the read-only target. Reachability from application code was traced only for `marked`
  (no call site found under `app/`); it was not re-traced for every other flagged package.
- **Infrastructure and CI/CD beyond specific checks were not reviewed.** `Dockerfile` was
  checked only for a non-root user (`USER $USER`, `Dockerfile:17`) and
  `docker-compose.yml` only for how `NODE_ENV` is passed through
  (`docker-compose.yml:7`); base-image currency (`node:12-alpine`), the GitHub Actions
  workflows under `.github/workflows/`, and `.travis.yml` were not read for
  pipeline-injection or artifact-tampering risks by any department.
- **File uploads and source maps do not apply** to this codebase (no upload endpoint, no
  bundler/build step producing `.map` files) and were confirmed absent rather than
  investigated further.
- **`/tutorial/*` pages and dead code** (`app/data/research-dao.js`'s unused
  `getBySymbol`, the tutorial router mounted with no `isLoggedIn` check) were read and
  deliberately not filed, since they serve only static instructional content with no user
  data or state change.
- **No department owns denial-of-service or resource-exhaustion analysis** as a first-class
  class of defect beyond what dependency advisories happen to mention (e.g. the `marked`
  and `body-parser` ReDoS/DoS advisories); no load testing or algorithmic-complexity review
  of first-party code was performed.
- **No department reviewed the MongoDB server's own configuration** (authentication,
  network exposure, `$where` execution being enabled at all) beyond the application code
  that queries it; NodeGoat has no MFA implementation anywhere in the codebase, so nothing
  could be checked under that heading either.

## Certificate

Verified findings: 42
Target tree: 78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3

`verify-safety-report.mjs` mechanically checked, after this report and `findings.json` were
written, that every one of the 42 findings resolves to a real file and line in the tree
locked above (re-hashed on this run), that every id is unique, and that no two findings
share `file`, `line` and `cwe`.

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".

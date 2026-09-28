## Résumé exécutif

Cette revue intègre les travaux de six départements (accès, données, dépendances,
injection, plateforme, secrets) sur NodeGoat, une application Express.js/MongoDB
volontairement vulnérable, dans l'arbre verrouillé `/root/targets/NodeGoat`
(111 fichiers, sha256 `78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`).
Chaque département a lu ses points d'entrée, tracé les données depuis leur
source jusqu'à leur point d'exécution, et déclaré un niveau de confiance par
constat ; cette intégration a fusionné les six listes, dédupliqué les constats
partageant fichier, ligne et CWE, puis vérifié chaque constat conservé avec
l'examinateur mécanique `verify-safety-report.mjs`. Le résultat final compte
49 constats uniques : 9 critiques, 16 élevés, 15 moyens et 9 faibles. Les plus
importants : (1) un secret de signature de session codé en dur et jamais
surchargé en production (`config/env/all.js:8`) ; (2) des mots de passe stockés
et comparés en texte clair (`app/data/user-dao.js:25`) ; (3) une injection NoSQL
critique via l'opérateur MongoDB `$where` alimenté par un paramètre de requête
non validé (`app/data/allocations-dao.js:78`) ; (4) une exécution de code
arbitraire côté serveur via trois appels `eval()` sur le corps d'une requête
(`app/routes/contributions.js:32`) ; (5) un mot de passe administrateur en
clair, seedé au démarrage de tout déploiement (`artifacts/db-reset.js:18`).

La revue a couvert `server.js`, `app/routes/`, `app/data/`, `app/views/`,
`config/`, `artifacts/db-reset.js`, `artifacts/cert/`, `package.json` et
`package-lock.json` ; elle n'a pas couvert le comportement d'exécution réel,
l'infrastructure de déploiement, l'historique Git, ni les paquets tiers
vendorisés sous `app/assets/vendor/` (détails complets sous « Ce qui n'a pas
été couvert »). Six constats ont été retirés de l'union parce qu'ils
dupliquaient, au sens strict fichier+ligne+CWE, un constat déjà conservé d'un
autre département ; aucun constat n'a été rejeté par l'examinateur mécanique
lui-même. Cette revue ne certifie en aucun cas que NodeGoat est sûr ou exempt
de vulnérabilités : elle certifie uniquement que chaque constat listé existe,
mécaniquement vérifié, à la ligne citée.

- critical: 9
- high: 16
- medium: 15
- low: 9
- info: 0

## Executive summary

This review integrates the work of six departments (access, data, dependencies,
injection, platform, secrets) on NodeGoat, a deliberately vulnerable
Express.js/MongoDB application, over the locked tree at
`/root/targets/NodeGoat` (111 files, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`). Each
department read its own entry points, traced data from source to sink, and
recorded a confidence level per finding; this integration merged the six
lists, deduplicated findings sharing file, line and CWE, and mechanically
re-verified every kept finding with `verify-safety-report.mjs`. The result is
49 unique findings: 9 critical, 16 high, 15 medium, 9 low. The most important:
(1) a session-signing secret hard-coded and never overridden in production
(`config/env/all.js:8`); (2) passwords stored and compared in plaintext
(`app/data/user-dao.js:25`); (3) a critical NoSQL injection through MongoDB's
`$where` operator fed by an unvalidated query parameter
(`app/data/allocations-dao.js:78`); (4) server-side arbitrary code execution
via three `eval()` calls on a request body
(`app/routes/contributions.js:32`); (5) a plaintext admin password seeded on
every deployment's startup (`artifacts/db-reset.js:18`).

The review covered `server.js`, `app/routes/`, `app/data/`, `app/views/`,
`config/`, `artifacts/db-reset.js`, `artifacts/cert/`, `package.json` and
`package-lock.json`; it did not cover actual runtime behavior, deployment
infrastructure, git history, or the vendored third-party packages under
`app/assets/vendor/` (full detail under "What was not covered"). Six findings
were dropped from the union because they duplicated, strictly by file+line+CWE,
a finding already kept from another department; no finding was rejected by the
mechanical examiner itself. This review does not certify anything about
NodeGoat's overall security posture: it certifies only that each listed
finding exists, mechanically verified, at the cited line.

- critical: 9
- high: 16
- medium: 15
- low: 9
- info: 0

## Scope and method

**Target:** `/root/targets/NodeGoat`, the tree locked by `target.json`: 111
files, read-only, sha256
`78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3`. The
mechanical examiner `verify-safety-report.mjs` re-hashed every locked file
before any finding was accepted; the tree was unchanged.

**Departments that ran, on their own branch, each committing
`findings/<department>.json` and `report/<department>.md`:** access
(authentication, session, authorization), data (sensitive-data handling,
storage, logging, transport), dependencies (manifest/lockfile advisories),
injection (SQL/NoSQL, `eval`, XSS, SSRF, ReDoS, open redirect), platform
(security headers, cookies, TLS, error handling, rate limiting,
misconfiguration), and secrets (hard-coded credentials and leaked
configuration). This integration is a seventh pass: it merged the six
department findings files, asked the examiner which findings did not hold
(`node verify-safety-report.mjs --findings <file> --list-invalid` for each of
the six files — every run printed nothing, so no finding was rejected on
mechanical grounds), deduplicated the union by file+line+CWE, and wrote this
report and `findings.json`.

**Tools that ran:** `semgrep` 1.177.0, run by the access, data, injection,
platform and secrets departments with the registry pack `p/owasp-top-ten`
(and, where reachable, the program's local rule pack) against the full target
tree, every hit read in context and used to decide where to look, never
accepted as a finding on its own; `npm audit --json`, run by the dependencies
department against the target's own `package.json`/`package-lock.json` with
the npm registry reachable; manual grep for credential- and secret-shaped
patterns, run by the secrets department across the whole tree; and the
mechanical examiner `verify-safety-report.mjs`, run by every department on its
own findings file and by this integration on the merged union and on this
report.

**What was actually read**, by department: `server.js`, every file under
`app/routes/`, every `*-dao.js` under `app/data/`, the templates under
`app/views/` that those routes render (`login.html`, `profile.html`,
`memos.html`, `layout.html`, `error-template.html`, `benefits.html`),
`config/config.js` and every file under `config/env/`, `artifacts/db-reset.js`,
`artifacts/cert/server.key`, `package.json`, `package-lock.json` (via `npm
audit`), `Dockerfile`, `docker-compose.yml`, `app.json`, and
`test/security/profile-test.js`. Full per-department detail, including which
lines were read to confirm each absence of a finding, is in `report/access.md`,
`report/data.md`, `report/dependencies.md`, `report/injection.md`,
`report/platform.md` and `report/secrets.md`.

Method follows the program's `review-method` and `severity-and-evidence`
skills: entry points read first, each attacker-influenced value traced from
source to sink, one finding per sink, the exact cited line quoted and
mechanically compared against the target's own text, and a confidence level
(`confirmed`, `likely`, or `possible`) recorded per what was actually read
rather than merely pattern-matched.

## Findings

### critical

- `access-001` — Session-signing secret is a hard-coded literal used unchanged in production (`config/env/all.js:8`, CWE-798, confirmed) — Anyone who has read the source (it is the public OWASP NodejsGoat repository) can compute a validly signed session cookie for any session id, letting them forge a session and set req.session.userId to any user, including an admin, without ever authenticating. Fix: Read cookieSecret from an environment variable or secret manager at startup, generate a long random value per deployment, and rotate it; never commit the value used in production.
- `access-008` — Passwords are stored in plaintext (`app/data/user-dao.js:25`, CWE-256, confirmed) — Reading the users collection — via a database backup, a compromised operator account, or an unrelated injection bug — discloses every user's password in cleartext, enabling full account takeover across the entire user base, including admin accounts. Fix: Hash the password with bcrypt.hashSync (or argon2) at signup and verify with bcrypt.compareSync at login; never store or compare the raw password.
- `dependencies-mongodb-dos-legacy-major` — mongodb driver is pinned to a legacy 2.x range with a denial-of-service advisory that only a major upgrade fixes (`package.json:18`, CWE-400, confirmed) — This is the driver every database access in NodeGoat's DAO layer goes through; a malformed server response or crafted document on this affected code path can crash or hang the process handling the app's database connection, denying service to every user. Fix: Move off the 2.x line; the 3.x line is itself end-of-life, so plan a full driver upgrade to a current major (7.6.0) and the accompanying API changes across the DAO files.
- `dependencies-underscore-rce` — underscore is pinned to a range with a critical arbitrary-code-execution advisory (CVE-2021-23358) (`package.json:23`, CWE-94, confirmed) — If any code path renders an underscore template with attacker-influenced input, an attacker can execute arbitrary JavaScript on the server; separately, a crafted deeply-nested value passed to the affected utility functions can hang the process. Fix: Bump the declared dependency to underscore@1.13.8 or later.
- `dependencies-swig-file-read` — swig's entire published range carries an unpatched arbitrary local file read advisory (`package.json:22`, CWE-22, confirmed) — If any template path or included fragment is influenced by user input, an attacker can read arbitrary files from the server's filesystem through swig's rendering pipeline. Fix: There is no fixed version to upgrade to; migrate off swig to an actively maintained template engine (for example Nunjucks or EJS) and re-audit every template path for user influence.
- `dependencies-forever-production-legacy` — forever, declared as a production dependency, is two majors behind and carries five transitive advisories (`package.json:15`, CWE-1104, confirmed) — forever is declared in `dependencies`, not `devDependencies`, so its vulnerable chain (flatiron/broadway/nconf/optimist, which includes prototype-pollution-class issues) runs with the same privileges as the deployed application process, not just at build time. Fix: Upgrade forever to 4.0.3, which drops or updates the vulnerable transitive packages; re-verify NodeGoat's process-management usage against the intervening major-version API changes.
- `injection-nosql-where-allocations` — NoSQL injection in allocations lookup via unsanitized `threshold` interpolated into a MongoDB `$where` JS expression (`app/data/allocations-dao.js:78`, CWE-943, confirmed) — Any logged-in user can inject arbitrary JavaScript that MongoDB evaluates server-side for every allocations document, enabling boolean/blind extraction of other users' allocation records or a denial-of-service (infinite loop) against the database for all users. Fix: Never build a `$where` clause from request input. Validate `threshold` as a number (e.g. `parseInt(threshold, 10)` with a bounds check) and use a normal comparison query such as `{ userId: parsedUserId, stocks: { $gt: parsedThreshold } }` instead of `$where`.
- `injection-eval-contributions` — Server-side code injection via `eval()` on contribution percentages from the request body (`app/routes/contributions.js:32`, CWE-95, confirmed) — Any authenticated user can submit a value such as `require('child_process').execSync('id')` (or any other JavaScript) as `preTax`, `afterTax` or `roth` and have it executed by the Node.js server process, giving full remote code execution with the privileges of the application. Fix: Replace `eval(req.body.preTax)` with `parseInt(req.body.preTax, 10)` (as already sketched, but disabled, in the surrounding comment) and validate the parsed number before use; never call `eval` on request data.
- `secrets-seeded-admin-password` — Hard-coded plaintext admin password is seeded into the live database and accepted by the login route (`artifacts/db-reset.js:18`, CWE-798, confirmed) — Anyone who has read this public repository (or any deployment built from it that ran the seed/postdeploy script, e.g. the shipped docker-compose.yml and Heroku app.json) can authenticate as the isAdmin:true account with userName "admin" and password "Admin_123" with no other precondition, reaching the admin-only benefits/allocations routes and every other user's SSN, date of birth and bank account/routing data stored by the app. Fix: Never seed a real admin account with a fixed literal password; generate a random one-time password at provisioning time (or require an out-of-band reset), store only a salted hash (bcrypt.hashSync, already present but commented out in user-dao.js), and change comparePassword to bcrypt.compareSync. Rotate any account created from this script in every existing deployment.

### high

- `access-003` — Allocations page takes the target user id from the URL with no ownership check (`app/routes/index.js:63`, CWE-639, confirmed) — Any authenticated user can read any other user's stock/fund/bond allocation percentages by changing the :userId path segment, e.g. GET /allocations/2 while logged in as user 1. Fix: Read the target user id from req.session.userId instead of req.params.userId (the commented-out fix nearby in allocations.js), or explicitly reject the request when req.params.userId !== req.session.userId.
- `access-004` — Benefits routes are guarded by isLoggedIn only; the admin-role middleware is defined but never applied (`app/routes/index.js:55`, CWE-862, confirmed) — Any authenticated, non-admin user can browse /benefits and see every non-admin employee's name and benefit start date, and reach the POST handler covered by access-005. Fix: Apply the existing isAdmin middleware to both routes: app.get("/benefits", isLoggedIn, isAdmin, ...) and app.post("/benefits", isLoggedIn, isAdmin, ...), as the commented-out lines already show.
- `access-005` — Benefits update trusts a client-supplied user id to modify another user's record (`app/routes/benefits.js:30`, CWE-639, confirmed) — Any authenticated user can change any other user's benefitStartDate by POSTing a different userId in the body, independent of whichever role check is (or is not) added to the route. Fix: Inside updateBenefits, verify the acting session user is an admin (req.session.userId's user.isAdmin) before writing, rather than trusting req.body.userId for who gets modified.
- `data-002` — SSN and date of birth are persisted in cleartext despite an available encryption path (`app/data/profile-dao.js:61`, CWE-312, confirmed) — SSN and date of birth for every user are recoverable in cleartext from a database dump, backup, or any other read access to the `users` collection - both are primary identifiers for identity theft and are not protected by the encryption mechanism already present but disabled in the codebase. Fix: Re-enable the crypto.createCipheriv/createDecipheriv helpers (lines 15-40) with a random IV per record and a key loaded from a secrets manager, not the hardcoded config.cryptoKey, and use them in updateUser/getByUserId.
- `data-003` — Full application config, including the session-cookie secret and crypto key, is logged to stdout on every startup (`config/config.js:13`, CWE-532, confirmed) — Anyone who can read the application's process logs (ops staff, a log-aggregation SaaS, or an attacker who compromises log storage) obtains the express-session signing secret and the AES key in plaintext, letting them forge session cookies to impersonate any user, including admins. Fix: Remove the console.log of the full config object, or log an explicit allowlist of non-secret fields (port, hostName) instead of the whole merged object.
- `data-005` — Entire application, including login credentials and session cookies, is served only over cleartext HTTP (`server.js:145`, CWE-319, confirmed) — Anyone able to observe network traffic between a client and the server (a shared Wi-Fi, a compromised router, an ISP, or a man-in-the-middle) can read login credentials, session cookies, and every other field submitted by the app, including the SSN/DOB/bank fields from the profile form, in plaintext. Fix: Serve the app exclusively over HTTPS using the already-present artifacts/cert/server.key and server.crt, and set the session cookie's `secure: true` (and `httpOnly: true`) flag once HTTPS is enabled.
- `dependencies-express-open-redirect-xss` — express is pinned to a range with known open-redirect and response.redirect() XSS advisories, plus 14 further transitive advisories (`package.json:13`, CWE-601, confirmed) — A request handled by this app on an unpatched express in this range can be redirected to an attacker-controlled host via a malformed URL, or have attacker-controlled content reflected into a redirect response, both usable for phishing and stored/reflected XSS. Fix: Raise the declared range to at least express@4.20.0 to pick up both direct fixes; the current stable major is 5.2.1 and is the better long-term target since it also carries newer body-parser/path-to-regexp/qs.
- `dependencies-body-parser-dos` — body-parser is pinned to a range with two denial-of-service advisories, plus a transitive advisory in qs (`package.json:9`, CWE-770, confirmed) — A crafted request body can exhaust server memory or CPU (denial of service) against every route that parses a body, or silently bypass a configured body-size limit if one was set expecting enforcement. Fix: Upgrade body-parser to 1.20.6 or later within the 1.x line; upgrading express first (see the express finding) will pull a compatible, patched body-parser as well.
- `dependencies-marked-pinned-redos-xss` — marked is pinned to an exact, eleven-year-old version with six known XSS/ReDoS advisories (`package.json:17`, CWE-1333, confirmed) — Markdown rendered through this version of marked can be crafted to execute script in a viewer's browser (XSS), or to hang the rendering process with a pathological input (ReDoS) — both directly reachable wherever this app renders user-supplied markdown (for example a memo body). Fix: Unpin the version and upgrade past 4.0.10 at minimum; the current release is 18.0.14, but expect breaking API changes across that many majors and re-test every render call site.
- `dependencies-helmet-outdated-major` — helmet is pinned to a 2.x range, six majors behind, pulling in separately-vulnerable connect and helmet-csp (`package.json:16`, CWE-1357, confirmed) — The security-header middleware this app relies on ships through an outdated, separately-vulnerable dependency chain, and misses default protections added in later majors (modern CSP directives, COOP/COEP headers, and others). Fix: Upgrade the declared range to helmet@8.x and re-apply its configuration, which changed shape across the major-version jumps from 2.x.
- `injection-ssrf-research` — SSRF in stock research lookup: outbound request URL is built entirely from request query parameters (`app/routes/research.js:16`, CWE-918, confirmed) — An authenticated user can make the NodeGoat server issue arbitrary outbound HTTP requests, including to internal-only services or a cloud metadata endpoint (e.g. `http://169.254.169.254/...`), and read the response through the reflected `res.write(body)`, enabling internal network reconnaissance and potential credential theft. Fix: Never let the request choose the outbound host. Validate `req.query.url` against an allowlist of known stock-data hosts, resolve and re-check the destination IP is not link-local/private/loopback before the request, and drop the raw response passthrough.
- `injection-redos-bank-routing` — Catastrophic-backtracking regular expression applied to attacker-controlled `bankRouting` field (`app/routes/profile.js:59`, CWE-1333, confirmed) — Any authenticated user can submit a crafted `bankRouting` value in a single POST /profile request that pins the Node.js event loop at 100% CPU for seconds to minutes, causing a denial of service for every user of the shared, single-threaded server. Fix: Remove the redundant outer quantifier so the pattern is linear, e.g. `/[0-9]+#/`, or cap `bankRouting`'s length before testing it and/or run the match through a linear-time engine.
- `injection-xss-memos-marked` — Stored XSS: user-submitted memo Markdown is rendered to every user via `marked()` with autoescape disabled (`app/views/memos.html:31`, CWE-79, likely) — If `marked`'s sanitize option does not block the attacker's payload, any authenticated user can post a memo that runs JavaScript in every other user's (including an admin's) browser when they view /memos, enabling session/cookie theft or full account takeover across the user base. Fix: Do not rely on marked's deprecated `sanitize` option. Render Markdown to HTML and then pass the result through an allowlist HTML sanitizer (e.g. DOMPurify server-side) immediately before output, keeping Swig's default autoescape enabled for every other field.
- `platform-002` — Session cookie has no httpOnly, secure or sameSite flag, no maxAge, and uses the default cookie name (`server.js:78`, CWE-1004, confirmed) — The session cookie is readable by any script that runs in the page (e.g. via the stored XSS below), is sent over plain HTTP since Secure is unset, and never expires client-side; an attacker who reads or replays it can take over the victim's session. Fix: Set an explicit cookie: { httpOnly: true, secure: true, sameSite: "strict", maxAge: <value> } and a non-default key, e.g. key: "sessionId".
- `platform-003` — CSRF protection middleware is imported but never mounted, leaving state-changing routes unprotected (`server.js:7`, CWE-352, confirmed) — Any authenticated user can be tricked by a hostile page into submitting a cross-site POST to /profile, /benefits, /contributions or /memos, changing their bank account, allocations or benefits data without their consent. Fix: Uncomment app.use(csrf()) and the res.locals.csrftoken assignment, mounted before the routes that render or check the token.
- `platform-005` — Stored XSS via profile lastName, rendered unescaped on every page's navigation bar (`app/views/layout.html:75`, CWE-79, confirmed) — A user who sets a script payload as their last name gets it executed in their own browser on every subsequent page (dashboard, profile, benefits, etc.) that includes the shared layout header, until the field is changed again. Fix: Re-enable swig.setDefaults({ autoescape: true }) globally, or explicitly HTML-encode firstName/lastName (and every other user-supplied field) before interpolating them into templates.

### medium

- `access-002` — Session id is not regenerated after successful login (session fixation) (`app/routes/session.js:116`, CWE-384, confirmed) — An attacker who gets a victim's browser to carry a session id issued before login (e.g. by setting the cookie themselves, since the app is also served over plain HTTP per server.js:145) inherits the authenticated session as soon as the victim logs in with that id. Fix: Wrap the post-validation state change in req.session.regenerate(() => { req.session.userId = user._id; ... }), the same pattern already used in handleSignup at line 234.
- `access-006` — No CSRF protection on the state-changing profile-update route (and every other state-changing route) (`app/routes/index.js:48`, CWE-352, confirmed) — A page visited by an authenticated victim can auto-submit a cross-site POST to /profile that silently rewrites their bank account number, routing number, SSN, address or name, since only the ambient session cookie is required. Fix: Uncomment and mount csurf() before the routes are registered (server.js:105-113), expose req.csrfToken() to every form, and include the hidden csrf field in the profile, contributions, benefits and memos forms.
- `access-007` — Login route has no rate limiting or lockout, enabling unlimited password guessing (`app/routes/index.js:34`, CWE-307, confirmed) — An attacker can submit unlimited login attempts against any known or guessed username with no delay or block, which is especially severe combined with the plaintext password storage in access-008. Fix: Add an account- and IP-aware rate limiter (e.g. express-rate-limit plus a per-username failed-attempt counter) in front of POST /login, and lock out or delay after a small number of consecutive failures.
- `data-004` — Database seed script logs every user record, including plaintext passwords, to the console (`artifacts/db-reset.js:99`, CWE-532, confirmed) — Whoever can read the output of this script (CI logs, an operator's terminal history, or a captured build log) gets the admin and seed-user passwords in cleartext, which double as valid credentials against a freshly reset instance. Fix: Log only non-secret identifiers (userName, _id) when reporting seeded users, and generate the seeded admin password at reset time rather than hardcoding it.
- `data-006` — Raw internal error objects are rendered unescaped straight into the error page sent to the client (`app/views/error-template.html:11`, CWE-209, confirmed) — Any unhandled error on any route (a malformed id causing a Mongo cast error, a DB connectivity failure, etc.) discloses internal error text - library names, query/field context, or stack-adjacent detail - to the requesting client, and because autoescape is disabled, an error message that happens to contain HTML/script-like content would also render unescaped. Fix: Render a generic, static error message to the client and log the actual err.message/err.stack server-side only (as errorHandler already does at lines 7-8); never pass the raw error object into a client-rendered template.
- `dependencies-cypress-devdep-outdated` — cypress, a build/test-only dependency, is thirteen majors behind and carries the largest transitive advisory chain in the project (`package.json:44`, CWE-1357, confirmed) — cypress only runs during `npm run test:e2e`/CI, not inside the deployed application, so this chain does not expose NodeGoat's production runtime directly; it is a supply-chain risk to whichever machine (developer laptop or CI runner) executes the test suite, which is why this is scored below the production-dependency findings above despite the audit's own "critical" label on the aggregate. Fix: Upgrade cypress to a current major; given the size of the jump, budget time for the end-to-end test suite's API changes across thirteen majors.
- `dependencies-async-prototype-pollution` — async, a devDependency, is pinned to a pre-release range with a known prototype-pollution advisory (CVE-2021-43138) (`package.json:42`, CWE-1321, confirmed) — If any build or test script passes attacker-influenced data through async's affected functions, an object's prototype can be polluted, potentially altering behavior across the whole process for the rest of that build/test run. Fix: Bump the declared range to at least async@2.6.4, or move to the current 3.x major.
- `dependencies-grunt-devdep-rce` — grunt, a devDependency, is pinned to a range with an arbitrary-code-execution advisory, plus 13 transitive advisories (`package.json:45`, CWE-1188, confirmed) — Running grunt on this range exposes the developer's or CI's machine to the listed advisories when the build/test scripts execute; this is a build-time risk to whoever runs `npm test` or `npm run db:seed`, not a risk to the deployed application's own runtime. Fix: Upgrade the declared range to grunt@1.6.3 or later, staying within the same major.
- `dependencies-bcrypt-nodejs-deprecated` — bcrypt-nodejs, used for password hashing, is the author's own thirteen-year-old, single-release, deprecated package (`package.json:8`, CWE-1104, confirmed) — Any weakness found in this implementation in the future — timing behavior, salt/round handling, or a platform incompatibility on a newer Node runtime — has no upstream maintainer to fix it; NodeGoat's password hashing has no remediation path except switching packages. Fix: Migrate to the actively maintained `bcrypt` or `bcryptjs` package, exactly as bcrypt-nodejs's own deprecation notice recommends, and re-test the password-hashing round trip in app/data/user-dao.js.
- `injection-open-redirect-learn` — Open redirect on /learn takes the destination directly from the `url` query parameter (`app/routes/index.js:72`, CWE-601, confirmed) — An attacker can craft a link such as `/learn?url=https://evil.example.com` hosted on the trusted nodegoat domain to redirect a logged-in victim to an attacker-controlled phishing or malware site. Fix: Validate `req.query.url` against an allowlist of known-good destinations (or internal path prefixes) before calling `res.redirect`, and reject or ignore any value that does not match.
- `injection-xss-login-username` — Reflected XSS: failed-login page echoes `userName` into an HTML attribute with autoescape disabled (`app/views/login.html:110`, CWE-79, confirmed) — An attacker who gets a victim to submit a crafted `userName` (e.g. via an auto-submitting cross-site form, since csrf protection is commented out in server.js) such as `" autofocus onfocus=alert(document.cookie) x="` breaks out of the `value` attribute and executes arbitrary JavaScript in the victim's browser in the application's origin. Fix: Re-enable Swig's `autoescape: true` default (or use an explicit `{% autoescape true %}`/escaping filter around user-controlled values) so `{{userName}}` is HTML-attribute-escaped before it reaches the page.
- `injection-xss-profile-website-href` — Reflected XSS: profile page renders unescaped `firstName` into an `href` attribute (`app/views/profile.html:78`, CWE-79, confirmed) — A logged-in user who submits a crafted first name such as `" onmouseover=alert(document.cookie) x="` (or a `javascript:` URI once the attribute is broken out of) gets arbitrary JavaScript executed in their own profile page; combined with the same field being stored via profile-dao.js `updateUser`, the payload persists across profile views. Fix: HTML-attribute-escape `firstName` before rendering, and if it is genuinely meant to build a URL, use URL encoding (`encodeURIComponent`) for that context instead of `firstNameSafeString`'s unescaped passthrough or the HTML-only ESAPI encoding already misapplied to `website` in the same file.
- `platform-001` — Helmet security-headers middleware is imported but never mounted (`server.js:10`, CWE-693, confirmed) — Responses carry no clickjacking, MIME-sniffing or content-security-policy protection and advertise Express via X-Powered-By, making the app easier to fingerprint and its pages embeddable in a hostile iframe. Fix: Uncomment and mount helmet() (or an equivalent explicit header set) before the routes are registered, and call app.disable("x-powered-by").
- `platform-006` — Global error handler renders the raw Error object to the client (`app/routes/error.js:10`, CWE-209, confirmed) — Whatever the underlying error's message contains, including MongoDB driver messages or internal path/field details, is returned straight to the browser instead of a generic message, helping an attacker map the backend. Fix: Log err.message and err.stack server-side only (as is already done at lines 7-8) and render a fixed, generic error message with a correlation id to the client.
- `secrets-config-secrets-logged-to-stdout` — Full application config, including the session cookie secret and crypto key, is printed to stdout on every startup (`config/config.js:12`, CWE-532, confirmed) — cookieSecret and cryptoKey land in process stdout on every boot; anywhere those logs are collected (container logs, PaaS log drains such as Heroku's, CI job output, log aggregation) becomes a second place those secrets are exposed to whoever can read logs, independent of source-code access, widening who can steal them and complicating rotation. Fix: Remove the console.log of the full config object, or redact known-sensitive keys (cookieSecret, cryptoKey) before logging, and never log secret values even at debug level.

### low

- `access-009` — Password comparison uses a non-constant-time equality check (`app/data/user-dao.js:61`, CWE-208, confirmed) — JavaScript's === short-circuits at the first differing byte, so a remote attacker able to measure response timing precisely gets a per-character oracle on the stored password, independent of the plaintext-storage issue in access-008. Fix: Once passwords are hashed, verify with the hashing library's constant-time compare (bcrypt.compareSync); never compare secrets with ===.
- `dependencies-swig-unmaintained` — swig has had no release since 2014 and the registry marks it "no longer maintained" (`package.json:22`, CWE-1104, confirmed) — The unpatched arbitrary-file-read advisory found alongside this finding (GHSA-2rq5-699j-x7p6) will never receive an upstream fix, and any future issue discovered in swig carries the same guarantee. Fix: Treat swig as end-of-life and schedule its replacement rather than waiting on an upstream patch that will not arrive.
- `dependencies-csurf-deprecated` — csurf is archived and no longer maintained upstream, and carries a transitive cookie advisory (`package.json:11`, CWE-1357, confirmed) — The CSRF-protection middleware this app relies on for every state-changing route (allocations, benefits, contributions, profile, memos) depends on a vulnerable cookie-parsing package and will receive no further fixes from its own maintainers. Fix: Migrate to a maintained CSRF middleware, per csurf's own archival notice; as a stopgap, pin the cookie transitive dependency to a patched version.
- `dependencies-express-session-transitive` — express-session pulls a vulnerable cookie and on-headers into the session middleware (`package.json:14`, CWE-1357, confirmed) — The session-cookie handling for every authenticated request in this app runs through this outdated chain; a fix published upstream in cookie or on-headers never reaches this app until express-session itself is upgraded past 1.18.1. Fix: Upgrade the declared range past 1.18.1 (current release 1.19.0), which pulls patched cookie and on-headers versions.
- `dependencies-node-esapi-abandoned` — node-esapi has had exactly one release, in 2014, with no update in the twelve years since (`package.json:20`, CWE-1104, confirmed) — Any encoding or escaping guarantee this app relies on from an ESAPI-style library for output-encoding defenses has not been reviewed or updated against a decade of newly discovered encoding-bypass techniques, and no fix will arrive from upstream. Fix: Confirm which call sites still use node-esapi; where its encoding functions are load-bearing for XSS defense, replace it with a maintained encoding library (for example `he` or `escape-html`).
- `platform-009` — Environment defaults to "development" when NODE_ENV is unset, silently enabling development configuration in an unconfigured deployment (`config/config.js:5`, CWE-1188, confirmed) — A production deployment that omits NODE_ENV=production silently ships development-only script injection and debug settings instead of config/env/production.js (which is empty), increasing the attack surface without any error or warning. Fix: Default to a safe/production configuration when NODE_ENV is unset, or fail startup loudly instead of silently falling back to development.
- `secrets-hardcoded-crypto-key-dead-path` — Hard-coded AES key intended to protect SSN/DOB/bank data, currently unreachable because the encrypt/decrypt code is commented out (`config/env/all.js:9`, CWE-321, confirmed) — As shipped, this key protects nothing today because the encryption path is disabled (ssn/dob/bank fields are stored in plaintext in MongoDB per profile-dao.js's active code). The risk is latent: if an operator uncomments the encrypt/decrypt block to "fix" the sensitive-data-exposure issue without also changing this literal, every deployment that does so would share the same publicly-known key, letting anyone with the source decrypt the resulting ciphertext. Fix: If the encryption path is enabled, source cryptoKey from a secrets manager or environment variable with no hard-coded value, and use a unique key per deployment; do not ship a working literal default in committed config.
- `secrets-committed-rsa-private-key` — RSA private key committed to the repository for the TLS certificate, currently unused because the HTTPS listener is commented out (`artifacts/cert/server.key:1`, CWE-321, confirmed) — Anyone who has cloned this repository holds the private half of the certificate. If an operator re-enables the commented HTTPS block without generating a fresh key/cert pair, every such deployment would share this one public, already-disclosed private key, letting anyone intercept or impersonate its TLS endpoint. Fix: Remove the committed key/cert pair from the repository and history; generate certificates per environment via a CA or ACME client and load them from outside version control (e.g. mounted secret/volume), never from a path checked into git.
- `secrets-hardcoded-zap-api-key` — OWASP ZAP proxy API key hard-coded in committed test/dev configuration (`config/env/development.js:6`, CWE-798, confirmed) — This key only authorizes calls to a local/lab OWASP ZAP proxy instance used for the project's own security regression tests, not a production service or customer data; the exposure is that anyone with the repository knows the API key a locally-run ZAP instance would need to be configured with, which is a low-value target but still a credential committed to source instead of local, uncommitted developer configuration. Fix: Generate the ZAP API key per developer/CI run (ZAP can auto-generate one) and inject it via an environment variable or an untracked local config file rather than committing it.

## What was not covered

### Findings dropped from the union, and why

Six findings verified individually against the target but were dropped when
building `findings.json`, because they duplicated — strictly by file, line and
CWE — a finding already kept from another department; the examiner's
`--list-invalid` check itself printed nothing for any of the six
`findings/<department>.json` files, so none of the drops below are a rejection
of the finding's validity, only of its place in a deduplicated union:

- `data-001` — duplicate of `access-008` (both cite `app/data/user-dao.js:25`, CWE-256, both `confirmed`); `access-008` was kept.
- `platform-004` — duplicate of `data-005` (both cite `server.js:145`, CWE-319, both `confirmed`); `data-005` was kept.
- `platform-007` — duplicate of `access-007` (both cite `app/routes/index.js:34`, CWE-307, both `confirmed`); `access-007` was kept.
- `platform-008` — duplicate of `injection-open-redirect-learn` (both cite `app/routes/index.js:72`, CWE-601, both `confirmed`); `injection-open-redirect-learn` was kept.
- `platform-010` — duplicate of `access-001` (both cite `config/env/all.js:8`, CWE-798, both `confirmed`); `access-001` was kept.
- `secrets-hardcoded-session-cookie-secret` — duplicate of `access-001` (same file/line/CWE as above, both `confirmed`); `access-001` was kept.

### Areas, file kinds and checks this program did not reach

- **Dynamic testing.** Every finding above is a static read of the source as committed; nothing was run, fuzzed, or exploited against a live instance, so none of these findings is a demonstrated live exploit, and no dynamic-only class of bug (timing side channels beyond the one noted in `access-009`, race conditions, runtime-only misconfiguration) was checked.
- **Deployment and runtime configuration.** `Dockerfile`, `docker-compose.yml` and `app.json` were read for what they wire up (e.g. the seed script and start command), but which environment variables an actual deployment sets, whether a reverse proxy or WAF sits in front of the app, and whether the commented-out HTTPS/Helmet/CSRF blocks are re-enabled outside this tree cannot be determined from static source.
- **Git history.** No department ran a history scan (`git log -p`, gitleaks, or equivalent); every finding is about what the currently locked tree contains, not about secrets or vulnerable code present in an earlier, now-edited commit.
- **Vendored third-party front-end code.** `app/assets/vendor/` (jQuery, Bootstrap, Morris, Raphael, html5shiv, Font Awesome) was not audited for known CVEs in the bundled versions; this is a supply-chain question about files that are not this project's own manifest-declared dependencies, and no department's brief covered it.
- **The `node_modules` tree itself and non-npm supply chain.** `npm audit` reasons over `package.json`/`package-lock.json`, not over the installed files; the base OS image and any native binaries a package's own install scripts pull were not reviewed. `node_modules` is not part of the locked target tree at all.
- **~130 further npm-audit-flagged transitive packages** (for example `qs`, `path-to-regexp`, `cookie`, `connect`, `debug`, `lodash`, `minimist`, `request`, `tar`, `ws`, and dependencies under `nyc`, `tap`, `zaproxy`) were read in the audit JSON and folded into the transitive counts of the direct dependency that pulls each one in, rather than written up as separate findings; a reader who wants the raw per-package list can re-run `npm audit --json` against the locked lockfile. Ten further direct devDependencies with their own audit advisories (`zaproxy`, `jshint`, `nodemon`, `selenium-webdriver`, `grunt-cli`, `grunt-contrib-jshint`, `grunt-contrib-watch`, `grunt-if`, `grunt-npm-install`, `grunt-retire`) were likewise read but not written up individually, being lower-value, same-shape build-tooling findings.
- **Reachability of every dependency advisory from a specific route.** The dependencies department reads the manifest and the audit's advisory data; it does not itself trace whether, for example, the flagged `underscore` template-injection primitive or the `swig` file-read primitive is reachable from a specific NodeGoat handler with attacker-controlled input — the `critical`/`high` severities on those two findings are the advisory's own rating, not an independently confirmed exploit chain through this app's own routes.
- **Typosquatting.** Every direct dependency name was checked against its own registry page while gathering versions and deprecation notices, and none looked suspicious, but no automated edit-distance/typosquat comparison against a popular-package list was run.
- **MFA and JWT.** NodeGoat implements neither: authentication is single-factor and session-based via `express-session` cookies only. There is no MFA to bypass and no JWT issuance or verification code anywhere in the target, so neither checklist applies, and no finding was manufactured to fill either gap.
- **CORS.** No CORS middleware exists anywhere in the codebase and the app sets no `Access-Control-Allow-*` header; its absence was noted by the platform department but is not itself reported as a finding, since no cross-origin API surface was found to be exposed by it.
- **Native code and memory safety.** This is a pure JavaScript/Express/MongoDB application with no native modules or compiled extensions in scope; that class of defect does not apply here and was not checked.
- **Test suites, CI/CD and instructional content.** `test/e2e/**`, `test/security/profile-test.js` (beyond the one secret it reads), `.github/workflows/*.yml`, `.travis.yml`, `Gruntfile.js`'s own `child_process.exec` usage, and the teaching pages under `app/views/tutorial/**` were skimmed at most far enough to confirm they hold no additional finding beyond what is listed above; they run in the developer/CI environment or are static documentation, not request-attacker-reachable application surface, and were not treated as first-class scope by any department.
- **Everything else in the locked tree not named above** — license, contribution and documentation files (`README.md`, `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`), editor/lint configuration (`.jshintrc`, `.jshintignore`, `nodemon.json`, `cypress.json`), and binary assets (`app/assets/favicon.ico`, the PNG images, the web fonts under `app/assets/vendor/theme/font-awesome/fonts/`) — was not opened by any department; nothing in this category is expected to carry an application-security defect, but none of it was read to confirm that.

## Certificate

Verified findings: 49
Target tree: 78ac112b7bd5083bb065086c4642dcd8a3932a8d3052f9405503124c90a70fe3

`node verify-safety-report.mjs --report` mechanically checked, after this
report was written, that every one of the 49 findings in `findings.json`
resolves to a real file and an existing line in the locked target tree above
(with its `snippet` matching the target's own text at that line), that all 49
ids are unique, that every cited CWE and OWASP id is well-formed, that no two
findings share file, line and CWE, that every finding id is cited in
"## Findings", that every id dropped from any department's
`findings/<department>.json` is disclosed above, and that the severity counts
stated in both summaries match `findings.json` exactly.

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".

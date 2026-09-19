---
name: access
description: Authentication (password handling, brute force, MFA), session management (cookie flags, fixation, expiry), authorization (IDOR, missing per-route checks, role checks), CSRF, and JWT pitfalls — the code patterns and the CWE id for each.
---

# Authentication, sessions, and authorization

## Authentication

- **Password handling** (CWE-916, CWE-521) — hashing with `bcrypt`/`argon2` at an adequate cost factor is correct; MD5/SHA1/SHA256 with no salt, or a home-rolled scheme, is not (full parameters in [data](../data/SKILL.md)). Flag password comparison with `==`/`.equals()` instead of the hashing library's own constant-time verify.
- **Brute force** (CWE-307) — a login, password-reset, or OTP-verification route with no attempt limit, no lockout, and no delay. Look for the limiter being applied per-IP only (bypassed by rotating IPs) rather than per-account, and for a reset-token or OTP endpoint with a short numeric code and no rate limit, which is brute-forceable directly.
- **MFA** (CWE-308) — an MFA step that can be skipped by calling the post-login endpoint directly, a "remember this device" cookie with no expiry or signature, or a backup-code path with weaker entropy than the primary factor.

## Session management

- **Cookie flags** (CWE-1004, CWE-614) — a session cookie set without `HttpOnly` (readable by any injected script), `Secure` (sent over plain HTTP), or `SameSite=Lax`/`Strict` (sent cross-site). In Express, look for `cookie-session`/`express-session` configured with defaults never overridden; in Django, `SESSION_COOKIE_HTTPONLY`/`SESSION_COOKIE_SECURE` left `False`; in Spring, a `Set-Cookie` built manually without these attributes.
- **Fixation** (CWE-384) — a session id issued before login that is not rotated after successful authentication, so an attacker who fixes a victim's pre-login session id inherits their post-login session. Fix: regenerate the session id (`req.session.regenerate()`, Django's `cycle_key()`, Spring's session-fixation protection) on every privilege change, not only on login.
- **Expiry** (CWE-613) — no absolute session timeout, only an inactivity timeout, or a "remember me" token that never expires and is not invalidated on password change.

## Authorization

- **IDOR** (CWE-639) — a route that accepts a resource id and loads it without checking the authenticated actor owns or may access it: `GET /invoices/:id` that does `Invoice.findById(id)` with no `where: { userId: req.user.id }`; a GraphQL resolver that loads by id from `args` with no owner check in the resolver itself.
- **Missing checks per route** (CWE-862) — trace every route individually; auth middleware applied to a router does not guarantee every route mounted under it actually requires the role it should, especially after a later route is added or a router is re-mounted elsewhere. A route protected only by omission from the public sitemap or by a hidden UI element is unauthenticated, not restricted.
- **Role checks** (CWE-863) — a check present but wrong: comparing against a role string that can be spelled multiple ways, checking `isAdmin` on a client-supplied JWT claim never re-verified server-side, or an admin panel guarded by a check for "logged in" rather than "is admin."

## CSRF (CWE-352)

A state-changing route (any non-idempotent `POST`/`PUT`/`PATCH`/`DELETE`) reachable with only a session cookie and no per-request token or origin check. Cookie-based session auth needs a CSRF token (Django and Rails include one by default; Express needs `csurf` or an equivalent) or strict `SameSite` cookies plus an `Origin`/`Referer` check; a token-in-header API (bearer JWT, not a cookie) is inherently CSRF-resistant because the browser will not attach it automatically.

## JWT pitfalls

- **`alg: none` and algorithm confusion** (CWE-347) — a verifier that accepts `alg: none` or that verifies an `RS256`-issued token with `HS256` using the public key as the HMAC secret. Fix: pin the expected algorithm explicitly in the verify call; never derive it from the token's own header.
- **No expiry or audience check** (CWE-345) — a token verified for signature only, with `exp`, `aud`, and `iss` never checked, so an old or wrong-service token remains valid indefinitely.
- **Weak or hardcoded signing secret** (CWE-798) — an HS256 secret that is short, guessable, or committed to source; see [secrets](../secrets/SKILL.md).
- **Sensitive claims trusted without re-verification** — a role or price stored in the JWT payload and trusted on every subsequent request instead of re-derived from the database when it changes.

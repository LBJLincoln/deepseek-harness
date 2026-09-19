---
name: platform
description: Security headers (helmet, CSP, HSTS), CORS, cookies, error handling and stack traces, rate limiting, file uploads, debug endpoints, client-side token storage, source maps in production, and Docker/compose/nginx misconfiguration.
---

# Platform and deployment configuration

## Security headers (CWE-693, CWE-1021)

Look for `helmet()` (Express) or an equivalent (Django `django-csp`/`SecurityMiddleware`, Spring Security headers, an nginx `add_header` block) actually mounted, not just installed, and check its config rather than assuming defaults are enough: a `Content-Security-Policy` with `script-src 'unsafe-inline'` or `*` defeats its own purpose; a missing `X-Frame-Options`/`frame-ancestors` leaves clickjacking open; `Strict-Transport-Security` absent or with no `includeSubDomains` leaves a downgrade path.

## CORS (CWE-942)

`Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true` is invalid per spec but some frameworks let it through misconfigured, and it lets any origin make credentialed requests. Also flag an origin allowlist implemented as a substring or regex check (`origin.endsWith('example.com')`, matched by `evil-example.com`) instead of an exact-match set.

## Cookies

Apply the same cookie-flag and lifecycle checks as [access](../access/SKILL.md): `HttpOnly`, `Secure`, `SameSite`, rotation on login, and expiry all apply to every cookie that carries a session or auth token, not only the primary session cookie.

## Error handling and stack traces (CWE-209)

A global error handler that serializes the caught error's `message`/`stack` straight into the JSON or HTML response (`res.status(500).json({error: err.stack})`), Django/Flask running with debug mode on in production (see below), or a Spring Boot default whitelabel error page exposing the exception class and path. Fix: log the full error server-side, return a generic message and an id the log can be correlated by.

## Rate limiting (CWE-770)

No limiter (`express-rate-limit`, `django-ratelimit`, an API gateway policy, or nginx `limit_req`) on login, password reset, OTP verification, search, or any expensive endpoint; a limiter present but keyed only by IP (bypassed by a botnet or IPv6 rotation) with no per-account or per-API-key dimension.

## File uploads (CWE-434)

Trusting the client-supplied filename or `Content-Type` for validation instead of sniffing actual content; storing uploads inside the served web root with the original extension, which turns an upload endpoint into remote code execution if a `.php`/`.jsp`/`.aspx` file is accepted; no size limit, enabling resource-exhaustion.

## Debug endpoints (CWE-489)

Django `DEBUG = True` in a production settings module; Flask `app.run(debug=True)` (the Werkzeug debugger's PIN can be brute-forced or leaked, giving remote code execution); Spring Boot Actuator (`/actuator/env`, `/actuator/heapdump`) exposed with no authentication; any `/debug`, `/__debug__`, GraphQL introspection, or admin-only route reachable without the auth check its neighbors have.

## Client-side storage of tokens (CWE-522)

An access or refresh token stored in `localStorage`/`sessionStorage` or a non-`HttpOnly` cookie, readable by any script an XSS bug injects; a React Native/mobile app writing a token to unencrypted shared storage instead of Keychain (iOS) or the Keystore-backed EncryptedSharedPreferences (Android). Fix: an `HttpOnly`, `Secure`, `SameSite` cookie for web sessions, or platform secure storage for native/mobile tokens.

## Source maps in production (CWE-540)

A production build that ships `.map` files publicly (`devtool: 'source-map'` in webpack with no upload-then-delete step, a Next.js build with `productionBrowserSourceMaps: true` and no access control) reconstructs original source, including any inlined secret or internal comment, for anyone who requests the map.

## Docker, Compose, and nginx

- Running the container process as root with no `USER` directive; `FROM ...:latest` or an unpinned base image digest; secrets passed as build `ARG`s (visible in image history) instead of runtime secrets or a multi-stage build that discards the build stage.
- Compose files committing real credentials in `environment:` instead of an `.env` excluded from version control (see [secrets](../secrets/SKILL.md)); a database port published to the host/internet with `ports:` instead of kept on the internal network.
- nginx `autoindex on` on a static or upload directory; an `alias` misconfigured relative to its `location` block, opening path traversal; no `client_max_body_size`, allowing large-body DoS; a `proxy_pass` that forwards client-controlled headers (`X-Forwarded-For`, `Host`) into backend trust decisions with no stripping or overwrite at the edge.

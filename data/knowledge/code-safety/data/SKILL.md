---
name: data
description: Sensitive data exposure, PII and secrets in logs, transport (TLS, HSTS), crypto misuse (MD5/SHA1 for passwords, ECB, static IVs, Math.random for tokens), password-storage parameters, and backups/exports — the code patterns and CWE ids.
---

# Data exposure, transport, and crypto misuse

## Sensitive data exposure (CWE-200)

An API response, admin panel, or export that returns more fields than the caller's role needs — a `SELECT *`/`Model.find()` serialized directly to JSON instead of an explicit response DTO, so adding a column later leaks it silently. Look for a `/users/:id` response that includes password hashes, tokens, or another user's PII, and for verbose error responses that echo internal object structure, SQL fragments, or stack traces to the client.

## Logging PII and secrets (CWE-532)

A request/response logger, error handler, or APM integration that logs the full request body or headers unfiltered, capturing passwords, tokens, and PII in `Authorization` headers or JSON bodies. Also flag application code that logs a user object, a payment payload, or an exception's `.toString()` including a caught credential. Fix: an allowlist of loggable fields or a redaction middleware applied before the logger, not a denylist that misses the next sensitive field added.

## Transport (CWE-319)

A server accepting plain HTTP for anything beyond a redirect to HTTPS; a client (mobile app, backend-to-backend HTTP call, webhook receiver) that accepts `http://` URLs or disables certificate validation (`rejectUnauthorized: false`, Python `verify=False`, a custom `TrustManager` that accepts everything) for convenience. Check for `Strict-Transport-Security` on every response, covered fully in [platform](../platform/SKILL.md).

## Crypto misuse (CWE-327, CWE-329, CWE-330)

- **MD5/SHA1 for passwords** — `hashlib.md5(password)`, `crypto.createHash('sha1')`, or Java `MessageDigest.getInstance("MD5")` used to store a password. These are fast general-purpose digests, not password hashes; use the parameters in the next section instead.
- **ECB mode** — `Cipher.getInstance("AES/ECB/PKCS5Padding")`, `crypto.createCipheriv('aes-128-ecb', ...)`, or a library default that turns out to be ECB. ECB leaks plaintext structure (identical blocks encrypt identically); use an authenticated mode (AES-GCM) instead.
- **Static or reused IVs** — a hardcoded IV constant, an IV derived deterministically from the key, or an IV reused across encryptions with CBC or GCM. Each encryption needs a fresh, random IV/nonce generated with a CSPRNG.
- **`Math.random`/`rand()` for tokens** — a password-reset token, session id, or API key generated with `Math.random()`, PHP `rand()`/`mt_rand()`, or `random.random()` in Python. These are not cryptographically secure; use `crypto.randomBytes`, `secrets.token_urlsafe`, or the language's CSPRNG.

## Password storage parameters (CWE-916)

Confirm the algorithm and its cost parameters, not just that a hashing library is present: `bcrypt` with a work factor below 10-12 is weak on modern hardware; `argon2id` (preferred) with memory below roughly 19 MiB or fewer than 2 iterations at low parallelism is under-provisioned; PBKDF2 below about 600,000 iterations (SHA-256) is weak. A hardcoded low cost factor left over from a test environment (`bcrypt.hash(pw, 4)`) is a finding, not a style note.

## Backups and exports (CWE-312)

A database backup, data-export feature, or debug dump that writes plaintext PII or credentials to a world-readable path, an unencrypted S3 bucket, or a support ticket attachment; a "download my data" or admin export endpoint with no authorization check distinct from viewing the data in the UI; backup files retained with no expiry alongside application logs that are shipped to a lower-trust log aggregator.

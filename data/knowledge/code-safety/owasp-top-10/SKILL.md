---
name: owasp-top-10
description: The OWASP Top 10 2021 and 2025 categories, mapped to CWE ids, with the code patterns to look for in Node/Express, Next.js, React, Django/Flask/FastAPI, Spring, Go, Laravel/Symfony, and mobile Swift/Kotlin. Cite the category and CWE id together in every finding.
---

# OWASP Top 10: categories, CWEs, code patterns

Cite both editions when they diverge: `OWASP A05:2025 / A06:2021` for a component finding. 2025 reorders 2021's ten: Broken Access Control stays #1 and absorbs SSRF; Security Misconfiguration rises to #2; "Vulnerable and Outdated Components" becomes the broader #3 "Software Supply Chain Failures"; Injection falls to #5; Identification and Authentication Failures is renamed Authentication Failures (#7); Security Logging and Monitoring Failures is renamed Security Logging and Alerting Failures (#9); and a new #10, Mishandling of Exceptional Conditions, replaces standalone SSRF.

**A01 Broken Access Control** (CWE-22, 284, 285, 639, 862, 863, and CWE-918 SSRF under 2025) — Express/Next.js routes with no auth middleware or a check only in the UI; a numeric `:id` param passed straight to a lookup with no ownership check (IDOR); Django views missing `@login_required` or `get_object_or_404(qs.filter(owner=request.user))`; Spring `@PreAuthorize` absent on a `@RestController` method a sibling method protects; Go `http.HandleFunc` with no middleware wrapper; Laravel routes outside an `auth`/policy `middleware` group; mobile `IDOR`-shaped REST calls with no server-side check that the signed-in user owns the resource id the client sent.

**A02 Security Misconfiguration** (CWE-16, 611 XXE, 1188) — default admin consoles and stack traces left enabled in production config; `DEBUG = True` in Django/Flask settings; Spring Boot Actuator endpoints exposed without security; permissive S3/bucket or CORS wildcard config; XML parsers (`libxml`, Java `DocumentBuilderFactory`, PHP `simplexml_load_string`) without external-entity resolution disabled; missing security headers, covered fully in [platform](../platform/SKILL.md).

**A03 Software Supply Chain Failures / Vulnerable and Outdated Components** (CWE-1104, 1357) — see [dependencies](../dependencies/SKILL.md) for the manifest/lockfile/advisory workflow; look for pinned-but-ancient majors, `*`/`^`-floating ranges on security-sensitive packages, and unreviewed postinstall scripts.

**A04 Cryptographic Failures** (CWE-259, 321, 327, 328, 330) — full treatment in [data](../data/SKILL.md): MD5/SHA1 for passwords, hardcoded keys, ECB mode, `Math.random`/`rand()` for tokens.

**A05 Injection** (CWE-79, 89, 78, 94, 611) — full treatment in [injection](../injection/SKILL.md): string-built SQL/NoSQL, `child_process.exec`/`os.system` with concatenated input, unescaped template output, `dangerouslySetInnerHTML`, `eval`/`Function`.

**A06 Insecure Design** (CWE-209, 501, 522, 1173) — verbose error responses that leak internals (stack traces, SQL fragments) instead of a generic message; trust boundaries drawn at the client (a Next.js API route trusting a role field the browser sent); missing rate limiting or step-up auth on a sensitive workflow (password reset, funds transfer) by design, not by omission of a control that exists elsewhere.

**A07 Authentication Failures / Identification and Authentication Failures** (CWE-287, 296, 307, 620, 798) — full treatment in [access](../access/SKILL.md): password handling, brute-force throttling, MFA, session cookies, JWT pitfalls.

**A08 Software or Data Integrity Failures** (CWE-345, 502, 829) — `pickle.loads`/`yaml.load` (not `safe_load`) on untrusted bytes; Java `ObjectInputStream.readObject` on request data; PHP `unserialize()` on user input; a CI/CD or auto-update path that fetches an artifact over plain HTTP or skips signature verification; a Next.js server action or Spring `@RequestBody` that binds directly onto a persistence entity (mass assignment) instead of a validated DTO.

**A09 Security Logging and Alerting Failures / Security Logging and Monitoring Failures** (CWE-117, 223, 532, 778) — see [data](../data/SKILL.md) for logging PII/secrets; also flag authentication and authorization failures that are never logged at all, and log entries built by string-concatenating request data (log injection, CWE-117) without newline stripping or a structured logger.

**A10 Mishandling of Exceptional Conditions** (2025; CWE-248, 390, 755) / **Server-Side Request Forgery** (2021; CWE-918) — a `catch` block that swallows an error and continues in an inconsistent state (partially applied a payment, half-deleted a record); an uncaught exception whose default handler renders a stack trace; and, still current practice under 2025's A01, any server-side fetch of a user-supplied URL (`axios.get(req.body.url)`, `requests.get(url)`, `RestTemplate.getForObject(url, ...)`, PHP `file_get_contents($url)`) with no allowlist, DNS-rebind protection, or block on internal/link-local address ranges.

## Using this skill

State the category number for the edition the customer's own vocabulary uses (ask, or default to 2021 if unstated) and always add the CWE id; a finding that says only "OWASP A03" without a CWE is not complete evidence under [severity-and-evidence](../severity-and-evidence/SKILL.md).

---
name: cwe-top-25
description: The current CWE Top 25 Most Dangerous Software Weaknesses (CISA/MITRE) in rank order — one-paragraph recognition cues and the fix each expects, for triaging a finding to the right CWE id fast during a customer code review.
---

# CWE Top 25: recognize it, fix it

Ranks are the published CISA/MITRE ordering and shift yearly; re-check `cwe.mitre.org/top25`. Cite the CWE id in every finding regardless of rank.

1. **CWE-79 Cross-Site Scripting.** Recognize: user input reaches HTML, an attribute, or a script context without escaping — template output marked safe/raw, React `dangerouslySetInnerHTML`, `innerHTML =`. Fix: contextual output encoding by default, plus a CSP as defense in depth.
2. **CWE-89 SQL Injection.** Recognize: a query string built by concatenation or f-string with request data. Fix: parameterized queries or an ORM query builder, never string formatting into SQL.
3. **CWE-352 Cross-Site Request Forgery.** Recognize: a state-changing route with no anti-CSRF token and a session cookie without `SameSite=Strict/Lax`. Fix: per-session CSRF tokens on unsafe methods, or strict `SameSite` cookies plus an origin check.
4. **CWE-862 Missing Authorization.** Recognize: a route or resolver with authentication but no check that the actor may perform this action on this resource. Fix: an explicit authorization check on every mutating and every resource-scoped route; see [access](../access/SKILL.md).
5. **CWE-787 Out-of-Bounds Write.** Recognize: unchecked buffer/array writes in native modules, Go `unsafe`, or C/C++ bindings behind a JS/Python/mobile FFI. Fix: bounds-checked APIs; avoid raw pointer arithmetic on attacker-sized input.
6. **CWE-22 Path Traversal.** Recognize: a filename or path segment from the request concatenated into a filesystem path. Fix: resolve to an absolute path and reject any result outside a fixed base directory; never trust `../` stripping alone.
7. **CWE-416 Use After Free.** Recognize: a freed/disposed native resource, buffer, or handle referenced again, typically in native mobile or Go cgo code. Fix: null out and guard the reference at free time; prefer an owning-language wrapper over manual lifetime tracking.
8. **CWE-125 Out-of-Bounds Read.** Recognize: reading past a buffer's length in native/FFI code, often from an attacker-controlled length field. Fix: validate lengths against the actual allocation before reading.
9. **CWE-78 OS Command Injection.** Recognize: `child_process.exec`, `os.system`, PHP `shell_exec`, or Java `Runtime.exec("sh -c " + input)` built from request data. Fix: an argument-array API (`execFile`, `subprocess.run([...])`) with no shell.
10. **CWE-94 Code Injection.** Recognize: `eval`, `new Function`, PHP `eval`/`create_function`, or a template engine's raw-code mode fed request data. Fix: never evaluate request-derived strings as code; use data-only template contexts.
11. **CWE-120 Classic Buffer Overflow.** Recognize: a fixed-size buffer filled from input with no length check (`strcpy`, an unchecked native copy behind an FFI). Fix: length-checked copy APIs or a memory-safe wrapper.
12. **CWE-434 Unrestricted Dangerous File Upload.** Recognize: an upload endpoint that trusts the client-supplied filename, extension, or content-type and stores the file inside the web root. Fix: server-side content sniffing, an extension allowlist, storage outside the web root, and a randomized filename.
13. **CWE-476 NULL Pointer Dereference.** Recognize: a value from an optional lookup (map get, DB find) used without a nil/None/null check. Fix: explicit presence checks or language-level optionals before use.
14. **CWE-121 Stack-Based Buffer Overflow.** Recognize: the same pattern as #11 with the destination on the stack, risking return-address corruption. Fix: bounds-checked copies, plus stack-protection compiler flags.
15. **CWE-502 Deserialization of Untrusted Data.** Recognize: `pickle.loads`, Java `readObject`, PHP `unserialize`, or `yaml.load` (not `safe_load`) on request or cookie data. Fix: a data-only format (JSON) with schema validation, or a restricted/safe deserializer.
16. **CWE-122 Heap-Based Buffer Overflow.** Recognize: the same pattern as #11 on a heap-allocated destination, corrupting adjacent heap metadata. Fix: bounds-checked copies and a memory-safe allocator wrapper.
17. **CWE-863 Incorrect Authorization.** Recognize: an authorization check present but wrong — checks the wrong field or role, or an object id not scoped to the current user (IDOR). Fix: scope every lookup to the authenticated actor's ownership or role.
18. **CWE-20 Improper Input Validation.** Recognize: a handler that reads a field and uses it directly with no type, range, or format check. Fix: validate at the boundary (schema validation on the request) before any business logic runs.
19. **CWE-284 Improper Access Control.** Recognize: the general case behind #4 and #17 — a resource with no access-control mechanism at all, not just one missing check on one route. Fix: an access-control layer applied structurally (middleware, gateway policy), not per-handler ad hoc checks.
20. **CWE-200 Exposure of Sensitive Information.** Recognize: an API response, log line, or error page that includes secrets, internal ids, or another user's data. Fix: response and log allowlisting of fields; see [data](../data/SKILL.md).
21. **CWE-306 Missing Authentication for Critical Function.** Recognize: an administrative, destructive, or data-exporting endpoint reachable with no authentication at all. Fix: require authentication on every non-public route by default, allowlisting the public ones.
22. **CWE-918 Server-Side Request Forgery.** Recognize: a server-side HTTP fetch of a URL taken from the request. Fix: an allowlist of destinations and a block on internal/link-local/metadata-service addresses.
23. **CWE-77 Command Injection.** Recognize: the general form of #9 — any interpreter (SQL, shell, LDAP, XPath) invoked with unescaped input. Fix: a parameterized or argument-array API specific to that interpreter.
24. **CWE-639 Authorization Bypass Through User-Controlled Key.** Recognize: an id, key, or filename taken directly from the request and used to look up a record with no ownership check — the IDOR pattern. Fix: scope every lookup by key to the authenticated actor.
25. **CWE-770 Allocation of Resources Without Limits or Throttling.** Recognize: no limit on request size, upload size, recursion depth, or concurrent work per client. Fix: explicit caps plus [rate limiting](../platform/SKILL.md).

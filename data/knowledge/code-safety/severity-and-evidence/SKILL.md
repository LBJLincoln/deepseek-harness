---
name: severity-and-evidence
description: The severity rubric (critical/high/medium/low/info with concrete criteria), the evidence rule, the finding JSON schema with two complete examples, and the deduplication rule (same file, line, and CWE). Use when scoring or writing any finding.
---

# Severity, evidence, and the finding schema

## Severity rubric

Score by the worst realistic case the code as read supports, not the theoretical worst case of the vulnerability class in general.

| Severity | Exploitability | Auth required | Data affected | Blast radius |
| --- | --- | --- | --- | --- |
| **Critical** | Remote, no user interaction, reliable | None, or any authenticated user | Full database, all tenants, or code execution | Entire system or every tenant |
| **High** | Remote, at most one minor precondition (a known id, a low-privilege account) | None or low-privileged | One tenant's full data, or a horizontal slice across many | One tenant, or many via a shared flaw |
| **Medium** | Needs user interaction (a clicked link, an opened file) or a specific role | Authenticated, often a specific role | A user's data beyond their own, or a narrow field set | One user or a small group |
| **Low** | Needs substantial preconditions (local access, a race window, non-default config) | Elevated access already, or local access | Limited or already-authorized data | Single record, with another control still present |
| **Info** | No exploit path demonstrated in the code read | N/A | N/A | Hardening gap, or a `possible`-confidence pattern needing more context |

## The evidence rule

Every finding's evidence names, in prose: the exact reachable source (which entry point, which parameter), every step the tainted value passes through with its file and line, the sink, and why no guard on that path stops it (or which guard was checked and found absent). "This looks like SQL injection" is not evidence; "`req.params.id` from the route at line 40 reaches the template literal at line 42 with no parameterization" is.

## The finding schema

```json
{
  "id": "SEC-001",
  "cwe": "CWE-89",
  "owasp": "A05:2025 / A03:2021",
  "severity": "critical",
  "confidence": "confirmed",
  "title": "SQL injection in order lookup via string-concatenated query",
  "file": "src/routes/orders.js",
  "line": 42,
  "endLine": 44,
  "snippet": "const sql = `SELECT * FROM orders WHERE id = ${req.params.id}`;\nconst [rows] = await db.query(sql);",
  "evidence": "req.params.id flows unvalidated from the route handler at line 40 directly into the template literal at line 42; no parameterization or validation exists on this path; db.query executes the raw text.",
  "impact": "An attacker can read or modify any row in any table reachable by the application's database user, including other customers' orders and stored payment references.",
  "fix": "Use a parameterized query: db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]).",
  "references": ["https://cwe.mitre.org/data/definitions/89.html", "https://owasp.org/Top10/A03_2021-Injection/"]
}
```

```json
{
  "id": "SEC-002",
  "cwe": "CWE-384",
  "owasp": "A07:2025 / A07:2021",
  "severity": "medium",
  "confidence": "likely",
  "title": "Session id not rotated after login (session fixation)",
  "file": "src/routes/auth.js",
  "line": 58,
  "snippet": "req.session.userId = user.id;\nres.redirect('/dashboard');",
  "evidence": "The login handler sets req.session.userId after password verification with no req.session.regenerate() call. express-session's default (assumed from its documented API, not traced into its own source here) keeps the pre-login session id, so a fixed id would carry into the authenticated session.",
  "impact": "An attacker who fixes a victim's session id before login gains an authenticated session once the victim logs in.",
  "fix": "Call req.session.regenerate() immediately after verifying credentials, before setting authenticated session state.",
  "references": ["https://cwe.mitre.org/data/definitions/384.html", "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/"]
}
```

`endLine` is present only when the vulnerable statement spans more than one line; omit it for a single-line finding rather than repeating `line`.

## Deduplication

Two candidate findings are the same finding when they share **file, line, and CWE id**; keep the higher-confidence one and fold any additional evidence into it. A different line — even the very next statement, or the same tainted value reaching a second sink — is a separate finding under [review-method](../review-method/SKILL.md)'s one-finding-per-sink rule, not a duplicate. A different CWE on the same line is also a separate finding: a route that is both an XSS sink and unauthenticated is two findings sharing a location, not one.

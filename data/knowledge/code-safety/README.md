# Code safety

English | [中文](README.zh.md)

Skills a security review department reads before analysing a customer's application code — web back ends, web front ends, and mobile clients — across six review departments (secrets, injection, access, data, dependencies, platform) plus five cross-cutting skills that set the method, cite standard identifiers, and shape the deliverable.

## Skills

| Skill | Covers |
| --- | --- |
| [review-method](review-method/SKILL.md) | The review discipline: entry points first, input to sink, one finding per sink, exact lines, confidence levels, and what "not covered" must list. |
| [owasp-top-10](owasp-top-10/SKILL.md) | The OWASP Top 10 2021 and 2025 categories mapped to CWE ids and code patterns per language and framework. |
| [cwe-top-25](cwe-top-25/SKILL.md) | The CWE Top 25: a one-paragraph recognition cue and the expected fix for each. |
| [secrets](secrets/SKILL.md) | Credential and key patterns, their false positives, and remediation (rotation, vaulting). |
| [injection](injection/SKILL.md) | SQL/NoSQL, command, template/eval, XSS, path traversal, SSRF, and deserialization, with safe alternatives per framework. |
| [access](access/SKILL.md) | Authentication, session management, authorization (including IDOR), CSRF, and JWT pitfalls. |
| [data](data/SKILL.md) | Sensitive data exposure, logging of PII and secrets, transport, crypto misuse, password-storage parameters, and backups. |
| [dependencies](dependencies/SKILL.md) | Reading manifests and lockfiles, running audit tools, typosquatting, abandoned packages, and advisory findings. |
| [platform](platform/SKILL.md) | Security headers, CORS, cookies, error handling, rate limiting, uploads, debug endpoints, and Docker/nginx misconfiguration. |
| [severity-and-evidence](severity-and-evidence/SKILL.md) | The severity rubric, the evidence rule, the finding JSON schema, and the deduplication rule. |
| [report-template](report-template/SKILL.md) | The report layout the integration writes, with a filled example. |

## Mounting

A separate program mounts this directory as a skill root for [`@deepseek-ai/dsh-skill-filesystem`](../../../packages/skill/skill-filesystem/README.md): `customSkillDirs: ['data/knowledge/code-safety']` with `includeDefaultRoots: false`, so the catalog contains exactly these eleven skills, addressed by the directory names above.

## What this is not

This pack guides a code review; it does not replace a penetration test. It finds patterns a reader can trace through source, not runtime behavior, deployed configuration, or anything that requires actually attacking a running system. A clean report built from this pack is evidence about the code that was read, not a certification that the application is secure.

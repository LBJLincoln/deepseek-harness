---
name: report-template
description: The report layout the integration writes — Résumé exécutif (French), Executive summary, Scope and method, Findings grouped by severity, What was not covered, and a Certificate of mechanical checks — with a filled example for a small Express app.
---

# The report layout

Every report has exactly these sections, in this order. Do not add marketing language, severity totals presented as a score out of ten, or a remediation timeline the review has no authority to commit the customer to.

- **`## Résumé exécutif`** — French. Counts per severity, the three most important findings by name and effect, what was and was not covered in one sentence each, and one paragraph on method.
- **`## Executive summary`** — the same content in English, for a mixed-language or non-French reader.
- **`## Scope and method`** — the repository, commit or tag reviewed, which directories or services were in scope, and a link to [review-method](../review-method/SKILL.md).
- **`## Findings`** — grouped by severity, critical first; one bullet per finding with its id, title, `file:line`, CWE, and confidence. Full detail (snippet, evidence, impact, fix) lives in the accompanying JSON per [severity-and-evidence](../severity-and-evidence/SKILL.md), not duplicated in prose here.
- **`## What was not covered`** — the [review-method](../review-method/SKILL.md) not-covered list, specific to this engagement.
- **`## Certificate`** — what a mechanical verifier checked after the fact: every finding resolves to a real file and line in the reviewed commit, every id is unique, every CWE/OWASP id is a known identifier, and no two findings share file, line, and CWE. This certifies the report's internal consistency, not the completeness or correctness of the review's judgment.

## Filled example: a small Express app

```markdown
## Résumé exécutif

Cette revue a porté sur le code source de commande-api, une application Express.js
de gestion de commandes, au commit a1b2c3d. Elle a permis d'identifier 3 constats :
1 critique, 1 moyen et 1 faible. Les plus importants : (1) une injection SQL
critique dans la recherche de commande par identifiant (src/routes/orders.js:42),
permettant de lire ou modifier toute donnée accessible par l'utilisateur de base de
données de l'application ; (2) une fixation de session lors de la connexion
(src/routes/auth.js:58) ; (3) l'absence de l'en-tête HSTS (src/app.js:12). La revue
a couvert les points d'entrée HTTP, l'authentification et la gestion des sessions ;
elle n'a pas couvert l'infrastructure de déploiement ni les dépendances tierces
(voir « Ce qui n'a pas été couvert »). Méthode : lecture des points d'entrée,
suivi des données de la source jusqu'au point d'exécution, un constat par point
d'exécution, ligne exactement citée et niveau de confiance déclaré pour chacun.

## Executive summary

This review covered commande-api, an Express.js order-management application, at
commit a1b2c3d, and found 3 issues: 1 critical, 1 medium, 1 low. The most
important: (1) a critical SQL injection in order lookup by id
(src/routes/orders.js:42); (2) session fixation on login
(src/routes/auth.js:58); (3) a missing HSTS header (src/app.js:12). HTTP entry
points, authentication, and session handling were covered; deployment
infrastructure and third-party dependencies were not (see "What was not covered").

## Scope and method

Repository commande-api, commit a1b2c3d, `src/` only. Method: [review-method](../review-method/SKILL.md).

## Findings

### Critical
- SEC-001 — SQL injection in order lookup — `src/routes/orders.js:42` — CWE-89 — confirmed

### Medium
- SEC-002 — Session id not rotated after login (session fixation) — `src/routes/auth.js:58` — CWE-384 — likely

### Low
- SEC-003 — Missing Strict-Transport-Security header — `src/app.js:12` — CWE-319 — confirmed

## What was not covered

- `infra/` (Terraform, Dockerfiles) and CI/CD configuration.
- Third-party dependency advisories (separate engagement).
- Runtime configuration: actual deployed environment variables, WAF rules, and network topology.
- Native mobile or memory-safety classes of bug: this codebase has no native module.

## Certificate

Mechanically verified: 3/3 findings resolve to an existing line at commit a1b2c3d;
3/3 ids unique; 3/3 CWE and OWASP ids recognized; 0 findings share file, line, and
CWE. This certifies internal consistency only, not completeness of coverage.
```

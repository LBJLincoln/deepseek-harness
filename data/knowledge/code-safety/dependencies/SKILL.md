---
name: dependencies
description: Reading manifests and lockfiles per ecosystem, running npm audit/pip-audit/mvn dependency:tree, querying OSV, spotting pinned-vs-floating versions, typosquatting, and abandoned packages, and writing an advisory finding with package, version, advisory id, and fixed version.
---

# Dependency and supply-chain review

CWE-1104 (Use of Unmaintained Third-Party Components) and CWE-1357 (Reliance on Insufficiently Trustworthy Component) cover this department; a typosquatted package that runs install-time code is CWE-829 (Inclusion of Functionality from Untrusted Control Sphere).

## Reading manifests and lockfiles

- **JavaScript/TypeScript** — `package.json` states intended ranges; `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock` states what actually installs. Always audit the lockfile, since a `^1.2.0` range in `package.json` can resolve to any later `1.x`.
- **Python** — `requirements.txt` (often unpinned), `Pipfile.lock`, or `poetry.lock`; a project with only a bare `requirements.txt` and no lock has no reproducible, auditable version set.
- **Java** — `pom.xml` (Maven) or `build.gradle`; run `mvn dependency:tree` or `gradle dependencies` to see the resolved, transitive graph, since a direct dependency's stated version is not what a version-conflict resolution actually picks.
- **Go** — `go.mod` states requirements, `go.sum` pins exact content hashes; `go list -m all` shows the resolved graph.
- **PHP** — `composer.json` and `composer.lock`, read the same way as `package.json`/`package-lock.json`.

## Running the audit tools

`npm audit`/`pnpm audit`, `pip-audit`, `mvn dependency:tree` combined with an OWASP Dependency-Check or Snyk pass, `govulncheck` for Go, and `composer audit` for PHP each match the resolved graph against a vulnerability database. Cross-check hits against the [OSV database](https://osv.dev) directly (`osv-scanner` reads a lockfile natively) when the ecosystem tool's advisory feed is thin, and treat a `0 vulnerabilities` result as coverage of known, disclosed issues only — not an absence-of-risk claim.

## Pinned vs. floating versions

Flag a security-sensitive dependency (auth, crypto, deserialization, an HTTP client) pinned to a caret/tilde range (`^4.0.0`, `~2.1`) or a wildcard (`*`, `latest`) rather than an exact version resolved through the lockfile; also flag a Dockerfile `FROM node:latest` or a base image with no digest pin. A floating range means the next `npm install` can silently change what code runs in production.

## Typosquatting

Compare an unfamiliar or newly added dependency's name against well-known ones one edit-distance away (`reqeusts` vs `requests`, `crossenv` vs `cross-env`, `python3-dateutil` vs `python-dateutil`), and check its registry page for a plausible repository link, a maintainer history longer than the package's own age, and a download count consistent with genuine adoption rather than a single spike.

## Abandoned packages

A package with no commits or releases in several years, a single maintainer with no other active projects, open unpatched CVEs with no response, or an explicit `deprecated` notice on the registry is a standing risk even with zero currently known CVEs, because the next one found in it will never be fixed upstream. Note it as a finding distinct from a specific advisory.

## Writing an advisory finding

State exactly: the package name, the installed version (from the lockfile, not the manifest range), the advisory id (CVE or GHSA), and the fixed version. For example: `lodash@4.17.15`, `CVE-2020-8203` (prototype pollution in `zipObjectDeep`), fixed in `4.17.19`. A finding that names only the package without the installed and fixed versions cannot be verified or remediated; see the [finding schema](../severity-and-evidence/SKILL.md) for the complete field set.

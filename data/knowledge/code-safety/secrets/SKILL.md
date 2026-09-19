---
name: secrets
description: Credential and key patterns to grep for in customer code — cloud keys, JWT secrets, database URLs, private keys, .env and config files, git history — plus the false positives (test fixtures, placeholders) and the remediation that actually neutralizes an exposure (rotation, vaulting).
---

# Finding hardcoded credentials

CWE-798 (Use of Hard-Coded Credentials), CWE-259 (Use of Hard-Coded Password), CWE-321 (Use of Hard-Coded Cryptographic Key), and CWE-540 (Inclusion of Sensitive Information in Source Code) cover this department; CWE-256 and CWE-522 cover credentials stored unprotected once out of source.

## Patterns to grep for

- **Cloud keys.** AWS access key id `AKIA[0-9A-Z]{16}` and a nearby `aws_secret_access_key`; a GCP service-account JSON with `"type": "service_account"` and a `"private_key": "-----BEGIN PRIVATE KEY-----"` field; an Azure `DefaultEndpointsProtocol=...;AccountKey=...` connection string.
- **Vendor API keys.** Stripe `sk_live_...`, GitHub `ghp_`/`github_pat_`, Slack `xox[baprs]-`, SendGrid `SG.`, and any `Authorization: Bearer <long opaque token>` literal in code or a committed Postman/Insomnia collection.
- **JWT secrets.** `jwt.sign(payload, "some-literal-string")` or a signing secret with a hardcoded fallback such as `process.env.JWT_SECRET || "devsecret"` — the fallback is what ships when the env var is unset in production.
- **Database URLs.** `postgres://user:password@host:5432/db`, `mongodb+srv://user:pass@cluster...`, `mysql://root:root@...` embedded in code, a Docker Compose `environment:` block, or a Kubernetes manifest instead of a mounted secret.
- **Private keys.** Any `-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----` block committed as a file or inlined as a string constant.
- **`.env` handling.** A committed `.env` (as opposed to `.env.example`) with real values; `.env` missing from `.gitignore`; a `dotenv.config()` call that loads a file the repository ships.
- **Config files.** Django `SECRET_KEY = "..."` or `DATABASES[...]['PASSWORD']` literal in `settings.py`; Spring `application.yml`/`application.properties` with a plaintext `spring.datasource.password` or `jwt.secret`; Laravel/Symfony `.env` committed instead of `.env.example`; ASP.NET-style `appsettings.json` connection strings.
- **Git history.** A secret rotated in the latest commit is not remediated: `git log -p -- <path>` and a full-history secret scan (gitleaks, trufflehog) must confirm it is absent from every reachable blob, not just `HEAD`.

## False positives

Test fixtures using a vendor's own published sample key (Stripe's `sk_test_...` examples, AWS's documented `AKIAIOSFODNN7EXAMPLE`) are not findings; neither are placeholders (`YOUR_API_KEY_HERE`, `changeme`, `xxxxxxxx`, `insert-key-here`) or values that live only in `*.example`, `*.sample`, or a `fixtures/`/`testdata/` directory that is never loaded in a real environment. Confirm placeholder status by checking that the value is never read as a live credential — a "test" key still wired into a real API call against production is not a false positive.

## Remediation

State it in this order in the finding's fix field:

1. **Rotate at the provider immediately.** Deleting the line does not revoke the key; anything already scraped or logged remains valid until the provider invalidates it.
2. **Move the credential to a vault.** A secrets manager (AWS Secrets Manager or Parameter Store, GCP Secret Manager, HashiCorp Vault) or the deployment platform's injected environment variables, never a checked-in file, config committed to the repository, or a hardcoded fallback.
3. **Purge history as a secondary step.** `git filter-repo` or BFG removes the blob from history for defense in depth, but only after rotation — a purged-but-unrotated key is still a live credential to anyone who already has a clone.
4. **Add scanning going forward.** A pre-commit or CI secret scanner (gitleaks, trufflehog) catches the next one before merge.

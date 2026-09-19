---
name: review-method
description: Use before analysing any customer application code. The review discipline for this department — read entry points first, trace data from input to sink, one finding per sink, quote the exact line, prefer fewer confirmed findings over many possible ones, mark confidence, and state what was not covered.
---

# The review discipline

A code security review is a claim about specific lines, not an impression of the codebase. Every finding must survive the question "show me the line" — if it cannot, it is not a finding yet, it is a lead.

## Order of work

1. **Read the entry points first.** Enumerate every route, controller, handler, GraphQL resolver, message-queue consumer, CLI entry point, and scheduled job before reading anything else. This is the attacker's menu: every other file matters only insofar as an entry point reaches it.
2. **Follow data from input to sink.** For each entry point, trace each attacker-controlled value (query string, body, header, cookie, path segment, uploaded file, message payload) forward through the code until it reaches a sink: a query, a shell call, a template render, a filesystem path, an HTTP request, a deserializer, a redirect target. Read every function on that path; do not infer what a helper does from its name.
3. **One finding per sink.** A single tainted value that reaches three unguarded sinks is three findings, each with its own line and its own fix, because each can be patched or reintroduced independently. Do not collapse them into one narrative paragraph.
4. **Quote the exact line.** Every finding names a file and a line number and reproduces the vulnerable statement verbatim. A finding that describes a pattern in prose without the line is not reportable — go back and find the line, or drop the finding.
5. **Prefer fewer confirmed findings to many possible ones.** A report with five findings the customer can act on beats one with thirty where twenty-five require guessing. Downgrade or drop a finding rather than pad the count; the [severity-and-evidence](../severity-and-evidence/SKILL.md) skill owns the evidence rule this enforces.

## Confidence

Every finding carries exactly one of these three confidence levels, chosen by what was actually read, not by how bad the pattern looks:

- **`confirmed`** — the complete vulnerable path was read: the tainted source, every intermediate function, and the sink, with no sanitizer, allowlist, or framework guard in between. You could paste the exploit request and predict the effect.
- **`likely`** — one link in the chain was inferred rather than read: a helper's behavior assumed from its name or a similar function elsewhere, a framework default assumed rather than confirmed in config, or the sink read but the source only partially traced. State which link was inferred in the finding's evidence field.
- **`possible`** — a recognizable vulnerable pattern (a raw query built from concatenation, an `eval` call, a missing auth decorator) was seen, but the path from an actual attacker-reachable input was not traced end to end, or the surrounding guards were not fully read. Treat `possible` findings as leads for the customer's own team, not as proven bugs.

Never silently round `likely` or `possible` up to `confirmed` to make a report look stronger; the customer will re-derive trust in every future report from whether this one's confidence levels held up.

## What "not covered" must list

Every review ends with an explicit not-covered section — see the [report template](../report-template/SKILL.md) — that names, concretely:

- Directories, packages, or services that exist in the repository but were not opened.
- Entry points enumerated but not traced to a sink for lack of time or access.
- Runtime behavior no static read can confirm: actual deployed configuration, feature flags, WAF or proxy rules, and anything gated behind infrastructure the review did not have.
- Classes of bug this review did not check for at all (for example, native memory safety in a compiled dependency, or timing side channels).

A reviewer who does not know what they skipped cannot tell the customer what remains at risk; "not covered" is part of the deliverable, not an apology.

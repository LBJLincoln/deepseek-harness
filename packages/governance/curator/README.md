# @deepseek-ai/dsh-curator

English | [中文](README.zh.md)

The curated export path: the [trajectory exporter](../../improvement/trajectories/README.md) wrapped in the two rules a transcript may not leave the lab without. It refuses to run without a redaction profile, withholds every session whose pinned [`dataUse/terms`](../data-use/README.md) do not admit the export's purpose, redacts every text field of each record before it reaches the sink, and writes one `ExportManifest` beside the lines. It reads persisted logs and writes no session event. Decision record: [the curator Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-curator.md).

## Config

```yaml
- id: curator
  name: '@deepseek-ai/dsh-curator'
  config:
    defaultProfile: village-v1
    profiles:
      village-v1:
        shipped: true
      client-v3:
        shipped: true
        rules:
          - id: client-ticket
            pattern: 'ACME-[0-9]{6}'
            replacement: '[redacted:ticket]'
```

| Field | Meaning |
|---|---|
| `profiles` (required) | Redaction profiles by id, at least one. Each states `shipped` — whether the rule set this package owns runs ahead of its own — and may list `rules`. |
| `profiles.<id>.rules[].id` (required) | Non-empty rule identity, unique inside its profile, and the key its hit counts are reported under. |
| `profiles.<id>.rules[].pattern` (required) | JavaScript regular expression source, compiled at load. |
| `profiles.<id>.rules[].flags` | Regular expression flags. The global flag is added whether or not it is listed; the sticky flag is refused. |
| `profiles.<id>.rules[].replacement` (required) | Literal text every match becomes. `$&`, `$1`, and `$$` are written verbatim, never expanded. |
| `defaultProfile` | Profile an export that names none applies. |

Every profile is compiled when the plugin loads. A profile with no effective rule, a rule with an empty id, an id another rule in the same profile already used, a sticky flag, a pattern that does not compile, an empty `profiles` map, and a `defaultProfile` naming no configured profile are all load failures carrying `CURATOR_INVALID_CONFIG` and naming the profile and rule at fault.

There is no `requireProfile` field: redaction is required by design. An export that names no profile over a deployment with no `defaultProfile` is refused with `CURATOR_PROFILE_REQUIRED`, and one naming an unconfigured profile with `CURATOR_PROFILE_UNKNOWN`; neither touches the sink.

## The shipped rules

`shipped: true` prepends five rules this package owns. Each covers one credential or identifier format that appears verbatim in agent transcripts; none is exhaustive, and a deployment adds its own formats through `rules`.

| Rule id | Matches | Leaves alone |
|---|---|---|
| `shipped:email` | An address with a dotted top-level domain | A bare host with no domain dot |
| `shipped:bearer-token` | `Bearer` followed by twenty or more credential characters, case-insensitively | The prose "Bearer token" |
| `shipped:api-key` | An `sk-` prefixed key of four or more characters at a word boundary | `sk-` inside a longer word, such as `risk-averse` |
| `shipped:ipv4` | A dotted quad whose every octet is 0–255 | A dotted number with an out-of-range octet |
| `shipped:e164-phone` | `+` followed by eight to fifteen digits | A shorter `+` number |

## Service contract

`ctx.curator.export({ purpose, profile?, sessions?, sink, manifestPath?, rewardedOnly?, includeHeldOut?, districts? })` runs one export. It reads each candidate session's log, folds its terms with `termsOf`, and hands only the admitted sessions to `ctx.trajectories.export`, which applies the held-out and district withholding it already owns. `rewardedOnly`, `includeHeldOut`, and `districts` are passed through unchanged.

A session is admitted only when its newest `dataUse/terms` lists the export's `purpose`. A session carrying no terms at all is withheld by the same rule: an unpinned transcript states no purpose, and a purpose nobody recorded is never assumed. Withheld sessions are counted in `withheldByTerms` and are never handed to the exporter, so nothing about them is folded, serialized, or written. A session that cannot be read while its terms are looked for is reported in `skipped` and the export continues.

The returned report carries the manifest, `sessions`, `exported`, `rewarded`, `filtered`, `heldOut`, `withheldByDistrict`, `withheldByTerms`, and `skipped`.

## What redaction rewrites

The curator walks each record and redacts every string except three enumerated exceptions, so a field added to the record format is redacted until someone decides otherwise rather than exported until someone notices.

Redacted: the rendered system prompt (`system`), each tool schema's `description` and parameter text (`tools`), every message content block including reasoning text and the content nested inside a tool result (`messages[].content[]`), the raw argument strings the model produced (`messages[].content[].arguments`, `messages[].toolCalls[].arguments`), the working directory (`source.cwd`), the goal objective (`reward.goal.objective`), and each check's run evidence (`reward.certificate.results[].evidence`).

Never redacted: the `environment`, `steps`, `parity`, and `provenance` subtrees, which hold only identifiers, digests, and counts; the key names `format`, `type`, `id`, `sessionId`, `parentSession`, `agentPreset`, `role`, `sourceKind`, `toolCallId`, `basis`, `phase`, `goalId`, `checkId`, `status`, `isolation`, `executor`, `provider`, `model`, `reasoningEffort`, `attachmentId`, and `mediaType` at any depth, each of which a reader switches on; and `name` at `tools[]`, `messages[].content[]`, and `messages[].toolCalls[]`, where it is a registered tool name.

Directives reach the record as the count `reward.directives`; the record carries no directive text, so there is none to redact.

## The curation block

Every exported line is the `dsh-trajectory/1` record plus one `curation` block.

| Field | Content |
|---|---|
| `redactionApplied` | Always `true`. A record without a `curation` block was written by the unredacted exporter, not by this one. |
| `redaction.profile`, `redaction.profileSha256` | The profile that ran and a digest over its effective rules in order, so a reader can tell two versions of one profile name apart |
| `redaction.hits` | Replacements this record received, per rule id; a rule that matched nothing in it is absent |
| `residency` | Region the session's own terms name, so a sink can partition an export by region without reading the logs again |

## The export manifest

Every export produces one `ExportManifest`, written to `manifestPath` when the request names one and returned in the report either way. `TrajectorySink` is a `write`/`close` pair with no path, so the caller states where the manifest goes rather than the curator guessing it from the sink.

| Field | Content |
|---|---|
| `version` | `dsh-export-manifest/1` |
| `exportedAt` | Epoch milliseconds the export finished at |
| `purpose` | The purpose every written session's terms admit |
| `profile`, `profileSha256` | The profile that ran and the digest of its effective rules |
| `records` | Lines written |
| `withheld` | `heldOut`, `districts`, and `terms` counted separately, so no withholding hides inside another |
| `ruleHits` | Replacements over the whole export, per rule id, listing every rule of the profile including those that matched nothing |
| `recordsSha256` | SHA-256 over the written lines in order, which is the digest of exactly the bytes the sink received |
| `trajectoryFormat` | `dsh-trajectory/1` |

An export is not a session, so the manifest is a file rather than a session event: it spans every session the request considered and belongs to none of them.

## Model Experience

None, as a curated export reads persisted logs and writes files; it adds nothing to any model request and appends no session event.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **The unredacted exporter is still callable** — `ctx.trajectories.export()` remains a service any plugin in the process can call, so this package is the export path that refuses rather than a barrier around the data. A composition rule that rejects a district composing the exporter without the curator waits for a district that needs it.
- **Rules are regular expressions** — a credential in a format no rule covers is exported, and `redactionApplied: true` states that a profile ran, never that a record is clean. The manifest's per-rule counts are what a reviewer reads to see whether a profile fires at all.
- **Redaction can corrupt meaning** — the IPv4 rule rewrites a version string shaped like a dotted quad, and an aggressive deployment rule can make a record unusable for training. The never-redacted set protects the identifiers a reader switches on, not the meaning inside the text.
- **One profile per export** — the profile a session's terms name is not cross-checked against the export's, because one manifest states one profile. A deployment holding several clients' transcripts runs one export per profile.
- **Each admitted session is read twice** — once for its terms and once by the exporter's own fold, which is the cost of composing the exporter rather than duplicating its withholding and skip accounting.
- **No dataset manifest** — dedupe, decontamination against the held-out suite, the per-record content hash, and the split assignment belong to the `DatasetManifest` slice and are not produced here.

# @deepseek-ai/dsh-tool-standard-author

English | [中文](README.zh.md)

The validation instrument: one model-facing `standard_author` tool with which a validator derives a completion standard of weighted cases from a reference program, before any implementation of the task exists. The reference lives under the validator's read-barrier reservation, where the implementer is denied every read; the instrument runs it, keeps what it produced as the expected result of a case, and freezes the recorded cases into the standard the implementer is measured by. The [validation-instrument Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-validation-instrument.md) owns the design rationale.

## Config

```yaml
- id: tool-standard-author
  name: '@deepseek-ai/dsh-tool-standard-author'
  config:
    referenceTimeoutMs: 30000
```

| Field | Meaning |
|---|---|
| `referenceTimeoutMs` (default: the executor's own) | Timeout of each reference execution in milliseconds, capped by the shell executor. A reference that overruns it records no case, so the bound states how long one behavioural sample may take. |

The plugin requires `tools`, `shell`, `readBarrier`, `goals`, and `completionStandards`, and contributes its guidance section when a `systemPrompt` is composed. A composition without the read barrier or the completion-standard service does not activate the row: the instrument has nothing to sample from and nothing to author into.

## What the tool needs from its session

**A reservation.** The instrument reads the run directory the session already holds through `ctx.readBarrier.reservation(agent)` and never mints one: minting is what makes an unmarked session the implementer, so a reader that reserved to find out would demote the session it was reading for. `EnvironmentRunner.stageReference` is what mints it and copies the environment's `task.reference` tree beneath it.

**A reference program.** `<reservation>/reference/run` is the entry point every `record_case` sources, mirroring the `run` file of a reserved check. Both names are fixed: they are the convention an environment author and the instrument agree on, not a deployment choice.

**A goal.** `freeze` authors the standard for the session's current goal, or extends the standard already measuring it.

**The `standard-author` authority.** The tool declares it through `ToolAuthorityMap`, so [`dsh-read-barrier`](../read-barrier/README.md) denies it to every `implementer` and `judge` session: the composition audit refuses a preset of those roles that composes it, and the per-agent guard refuses a registration that arrives later. The shipped `validator` preset is the composition that may hold it.

## The three verbs

`record_case` runs the reference twice from an emptied scratch directory under the reservation, with the case's `argv`, `stdin`, and staged `files`, and digests the channels the case compares — through the same capture the environment runner measures a candidate with, so a case means one thing whichever side executes it. The two runs must agree: a case whose expected result changes between them cannot measure anything, and is refused rather than recorded. A channel the reference could put no value on — a signalled exit, a stream the executor truncated — is refused for the same reason.

`weigh` restates a recorded case's weight. `freeze` writes each check's bodies to `<reservation>/checks/<check id>/cases.jsonl`, then authors or extends the standard through `ctx.completionStandards` with the bodies attached, which is where the case count, the weights, and the digest binding the two are validated. A check that omits `run` is measured by `. ./run`: a recreation task asks for the reference's behaviour at the same entry point. The case total is bounded by the completion standard's own `maxCases`, whose refusal `freeze` reports unchanged.

Nothing recorded counts until it is frozen, and a frozen check leaves the working set, so freezing it twice refuses instead of duplicating it.

## UI presentation

The pending call renders as a `generic` card whose title names the verb and the case: `Sample the reference for case "<case>"` with the `execute` icon, `Weigh case "<case>"`, or `Freeze the completion standard`. `presentCall` is a pure function of the arguments, so a replay renders what the call rendered. It carries no `locations`: every path the tool touches lives under the barrier root, and naming one in a card would publish the reservation's layout to whoever is watching.

## Model Experience

### System prompt

#### What the model sees

The model receives one fixed guidance section naming the tool and the skill that teaches the sampling.

##### Standard-authoring guidance

```markdown
You author the standard this task is measured by, before any implementation exists. Sample the reference program with standard_author: cover the behaviour the task statement promises, weight each case by how much a user would miss it, and freeze the cases into the standard when the sample is complete. Load the standard-sampling skill for how to choose the sample.
```

#### Token effect

One fixed concise section is present on each request while the plugin is mounted.

#### KV Cache effect

Prefix-stable while the plugin and guidance text are unchanged.

### Tool schemas

#### What the model sees

The model sees the generated [`standard_author` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-standard-author): one `action` discriminant over `record_case`, `weigh`, and `freeze`, the case identity and weight, the input the case feeds (`argv`, `stdin`, and `files` as `{ path, content }` entries), the `channels` and `normalizers` it compares by, the `treeScope` a tree comparison digests, and the `checks` a freeze names. No reservation path, no digest, and no session identity appears in the schema.

#### Token effect

One fixed schema is sent on each request while visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Tool results

#### What the model sees

Each call returns one object whose `summary` is rendered as the single text block. A success states what was recorded, weighed, or frozen and how much of the standard now stands; a refusal states what the reference did and why nothing was recorded. Neither names the reservation, the digests, or the implementer.

##### Exact recorded-case result

```markdown
Recorded case "<case>" of check "<check>" at weight <n>, comparing <channels>. The reference produced the same result on both runs. Check "<check>" now holds <n> case(s).
```

##### Exact re-weighted result

```markdown
Case "<case>" of check "<check>" now carries weight <n>.
```

##### Exact frozen result

```markdown
Froze <n> check(s) carrying <n> case(s) of total weight <n>. The standard measuring this task is now revision <n>; the implementer is measured by it and never sees it.
```

##### Exact nondeterminism refusal

```markdown
the reference did not produce the same <channels> twice for case "<case>"; a case whose expected result changes between runs cannot measure a candidate, so it was not recorded
```

##### Exact unusable-channel refusal

```markdown
the reference produced no usable <channels> for case "<case>"; a channel without an expected result cannot measure a candidate, so it was not recorded
```

#### Token effect

One short text block per call; no reference output, no digest, and no case body is returned.

#### KV Cache effect

Results append to history and do not change the prompt prefix.

## Known Limitations and Deferred Work

- The instrument authors into the calling session's own standard, so the environment runner cannot yet drive a validator turn before its implementer turn. A recreation environment's derived checks are handed to the registry by whoever drives the two sessions; suite admission is the [note](../../../.agents/notes/proposed/architecture/2026-09-06-validation-instrument.md)'s next slice.
- The shipped Web and CLI compositions hold neither `completionStandards` nor `readBarrier`, so the `validator` preset they ship does not activate there. A deployment that runs validators composes both host rows.

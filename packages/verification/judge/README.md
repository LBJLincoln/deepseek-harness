# @deepseek-ai/dsh-judge

English | [中文](README.zh.md)

The blind judge (`ctx.judge`): the oversight Consumer that audits one recorded attempt from a session holding no implementer context. Cross-provider routing is the first answer to a judge whose label affects it, and a deployment with one model licence cannot take it; this package builds the second — a judge session whose lineage, workspace, composition, and history are all constructed so the judge cannot reach the work it is deciding about. The [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md) owns the design rationale, and the [oversight seam](../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) owns the role this Consumer plays.

## Config

```yaml
- id: judge
  name: '@deepseek-ai/dsh-judge'
  config:
    preset: judge
    workspaceRoot: ~/.dsh/judge
    rationaleMaxChars: 2000
```

| Field | Meaning |
|---|---|
| `preset` (default `judge`) | Preset every judge session composes. It must be a `system`-trust preset declaring `role: judge`; [`dsh-agent-presets`](../../preset/agent-presets/README.md) and [`dsh-read-barrier`](../read-barrier/README.md) enforce that, not this field. |
| `workspaceRoot` (default `<harness home>/judge`) | Absolute or `~`-prefixed directory judge workspaces are minted under; each audit gets `<root>/workspaces/<judge session id>/`, created owner-only. A path that is not absolute after `~` expansion is rejected at load. |
| `systemPrompt` (default below) | The judge's standing instruction, delivered as the first message of the judge session's derived history. |
| `rationaleMaxChars` (default `2000`) | Bound of the rationale recorded on the verdict; a longer answer keeps its head and its tail. |

The service requires `agents`, `sessions`, and `agentPresets`: it creates the session, flushes its log before disposal, and composes it from the roster.

## Service contract

`ctx.judge.audit(request)` runs one complete audit and returns the verdict with the judge session and workspace that produced it. `request` carries the audited session id, the one-based `attempt`, that attempt's `treeHash`, the absolute `workspace` the attempt left behind, the `taskPrompt` the implementer worked from, the attempt's `results`, the `certificate` it earned when it earned one, and optionally the `model` route the judge's own turn runs on and a `signal` that aborts it.

The order is what makes the audit blind, and every step is a precondition of the next.

**The copy is checked before the session exists.** The workspace is copied into a fresh judge workspace and digested with [`hashWorkspaceTree`](../verification/README.md); a digest that differs from the attempt's refuses the audit with `JUDGE_TREE_HASH_MISMATCH` and creates nothing. A judge that read a different tree than the one the attempt was measured on would decide about work that never happened. The refused copy is left in place: it is what an operator inspects to find out how the tree moved.

##### Exact digest refusal

```markdown
judge: the workspace copy for attempt <n> of session "<audited session>" hashes to "<actual>", not the recorded "<expected>"
```

**The session carries no lineage.** It is created through `ctx.agents.create` with a fresh `SessionId`, no `parentSessionId`, and no resume or fork seed, so its log begins at its own creation and its derived history holds nothing it did not receive here. Its `meta.cwd` is the judge workspace, never the implementer's.

**Its history is exactly three messages.** The standing instruction and the task are injected — queued for the next step without waking the driver — and the evidence follows as the waking message, so one step claims all three in that order. No `assistant/message`, `tool/result`, or `verification/directive` from the audited session reaches it.

**The evidence names verdicts, never contents.** One line per check with its id, its status, and its case tally when it was measured case by case, then the certificate the attempt earned or `certificate: none`. A `CheckResult`'s recorded `evidence` string holds the candidate's own captured bytes and is deliberately absent, as are the standard's check instructions, which the judge is never shown.

**Both records are durable.** `judge/session { judgeSessionId, auditedSessionId, attempt, treeHash }` is appended to the judge's own log before its first turn, and `judge/verdict { auditedSessionId, attempt, verdict, rationale }` after its turn settles; the log is flushed before the session is disposed.

### The verdict vocabulary

`upheld` means the evidence supports the outcome the attempt recorded, `overturned` that it contradicts it, and `inconclusive` that the evidence cannot decide. The verdict is read back from the first `verdict:` line of the judge's answer, and everything after that line is the rationale. An answer naming none of the three records `inconclusive` carrying the answer itself, because a judge that did not name a verdict decided nothing and its words are the only account of why; an answer with no text at all records `the judge answered nothing`.

A deployment that rewrites `systemPrompt` keeps the `verdict: <one of the three>` answer line. Without it every audit is `inconclusive`.

### The invariant companion

The separately published `./invariant` companion rejects a `judge/verdict` whose verdict is outside the vocabulary, one in a session whose header carries a `parentSession` or a non-zero `seedLength`, one in a session whose log carries no `judge/session`, and one from a session whose derived history opened with anything but the three messages an audit may carry. It reads the durable stream alone, so a forged verdict fails replay wherever the companion is installed.

## Model Experience

### The judge's standing instruction

#### What the model sees

The first message of every judge session's derived history, verbatim, unless a deployment replaced it through `systemPrompt`. The judge's composition contributes no tool schema and no prompt section of its own; the shipped `judge` preset's persona is the whole system prompt.

##### Verbatim default instruction

```markdown
You are auditing one attempt at a task. You did not run it, and the session that did is closed to you: the next two messages are the whole record you have.

The first is the task the implementer was given. The second is the evidence: which checks the attempt was measured by, whether each passed, and whether a certificate was issued. You are not shown the check instructions, the commands that ran, or anything either side wrote.

Answer with this line first, then your reason on the lines after it:

verdict: upheld

Use `upheld` when the evidence supports the outcome the attempt recorded, `overturned` when it contradicts it, and `inconclusive` when the evidence cannot decide. Decide on what you were given; there is nothing further to ask for.
```

#### Token effect

Fixed per audit: the instruction, the task prompt as the environment authored it, and one evidence message that grows by one line per check. Nothing is retained across audits — each one is its own session — so the cost is one short prefix per attempt judged rather than a growing transcript.

#### KV Cache effect

Independent per audit. Every judge session is a fresh request prefix, so nothing a judge reads can invalidate or reuse the audited session's prefix, and two audits of the same task share the instruction and the task text but not a session.

### The evidence message

#### What the model sees

The attempt number, one `<position>. <check id>: pass|fail` line per check with `(cases <n> of <total> passed, weight <w> of <total>)` appended for a check measured case by case, and one certificate line — either `certificate: none` or `certificate: issued at "<isolation>" isolation over checks run by <an automated validator|the implementer's own report>, covering <n> check(s)`. The whole message is wrapped in `<audited_attempt attempt="<n>">` … `</audited_attempt>`.

#### Token effect

One line per check plus two framing lines and the certificate line. Check ids and case tallies are short and bounded by the standard; the candidate's captured output, which is not bounded by anything, never enters the message.

#### KV Cache effect

Append-only within the audit's single turn and independent across audits, for the reason above.

## Known Limitations and Deferred Work

- **A host-plane tool reaches the judge** — the preset composes no tool, but a deployment that registers model-facing tools into the global layer exposes them to every session, the judge included. The read barrier still denies the judge every tool that declares an authority and every directory the barrier owns; an ordinary tool such as `bash` is neither. A blind judge belongs in a deployment whose model-facing rows live on the agent plane, which is what the shipped CLI composition does.
- **Context injected into every session breaks the audit** — a plugin that injects model-facing context on `agent/session-start` or `agent/pre-step` adds a fourth message, and the invariant companion then refuses the verdict rather than accepting a judge that read more than the audit allows. The refusal is the intended outcome; the deployment scopes such a plugin away from the judge preset.
- **The verdict is one model's answer** — nothing checks it against a second judge, a rubric, or the audited run. It is evidence for a reviewer, not an admission decision: no certificate, goal completion, or reward depends on it.
- **A refused copy is left on disk** — a `JUDGE_TREE_HASH_MISMATCH` keeps the copied workspace so an operator can compare it, and nothing reclaims it later. The judge root is owner-only, and one copy per refused audit is the whole cost.
- **One audit per call, no batching** — auditing many attempts of one run means one session, one workspace copy, and one model request each; the copy is a whole-tree `cp` with no sharing between audits of the same tree.

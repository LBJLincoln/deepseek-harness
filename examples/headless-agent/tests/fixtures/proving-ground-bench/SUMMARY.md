# The tiers with validator-held cases

Two tiers put their main check on cases held in `reference/cases.json`, which no workspace receives: tier 5, ten single-file tasks, and tier 6, a four-task pilot of multi-file repositories. Each task is a command, `src/cli.js`, driven by arguments and standard input and judged on its exit code and its two streams; the visible `test/*.test.js` covers the main paths only, and the rest of the verdict comes from the hidden corpus.

**Only tier 5 has been audited.** Its corpora were read case by case against their prompts after two independent loops ran them, in the fairness audit recorded below. No tier-6 corpus has had that reading, so a tier-6 miss may be an unstated corner rather than an implementer's error, and a tier-6 result is not comparable to a tier-5 one until the audit is done. The rationale and the design are in [the tier-5 Agent Note](../../../../../.agents/notes/proposed/architecture/2026-09-07-bench-tier-5-hidden-cases.md) and [the tier-6 Agent Note](../../../../../.agents/notes/implemented/process/2026-09-19-tier-6-pilot-environments.md).

## Tier 5: the tasks

| Task | Domain | Held out | Visible assertions | Hidden cases | Reference lines | What it turns on |
|---|---|---|---|---|---|---|
| `uri-resolve` | parsing | no | 16 | 150 | 255 | Percent-encodings normalize before dot segments are removed, so `%2E%2E` climbs; a default port must be written with exactly the default's digits to be dropped. |
| `glob-brace` | parsing | yes | 17 | 170 | 406 | Extended groups divide the segment every way, brace ranges pad and count down, and a leading `.` needs a literal `.` to match. |
| `conf-canon` | parsing | no | 18 | 150 | 339 | Which header may redeclare which table, where a dotted key may walk, and fifteen distinct failure messages. |
| `build-schedule` | data-structures-algorithms | no | 15 | 140 | 287 | List scheduling by longest remaining chain, a zero-cost task freeing its worker in the instant it starts, and one named cycle out of many. |
| `ranked-choice` | data-structures-algorithms | no | 16 | 170 | 170 | The backwards tie-break restarts from the first round after each narrowing, and majority is strictly more than half of the ballots still counting. |
| `sheet-eval` | data-structures-algorithms | no | 18 | 150 | 464 | Six error tokens with a stated precedence, `IF` hiding the branch it did not take, and a unary sign binding tighter than `^`. |
| `lex-states` | state-machines | no | 16 | 160 | 288 | Tab-stopped columns, nestable block comments, and a number that runs into a name reporting everything it consumed. |
| `rate-limit-sim` | systems | no | 17 | 150 | 230 | Refill accrues as an exact fraction of the period, every routed policy advances before any is asked, and a denied event consumes nothing. |
| `diff3-merge` | text | no | 15 | 160 | 187 | The longest common subsequence is pinned to its earliest match, and adjacent changes absorb into one conflict region. |
| `wrap-justify` | text | yes | 16 | 160 | 191 | Width counts columns over a stated code-point table, and a word breaks at the last hyphenation point that still fits. |

## Tier 5: the difficulty gate

Each task was run once against the Claude Code product loop in a copy of its directory with `reference/` removed — `claude -p "<prompt + shared rules>" --permission-mode acceptEdits --allowedTools "Bash(node:*)" Read Edit Write --no-session-persistence`, eight-minute limit — and what the loop left behind was scored against the visible suite and the hidden cases. `timeout` means the limit cut the attempt off; the loop had written nothing usable by then, which is why those rows score zero on both.

Round 1 ran all ten. Round 2 re-ran the six that had passed every hidden case, after their corpora gained corner cases for the specification points listed above; the table reports each task against its shipped corpus, so round 2 for those six and round 1 for the other four.

| Task | Visible suite | Hidden cases | Wall time | Round |
|---|---|---|---|---|
| `uri-resolve` | pass | 150 / 150 | 417 s | 2 |
| `glob-brace` | fail | 0 / 170 | 480 s, timeout | 1 |
| `conf-canon` | fail | 0 / 150 | 481 s, timeout | 1 |
| `build-schedule` | pass | 140 / 140 | 302 s | 2 |
| `ranked-choice` | pass | 170 / 170 | 201 s | 2 |
| `sheet-eval` | fail | 0 / 150 | 480 s, timeout | 1 |
| `lex-states` | pass | 158 / 160 | 367 s | 1 |
| `rate-limit-sim` | pass | 150 / 150 | 313 s | 2 |
| `diff3-merge` | pass | 160 / 160 | 300 s | 2 |
| `wrap-justify` | pass | 160 / 160 | 260 s | 2 |

Four tasks failed at least one hidden case and seven passed their visible suite, which is the bar the tier was accepted against. Only `lex-states` failed while its visible suite passed, which is the shape the tier is for; the other three failures are attempts the eight-minute limit cut off. The six re-run tasks scored the same in both rounds — every one of them at every hidden case — so the added corners changed nothing for this implementer, and the tier's separating power against it currently rests on the size of the four hardest specifications rather than on their corners.

## Tier 6: the pilot, unaudited

Four multi-file tasks. Each is a small working repository — a `README.md`, four files under `src/`, immutable input files under `data/`, and its own `node:test` suite, which passes as shipped — beside a specification of a change that spans several of those files and a second shipped suite that fails until that change lands. Every reference adds a fifth file to `src/`. The hidden corpus drives the same `src/cli.js` and compares the same three channels as tier 5, over argument forms, standard input, and the workspace files a case names by path.

| Task | Domain | Held out | Visible assertions | Hidden cases | Reference lines | What it turns on |
|---|---|---|---|---|---|---|
| `task-runner` | systems | no | 17 shipped + 18 new | 140 | 333 | A path reason beats a dependency one, a snapshot tells new from missing from changed, and one named cycle out of many. |
| `config-layers` | parsing | no | 14 shipped + 17 new | 140 | 303 | Three layers stacked key by key, five declared types with their own refusals, and a column carried from the parser through to the value that failed. |
| `job-queue` | state-machines | no | 19 shipped + 15 new | 160 | 268 | Backoff doubles from the instant an attempt failed, a re-queued attempt still waits out the rate limit, and the policy file is in force before the log is read. |
| `md-render` | text | no | 18 shipped + 18 new | 150 | 379 | A nested item may not jump a level, an unresolved reference falls back to literal text, and a fence escapes what it shows. |

No fairness audit has run on these four: no second implementer has failed their cases, and no corpus has been read case by case against its prompt. Until that happens a tier-6 miss is not evidence about the implementer, and a tier-6 certification rate is not comparable to a tier-5 one. The difficulty gate tier 5 passed — one product-loop attempt per task, scored against the visible suite and the hidden cases — has not run either, so nothing here yet shows that the tier separates anything.

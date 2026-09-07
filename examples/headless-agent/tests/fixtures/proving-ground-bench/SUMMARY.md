# Tier 5: the differential tasks and what the product loop did with them

Ten tasks whose main check runs the candidate on cases held in `reference/cases.json`, which no workspace receives. Each is a command, `src/cli.js`, driven by arguments and standard input and judged on its exit code and its two streams; the visible `test/*.test.js` covers the main paths only, and the rest of the verdict comes from the hidden corpus. The rationale and the design are in [the tier-5 Agent Note](../../../../../.agents/notes/proposed/architecture/2026-09-07-bench-tier-5-hidden-cases.md).

## The tasks

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

## The difficulty gate

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

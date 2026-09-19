# jobq

A job-queue simulator with no dependencies. It reads a log from standard input and replays it on one worker against a clock that only moves when the simulation asks it to, so a run is the same on every machine and in every order.

## Layout

| File | What it owns |
| --- | --- |
| `src/cli.js` | the argument forms, the mode dispatch, and how a failure is reported |
| `src/parse.js` | the log grammar and the refusals it words, as `LogError` |
| `src/queue.js` | the simulation: what starts when, and what the rate limit holds back |
| `src/clock.js` | `createClock`, the monotonic clock the simulation advances by hand |

`test/jobq.test.js` is the suite for what is already here, and `data/` holds the policy files the examples name.

## The log

One directive per line. A line is trimmed first; an empty one and one that starts with `#` are ignored; the rest is split on runs of whitespace. Every number is an unsigned decimal integer written without a sign or a separator.

```
limit 2 10
job build 5 ok
job flaky 3 fail ok
submit 0 build
submit 0 flaky
```

`limit <starts> <window>` allows at most `<starts>` starts inside any window of `<window>` milliseconds, and may appear at most once. `job <id> <duration> <outcome>...` declares a job that occupies the worker for `<duration>` milliseconds and whose attempts turn out as the listed `ok` and `fail` words, the last of which repeats. An id is one or more of the characters `A` to `Z`, `a` to `z`, `0` to `9`, `_`, `.` and `-`. `submit <at> <id>` puts a declared job in the queue at that instant; a job may be submitted at most once.

## The simulation

The clock starts at 0 and one worker runs everything. Take the queued attempt with the smallest ready time, breaking ties by submission order, and advance the clock to that ready time. If a rate limit is in force and the last `<starts>` starts all fall inside the window ending now, advance the clock to the instant the oldest of them leaves it. The attempt starts at the clock's instant and finishes `<duration>` later, and the clock advances to that finish. A job of duration 0 finishes in the instant it starts. A failed attempt is simply over: nothing here retries it.

## Modes

- `trace` prints one line per attempt in the order the attempts started, `<start> <id> attempt=<n> <outcome> finish=<finish>`, and then a final `end <clock>` line.
- `summary` prints one line per submitted job in ascending id order, `<id> attempts=<n> <outcome of its last attempt>`, and then the same final `end <clock>` line.

A declared job nothing submits never runs and appears nowhere.

## Failures

Every refusal writes one line to standard error and exits 2, having written nothing to standard output; the first failure stops the run. A grammar failure names its 1-based log line: `error: line 2: unknown directive cancel`. The messages are `expected limit <starts> <window>`, `expected job <id> <duration> <outcome>...`, `expected submit <at> <id>`, `invalid job id <id>`, `invalid outcome <word>`, `<field> must be a non-negative integer` and `<field> must be a positive integer` naming `at`, `duration`, `starts` or `window`, `job <id> is declared twice`, `job <id> is submitted twice`, `limit is declared twice`, and `unknown directive <word>`. A `submit` line naming a job no `job` line declares is refused without a line number, as `error: unknown job <id>`. A malformed argument list is refused with the usage line.

## Known gaps

A failure is the end of a job: there is no retry, no backoff, and nowhere for a job that never succeeds to go. The rate limit and nothing else can be configured, it can only come from the log itself, and there is no way to run the same log under a different policy.

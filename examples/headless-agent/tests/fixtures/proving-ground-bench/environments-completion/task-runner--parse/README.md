# taskrun

A dependency-aware task runner with no dependencies of its own. It reads a task file from standard input and answers questions about it; it never executes a command.

## Layout

| File | What it owns |
| --- | --- |
| `src/cli.js` | the argument forms, the mode dispatch, and how a failure is reported |
| `src/parse.js` | the task-file grammar and the refusals it words, as `ParseError` |
| `src/graph.js` | run order over the dependency edges |
| `src/digest.js` | the FNV-1a digest the snapshot format records |

`test/taskrun.test.js` is the suite for what is already here. `data/files/` holds the workspace files the examples name, and `data/snapshots/` the digest snapshots.

## The task file

One directive per line. A line is trimmed first; an empty one and one that starts with `#` are ignored; the rest is split on runs of whitespace.

```
# build.tasks
task build node build.js
task bundle node bundle.js
needs bundle build
```

`task <name> <word>...` declares a task whose command is the remaining words joined with single spaces. `needs <name> <dependency>...` adds dependencies; a repeated edge counts once, and a `needs` line may stand before the `task` line it names.

## Modes

- `order` prints the task names one per line, in run order: repeatedly the lexicographically smallest task whose dependencies have all been printed.
- `show <name>` prints `<name>: <command>` and then `needs: ` followed by the dependencies in ascending order, or `-` when there are none.
- `digest <path>...` prints `<path> <digest>` for each path in argument order, with `missing` in place of a digest for a path that is not there. The digest is 32-bit FNV-1a over the file's bytes — offset basis `0x811c9dc5`, prime `16777619`, xor then multiply — as eight lowercase hex digits.

## Failures

Every refusal writes one line to standard error and exits 2, having written nothing to standard output; the first failure stops the run. A parse failure names its 1-based input line: `error: line 2: unknown directive run`. The messages are `expected task <name> <word>...`, `expected needs <name> <dependency>...`, `invalid task name <name>`, `task <name> is declared twice` and `unknown directive <word>`. A `needs` line naming a task no `task` line declares is refused without a line number, as `error: unknown task <name>`, and so is `show` on such a name.

## Known gaps

`order` does not detect a dependency cycle: it stops as soon as nothing is ready and leaves every task in the cycle out of its output. The task file has no way to declare which files a task reads or writes, so nothing here can tell whether a task is up to date.

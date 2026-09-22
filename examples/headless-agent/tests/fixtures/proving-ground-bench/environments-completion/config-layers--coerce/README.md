# conflayers

A configuration loader with no dependencies. It reads INI files, knows a fixed schema of settings, and answers what one of them is set to.

## Layout

| File | What it owns |
| --- | --- |
| `src/cli.js` | the argument forms, the mode dispatch, and how a failure is reported |
| `src/ini.js` | the INI grammar and the refusals it words, as `IniError`, each with a line and a column |
| `src/schema.js` | `SETTINGS`, the known settings with their declared type and default text |
| `src/layer.js` | `merge`, which stacks layers so that the last one to set a key wins |

`test/conflayers.test.js` is the suite for what is already here, and `data/` holds the INI files the examples name.

## The INI grammar

A line is trimmed first. An empty one, and one beginning with `#` or `;`, is ignored. `[name]` opens a section, and a section may be opened more than once. Anything else is `key = value`: the text before the first `=` is the key, trimmed, and everything after it is the value, trimmed. A key outside a section keeps its own name; a key inside one is prefixed with the section name and a dot, so `port` under `[server]` is `server.port`. A name and a key are one or more of the characters `A` to `Z`, `a` to `z`, `0` to `9`, `_`, `.` and `-`. Nothing inside a value is special: `#` and `;` open a comment only at the start of a line.

```ini
log.file = /var/log/app.log

[server]
port = 9090
```

## The schema

| Key | Type | Default |
| --- | --- | --- |
| `log.file` | string | (empty) |
| `log.level` | enum `debug`, `info`, `warn`, `error` | `info` |
| `log.rotate` | boolean | `true` |
| `retry.attempts` | integer | `3` |
| `retry.backoff` | duration | `250ms` |
| `server.host` | string | `localhost` |
| `server.port` | integer | `8080` |
| `server.timeout` | duration | `30s` |
| `server.tls` | boolean | `false` |
| `tags` | list | (empty) |

The types are declared but nothing here enforces them yet: every mode below prints the raw text as the file wrote it.

## Modes

- `dump <file>` prints `<key>=<raw text>` for every schema key in ascending order, falling back to the schema default for a key the file leaves out. A key the schema does not know is ignored.
- `get <file> <key>` prints the raw text of one setting, or its default. A key outside the schema is refused.

## Failures

Every refusal writes one line to standard error and exits 2, having written nothing to standard output; the first failure stops the run. A grammar failure carries the position it was read at, as `error: <file>:<line>:<column>: <message>`, where the column counts characters of the raw line from 1, leading whitespace included. The messages are `expected "]"`, reported one past the line's last non-space character; `expected a section name` and `invalid section name <name>`, at the name's first character; `expected a section header or key = value` and `invalid key <key>`, at the line's first non-space character; `expected a key`, at the `=`; and `key <key> is set twice`, at the line's first non-space character. A file that cannot be read is refused as `error: cannot read <path>`, an unknown key as `error: unknown setting <key>`, and a malformed argument list with the usage line.

## Known gaps

Only one file is ever read, so the `merge` primitive stacks a single layer and nothing overrides anything. Nothing reads the environment. The declared types do nothing: `server.port = eighty` loads as happily as `server.port = 80`, and a caller has to coerce the text itself. `IniError` carries a position, but the parse result does not, so nothing downstream could say where a bad value was written.

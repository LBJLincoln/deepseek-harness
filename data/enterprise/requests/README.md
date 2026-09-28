# The owner's requests

English | [中文](README.zh.md)

This directory is how the enterprise's owner gives it work. A request is one Markdown file here; the enterprise answers it with one ticket in the [queue](../tickets/README.md), and `pnpm run enterprise:requests` reads back what became of it.

## Writing a request

Add a file `<name>.md` to this directory on the development branch; GitHub's web editor on a phone is enough. The file needs a first line `# <title>`, one line naming what you want, and below it free text saying what you want and why, in your own words. Nothing else is required: no id, no seat, no format beyond that first line. The name is yours to choose, and requests are taken up in file-name order.

```markdown
# Show the Command Deck in dark mode

The deck is too bright when I read it at night. Follow the phone's dark setting, and keep the division chart readable in both themes.
```

Requests are trusted input: only people with push access to the branch can add one, and the enterprise takes each as the owner's word.

## Reading its status

A ticket answers a request when its `source.path` is the request's file, and it carries priority `0`, which the queue reserves for tickets answering requests. `pnpm run enterprise:requests` prints every request's file, title and state, and `--json` prints the same as one JSON array. The states are derived from committed files alone: the queue, the ticket lines of the [ledger](../README.md#the-ledger), and the intake records under `../intake/`.

| State | Meaning |
|---|---|
| `waiting` | No intake has answered the request yet. |
| `refused` | No ticket answers it, and the latest intake record naming it refused it; the reason is printed with it. |
| `queued` | A ticket answers it, and no shift has worked that ticket yet. |
| `halted` | Its ticket's latest ledger line neither shipped nor was rejected; a later shift works it again. |
| `shipped` | Its ticket shipped; the commit carrying the change is printed with it. |
| `rejected` | The independent review rejected its ticket's change. |

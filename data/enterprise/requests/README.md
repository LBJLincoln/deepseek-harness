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

## What happens to a request

Every run of the coordinators' [intake](../../../examples/headless-agent/tests/fixtures/enterprise-intake/README.md), which the enterprise's cycle starts every two hours, takes up the requests no ticket answers yet, at most two per run in file-name order, whether or not the queue needs more work. A Program Departments coordinator reads the request and writes exactly one ticket for the seat whose code or document it is about, small enough for one implementer and with checks that fail before the change. The ticket carries the request's file and title line as its source and priority `0`, which the queue reserves for tickets answering requests, so the next shift takes it before every ticket not yet tried. Admission, the deterministic rules every ticket passes, may refuse it; the intake record then says why, and the next intake tries again, so editing a refused request gets it a new attempt. A request whose first line is not `# <title>` is refused without being read.

## Reading its status

`pnpm run enterprise:requests` prints every request's file, title and state, and `--json` prints the same as one JSON array. A ticket answers a request when its `source.path` is the request's file. The states are derived from committed files alone: the queue, the ticket lines of the [ledger](../README.md#the-ledger), and the intake records under `../intake/`.

| State | Meaning |
|---|---|
| `waiting` | No intake has answered the request yet. |
| `refused` | No ticket answers it, and the latest intake record naming it refused it; the reason is printed with it. |
| `queued` | A ticket answers it, and no shift has worked that ticket yet. |
| `halted` | Its ticket's latest ledger line neither shipped nor was rejected; a later shift works it again. |
| `shipped` | Its ticket shipped; the commit carrying the change is printed with it. |
| `rejected` | The independent review rejected its ticket's change. |

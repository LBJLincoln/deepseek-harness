# Agent Note: The owner's requests become tickets at the next intake

Status: implemented

English | [中文](2026-09-28-owner-requests.zh.md)

## Problem

The enterprise runs itself every two hours: the coordinators' intake refills the queue when it runs low ([coordinators' intake note](2026-09-28-coordinators-intake.md)), and a shift works the queue ([shift engine note](2026-09-28-enterprise-shift-engine.md)). Its owner had no channel into it: work reached the queue only through what the coordinators found in their own package groups or what an operator session filed by hand, and the owner learned what became of a wish only by asking an operator. A channel has to be writable from GitHub's web editor on a phone, must not wait for the queue to run low, must put the owner's work ahead of the enterprise's own, and must answer what became of each request from what the repository already records.

## Decision

**A request is a Markdown file.** The owner commits `data/enterprise/requests/<name>.md`: a first line `# <title>` and free text, nothing else ([requests README](../../../../data/enterprise/requests/README.md)). Only people with push access to the branch can add one, so a request is trusted input and reaches the department that answers it verbatim. A ticket answers a request when its `source.path` is the request's file; its `source.anchor` is the request's title line, so the queue's rule that a source exists and contains its anchor holds for a request's ticket unchanged.

**Every intake run answers requests first, independently of the refill.** [`scripts/enterprise-intake.ts`](../../../../scripts/enterprise-intake.ts) reads the requests no ticket answers and gives the first `--max-requests` (default 2) in file-name order one department each, in the same program as the refilling coordinators and ahead of them. A request's department is keyed `request-<file name>`, is staffed by the coordinators in turn from the one with the fewest open tickets, is told the request verbatim, and commits exactly one ticket at `.intake/<key>.json`. Its verifier is the same `admit` form with `--request`, and the same admission decides, with one rule checked first: a request's department files a ticket carrying the request's source and priority `0`, and no other department takes a request as its source. A request whose first line is not `# <title>` is refused without a department and takes no place among the `--max-requests`. When the queue holds `--min-open` open tickets the run still answers requests and skips only the refill; the cycle already runs the intake every two hours and commits `data/enterprise/` before its shift, so the cycle is unchanged.

**Priority 0 is the precedence.** [`validateTickets`](../../../../scripts/enterprise-tickets.ts) allows priority `0` only on a ticket whose `source.path` is a request, and admission requires it of every request's ticket. The engine's queue order — fewest attempts, then priority, then each division's turn, then id — therefore takes a request's ticket before every untried ticket without a change to the engine, and a request's ticket that failed waits behind the untried ones like any other.

**A refused request is recorded and retried.** The intake record's `requests` names every request the run took up with its result: `admitted` with the ticket; `refused` with every reason admission gave, or that its department committed no ticket, or that the title line is missing; `unanswered` when its department was cut before it finished and nothing it committed was refused for a reason of its own. The next run takes up every request no ticket answers, so an owner who edits a refused request gets a new attempt. Each department's function line names the coordinator who staffed it.

**Status is derived, never stored.** `pnpm run enterprise:requests` ([`scripts/enterprise-requests.ts`](../../../../scripts/enterprise-requests.ts)) prints each request's file, title and state from the queue, the ledger's ticket lines and the intake records: `queued`, `halted`, `shipped` with the commit, or `rejected`, from the answering ticket's latest line; otherwise `refused` with the reason when the latest intake record naming the request refused it, and `waiting` when none did.

## Alternatives considered

**A separate request command or program.** It would duplicate the clone, the checkouts, the driver, admission, the route wall and the record, and a second program each cycle would spend a second clone and a second install; one program whose request departments run first reuses all of them and keeps the usage-limit stop and its exit code 3.

**Requests as GitHub issues.** Reading them needs credentials and network in every cycle and a trust decision per author; a file on the branch is trusted by who can push, is read like every other ticket source, and meets the validator's source rule as it stands.

**Admission stamping the source and priority.** The department would never learn that its ticket's source was wrong, and admission would become the one place that edits a proposal beyond its id. Refusing with the exact expected source keeps admission a judge: the objective states the values, and the refusal names them for the department's second round.

**A state file for requests.** Every state is already a function of committed files: a ticket answers a request by its source path, the ledger closes the ticket, and the intake record says why a request is still unanswered. A state file would be a second copy that an interrupted cycle could leave stale.

**Priority 0 for any ticket an operator deems urgent.** The validator reserves it for requests so the precedence belongs to the owner; an operator's urgent work is written as a request.

**Skipping a refused request until its file changes.** It would hide a request refused for a transient reason, such as a department that spent its budget, and would need a record of what each refusal saw; retrying every run costs one department per waiting request, bounded by `--max-requests`.

## Consequences

The owner's channel is a commit: a request committed before a cycle is taken up by that cycle's intake, and once admitted its ticket is the first untried ticket the same cycle's shift takes. Requests are taken up in file-name order and a refused request is retried every run, so one that keeps being refused keeps its place ahead of later files until the owner edits or removes it, and `--max-requests` bounds the model sessions requests spend per run. A run spends one department per waiting request even when the queue is full. A request's department is a coordinator writing a ticket for another seat, so a request is only as well scoped as that coordinator reads it; admission and the shift's independent review remain the gates. A request about something no roster seat covers is refused with the owner rule's reason, which the status prints.

## Verification

[`scripts/enterprise-requests.spec.ts`](../../../../scripts/enterprise-requests.spec.ts) pins request discovery (the title line, the README pair and other files passed over, file-name order), the answered check, every state and a ticket's precedence over a refusal, the reading of committed records with damaged ones passed over, the printed and JSON output, and the engine's `queueOrder` taking a priority-0 ticket before every untried ticket. [`scripts/enterprise-tickets.spec.ts`](../../../../scripts/enterprise-tickets.spec.ts) pins the priority-0 rule; [`scripts/enterprise-intake-admission.spec.ts`](../../../../scripts/enterprise-intake-admission.spec.ts) the request rule in both directions; [`scripts/enterprise-intake.spec.ts`](../../../../scripts/enterprise-intake.spec.ts) the option, the department keys and staffing, the request's objective, the plan's order and quoted verifier, and each request result. [`examples/headless-agent/tests/enterprise-intake.e2e.ts`](../../../../examples/headless-agent/tests/enterprise-intake.e2e.ts) runs the command keyless over a seeded repository holding four requests with no refill needed: it admits one at priority 0, refuses one for its priority and one without a title line, leaves the fourth waiting, and reads the four states back through the status command.

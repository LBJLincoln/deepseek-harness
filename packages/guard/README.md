# guard/ — loop-hygiene guard family

English | [中文](README.zh.md)

Behavioral guard plugins watch the agent loop for unproductive patterns and enforce per-call and per-session budgets. A guard is a self-contained consumer of core services and extension points, not a swappable capability.

| Package | Role | ctx key |
|---|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Advisory reminders for repeated tool calls | listens on tool and agent events |
| [`timeout-policy/`](timeout-policy/README.md) | Arms per-call tool deadlines as deployment policy | registers a `tools/execute` listener |
| [`budget-policy/`](budget-policy/README.md) | Stops a session that exceeds its token, wall-clock, or cost cap | registers an `agent/pre-step` listener |

Reminders travel as `additionalContexts` on the `tools/post-execute` decision and are appended as logged plugin-sourced `user/message` events ([tools](../../docs/subsystems/tools.md)); the timeout split across `dsh-timeout`, capability termination, and this policy layer is recorded in the [timeout-library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md). A session budget is durable rather than advisory: it records a `budget/breach` event and blocks the goal, so the stop survives a restart ([budget-policy Agent Note](../../.agents/notes/proposed/architecture/2026-09-05-budget-policy.md)).

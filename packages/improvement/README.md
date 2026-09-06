# improvement/ — from certified sessions to training and evaluation records

English | [中文](README.zh.md)

The improvement seam turns what the harness already records into what a trainer and an evaluator consume. Environments declare tasks with executable checks in the completion-standard vocabulary; the runner runs one environment as one fresh session, stamps it, executes the checks as the validator, and completes the goal only under a certificate; the fleet runs a plan of environment × model × repetition cells through the runner and folds a leaderboard; trajectories fold persisted sessions into chat-format records whose reward a certificate decided and withhold held-out environments by the stamp; the scorekeeper folds the same logs into session facts and a scoreboard, so every number is recomputable from the log alone; an experiment freezes a plan, runs two arms over paired cells, and reports the delta with a confidence interval and a verdict; the shift driver runs the fleet unattended on a cadence, recording each shift in its own session log so a restart resumes exactly the cells that never started; and the program ledger decomposes one client deliverable into department goals, each on its own worktree and session, and releases only on a certificate of the merged head.

| Package | Role | ctx key |
|---|---|---|
| [`environments/`](environments/README.md) | Environment registry: tasks with verifiers, held out or training-eligible; the `environment/run` stamp vocabulary | `ctx.environments` |
| [`environment-runner/`](environment-runner/README.md) | Environment runner: one environment as one validated session, the runner as validator | `ctx.environmentRuns` |
| [`fleet/`](fleet/README.md) | Fleet runs: a plan of environment × model × repetition cells, every outcome kept, a leaderboard per route and environment | `ctx.fleet` |
| [`trajectories/`](trajectories/README.md) | Trajectory export: sessions as `dsh-trajectory/1` JSONL with rewards, provenance, and the environment stamp | `ctx.trajectories` |
| [`scorekeeper/`](scorekeeper/README.md) | Session facts: the `sessionFacts` projection unit, a log-derived scoreboard with pass@k per environment, and a JSONL facts export | `ctx.scorekeeper` |
| [`experiments/`](experiments/README.md) | Experiments: a frozen paired comparison of two arms over fleet cells, with bootstrap intervals and a promote/reject/inconclusive verdict | `ctx.experiments` |
| [`shifts/`](shifts/README.md) | Shifts: a cadenced, spend-windowed loop over fleet plans whose ledger lives in its own session log and whose interrupted shifts resume by ledger and run stamp | `ctx.shifts` |
| [`program/`](program/README.md) | Programs: one deliverable decomposed into department goals, each on its own git worktree, session, preset, and caps, integrated on a merged head and released on its certificate | `ctx.programs` |

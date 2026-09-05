# improvement/ — from certified sessions to training and evaluation records

English | [中文](README.zh.md)

The improvement seam turns what the harness already records into what a trainer and an evaluator consume. Environments declare tasks with executable checks in the completion-standard vocabulary; the runner runs one environment as one fresh session, stamps it, executes the checks as the validator, and completes the goal only under a certificate; the fleet runs a plan of environment × model × repetition cells through the runner and folds a leaderboard; trajectories fold persisted sessions into chat-format records whose reward a certificate decided and withhold held-out environments by the stamp; the scorekeeper folds the same logs into session facts and a scoreboard, so every number is recomputable from the log alone.

| Package | Role | ctx key |
|---|---|---|
| [`environments/`](environments/README.md) | Environment registry: tasks with verifiers, held out or training-eligible; the `environment/run` stamp vocabulary | `ctx.environments` |
| [`environment-runner/`](environment-runner/README.md) | Environment runner: one environment as one validated session, the runner as validator | `ctx.environmentRuns` |
| [`fleet/`](fleet/README.md) | Fleet runs: a plan of environment × model × repetition cells, every outcome kept, a leaderboard per route and environment | `ctx.fleet` |
| [`trajectories/`](trajectories/README.md) | Trajectory export: sessions as `dsh-trajectory/1` JSONL with rewards, provenance, and the environment stamp | `ctx.trajectories` |
| [`scorekeeper/`](scorekeeper/README.md) | Session facts: the `sessionFacts` projection unit, a log-derived scoreboard with pass@k per environment, and a JSONL facts export | `ctx.scorekeeper` |

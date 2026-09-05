# improvement/ — from certified sessions to training and evaluation records

English | [中文](README.zh.md)

The improvement seam turns what the harness already records into what a trainer and an evaluator consume. Environments declare tasks with executable checks in the completion-standard vocabulary; the runner runs one environment as one fresh session, stamps it, executes the checks as the validator, and completes the goal only under a certificate; trajectories fold persisted sessions into chat-format records whose reward a certificate decided and withhold held-out environments by the stamp.

| Package | Role | ctx key |
|---|---|---|
| [`environments/`](environments/README.md) | Environment registry: tasks with verifiers, held out or training-eligible; the `environment/run` stamp vocabulary | `ctx.environments` |
| [`environment-runner/`](environment-runner/README.md) | Environment runner: one environment as one validated session, the runner as validator | `ctx.environmentRuns` |
| [`trajectories/`](trajectories/README.md) | Trajectory export: sessions as `dsh-trajectory/1` JSONL with rewards, provenance, and the environment stamp | `ctx.trajectories` |

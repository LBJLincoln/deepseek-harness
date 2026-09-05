# improvement/ — from certified sessions to training and evaluation records

English | [中文](README.zh.md)

The improvement seam turns what the harness already records into what a trainer and an evaluator consume. Environments declare tasks with executable checks in the completion-standard vocabulary; trajectories fold persisted sessions into chat-format records whose reward a certificate decided. Neither package executes a task or calls a model.

| Package | Role | ctx key |
|---|---|---|
| [`environments/`](environments/README.md) | Environment registry: tasks with verifiers, held out or training-eligible | `ctx.environments` |
| [`trajectories/`](trajectories/README.md) | Trajectory export: sessions as `dsh-trajectory/1` JSONL with rewards and provenance | `ctx.trajectories` |

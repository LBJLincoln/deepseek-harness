# Agent Note: 夜间预检在 loop 运行之前询问 bench 的沙箱提供者

Status: implemented

[English](2026-09-27-preflight-probes-the-sandbox.md) | 中文

## Problem

2026-09-27，夜间 Routine 在一个全新的云端会话里做了一次预演。它的预检通过了每一步（安装、构建、Claude Code CLI、登录、队列的 dry run），随后冒烟 fleet 的六个 cell 全部以 `SANDBOX_UNAVAILABLE` 失败：bench 让每个 cell 在约束下运行，而这个全新容器既没有 bubblewrap，也没有构建好的 Landlock 启动器，shell 执行器于是拒绝在无约束的情况下运行。这些 cell 在被拒之前仍各自走了 13 到 17 步、调用了模型并计费，所以这一夜花了十二分钟和真实的用量，去证明一个两分钟的检查本可以说出的事实。预检检查了 loop 需要的一切，唯独漏掉了每个 cell 都需要的那一项主机能力。

## Decision

`data/proving-ground/tools/preflight.mjs` 在 `build` 与 `cli` 之间新增 `sandbox` 一步。它询问 bench 所组装的那个提供者，而不是复制其探测逻辑：一个子 Node 进程在 `packages/sandbox/sandbox-local` 中运行，于是 `@deepseek-ai/cordis` 经由提供者自己的依赖解析，`./lib/index.js` 正是构建步骤刚产出的提供者；它把 `LocalSandboxProvider` 装入一个全新的 context，按封闭 cell 的策略（对一个工作区 `workspace-write`，并在旁边拒绝一个读根）调用 `confine(['true'], …)`，然后运行包裹后的 argv。只有包裹存在且以 0 退出时这一步才通过，并在台账行上记下所选的运行器及其约束完整度；被拒时，中止行的 tail 记录提供者自己的错误，即带补救说明的 `SANDBOX_UNAVAILABLE`。Routine 的提示词随之新增一个让全新容器能够通过的主机状态步骤：`bwrap` 不存在时安装 bubblewrap。

## Alternatives considered

**把提供者的 bubblewrap 探测复制进预检。** 否决：提供者在 Linux 上的链路是先 bubblewrap、再 Landlock，有它自己的 argv 和它自己的拒绝读根规则；一旦任何一侧发生变化，复制品就会在提供者拒绝的主机上通过，或在它接受的主机上失败。

**在 fleet 内部检测该失败，并在第一个被拒的 cell 之后停止。** 有用，但属于另一件事：fleet 不应运行一个其沙箱无法约束的组合，但预检的职责是在 loop 花掉任何东西之前停下来，而且它本就是 Routine 用来提交“这一夜从未到达 loop”之证据的地方。

**依赖环境的 setup 脚本。** 对全新会话而言它是持久的修复，也是用户要做的决定；预检仍然必须在它没被做的时候说出来。

## Consequences

没有可用后端的主机，如今会在一秒之内停在 `sandbox` 这一步，并留下一行已提交、指明拒绝原因的预检记录。这一步需要构建已经跑过，步骤顺序保证了这一点；在没有构建的树上单独执行 `--steps sandbox`，会以 tail 中的导入错误中止。一旦某个全新容器在安装 bubblewrap 之后通过这一步，Routine 就可以改为每次触发都使用一个全新会话。

## Verification

在装有 bubblewrap 0.9.0 的本容器上：`node data/proving-ground/tools/preflight.mjs --steps sandbox` 在 0.2 秒内通过，`runner=bwrap enforcement=full`。把 bubblewrap 从 `PATH` 中隐去（`PATH=/opt/node22/bin`）后，同一命令在 0.1 秒内停在 `sandbox`，带有 `code: "SANDBOX_UNAVAILABLE"` 以及提供者那条把 bubblewrap 与 Landlock 列为补救办法的消息。两条测试记录随后已从 `loop/preflight.jsonl` 中删除。

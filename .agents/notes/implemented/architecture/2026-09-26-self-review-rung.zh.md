# Agent Note: 尝试阶梯上的自审档位

Status: implemented

[English](2026-09-26-self-review-rung.md) | 中文

## Problem

[假设计划的读数](../../proposed/architecture/2026-09-08-hypothesis-program-results.md)在 proving-ground bench 上只留下一种有实测价值的 harness 机制：验证密度。验证器带聚类的 `<validation_failed>` directive 循环在三次尝试下认证了 16 个 tier-5 cell 中的 15 个，对比一次尝试下的 9 个；而第四、第五次尝试、一份知识包与三个 craft skill 都没有增加任何证书。[四目标重新思考](../../proposed/process/2026-09-22-four-goals-rethink.md)把下一批杠杆指定为那些提高每 token 验证量的机制，验证之前的自审轮次是其中之一。运行器无法运行这样一轮：一次尝试是一轮实现者轮次加一次验证，运行器在任务陈述之后发送过的唯一文本是验证失败所换来的 directive，而逐次尝试的选择属于阶梯的档位，档位只携带一条路由与一个预算份额，别无其他。比较该机制开与关的实验因此没有可以命名它的 arm、没有能区分两个 arm 的摘要，也没有能把它们分开折叠的行。

## Decision

`EnvironmentRunRung.selfReview?: boolean` 在该档位上要求一轮自审。当一次尝试的实现者工作正常结束——而不是在被 cell 上限阻塞或截断的尝试之后——运行器把下面这段固定的块交给同一实现者，等待该轮次结束，然后才对检查方拥有的集合求摘要、恢复夹具并验证。route 实现者把该块单独作为 cell 会话的下一轮用户消息收到；被委派的实现者以又一个全新子进程的形式收到 `task.prompt`、一个空行与该块，经由验证跟进消息所用的同一套定形。该块是 [`packages/improvement/environment-runner/src/index.ts`](../../../../packages/improvement/environment-runner/src/index.ts) 中的模块常量，由[运行器 README](../../../../packages/improvement/environment-runner/README.md#the-attempt-ladder)、attempt-ladder e2e 与 [`self-review-rung` headless 快照](../../../../examples/headless-agent/tests/snapshots/self-review-rung/stream-json.expected.jsonl)钉住；它既不指名检查，也不指名用例或期望输出，因此聚类 directive 所守的隐藏用例之墙得以保持。

```markdown
<self_review>
Before your work is validated: re-read the specification at the top of this task and check your implementation against every requirement and corner it states — exact output on stdout and stderr, exit codes, and edge inputs the visible tests may not cover. Run the visible tests once more. Fix anything that does not match the specification, then stop.
</self_review>
```

自审轮次属于该次尝试：尝试计数与 `maxAttempts` 不变，它运行在该档位的路由上，并处于该档位 `share` 所设置的同一个界定之下，因此自审的档位无法花掉第二份份额。route 实现者的自审步骤由预算策略的 pre-step 检查像其工作一样停止。被委派的自审子进程在启动之前被度量，与实现子进程完全一样：在那里发现的 attempt 作用域越限跳过自审并让运行转入下一档位，cell 自身上限的越限跳过自审、验证工作并结束运行，而发现该越限的那次度量就是该次尝试唯一的一次，因此没有任何越限被记录两次。

该标志随档位一同流转。`resolveLadder` 在要求自审的档位的 `EnvironmentRunStampRung` 上盖上 `selfReview: true`，在拒绝或省略它的档位上什么也不盖；`decodeEnvironmentRun` 读回该标志并拒绝非布尔值；自审子进程的委派记录在 `restatedTask: true` 之旁携带 `selfReview: true`；实验摘要把它作为每个档位元组的第三个固定位置纳入，缺席时为 `false`，处于计划格式版本 9 之下；fleet 排行榜、天文台页面与记分板行键都携带它，因此仅在自审上不同的两个 arm 是两个摘要、两行与两个标签（`route @share +review`）。

## Alternatives considered

**携带验证器通道差异的 directive。** 每次验证失败给出更多信息，但这些信息正是隐藏用例所期望的东西：聚类 directive 之所以只指名通道、数量与权重，恰恰是因为一个字节的期望输出就会泄露用例。自审轮次在不触碰这面墙的前提下提高验证量，所以它先行；通道差异仍受这面墙约束，未予构建。

**由验证器选择的 best-of-n。** 每次尝试多份实现、由验证器保留通过认证的那份，会把每个 cell 的成本乘以 n，而这个 bench 的读数已经把单独的强模型列为通往证书最便宜的路线。推迟到读出一种比 n 次尝试更便宜的机制之后。

**运行器上的配置级开关。** 部署选择无法逐 arm 变化，而一个冻结配对的两个 arm 运行在同一份组合中，摘要因此无法区分它们。该标志属于档位，模型与份额已经在那里，于是实验逐次尝试命名它并冻结它。

**每次尝试调用两次 `implement`，各自设置自己的界定。** 比对两个轮次用一个界定更简单，但 `share: 0.5` 的档位就能在其工作与自审之间花掉一个 cell 的全部上限，而阶梯拒绝份额之和超过一，正是为了防止这一点。

## Consequences

实验的 arm 在某个档位上命名 `selfReview: true`，冻结配对就在相同上限下读出该机制开与关的对比；被盖章的档位、fleet 标签与记分板键在每一处折叠行的地方都让两个 arm 保持分开。每份计划摘要随格式版本改变，因此在先前格式下冻结的摘要会以 `EXPERIMENT_PLAN_NOT_FROZEN` 被拒绝，直到该计划被再次冻结，而 `experiment-presets` 快照携带新的摘要。一次自审的尝试多付一条固定用户消息与回应它所花的步骤；在被委派的 cell 上，则是每次尝试多一次子运行与多一条委派记录。自审轮次不与其尝试分开度量：运行的 `usage`、尝试记录与记分板都把它计入该次尝试之内，只有会话日志能把它的花费分离出来。

## Verification

[`packages/improvement/environment-runner/tests/environment-runner.spec.ts`](../../../../packages/improvement/environment-runner/tests/environment-runner.spec.ts) 钉住 `resolveLadder` 中的盖章、介于工作与验证之间的 route 自审轮次与普通档位上没有自审、被委派自审子进程的提示词与记录，以及三种跳过——挂钟截止截断之后、档位份额花尽且只有一条 attempt 作用域越限之后、cell 上限花尽且工作已验证并结束运行之后。[`tests/attempt-ladder.e2e.ts`](../../../../packages/improvement/environment-runner/tests/attempt-ladder.e2e.ts) 让自审的首个档位跑过真实的 `attempt-ladder` 组合，并把自审作为介于任务与 directive 之间的一条已记录用户轮次读回。[`self-review-rung` 快照](../../../../examples/headless-agent/tests/snapshots/self-review-rung/stream-json.expected.jsonl)钉住一个 cell 的完整记录稿，其自审轮次修正了随后被验证认证的工作。environments、experiments、fleet、scorekeeper 与 observatory 的 spec 钉住解码器、摘要、标签、行键与排序键。

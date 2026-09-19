# 2026-09-19-openrouter-free-v1

[English](README.md) | 中文

第一个在用途过滤下构建的数据集：每一条数据使用条款允许 `training` 的已记录 Proving Ground 轨迹，在当天的重新导出之后，就是 OpenRouter 免费层上三份记录——smoke fleet、loop 的第一次迭代、agentic fleet（[README](../../README.md)）——的 22 条轨迹，其中 18 条已认证、4 条是测得的失败，来自六个非保留第 2 层环境上的四个免费开放权重模型。[`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) 以 `--purpose training` 写出它；记录本身从不手工编辑，这个目录里没有任何东西是手写的。

## 文件

| 文件 | 内容 |
|---|---|
| `train.jsonl` | 22 条轨迹，按记录名再按轨迹 id 排序 |
| `heldout.jsonl` | 为空：没有保留环境在允许训练的条款下跑过 |
| `manifest.json` | 名称、构建时间、仓库 head、工具版本、用途过滤、每个来源记录及其清单摘要、计数、写出集合的分布、token 总量，以及每个写出文件的 SHA-256 |

只有 `manifest.json` 和这对 README 入库；用下面的命令重建其余文件，并与清单记录的摘要比对。`train.jsonl` 为 4 401 829 字节，SHA-256 为 `44a78795f43792c40f32c243615b9cae2473023f679626983fd509360ee7b988`；`heldout.jsonl` 为空，其摘要即零字节的 SHA-256。

## 过滤准入了什么、扣留了什么

这次构建在 35 份已导出记录中看到 852 条轨迹，按条款扣留了 804 条，另有 26 条作为重复被丢弃。每一条订阅记录都被固定为仅供评估，所以过滤按设计把它们全部扣留。三份准入记录中有两份由一个早于轨迹记录 `terms` 字段的构建导出，并由 [`tools/reexport-trajectories.mjs`](../../tools/reexport-trajectories.mjs) 为此重新导出——它用当前的折叠重新折叠记录自己的会话日志，并在记录的清单里同时保留两个摘要；该路由的两份部分记录只有会话日志、没有导出，所以重新导出在其中无物可替换，它们的东西一条也没有被准入。这 22 行是 `nex-agi/nex-n2.5-pro:free`（8 条，全部认证）、`poolside/laguna-s-2.1:free`（6 条，全部认证）、`nvidia/nemotron-3-super-120b-a12b:free`（6 条，4 条认证）和 `deepseek/deepseek-v4-flash-0731:free`（2 条，均未认证）：一个层、一个下午的语料，每一个奖励都是 runner 签发或拒绝的一张证书。

## 重建

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training --check
```

`--check` 按给它的标志重建，所以用途要重复一次。

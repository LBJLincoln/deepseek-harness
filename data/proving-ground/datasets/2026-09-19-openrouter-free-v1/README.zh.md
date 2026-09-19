# 2026-09-19-openrouter-free-v1

[English](README.md) | 中文

第一个在用途过滤下构建的数据集：每一条数据使用条款允许 `training` 的已记录 Proving Ground 轨迹，在构建当天就是 [`2026-09-19-bench-h1-fleet-openrouter-nex-smoke-t2`](../../README.md) 的 2 条轨迹，即 loop 在 OpenRouter 免费层上的第一次迭代。[`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) 以 `--purpose training` 写出它；记录本身从不被编辑，这个目录里没有任何东西是手写的。

## 文件

| 文件 | 内容 |
|---|---|
| `train.jsonl` | 2 条轨迹，按记录名再按轨迹 id 排序 |
| `heldout.jsonl` | 为空：没有保留环境在允许训练的条款下跑过 |
| `manifest.json` | 名称、构建时间、仓库 head、工具版本、用途过滤、每个来源记录及其清单摘要、计数、写出集合的分布、token 总量，以及每个写出文件的 SHA-256 |

只有 `manifest.json` 和这对 README 入库；用下面的命令重建其余文件，并与清单记录的摘要比对。`train.jsonl` 为 636 472 字节，SHA-256 为 `47122a0fcf78e871c5b89dce755aef9199d9a03d939376810940887c83b74e1c`；`heldout.jsonl` 为空，其摘要即零字节的 SHA-256。

## 过滤扣留了什么

这次构建在全部记录中看到 852 条轨迹，按条款扣留了 824 条，另有 26 条作为重复被丢弃。每一条订阅记录都被固定为仅供评估，所以过滤按设计把它们全部扣留。当天其余的 OpenRouter 记录——smoke fleet、被叫停的第一次启动、DeepSeek 重跑，以及带着 16 张证书的 agentic fleet——由一个早于轨迹记录 `terms` 字段的构建导出，所以它们的 `dsh-trajectory/1` 行不声明任何用途而被扣留，尽管它们的每一个会话都带着点名 `training` 的 `dataUse/terms` 事件。由当前工具重新导出这些记录即可准入它们；在那之前，这个数据集是一个模型在两个第 2 层任务上的两条已认证轨迹，是路径的证明，而不是语料。

## 重建

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training
```

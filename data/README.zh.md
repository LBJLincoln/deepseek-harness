# 数据

[English](README.md) | 中文

本仓库对自身运行所保留的记录，以文件而非断言的形式存在。

- [transcripts/](transcripts/README.md)：构建本仓库的 agent 会话的过程 transcript（文本记录），既有原始形式，也有紧凑数据集。
- [proving-ground/](proving-ground/README.md)：真实的 Proving Ground 运行，连同其 cell 会话日志、导出和 observatory 页面；[proving-ground/dashboard.html](proving-ground/dashboard.html) 是由全部记录折叠而成的那一个页面，[proving-ground/improvement-log.md](proving-ground/improvement-log.md) 是这些运行所检验的每一次改进迭代的台账，[proving-ground/datasets/](proving-ground/README.md) 存放训练语料的折叠。
- [knowledge/](knowledge/README.md)：从有日期的研究扫描中提炼出的知识包，以带来源的语料保存，并作为 skill 提供给 agent。
- [code-safety/](code-safety/README.md)：对本 harness 未曾编写的仓库所做的真实代码安全评审，连同每次发布的报告、其背后的发现，以及已提交的审查器给出的裁定。

四者都是分析记录。唯一的例外是 `proving-ground/datasets/` 下一份清单以 `training` 为用途的折叠：它只包含钉定条款允许训练的会话，今天即免费的开放权重路由，而且它是一份可重建的记录索引，而非语料。`data/` 下的其余一切按其条款仅供评估：RLVR 语料来自 harness 自身在条款允许的路由上完成的经认证运行，并由[数据使用条款](../packages/governance/data-use/README.md)与 [curator](../packages/governance/curator/README.md) 把关。

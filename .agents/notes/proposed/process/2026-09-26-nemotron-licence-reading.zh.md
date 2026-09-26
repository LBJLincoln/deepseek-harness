# Agent Note: NVIDIA-Nemotron-3-Super-120B-A12B 所适用许可的一次细读

Status: proposed

[English](2026-09-26-nemotron-licence-reading.md) | 中文

## Problem

[RLVR 基座模型注记](../architecture/2026-09-19-rlvr-recipe-and-base-model.md)把 NVIDIA-Nemotron-3-Super-120B-A12B 列为次选基座模型，并把它的许可记为「NVIDIA Nemotron Open Model License（`license:other`，允许商用；训练用途导出需先做一次条款法务审查，随后由 `dsh-data-use` 编码进去）」。这次审查至今无人做过。仓库里关于同一许可的另一处表述指向相反方向：[EU AI Act 知识包（knowledge pack）](../../../../data/knowledge/2026-q3/skills/eu-ai-act-gpai-2026q3/references/items.md)以「该许可与 Nemotron 3 Super 属于同一受限系列」为由，否决了用一个同系列检查点产出训练产物。两处表述都没有引用任何条款，因此一位被要求裁定此事的律师只能从零开始。

这个问题已经落在数据里。[`with-openrouter` 叠加层](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml)为该路由上的每个会话钉定同一份协议 `proving-ground-openrouter-free`，用途为 `training` 与 `evaluation`，而它的模型列表包含 `nvidia/nemotron-3-super-120b-a12b:free`；叠加层自己的注释把逐模型的决定——「某个模型的许可是否允许其输出作为训练数据，在准入时逐模型决定」——推给了一个至今无人记录的决定。[Proving Ground 第四十条记录](../../../../data/proving-ground/README.md)`2026-09-19-bench-h2-openrouter-agentic-t2` 在这些条款下跑了六个 Nemotron 单元；它的 `trajectories.jsonl` 含十八行 `dsh-trajectory/2` 记录，其中六行的 `model` 为 `nvidia/nemotron-3-super-120b-a12b:free`，每一行都钉定为允许 `training` 的 `proving-ground-openrouter-free`。[`dsh-data-use`](../../../../packages/governance/data-use/README.md)允许后来的钉定收窄用途、绝不允许放宽，因此创建时钉定的用途在一个方向上是永久的，而一个本不该钉定的用途只能靠排除规则挡在语料之外。

本注记是一位非法律专业人士对许可文本所做的一次审慎、有出处的细读。它不是法律意见；任何 Nemotron 输出的训练用途导出都不会仅凭本注记进行。它的存在是为了让法务从逐字引用、带节号的实际条款出发，也为了让法务答复之后要写进 `dsh-data-use` 的条款已经拟好。

## Proposal

记录管辖文本，逐字引用与下面七个问题有关的每一条条款，为每条给出字面解读，列出只有法务能回答的问题，并为两种结论各拟一份 `dsh-data-use` 条款。本节就是这次细读；随后两个小节是它的两项产物。这里没有任何内容是法律意见，凡是决定会依赖的地方都没有改写原文。

### 管辖该检查点的文本

[模型卡](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16)在头部元数据（front matter）和「License/Terms of Use」一节中声明许可，而本次读取的仓库修订版本完全不含许可文件：文件列表中没有 `LICENSE`、`LICENSE.md`、`LICENSE.txt` 与 `NOTICE`，各自的 raw 路径都返回 404。许可通过模型卡上的链接附着于检查点。

```text
license: other
license_name: nvidia-nemotron-open-model-license
license_link: >-
  https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/
```

```text
This model is ready for commercial use.
```

```text
**Governing Download Terms:** Use of this model is governed by the [NVIDIA Nemotron Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/).
```

链接指向的是 [NVIDIA 的许可页面](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/)。页面正文标题为「NVIDIA Nemotron Open Model License」，标注「Last Modified: December 15, 2025」，在一段序言与结尾标记「(v. December 15, 2025)」之间排列十个编号条款，全文 1,221 个英文词。页面链接了[该许可的 PDF](https://www.nvidia.com/content/dam/en-zz/Solutions/license-agreements/enterprise-software/NVIDIA-Nemotron-Open-Model-License-12-12-25.pdf)，共两页，经 PDF 转文本解析器读取：同样的序言、同样措辞的同样十个条款、同样的结尾标记，且没有「Last Modified」一行。两个来源都不含 §1 中「Work」定义所引用的附录（Appendix）。模型卡的第二段管辖条款关于受另外两份 NVIDIA 协议约束的 NIM 容器；它不涉及不经 NIM 直接提供权重的路由，本文不读它。

```text
Model card: https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16
  raw card: https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16/raw/main/README.md
  read 2026-09-26; repository revision 2dc98e2afe4face0e4ce40972a915c45368bd34a, last modified 2026-08-25T15:48:50Z
  README.md sha256 cade76c064eda90d4f53e12614f45816ae6cfe43dacc8a9410abcc2fc7a17e59 (82,606 bytes)
  no LICENSE, LICENSE.md, LICENSE.txt, or NOTICE file in the revision; each raw path answers 404
Licence page: https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/
  fetched 2026-09-26T22:43:59Z; HTML sha256 b247a0220d98932469625c1a0b87ff8d0cf7a1c6332c5de48098714abd6ff45d (299,095 bytes)
  title "NVIDIA Nemotron Open Model License"; "Last Modified: December 15, 2025"; closing marker "(v. December 15, 2025)"
  licence body as text, from the title line to "END OF TERMS AND CONDITIONS", with tags removed, character entities decoded,
  runs of spaces collapsed, and one line per paragraph: sha256 ff43fc669f58899c4df41b48aa65da125378e13ea0972c0cdd68624834da5bbc, 1,221 words
Licence PDF: https://www.nvidia.com/content/dam/en-zz/Solutions/license-agreements/enterprise-software/NVIDIA-Nemotron-Open-Model-License-12-12-25.pdf
  fetched 2026-09-26; sha256 2ffd837856bb99d4cee13d17f0b597ecfeb95c38e30abc08d3dffef7d589881d (66,058 bytes, 2 pages)
  same preamble, ten sections, and "(v. December 15, 2025)" marker; no "Last Modified" line; no Appendix
```

下面的每一段引文都取自该哈希对应的页面文本。页面把条款标题加粗，并把 §3 的字母编号条件缩进；引文去掉了这些排版，保留每一个字符，包括原文中弯引号与直引号的混用。

### （a）经第三方托管做推理

OpenRouter 路由把提示词发给一份托管的权重副本并收回输出；本仓库既不复制、不分发，也不表演任何内容。决定这种使用是否被允许、附带何种条件的条款，是序言中的接受条款、§1 中「You」与「Legal Entity」的定义，以及 §2 的授权。

```text
By using, reproducing, modifying, distributing, performing or displaying any portion or element of the Works or Derivative Works, or otherwise accepting the terms of this License, you agree to be bound by this License.
```

```text
“Legal Entity” shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.
“You” (or “Your”) shall mean an individual or Legal Entity exercising permissions granted by this License.
```

```text
2. Grant of License. Subject to the terms and conditions of this License, NVIDIA hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in source or object form.
```

字面解读：许可授予托管方托管所需的权利——复制、公开表演、分发——既不对托管附加条件，也不对调用方附加任何条件；「host」「API」「inference」这些词在文本中都不出现，「service」只出现一次，在 §4 的「service marks」里。序言的接受条款点名「using ... any portion or element of the Works」，这可能使调用方成为受许可约束的「You」；若是如此，能触及一个不做分发者的义务只有：（e）下 §2 的诉讼条款、（b）下 §7 的赔偿保障条款，以及（g）下的 §9 与 §10。管辖该路由的其他文件——OpenRouter 的条款、上游提供方的数据政策、若上游是 NVIDIA 自己的端点则还有 NVIDIA 自己的 API 条款——都是本次细读之外的独立法律文件。

### （b）把输出用作另一个模型的训练数据

RLVR 计划所系的问题：录下的 Nemotron 输出，也就是我们的 trajectory，能否用来训练另一个模型？提到输出的条款有序言第三条要点、（e）下引用的 §2 诉讼句、§6 的责任限制和 §7 的赔偿保障；§1 中「Work」与「Derivative Works」（派生作品）的定义决定一个用输出训练出的模型本身会不会算派生作品。

```text
NVIDIA Works released under this License are intended to be used permissively and enable the further development of AI technologies. Subject to the terms of this License, NVIDIA confirms that:
Works are commercially usable.
You are free to create and distribute Derivative Works.
NVIDIA does not claim ownership to any outputs generated using the Works or Derivative Works.
```

```text
“Work” shall mean the work of authorship, including machine learning model, software, checkpoints, learnt weights, algorithms, parameters, configuration files and documentation, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).
“Derivative Works” shall mean any work, whether in source or object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.
```

```text
7. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of NVIDIA, and only if You agree to indemnify, defend, and hold NVIDIA harmless for any liability incurred by, or claims asserted against, NVIDIA by reason of your accepting any such warranty or additional liability. You will indemnify and hold harmless NVIDIA from and against any claim by any third party arising out of or related to your use or distribution of the Works, Derivative Works thereof, or output from the Works or Derivative Works.
```

字面解读：文本对训练一事保持沉默。它不含任何关于输出用途的限制，不含关于训练或改进另一个模型的条款，也没有「竞争模型」之类的措辞：「train」「distill」「compet」「improve」这几个字符串在全部 1,221 个词中一次都没有出现。它关于输出所说的是：NVIDIA 不主张对输出的所有权；NVIDIA 对输出免责（§6）；主张某个输出侵权会终止许可（§2，见（e））；以及你就「your use or distribution of ... output from the Works」引发的第三方索赔向 NVIDIA 提供赔偿保障（§7）——这项保障覆盖使用，而不只是再分发。放弃所有权主张不是对输出授予权利，也丝毫没有说明第三方对输出享有什么权利。用输出训练出的模型是否属于「Derivative Work」，取决于「based on (or derived from) the Work」在可分离性排除条款下如何解读；一个不含 Work 任何权重、代码或配置的模型读起来是可分离的，但文本没有给出定论，而这个答案决定 §3 的条件与 §4 是否附着于训练出的产物。

### （c）微调 Nemotron 本身并再分发结果

经微调或 RL 训练的 Nemotron 检查点，按本文对 §1 定义的解读属于派生作品。§2 授予准备、再许可与分发它的权利；§3 规定再分发的条件，并允许对整体附加你自己的条款。

```text
3. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in source or object form, provided that You meet the following conditions:
a. You must give any other recipients of the Work a copy of this License; and
```

```text
You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.
```

字面解读：微调与再分发都被允许，附三项条件——向每位接收者提供本许可的副本（§3a）、保留声明（§3b）以及 NOTICE 声明（§3c），后两项在（d）下引用——并且只要满足 Work 自身的条件，派生作品整体可以采用不同的条款。没有任何条款要求派生物的名称带有「Nemotron」或其他任何标识，也不存在任何形式的命名条件；相反的问题，即派生物能否在名称中带「Nemotron」，是 §4 下的商标问题。向下游传递的义务是许可文本本身（§3a）与各项声明（§3b、§3c）；没有可接受使用政策需要向下传递，因为文本中不含任何这样的政策。

### （d）署名、声明与商标

```text
b. You must retain, in the source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and
c. If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the following attribution notice within a “Notice” text file with such copies and the following statement: “Licensed by NVIDIA Corporation under the NVIDIA Nemotron Model License.”
```

```text
4. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of NVIDIA, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.
```

字面解读：Work 源形式中的各项声明必须保留在所分发派生作品的源形式中（§3b）；§3c 的 NOTICE 文件条件以 Work 包含「NOTICE」文本文件为前提，而本次读取的修订版本不含这样的文件，因此 §3c 是否对该检查点有约束力尚无定论；在它有约束力之处，要求的声明写的是「NVIDIA Nemotron Model License」，而非页面标题所用的「NVIDIA Nemotron Open Model License」，且声明必须照原文复制。§4 除描述来源与复制 NOTICE 内容之外，不授予任何商标权利。

### （e）约束下游用户的可接受使用、终止与安全条款

文本不含可接受使用政策、禁止用途清单，也不含任何安全、护栏或负责任使用条款：「acceptable」「prohibit」「safety」「guardrail」「trustworthy」「harmful」「policy」都不出现，「harm」仅出现在 §7 的两处「hold harmless」免责表述中。唯一的终止条款是 §2 的诉讼句；授权本身是「perpetual」且「irrevocable」的。

```text
If You institute patent or copyright litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or an output from the Work constitutes direct or contributory patent or copyright infringement, then any licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.
```

字面解读：下游用户除了 §3 所传递的内容——一份许可副本与各项声明——之外不受任何约束，因为再没有别的东西可传递；许可对就 Work 或其输出提起诉讼的被许可人终止，除此之外没有其他明示的终止事由。§5（保证免责）、§6（责任限制，其中把「an output from the Work or Derivative Work」列入 NVIDIA 免责的对象）与 §8（反馈）对你有约束力但不限制任何用途；本文不引用它们。模型卡还有一句话，是指引而非许可条款，但因为它提到「our terms of service」，法务可能想看一眼：

```text
NVIDIA believes Trustworthy AI is a shared responsibility and we have established policies and practices to enable development for a wide array of AI applications. When downloaded or used in accordance with our terms of service, developers should work with their internal model team to ensure this model meets requirements for the relevant industry and use case and addresses unforeseen product misuse.
```

### （f）许可随时间变化

```text
“License” shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 10 of this document.
```

```text
Last Modified: December 15, 2025
```

```text
(v. December 15, 2025)
```

字面解读：文本没有修订、更新或后续版本条款——「amend」只在 §10 关于法律的「as amended」中出现一次，「update」与「version」一次都不出现——因此文件把自己定义为这十个条款，对 NVIDIA 修改页面之后会发生什么只字未提。模型卡链接的是不带版本的 URL，所以未来一次下载所受的管辖文本就是页面当天提供的内容，而今天录下的会话跑在上述哈希对应的文本之下。PDF 的文件名带着日期 12-12-25，其正文则带着标记「(v. December 15, 2025)」；两个日期相差三天，只有后者位于文本之内。§1「Work」定义所引用的附录在两个来源中都不存在，因此标示一个 Work 的「copyright notice」在本次细读能触及的任何地方都没有示例。

### （g）地域与出口管制

```text
9. Governing Law. This Agreement will be governed in all respects by the laws of the United States and the laws of the State of Delaware, without regard to conflict of laws principles or the United Nations Convention on Contracts for the International Sale of Goods. The state and federal courts residing in Santa Clara County, California will have exclusive jurisdiction over any dispute or claim arising out of or related to this Agreement, and the parties irrevocably consent to personal jurisdiction and venue in those courts; except that, either party may apply for injunctive remedies or an equivalent type of urgent legal relief in any jurisdiction.
```

```text
10. Trade and Compliance. You agree to comply with all applicable export, import, trade and economic sanctions laws and regulations, as amended, including without limitation U.S. Export Administration Regulations and Office of Foreign Assets Control regulations. These laws include restrictions on destinations, end-users and end-use.
```

字面解读：许可本身不对使用划任何地域界线——授权是「worldwide」的，没有任何领土或驻留地区限制它，文本中点名的地点只有 §9 的管辖法律与管辖法院——但 §10 以引用方式纳入美国出口与制裁法律，点名「destinations, end-users and end-use」三个维度，§9 则固定为特拉华州法律与圣克拉拉县法院。这些法律中哪些会触及权重、派生作品或存放在叠加层所钉定的 `eu-west` 驻留地区的输出，以及按 §1 百分之五十控制权测试作为「You」的「Legal Entity」究竟是谁，都是关于本组织的事实，文本无法解决。

### 只有法务能回答的问题

1. 用 Nemotron 输出训练出的模型是否属于 §1 下的「Derivative Work」——「based on (or derived from) the Work」对照可分离性排除条款——从而 §3 的条件与 §4 是否附着于 RLVR 计划产出的产物。
2. 「NVIDIA does not claim ownership to any outputs」（序言）是否使输出可以自由用于训练，还是仅仅放弃 NVIDIA 自己的主张，而第三方的权利以及 §7 针对「your use ... of ... output」的赔偿保障依然存在。
3. 调用一个托管端点是否使调用方按序言的「By using ... any portion or element of the Works」成为「You」；若是，对一个既不复制也不分发任何内容的一方随之产生哪些义务。
4. 除本许可之外还有哪些文件管辖 OpenRouter 路由的输出——OpenRouter 的条款、上游提供方的数据政策、若上游是 NVIDIA 自己的端点则还有 NVIDIA 的 API 条款——以及其中是否有任何一份在本许可未作限制之处限制了用输出训练。
5. 约束一个会话的是哪个版本：首次使用权重时不带版本的 URL 所提供的文本，还是每个会话运行时的现行文本；以及当所引用的附录不存在、仓库修订版本不含任何许可或声明文件时，按 §1 是什么标示了一个「Work」。
6. 对于修订版本中不含「NOTICE」文件的检查点，§3c 是否被触发，以及其声明是否必须以「NVIDIA Nemotron Model License」的确切措辞复制。
7. 一个微调后的发布版本能否作为 §4 下「reasonable and customary use in describing the origin of the Work」在名称中带「Nemotron」，还是那属于许可未授予的商标使用。
8. 对于存放在 `eu-west` 或发往别处的权重、派生作品与输出，§10 对本组织有何要求；按 §1 百分之五十控制权测试哪个实体是「You」；以及 §9 的管辖法院能否接受。
9. §7 的赔偿保障对训练用途造成何种风险敞口，因为其最后一句覆盖「use」而不只是分发，并点名了「output from the Works」。
10. 对于在该领域持有专利的组织，§2 的诉讼条款意味着什么，因为主张「an output from the Work」侵权会终止许可。

### `dsh-data-use` 将编码的内容

`dsh-data-use` 为每个部署钉定一套条款，因此叠加层推迟的逐模型决定通过组合来做：每个许可系列一份协议，而不是每条路由一份。协议是运营方自己的文件；它的 `agreementId` 点名准入所依据的许可文本与版本，于是一个会话钉定的条款就能说明是哪次解读接纳了它。臂为 `nvidia/nemotron-3-super-120b-a12b:free` 的计划在钉定 Nemotron 协议的叠加层下运行，路由上的 Apache-2.0 与 MIT 模型则继续沿用 `proving-ground-openrouter-free`。

在法务回答问题 2 之前，Nemotron 协议只接纳 `evaluation`。`residency`、`retentionDays` 与 `redactionProfile` 沿用叠加层的取值，因为许可对它们没有任何规定；`clientId` 不变。

```yaml
- id: data-use
  name: '@deepseek-ai/dsh-data-use'
  config:
    clientId: daliesk-lab
    agreementId: proving-ground-openrouter-nemotron
    purposes:
      - evaluation
    residency: eu-west
    retentionDays: 90
    redactionProfile: village-v1
```

法务确认问题 2 之后，同一份协议接纳 `training` 与 `evaluation`，顺序与叠加层现有列法一致，`--purpose training` 的 curator 导出从那时起接纳新钉定的会话。由于钉定绝不放宽，在仅评估协议下录下的会话将永久留在所有训练导出之外：Nemotron 训练语料从决定之后钉定的第一个会话开始，这是在创建时钉定的代价，也是在更多 Nemotron 单元运行之前先拿到答复的理由。

第四十条记录的六条 Nemotron trajectory 在本次细读之前就以 `proving-ground-openrouter-free` 钉定为 `training`，并且不带 `curation` 块，因此 [`dsh-curator`](../../../../packages/governance/curator/README.md) 从未见过它们。记录不会被改写。在法务回答问题 2 之前，[`build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs)——它今天按条款与留出状态扣留、排除委托与篡改的行、按停止原因遮蔽负样本并丢弃重复——新增一条以记录的 `model` 字段为键、针对 `nvidia/nemotron-3-super-120b-a12b:free` 的排除规则，fold 的 manifest（元数据清单）报告因此被排除的数量。

许可自身的义务——§3 的许可副本、各项声明与 NOTICE 声明，§4 的商标限制——附着于再分发的派生作品，而不是 transcript（文本记录），因此它们不是条款字段：它们属于 RLVR 注记最终产出的训练产物的发布清单，而本注记就是那份清单引用它们的出处。

## Alternatives considered

**只依赖 Hugging Face 的 `license:other` 标签。** 不采用：这个标签什么也没有说明。它只表示该许可不在 Hugging Face 列出的许可之列，从逐字的 Apache 2.0 到仅限研究的授权它都容纳；只有链接指向的文本才说明什么被允许。

**默认把输出视为无负担。** 不采用：条款必须读，而读过之后它说的比这个默认假设的更少。「NVIDIA does not claim ownership」是一项免责表述，不是一项授权，同一文本中的赔偿保障还覆盖对输出的使用；「无负担」的默认还会让条款机制形同虚设，因为 `dsh-data-use` 的存在是为了记录一次解读，而不是预设一次解读。

**改选 Apache-2.0 基座并跳过这个问题。** 作为跳过问题的方式不采用，尽管 Qwen3.5-122B-A10B 仍是 RLVR 注记的推荐。这样做会失去本仓库今天唯一能在 OpenRouter 路由上免费实测的候选、唯一由厂商公开了训练它所用的 RL 训练器与环境的候选，以及该级别中的纯文本检查点。而且它并不能消除这个问题：Nemotron 单元已经在那条路由上、在一份接纳 `training` 的协议下运行，因此无论 Nemotron 最终是否被训练，路由的条款都需要这个逐模型的决定。

## Acceptance criteria

- 对于（a）至（g）中的每一项，法务仅凭所引用的条款、无需重读许可，即可确认或纠正字面解读；每处纠正连同其所依据的条款引文一起落入本注记的后继注记。
- 重新获取所记录的 URL 能复现所记录的哈希，否则在任何决定引用本注记之前，先对照变化后的文本重读。
- 每段围栏引文在所述归一化规则下与获取到的文本逐字节一致，且两个语言文件携带完全相同的围栏代码块。
- 臂为 `nvidia/nemotron-3-super-120b-a12b:free` 的计划在钉定 `proving-ground-openrouter-nemotron`、`purposes: [evaluation]` 的叠加层下运行，对这样一次运行做 `--purpose training` 的 curator 导出时，每个 Nemotron 会话都计入 `withheldByTerms`。
- 在法务答复之前构建的训练 fold 按 `model` 字段排除已记录的六条 Nemotron trajectory，其 manifest 报告该数量。
- 法务确认问题 2 之后，Nemotron 协议接纳 `training` 与 `evaluation`，Nemotron 训练语料从此后钉定的第一个会话开始。

## Risks

- **文本可能被修订。** 模型卡链接的是不带版本的 URL，许可除日期标记外没有版本条款。本注记钉住了它所读到的内容——获取于 2026-09-26，HTML sha256 `b247a022…`，正文文本 sha256 `ff43fc66…`，PDF sha256 `2ffd8378…`——引用本注记的决定必须先重新获取并比对。
- **引文必须精确。** 引文从页面 HTML 中提取：去掉标签、解码字符实体、合并连续空格；加粗与缩进被去掉，原文弯引号与直引号的混用被保留。提交前已用脚本把每一行引文与提取文本逐行核对；从渲染页面复制的文本可能仅在空白字符上有差异。
- **解读可能有误。** 这是非法律专业人士的解读，其中的「不含」判断依赖对一篇 1,221 词文本的词语检索；上面列出的问题正是律师的答案最可能不同之处。
- **Work 没有被标示。** §1 通过一条版权声明来识别 Work，其示例在两个来源都不含的附录里，而仓库修订版本不含任何许可或声明文件；许可附着于什么，由模型卡的链接而非文本本身确定。
- **其他文件可能在本许可未作限制之处施加限制。** OpenRouter 的条款、上游提供方的数据政策以及 NVIDIA 自己的 API 或 NIM 条款都未读过；其中任何一份都可能约束本仓库所用路由的输出。
- **六条 trajectory 已带有 `training`。** 它们按原样留在记录中；排除是构建器的一条规则，在该规则存在之前，对那条记录构建训练 fold 会接纳它们。
- **知识包的「受限系列」表述与本次细读相冲突。** 如果它依据的是另一份 NVIDIA 许可文本——它所涉及的 Nemotron 3.5 检查点本文未读——那份文本在任何此类检查点进入计划之前需要自己的一次细读；如果它依据的是本文这份文本，则本注记取代它。

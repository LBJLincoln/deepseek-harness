# Agent Note: A reading of the licence that governs NVIDIA-Nemotron-3-Super-120B-A12B

Status: proposed

English | [中文](2026-09-26-nemotron-licence-reading.zh.md)

## Problem

[The RLVR base-model note](../architecture/2026-09-19-rlvr-recipe-and-base-model.md) names NVIDIA-Nemotron-3-Super-120B-A12B as the runner-up base model and records its licence as "NVIDIA Nemotron Open Model License (`license:other`, commercial use permitted; a training-purpose export needs a legal read of the terms, which `dsh-data-use` then encodes)". Nobody has done that reading. The repository's other statement about the same licence points the other way: [the EU AI Act knowledge pack](../../../../data/knowledge/2026-q3/skills/eu-ai-act-gpai-2026q3/references/items.md) rejects a sibling checkpoint for a trained artefact because "the licence is the same restricted family as Nemotron 3 Super". Neither statement quotes a clause, so a lawyer asked to settle the question would start from nothing.

The question is already live in the data. [The `with-openrouter` overlay](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml) pins one agreement, `proving-ground-openrouter-free`, with purposes `training` and `evaluation` for every session on that route, and its model list includes `nvidia/nemotron-3-super-120b-a12b:free`; its own comment defers the per-model decision — "whether a given model's licence admits its outputs as training data is decided per model at admission" — to a decision nobody has recorded. [The fortieth proving-ground record](../../../../data/proving-ground/README.md), `2026-09-19-bench-h2-openrouter-agentic-t2`, ran six Nemotron cells under those terms; its `trajectories.jsonl` holds eighteen `dsh-trajectory/2` lines, six with `model` `nvidia/nemotron-3-super-120b-a12b:free`, every one pinned `proving-ground-openrouter-free` admitting `training`. [`dsh-data-use`](../../../../packages/governance/data-use/README.md) lets a later pin narrow purposes and never widen them, so a purpose pinned at creation is permanent in one direction, and a purpose that should not have been pinned can only be kept out of a corpus by an exclusion rule.

This note is a careful, sourced reading of the licence text by a non-lawyer. It is not legal advice, and no training-purpose export of Nemotron outputs proceeds on this note alone: it exists so that counsel starts from the operative clauses, quoted verbatim with their section identifiers, and so that the `dsh-data-use` terms that follow counsel's answer are already drafted.

## Proposal

Record the governing text, quote every clause that bears on the seven questions below, state a plain reading of each, list the questions only counsel can answer, and draft the `dsh-data-use` terms for both outcomes. This section is that reading; the next two subsections are its two products. Nothing here is legal advice, and no clause was paraphrased where a decision would rest on it.

### The text that governs the checkpoint

[The model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16) declares the licence in its front matter and in a "License/Terms of Use" section, and the repository at the revision read carries no licence file at all: `LICENSE`, `LICENSE.md`, `LICENSE.txt`, and `NOTICE` are absent from the file list and answer 404 at their raw paths. The licence attaches to the checkpoint by the card's link.

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

The linked page is [NVIDIA's licence page](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/). Its body is titled "NVIDIA Nemotron Open Model License", is marked "Last Modified: December 15, 2025", runs ten numbered sections between a preamble and the closing marker "(v. December 15, 2025)", and is 1,221 words long. The page links [a PDF of the licence](https://www.nvidia.com/content/dam/en-zz/Solutions/license-agreements/enterprise-software/NVIDIA-Nemotron-Open-Model-License-12-12-25.pdf), two pages, read through a PDF-to-text parser: the same preamble, the same ten sections in the same words, the same closing marker, and no "Last Modified" line. Neither source carries the Appendix that the definition of "Work" in §1 cites. The card's second governing-terms paragraph concerns the NIM container under two other NVIDIA agreements; it does not reach a route that serves the weights without NIM, and it is not read here.

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

Every quotation below is taken from the page text at that hash. The page marks section titles in bold and indents §3's lettered conditions; the quotations drop that formatting and keep every character, including the source's mix of curly and straight quotation marks.

### (a) Inference through a third-party host

The OpenRouter route sends prompts to a hosted copy of the weights and receives outputs; this repository reproduces, distributes, and performs nothing. The clauses that decide whether such use is permitted and on what conditions are the acceptance sentence of the preamble, the definitions of "You" and "Legal Entity" in §1, and the grant in §2.

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

Plain reading: the licence grants the host what hosting needs — reproduce, publicly perform, distribute — and places no condition on hosting and none on a caller; the words "host", "API", and "inference" do not appear in the text, and "service" appears once, in §4's "service marks". The preamble's acceptance sentence names "using ... any portion or element of the Works", which may make a caller a "You" bound by the licence; if it does, the obligations that reach a non-distributor are the litigation clause of §2 under (e), the indemnity in §7 under (b), and §9 and §10 under (g). Whatever else governs the route — OpenRouter's terms, the upstream provider's data policy, NVIDIA's own API terms if the upstream is NVIDIA's endpoint — is a separate instrument outside this reading.

### (b) Outputs as training data for a different model

The question the RLVR program turns on: may recorded Nemotron outputs, our trajectories, train a different model? The clauses that mention outputs are the third preamble bullet, the litigation sentence of §2 quoted under (e), the liability limitation in §6, and the indemnity in §7; the definitions of "Work" and "Derivative Works" in §1 decide whether a model trained on outputs could itself be a Derivative Work.

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

Plain reading: the text is silent on training. It contains no restriction on the use of outputs, no clause about training or improving another model, and no competing-model language: the strings "train", "distill", "compet", and "improve" do not occur anywhere in the 1,221 words. What it says about outputs is that NVIDIA does not claim ownership of them, that NVIDIA disclaims liability for them (§6), that alleging an output infringes ends the licence (§2, under (e)), and that You indemnify NVIDIA against third-party claims arising from "your use or distribution of ... output from the Works" (§7) — an indemnity that covers use, not only redistribution. A disclaimer of ownership is not a grant of rights in outputs and says nothing about third parties' rights in them. Whether a model trained on outputs is a "Derivative Work" turns on "based on (or derived from) the Work" read against the separability exclusion; a model that contains no weights, code, or configuration of the Work reads as separable, but the text does not decide it, and the answer fixes whether §3's conditions and §4 attach to the trained artefact.

### (c) Fine-tuning Nemotron itself and redistributing the result

A fine-tuned or RL-trained Nemotron checkpoint is a Derivative Work under §1's definition as read here. §2 grants the right to prepare, sublicense, and distribute it; §3 states the conditions of redistribution and permits terms of Your own for the whole.

```text
3. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in source or object form, provided that You meet the following conditions:
a. You must give any other recipients of the Work a copy of this License; and
```

```text
You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.
```

Plain reading: fine-tuning and redistribution are permitted, on three conditions — a copy of this licence to every recipient (§3a), retained notices (§3b) and the NOTICE statement (§3c) both quoted under (d) — and the Derivative Work as a whole may carry different terms so long as the Work's own conditions are met. No clause requires the derivative's name to carry "Nemotron" or any other mark, and there is no naming condition of any kind; the opposite question, whether a derivative may carry "Nemotron" in its name, is a trademark question under §4. The pass-through obligation is the licence text itself (§3a) and the notices (§3b, §3c); there is no acceptable-use policy to flow down because the text contains none.

### (d) Attribution, notice, and trademark

```text
b. You must retain, in the source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and
c. If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the following attribution notice within a “Notice” text file with such copies and the following statement: “Licensed by NVIDIA Corporation under the NVIDIA Nemotron Model License.”
```

```text
4. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of NVIDIA, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.
```

Plain reading: notices in the Work's source form must be kept in a distributed derivative's source form (§3b); the NOTICE-file condition of §3c is conditional on the Work including a "NOTICE" text file, and the revision read includes none, so whether §3c binds this checkpoint at all is open; where it binds, the required statement names the "NVIDIA Nemotron Model License", not the "NVIDIA Nemotron Open Model License" the page is titled, and the statement must be reproduced as written. §4 grants no trademark rights beyond describing origin and reproducing the NOTICE content.

### (e) Acceptable use, termination, and safety clauses that bind downstream users

The text contains no acceptable-use policy, no prohibited-use list, and no safety, guardrail, or responsible-use clause: "acceptable", "prohibit", "safety", "guardrail", "trustworthy", "harmful", and "policy" do not occur in it, and its only occurrences of "harm" are the two "hold harmless" indemnities of §7. The only termination clause is the litigation sentence of §2; the grant itself is "perpetual" and "irrevocable".

```text
If You institute patent or copyright litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or an output from the Work constitutes direct or contributory patent or copyright infringement, then any licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.
```

Plain reading: a downstream user is bound to nothing beyond what §3 passes through — a copy of the licence and the notices — because there is nothing else to pass; the licence ends for a licensee who sues over the Work or an output from it, and for no other stated cause. §5 (warranty disclaimer), §6 (limitation of liability, which names "an output from the Work or Derivative Work" among the things NVIDIA disclaims liability for), and §8 (feedback) bind You and restrict no use; they are not quoted here. The model card carries one further sentence, guidance rather than a licence term, which counsel may want to see because it refers to "our terms of service":

```text
NVIDIA believes Trustworthy AI is a shared responsibility and we have established policies and practices to enable development for a wide array of AI applications. When downloaded or used in accordance with our terms of service, developers should work with their internal model team to ensure this model meets requirements for the relevant industry and use case and addresses unforeseen product misuse.
```

### (f) The licence changing over time

```text
“License” shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 10 of this document.
```

```text
Last Modified: December 15, 2025
```

```text
(v. December 15, 2025)
```

Plain reading: the text has no amendment, update, or successor-version clause — "amend" occurs once, in §10's "as amended" about laws, and "update" and "version" not at all — so the document defines itself as its ten sections and says nothing about what happens when NVIDIA changes the page. The card links the unversioned URL, so the text a future download is governed by is whatever the page serves that day, while a session recorded today ran under the text at the hash above. The PDF's file name carries the date 12-12-25 and its text the marker "(v. December 15, 2025)"; the two dates differ by three days, and only the marker is inside the text. The Appendix that §1's "Work" definition cites is absent from both sources, so the "copyright notice" that marks a Work is not exemplified anywhere this reading could reach.

### (g) Geography and export control

```text
9. Governing Law. This Agreement will be governed in all respects by the laws of the United States and the laws of the State of Delaware, without regard to conflict of laws principles or the United Nations Convention on Contracts for the International Sale of Goods. The state and federal courts residing in Santa Clara County, California will have exclusive jurisdiction over any dispute or claim arising out of or related to this Agreement, and the parties irrevocably consent to personal jurisdiction and venue in those courts; except that, either party may apply for injunctive remedies or an equivalent type of urgent legal relief in any jurisdiction.
```

```text
10. Trade and Compliance. You agree to comply with all applicable export, import, trade and economic sanctions laws and regulations, as amended, including without limitation U.S. Export Administration Regulations and Office of Foreign Assets Control regulations. These laws include restrictions on destinations, end-users and end-use.
```

Plain reading: the licence itself draws no geographic line on use — the grant is "worldwide", no territory or residency limits it, and the only places named are the governing law and venue of §9 — but §10 incorporates U.S. export and sanctions law by reference, with "destinations, end-users and end-use" named as the three axes, and §9 fixes Delaware law and Santa Clara County courts. Which of those laws reach the weights, a Derivative Work, or the outputs at the `eu-west` residency the overlay pins, and who the "Legal Entity" that is "You" is under §1's fifty-percent control test, are facts about this organization that the text does not settle.

### What only counsel can answer

1. Whether a model trained on Nemotron outputs is a "Derivative Work" under §1 — "based on (or derived from) the Work" against the separability exclusion — and therefore whether §3's conditions and §4 attach to the artefact the RLVR program produces.
2. Whether "NVIDIA does not claim ownership to any outputs" (preamble) leaves the outputs free to train on, or merely disclaims NVIDIA's claim while third parties' rights, and §7's indemnity for "your use ... of ... output", remain.
3. Whether calling a hosted endpoint makes the caller a "You" under the preamble's "By using ... any portion or element of the Works", and if so which obligations follow for a party that reproduces and distributes nothing.
4. Which instruments beyond this licence govern the OpenRouter route's outputs — OpenRouter's terms, the upstream provider's data policy, NVIDIA's API terms if the upstream is NVIDIA's own endpoint — and whether any of them restricts training on outputs where this licence does not.
5. Which version binds a session: the text served at the unversioned URL when the weights were first used, or the text current when each session ran; and what marks a "Work" under §1 when the cited Appendix is absent and the repository revision carries no licence or notice file.
6. Whether §3c is triggered for a checkpoint whose revision includes no "NOTICE" file, and whether its statement must be reproduced with its exact wording "NVIDIA Nemotron Model License".
7. Whether a fine-tuned release may carry "Nemotron" in its name as "reasonable and customary use in describing the origin of the Work" under §4, or whether that is a trademark use the licence does not grant.
8. What §10 requires of this organization for weights, Derivative Works, and outputs stored at `eu-west` or sent elsewhere, and which entity is "You" under the fifty-percent control test of §1; and whether the §9 venue is acceptable.
9. What exposure the §7 indemnity creates for a training use, since its last sentence covers "use", not only distribution, and names "output from the Works".
10. What the §2 litigation clause means for an organization that holds patents in the field, since alleging that "an output from the Work" infringes ends the licence.

### What `dsh-data-use` would encode

`dsh-data-use` pins one set of terms per deployment, so the per-model decision the overlay defers is made by composition: one agreement per licence family, not one per route. The agreement is the operator's own instrument; its `agreementId` names the licence text and version the admission rests on, so a session's pinned terms say which reading admitted it. Plans whose arm names `nvidia/nemotron-3-super-120b-a12b:free` run under an overlay that pins the Nemotron agreement, while the Apache-2.0 and MIT models on the route keep `proving-ground-openrouter-free`.

Until counsel answers question 2, the Nemotron agreement admits `evaluation` alone. `residency`, `retentionDays`, and `redactionProfile` keep the overlay's values, because the licence says nothing about any of them; `clientId` is unchanged.

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

After counsel confirms question 2, the same agreement admits `training` and `evaluation`, in that order as the overlay already lists them, and a `--purpose training` curator export admits the sessions pinned from then on. Because a pin never widens, the sessions recorded under the evaluation-only agreement stay out of every training export permanently: the Nemotron training corpus begins with the first session pinned after the decision, which is the cost of pinning at creation and the reason to obtain the answer before more Nemotron cells run.

The six Nemotron trajectories of the fortieth record were pinned `training` under `proving-ground-openrouter-free` ahead of this reading and carry no `curation` block, so [`dsh-curator`](../../../../packages/governance/curator/README.md) never saw them. Records are not rewritten. Until counsel answers question 2, [`build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs), which today withholds by terms and held-out status, excludes delegated and tampered rows, masks negatives by stop reason, and drops duplicates, gains an exclusion keyed on the record's `model` field for `nvidia/nemotron-3-super-120b-a12b:free`, and the fold manifest reports the count it excluded on that ground.

The licence's own obligations — the licence copy, notices, and NOTICE statement of §3, the trademark limit of §4 — attach to a redistributed Derivative Work, not to a transcript, so they are not terms fields: they belong on the release checklist of whatever trained artefact the RLVR note produces, and this note is where that checklist quotes them from.

## Alternatives considered

**Rely on the Hugging Face `license:other` tag alone.** Rejected: the tag names nothing. It says only that the licence is not one Hugging Face lists, and it admits any terms from a verbatim Apache 2.0 to a research-only grant; the linked text is the only thing that says what is allowed.

**Treat outputs as unencumbered by default.** Rejected: the clause must be read, and once read it says less than the default assumes. "NVIDIA does not claim ownership" is a disclaimer, not a grant, and the same text's indemnity covers use of outputs; a default of "unencumbered" would also make the terms machinery pointless, since `dsh-data-use` exists to record a reading, not to presume one.

**Pick the Apache-2.0 base and skip the question.** Rejected as a way of skipping it, though Qwen3.5-122B-A10B remains the RLVR note's recommendation. It would cost the one candidate this repository can measure today at no charge on the OpenRouter route, the one candidate whose vendor published the RL trainer and the environments it was trained with, and the text-only checkpoint in the class. And it would not remove the question: Nemotron cells already run on that route under an agreement admitting `training`, so the route's terms need the per-model decision whether or not Nemotron is ever trained.

## Acceptance criteria

- For each of (a) through (g), counsel confirms or corrects the plain reading from the quoted clauses alone, without re-reading the licence; each correction lands in this note's successor with the clause it rests on quoted.
- A fresh fetch of the recorded URLs reproduces the recorded hashes, or the note is re-read against the changed text before any decision cites it.
- Every fenced quotation is byte-identical to the fetched text under the stated normalization, and the two language files carry identical fences.
- A plan whose arm names `nvidia/nemotron-3-super-120b-a12b:free` runs under an overlay pinning `proving-ground-openrouter-nemotron` with `purposes: [evaluation]`, and a `--purpose training` curator export over such a run counts every Nemotron session in `withheldByTerms`.
- A training fold built before counsel's answer excludes the six recorded Nemotron trajectories by the `model` field, and its manifest reports that count.
- After counsel confirms question 2, the Nemotron agreement admits `training` and `evaluation`, and the Nemotron training corpus starts with the first session pinned afterwards.

## Risks

- **The text may be revised.** The card links an unversioned URL and the licence has no versioning clause beyond its date marker. This note pins what it read — fetched 2026-09-26, HTML sha256 `b247a022…`, body text sha256 `ff43fc66…`, PDF sha256 `2ffd8378…` — and a decision that cites it must first re-fetch and compare.
- **Quoting must be exact.** The quotations were extracted from the page's HTML by removing tags, decoding entities, and collapsing runs of spaces; bold and indentation were dropped, and the source's mixed curly and straight quotation marks were kept. Each quoted line was checked mechanically against the extracted text before commit; a copy made from the rendered page may differ in whitespace alone.
- **The reading may be wrong.** It is a non-lawyer's reading, and its absence claims rest on word search over one 1,221-word text; the questions above are where a lawyer's answer is most likely to differ.
- **The Work is not marked.** §1 identifies a Work by a copyright notice exemplified in an Appendix that neither source carries, and the repository revision carries no licence or notice file; what the licence attaches to is fixed by the card's link, not by the text.
- **Other instruments may restrict what this licence does not.** OpenRouter's terms, the upstream provider's data policy, and NVIDIA's own API or NIM terms were not read; any of them may bind the outputs of the route this repository uses.
- **Six trajectories already carry `training`.** They stay in the record as written; the exclusion is a builder rule, and until it exists a training fold over that record admits them.
- **The knowledge pack's "restricted family" statement conflicts with this reading.** If it rests on a different NVIDIA licence text — the Nemotron 3.5 checkpoint it concerns was not read here — that text needs its own reading before any such checkpoint enters a plan; if it rests on this text, this note supersedes it.

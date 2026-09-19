# Agent Note: 代码安全知识包采用扁平技能根目录,而非扫描式资料包

Status: implemented

[English](2026-09-19-code-safety-knowledge-pack.md) | 中文

## 问题

某客户概念验证项目需要让安全评审团队在分析客户的 Web 后端、Web 前端或移动客户端代码之前,阅读一份权威的、面向代码模式的参考资料:评审方法论、映射到具体代码模式的 OWASP Top 10 与 CWE Top 25、按评审方向划分的检查清单(密钥、注入、访问控制、数据、依赖、平台)、包含结论模式的严重程度与证据评分标准,以及集成程序用于生成报告的版式。这些内容需要按评审方向按需加载,而不是塞进每一次提示词中。

`data/knowledge/` 下现有的每一项都是按时间窗口进行的扫描式资料包:`pack.json` 记录时间窗口与外部信息来源,`corpus/items.json` 合并各来源报告的去重条目,`skills/<theme>/SKILL.md` 位于嵌套的 `skills/` 目录下,旁边还有生成出的 `references/items.md`,整套流程由 `data/knowledge/tools/build-pack.mjs` 构建和校验。而安全评审方法与标准标识符既没有时间窗口,也不来自某次外部扫描,因此并不适合这种结构。

## 决策

`data/knowledge/code-safety/` 是一个普通的技能根目录,而非扫描式资料包:十一个目录直接位于资料包根目录下,每个目录中只有一个 `<name>/SKILL.md`——`review-method`、`owasp-top-10`、`cwe-top-25`、`secrets`、`injection`、`access`、`data`、`dependencies`、`platform`、`severity-and-evidence`、`report-template`。这里没有 `pack.json`、`manifest.json`、`corpus/`,也没有嵌套的 `skills/` 目录。有一个独立的程序会将该目录本身挂载到 [`@deepseek-ai/dsh-skill-filesystem`](../../../../packages/skill/skill-filesystem/README.md) 上,设置 `customSkillDirs: ['data/knowledge/code-safety']` 与 `includeDefaultRoots: false`,并直接以这些目录名引用各项技能。每个 `SKILL.md` 只携带该提供方要求的 `name`/`description` frontmatter 字段,篇幅控制在 300 至 900 词之间,并直接在正文中引用 CWE 与 OWASP 标识符,而不是通过生成的引用文件。资料包根目录携带双语的 `README.md`/`README.zh.md`(说明目的、技能列表、挂载方式,以及「本资料包用于指导评审、不能替代渗透测试」这条规则);各个 `SKILL.md` 正文本身仅保留英文。

## 备选方案

**套用扫描式资料包的结构。** 已否决:该结构的约定是针对某次外部扫描、按时间窗口组织,并为每条条目记录证据与来源;而本资料包的内容是评审团队自身的方法与标准标识符,没有扫描来源也没有时间窗口可记录,若照搬 `pack.json` 的 `window`/`sources` 字段以及 `corpus`/`build-pack.mjs` 那套机制,只会是围绕从不按扫描节奏变化的内容摆设的空壳。

**把整个评审方向写成一个大的 `SKILL.md`。** 已否决:挂载程序按目录名加载技能,以便只引入与被评审代码相关的方向(例如只加载 `secrets` 而不连带加载 `platform`);合并成一个文件会导致每次引用都要加载整个资料包,篇幅也会大大超出单技能的词数上限。

**为每个 `SKILL.md` 正文都翻译出一份 `.zh.md`。** 已否决:现有资料包中没有任何一个技能正文带有中文版本——`scripts/translation-pairing.ts` 中的 `isTranslationScopeFile` 本就不会把 `SKILL.md` 纳入双语语料库,它只匹配 `README` 相关文件、`.agents/notes/`、`docs/` 与 `python/`。为十一份技术参考资料都维护第二语言版本,而交付物中已经包含双语部分(即[报告模板](../../../../data/knowledge/code-safety/report-template/SKILL.md)里的法语版执行摘要),只会增加翻译维护负担却没有实际读者。

## 影响

- 挂载程序可以直接将 `customSkillDirs` 指向 `data/knowledge/code-safety`,得到恰好十一条技能目录项,无需再处理一层 `skills/` 间接目录。
- `pnpm run verify-translation-pairing` 的全库检查不会要求这里的任何 `SKILL.md` 配有 `.zh.md`,这与其他知识资料包的做法一致;只有本资料包自身的 `README.md` 是双语的,并记录在 `README.i18n.yaml` 中。
- 日后若要在 `scripts/run-gates.ts` 中新增知识资料包相关的门禁(目前尚不存在——`grep -n knowledge scripts/run-gates.ts` 没有任何匹配),必须同时兼顾两种资料包结构:扫描式资料包的 `pack.json`/`manifest.json`/`corpus`/`skills/<theme>`,以及本资料包的扁平 `<name>/SKILL.md`,否则就要明确将门禁范围限定为其中一种。
- 每个 `SKILL.md` 中关于 OWASP 与 CWE 的内容,都是本资料包撰写之时的一份快照;与扫描式资料包不同,这里没有时间窗口或构建步骤会强制刷新内容,因此保持内容时效性,要靠日后修改这些文件的人手动完成。

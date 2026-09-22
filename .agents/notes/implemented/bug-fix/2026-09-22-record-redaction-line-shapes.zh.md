# Agent Note: 记录脱敏覆盖单个字符串之外的密钥行

Status: implemented

[English](2026-09-22-record-redaction-line-shapes.md) | 中文

## Problem

`data/code-safety/tools/redact-record.mjs` 只在私钥的 `-----BEGIN … PRIVATE KEY-----` 与 `-----END … PRIVATE KEY-----` 标记位于同一个字符串、密钥体夹在二者之间时才替换密钥体，并且只要密钥体不是以 JSON 转义换行开头，就用原始换行拼接标记。记录下来的会话日志里有三种形态逃过了这条规则。文件读取工具的 `lines` 元数据把文件的每一行存成各自独立的 JSON 字符串，因此密钥的 base64 行作为独立条目跟在 BEGIN 条目之后，整块规则从不匹配。一个把多个目标文件拼接输出的工具在两行之后截断了密钥，根本没有写出 END 标记。一个标注行尾的工具在每个换行前放一个 `$`，整块规则匹配了，但推导出的分隔符是原始换行，把一条 JSONL 行拆成了三条。记录 `2026-09-21-nodegoat-3`、`2026-09-22-nodegoat-4-improved` 以及第二次迭代配对的两次运行，其 `secrets` 部门日志中带有 NodeGoat 演示服务器密钥的密钥体，而 README 却声明密钥材料已被替换；两条 `2026-09-19` 的 NodeGoat 记录从第三行起带有密钥体，藏在早先一个不完整的标记之后；配对的第一次 `with` 运行含有一条无法解析的会话行。该密钥是 OWASP 随 NodeGoat 发布的公开演示密钥，因此没有任何机密被暴露；但对这些文件而言，声明的脱敏契约是不成立的。

## Decision

工具保留整块规则，并在每个 BEGIN 标记之后增加逐行遍历：它按文件所用的分隔符一次消费一行（原始换行、任意编码深度的 JSON 转义换行、二者之前可选的 `$`，或 `lines` 条目之间的 `"},{"number":N,"text":"` 边界），把最多 76 列、只含 base64 的行替换为 `[REDACTED PRIVATE KEY BODY]`，跨过早先脱敏已替换过的行，并在 END 标记或第一条不属于上述任何一种的行处停止。扁平密钥体折叠为一行标记；`lines` 条目则每个条目保留一个标记，以保持 JSON 可解析。整块规则现在以密钥体中任意位置最先出现的任一种换行作为分隔符，密钥体中没有换行时则不加任何拼接。`redactRecord` 在工具对同一记录运行两次时合并同一文件的计数。`data/code-safety/` 下的每条记录都重新过了一遍工具，被拆开的会话行已拼回，每份 manifest 的摘要已刷新；`record-run.mjs` 在为新记录计算摘要之前运行同一个函数，因此配对剩余的运行在记录时即被覆盖。

## Alternatives considered

**只脱敏发现的那几个文件。** 逐行遍历就是 README 所声明的规则，只是应用到了记录器此前未见过的形态；一次性手工编辑会让下一条记录带着同样的缺口。

**替换会话日志中任何位置的所有长 base64 串。** 会话日志中合法地存在 base64（摘要、编码后的工具载荷）；遍历只在私钥 BEGIN 标记之后开始，并在第一条不是密钥体的行处停止。

**丢弃 `lines` 条目而不是替换其文本。** deck 的读取轨迹统计部门读过的行数；替换文本能保住这个计数，也保住 JSON 的完整。

## Consequences

`data/code-safety/README.md` 中的脱敏契约对记录在案的各种形态都成立。只引用 BEGIN 行的搜索命中，以及 secrets 技能中提到该标记的散文，都不会被改动，因为其后没有 base64 行。BEGIN 标记之后一行若是仅由 base64 字符组成的裸路径，也会被脱敏；实际路径都带有点或短横线，这种误判的代价只是日志里的一条路径。

## Verification

`data/code-safety/tools/redact-record.cases.mjs` 为每种形态各持有一个用例（整块、`lines` 元数据、部分标记过的 `lines` 元数据、一层与两层编码深度下被截断的密钥、带 `$` 标注的整块与截断密钥、不被改动的搜索命中与散文、示例 AWS 密钥，以及对每个输出的不动点）；`scripts/code-safety-redaction.spec.ts` 在 `pnpm run test` 下运行它。重新运行之后，对所有已跟踪文本文件的审计没有发现任何 PEM 头之后跟着 base64 行，每个记录文件都能解析，每份 manifest 的摘要都与其文件一致，`redact-record.mjs --dry-run` 对每条记录都报告无可脱敏之处。

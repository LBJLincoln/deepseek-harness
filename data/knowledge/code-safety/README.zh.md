# 代码安全

[English](README.md) | 中文

这是安全评审团队在分析客户应用代码——包括 Web 后端、Web 前端和移动客户端——之前需要阅读的技能集合,涵盖六个评审方向(密钥、注入、访问控制、数据、依赖、平台),外加五项贯穿全局的技能,用于确定方法、引用标准标识符并规范交付物的形式。

## 技能列表

| 技能 | 内容 |
| --- | --- |
| [review-method](review-method/SKILL.md) | 评审方法论:先看入口点、从输入追踪到汇聚点、每个汇聚点一条结论、精确到行、置信度分级,以及「未覆盖范围」必须列出的内容。 |
| [owasp-top-10](owasp-top-10/SKILL.md) | OWASP Top 10 2021 版与 2025 版分类,对应的 CWE 编号以及各语言、各框架下的代码模式。 |
| [cwe-top-25](cwe-top-25/SKILL.md) | CWE Top 25:每一项的一段式识别线索及其预期修复方式。 |
| [secrets](secrets/SKILL.md) | 凭证与密钥的特征模式、常见误报,以及修复方式(轮换、纳入密钥管理)。 |
| [injection](injection/SKILL.md) | SQL/NoSQL 注入、命令注入、模板与 eval 注入、XSS、路径穿越、SSRF 与反序列化,以及各框架下的安全替代方案。 |
| [access](access/SKILL.md) | 身份认证、会话管理、授权(含 IDOR)、CSRF 以及 JWT 相关陷阱。 |
| [data](data/SKILL.md) | 敏感数据暴露、日志中的 PII 与密钥、传输安全、密码学误用、密码存储参数以及备份。 |
| [dependencies](dependencies/SKILL.md) | 阅读各生态的清单与锁定文件、运行审计工具、识别抢注包与废弃包,以及撰写漏洞结论。 |
| [platform](platform/SKILL.md) | 安全响应头、CORS、Cookie、错误处理、限流、文件上传、调试端点以及 Docker/nginx 配置错误。 |
| [severity-and-evidence](severity-and-evidence/SKILL.md) | 严重程度评分标准、证据规则、结论的 JSON 模式,以及去重规则。 |
| [report-template](report-template/SKILL.md) | 集成程序生成报告所用的版式,附一份完整示例。 |

## 挂载方式

有一个独立的程序会将本目录作为 [`@deepseek-ai/dsh-skill-filesystem`](../../../packages/skill/skill-filesystem/README.md) 的技能根目录进行挂载:`customSkillDirs: ['data/knowledge/code-safety']`,并设置 `includeDefaultRoots: false`,使技能目录中恰好只包含上述十一项技能,并以上面的目录名进行引用。

## 本资料包不是什么

本资料包用于指导代码评审,并不能替代渗透测试。它发现的是阅读者能够在源码中追踪到的模式,而非运行时行为、部署配置,或任何需要真正攻击一个运行中系统才能确认的问题。基于本资料包得出的「无问题」报告,只能证明所读代码的情况,不能证明该应用程序是安全的。

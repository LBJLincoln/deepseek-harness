# Agent Note：claude-code profile

Status: implemented

[English](2026-09-18-claude-code-profile.md) | 中文

## Problem

`dsh --profile headless "task"` 是产品的一次性编码运行，而它需要 `DEEPSEEK_API_KEY`：base 组合包的 `agent-default-model` 指定 `deepseek-official`／`deepseek-v4-flash`，每一条带密钥的路由都要解析一份操作者可能并不持有的凭据。harness 其实早就可以在没有密钥的情况下运行——`@deepseek-ai/dsh-llm-claude-code` 由操作者已完成登录的 Claude Code 安装来服务 LLM 接缝——但只有手写的组合用到了它。Proving Ground 基准配置是唯一组合该路由的地方，它是与其驱动器并列的原始 `cordis.yml`，因此一个持有 Claude Code 订阅却没有 API key 的操作者无从运行：没有任何随附 profile 触及那条路由，而在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 里手工复刻基准的那些配置行，本应由安装自身承担。

## Decision

新增第三个内置组合包 `@deepseek-ai/dsh-claude-code`（位于 `packages/bundle/claude-code`），以及 `PROFILE_TEMPLATES` 中的 `claude-code` 条目，其层顺序为 `dsh-base`、`dsh-headless`，然后是本组合包，因此 `dsh --profile claude-code "task"` 会像 `headless` 一样在首次使用时自动初始化。该组合包与 `dsh-base` 一样是没有运行时 API 的 patch 层：它的实体是 `cordis.patch.yml`，经 `dsh.bundle.patch` manifest（元数据清单）字段解析。

该层只触及三行配置，别无其他。它插入 `llm-claude-code`，目录与基准组合的一致——提供方 `claude-code`，产品别名 `opus`、`sonnet` 与 `haiku` 及其 `productModel` 和 200,000 token 的 `contextWindow`，`effort: medium`，以及五分钟的 `queryTimeoutMs`——因此两处组合指的是同一批模型，在基准上测得的数据也就描述了随发行版交付的 profile。它把 `agent-default-model` 重新指向 `claude-code`／`sonnet`，并重新写全两个字段，因为按 id 定向的 patch 会整体替换 config。它还把 `system-prompt` 的 persona 重述为 `You are a coding agent powered by the Claude Code {{model}} model.`，保留 `dsh-headless` 使用的那些占位符，因为在这条路由上 `{{model}}` 渲染出的是产品别名，而 headless 的 persona 没有任何内容说明由谁来服务。

带密钥的适配器仍然保持挂载。`llm-deepseek` 在没有凭据时依旧注册路由、目录依旧可浏览，只有真正需要凭据的那次请求会失败；`llm-pi-ai` 在设置段落提供 provider profile 之前根本不注册路由。两者都不会让无密钥的加载失败。禁用它们只会拿掉用户自己的 patch 层仍可选择的路由，而 profile 的层次顺序正是为了容许这种选择而存在。

包名为 `@deepseek-ai/dsh-claude-code`，与其目录同名，一如其他所有包，因此 `tsconfig.base.json` 中的 `@deepseek-ai/dsh-*` 通配符无需逐包条目就能把它映射到源码。本组的组合包名陈述它们所是的那一层 profile（`base`、`web-app`、`headless`），而不带 "profile" 一词。

## Alternatives considered

- **不新增 profile，直接改随附的 `headless` 模板。** 拒绝：路由是部署选择，而不是模式本身。持有密钥的操作者和持有订阅的操作者想要的是同一个一次性模式，替他们选定路由的模板会拿走另一种可能。
- **在 `dsh-headless` 内部用 `!!js` 表达式按某个 `DSH_*` 变量条件化该路由。** 拒绝：让一个环境变量悄悄改变由哪家公司服务请求，恰恰与 profile 约定相反——在那里，组合出的配置树在启动前就能用 `--dump-config` 读出；`AGENTS.md` 也要求把随部署而变的选择放在经校验的配置里，而不是藏在默认值中。
- **把基准的整份 `cordis.yml` 作为组合包发布。** 拒绝：基准组合了 fleet、实验、验证与 curator，这些都不是一次性编码运行所需要的。可以迁移过来的只有路由相关的配置行。
- **在本层禁用 `llm-deepseek` 与 `llm-pi-ai`。** 拒绝：两者都不会让无密钥的加载失败；而给这个 profile 添加了密钥的用户，还得重新启用被本层关掉的配置行。

## Consequences

`dsh --profile claude-code "task"` 是一次跑在操作者自有订阅上的无密钥一次性运行，`apps/cli` 因此多了一个组合包依赖，而该组合包对 `@deepseek-ai/dsh-llm-claude-code` 的依赖会经启动器的依赖闭包遍历进入 profile 模块回退目录。由该路由引出的两项模型可见事实记录在组合包 README 的限制小节中：该安装会把 harness 的系统提示词包进一层会话日志无法重建的外壳，而模型 id 是产品别名，其解析归该安装所有，而不归本组合。想要其他别名、effort 或连续性模式的部署，可在自己的 profile `cordis.patch.yml` 中覆盖该行，并重新写全要保留的字段。

## Testing

组合包测试套件经启动器自身的双锚点 `loadProfile` 解析三个真实的组合包，并用 `composeEntries` 组合它们随附的 patch 文件，钉住路由的完整配置、默认选择、persona 占位符、未被触及的一次性模式配置行，以及带密钥的适配器仍处于启用状态——且没有任何未匹配 patch 的警告，这正是本层所定向的那些 id 确实存在于其下层的证明。app-boot 的 profile 套件钉住新模板的层顺序及其自动初始化出的 manifest。一次在空目录中对 `dsh --profile claude-code` 的真实运行创建了所要求的文件，并留下两条记录着 `claude-code`／`sonnet` 的 `assistant/message` 事件，第一条是全新会话，第二条在同一个产品会话上续接。

# `@deepseek-ai/dsh-claude-code`

[English](README.md) | 中文

dsh Claude Code 组合包。[`cordis.patch.yml`](cordis.patch.yml) 是叠加在 [`dsh-base`](../base/README.md) 与 [`dsh-headless`](../headless/README.md) 之上的 patch 层：它让一次性任务模式的每一次模型请求都由操作者已完成登录的 Claude Code 安装来服务，因此 `dsh --profile claude-code "task"` 无需 API key 即可运行与 `--profile headless` 相同的任务模式。本包没有运行时 API；profile 组合器只通过 `dsh.bundle.patch` manifest（元数据清单）字段解析该 patch，不经过任何代码。

该层只触及三行配置。它插入 `llm-claude-code`（[`dsh-llm-claude-code`](../../llm/llm-claude-code/README.md)）作为 `claude-code` 提供方路由，覆盖三个模型——`opus`、`sonnet` 与 `haiku`，每个都带上请求该安装运行的 `productModel` 以及 200,000 token 的 `contextWindow`——并设置 `effort: medium` 与五分钟的 `queryTimeoutMs`。它把 [`agent-default-model`](../../core/agent-default-model/README.md) 重新指向 `claude-code`／`sonnet`；按 id 定向的 patch 会整体替换 config，因此两个字段都要重新写全。它还重述了 `system-prompt` 的 persona，因为 headless 的 persona 只渲染 `{{model}}`、没有任何内容说明由谁来服务，而在这条路由上该占位符解析出的是产品别名。其余一切不变：该路由注入 `subprocess`，base 层已经以 `@deepseek-ai/dsh-subprocess-local` 挂载了它；一次性 runner、它的 startup 提供方以及被禁用的 HMR 行都保持 `dsh-headless` 组合出的样子。

带密钥的适配器仍然保持挂载。[`llm-deepseek`](../../llm/llm-deepseek/README.md) 按请求解析凭据，没有凭据时路由依然注册、目录依然可浏览；[`llm-pi-ai`](../../llm/llm-pi-ai/README.md) 在 `llm-pi-ai:` 设置段落提供 provider profile 之前根本不注册任何路由。两者都不会让无密钥的加载失败，因此禁用它们只会拿掉用户自己的 profile patch 层仍可选择的路由。

## 模型体验

### 部署 persona

#### 模型看到的内容

本层在 `system-prompt` 行上配置的 persona，渲染为顺序为 0 的 `deployment:persona` 段落；其中 `{{model}}` 解析为所选模型 id（除非请求指定了其他模型，否则为 `sonnet`），`{{cwd}}` 解析为会话的工作目录。选择 `claude-code` 路由还意味着整个提示词是包裹在该安装自己的系统提示词外壳中抵达模型的，而 [`dsh-llm-claude-code`](../../llm/llm-claude-code/README.md) 既不撰写也无法检视那层外壳。

##### persona 原文

```markdown
You are a coding agent powered by the Claude Code {{model}} model. Your working directory is {{cwd}}.
```

#### Token 影响

每次请求一句短句，它替换 `dsh-headless` 配置的 persona 而不是追加在其后；该安装的外壳还会另外增加一份固定开销，本层不对其计量。

#### KV Cache 影响

persona 位于系统提示词最前端，并在一个会话内保持恒定，因此可复用前缀得以保留；在该路由默认的 `per-session` 连续性下，该安装会从自己的提示词缓存中读回这段前缀。

## 已知限制与延期工作

- **该安装的系统提示词外壳不在会话日志中**：persona 与其余提示词段落都由 harness 撰写，但产品会用本组合既不写入也看不到的文本把它们包起来，因此每次请求都有一项模型可见输入无法从日志重建。
- **每个 harness 会话对应一个产品会话**：该路由默认的 `per-session` 连续性会在一次运行的各步之间复用同一个产品会话，因此在两步之间被杀死的进程会在操作者自己的配置目录里留下该会话的 transcript。
- **模型 id 是产品别名**：`opus`、`sonnet` 与 `haiku` 指的是请求该安装运行的目标，而不是锁定的模型版本，因此一次运行实际执行的内容随该安装变化，而不随本组合变化。

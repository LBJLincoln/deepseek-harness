# @deepseek-ai/dsh-mcp-tool-server

[English](README.md) | 中文

把**一个**本仓库智能体自己的工具注册表作为一台 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器提供给外部智能体，并把收到的每一次调用都通过该智能体上的 `ctx.tools.execute()` 执行。它是 [`dsh-mcp-client`](../mcp-client/README.md) 的反向：后者把外来服务器的工具注册到 `ctx.tools` 上，而这里是外来模型来够本仓库的工具，因此审批、注册表守卫、每个工具自己派发的文件系统策略、环绕派发的包装器，以及持久的 `tool/call`/`tool/result` 事件对，全都作用于一个本进程之外的模型所请求的工作。

设计理由归 [external-agent bridge Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-external-agent-bridge.md)。它的首个消费者是桥接模式下的 [`dsh-subagent-claude-code`](../../subagent/subagent-claude-code/README.md)。

## 用法

```yaml
- id: mcp-tool-server
  name: '@deepseek-ai/dsh-mcp-tool-server'
  config:
    serverName: dsh
```

消费者调用 `instance(agent)`，把 handle 的 `config` —— `{ type: 'sdk', name, instance }`，即 Agent SDK 原样接受的进程内服务器配置 —— 以该 handle 的 `serverName` 交给运行外部模型的那一方，并在运行结束时等待 `dispose()`。`toolNames` 报告实际提供了什么，供消费者记录这次运行。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `serverName` | `dsh` | 请求未指定时，一次被服务的运行所使用的 MCP 命名空间。须匹配 `[A-Za-z0-9_-]{1,32}`，因为消费方客户端会把每个被提供的工具限定为 `mcp__<serverName>__<tool>`。 |

`instance(agent, request)` 按运行接受同一个命名空间；`resolve(request)` 是唯一为它兜底默认值的地方，模式之外的命名空间在那里就被拒绝，而不是等到第一次工具调用。

## 一次被服务的运行就是一个 turn

`tool/call` 与 `tool/result` 是 step 作用域事件：[会话不变式](../../core/session/README.md)要求二者各自指名当前打开的 turn 与 step。因此一个 handle 恰好拥有被服务智能体会话的一个 turn —— 创建时追加 `turn/start` 与 `step/start`，`dispose()` 追加 `step/end` 与 `turn/end` —— 这正是外部智能体的调用得以持久化的前提。它也是诚实的记录：外部智能体的一次运行**就是**授权它的那个本仓库会话的一个 turn。

这成立的前提是：被服务的智能体是为一次运行创建、且无人另行驱动的子智能体。会话中已有 turn 打开的智能体在 `instance()` 处被拒绝，同一智能体上的第二个活跃运行同样被拒。插件销毁会释放该服务仍持有的每一次运行，因此被销毁的组合不会留下未关闭的 turn。

## 一次被服务的调用究竟做了什么

工具清单就是该智能体自己的注册表视图（`ctx.tools.schemas(agent)`），在 `instance()` 处取快照：它是外部模型据以规划的东西，也是消费者持久记录所指名的东西，因此一套在其脚下改变的集合会让两者都变错。名字原样提供；`mcp__<serverName>__` 限定由消费方客户端施加。

一次 `tools/call` 会追加 `tool/call`，等待 `ctx.tools.execute({ callId, name, arguments, agent, signal })`，追加引用该调用的 `tool/result`，并返回执行器渲染出的内容。快照之外的名字会被拒绝，即使被够到，它在执行器处仍会以 `UNKNOWN_TOOL` 失败：清单是呈现，执行器才是权威。

## Model Experience

### 被提供的工具清单

#### 模型看到什么

外部模型为被服务智能体所见的每个工具看到一个 MCP 工具，携带本仓库的描述与 JSON Schema，原样不变。它看不到本仓库的提示词、persona 或会话历史 —— 被提供的只有工具，别无他物。

#### Token 影响

这些 schema 的开销由外部产品在它自己的上下文里支付。任何本仓库模型的上下文都不会因此增加。

#### KV Cache 影响

与每一个本仓库请求缓存无关。快照在整次运行期间固定，因此外部产品自己的前缀在其各轮之间保持稳定。

### 一次被服务调用的结果

#### 模型看到什么

工具面向模型的内容，压平成一份文本载荷 —— 与本仓库模型会收到的投影相同。非文本块会被指名而不是丢弃，执行器的失败（一次拒绝、一次守卫、一次工具错误）则作为携带该消息的 MCP 错误结果抵达。

#### Token 影响

由外部产品的上下文支付。本仓库会话持久记录同样的内容；由于该 `tool/*` 事件对对该智能体而言仅进日志 —— 那里没有模型被驱动 —— 它不会进入任何本仓库请求。

#### KV Cache 影响

在被服务智能体的日志中只追加，且与任何本仓库请求前缀无关。

## Known Limitations and Deferred Work

- **尚无 HTTP 面** —— `serve(agent)`，即同一台服务器经 SDK 的 Streamable HTTP 传输在回环端口上提供、配以每次运行的 bearer token，是接收 MCP 端点而非进程内实例的外部智能体（Codex、ACP）所需要的。它需要一个监听器、一次 token 比对、每次运行的传输记账，以及自己的拒绝测试，其中没有一样与进程内那一面共享，因此它等待真正需要它的消费者。
- **工具集是快照** —— 在 `instance()` 之后注册、注销或被限制的工具不会抵达正在运行的外部模型，也不会发送 `tools/list_changed` 通知。
- **不提供 MCP resources、prompts 或 completions** —— 该服务器只声明 `tools` 能力；索要其他内容的客户端得到 SDK 的不支持方法错误。
- **每个智能体一次运行** —— 同一智能体上的并发被服务运行会被拒绝而不是多路复用，因为它们会共用一个 turn。
- **取消属于客户端** —— 一次被服务的调用跟随该 MCP 请求自己的信号；除了销毁 handle（由消费者持有）之外，没有办法取消一次运行尚未完成的调用。

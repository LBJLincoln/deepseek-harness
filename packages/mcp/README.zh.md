# MCP — 模型上下文协议

[English](README.md) | 中文

将 harness 与 MCP 生态系统桥接的包。

| 包 | 职责 |
|---|---|
| [`mcp-client/`](mcp-client/README.md) | MCP 客户端桥接，将外部服务器工具注册到 `ctx.tools` |
| [`mcp-tool-server/`](mcp-tool-server/README.md) | MCP 服务器，把一个智能体自己的工具提供给外部智能体，并把每一次调用都通过本仓库执行器执行 |

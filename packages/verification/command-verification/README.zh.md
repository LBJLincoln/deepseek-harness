# @deepseek-ai/dsh-command-verification

[English](README.md) | 中文

面向人的只读 `/verification` 命令，渲染会话的证据台账：当前完成标准、带每项检查通过证据的证书状态、已记录的放宽，以及指令计数。变更操作保留在验证者一侧的服务动词上；本适配器只做读取。

## 配置

```yaml
- id: verification
  name: '@deepseek-ai/dsh-verification'
- id: command-verification
  name: '@deepseek-ai/dsh-command-verification'
```

命令通过 `ctx.commands` 全局注册，并要求完成标准服务；没有命令适配器的组合只是永远不会调用它。

## 命令

`/verification` 不接受参数。没有当前标准时打印空台账提示；有标准时打印 goal、修订号、证书状态（`certified` 附隔离级别与通过检查数，或 `not certified`）、附结果描述的活动检查（存在覆盖证书时每项带通过证据）、附已记录证据的放宽检查，以及会话的指令计数。被拒绝的参数或缺失的标准都不会写入会话事件。

## 模型体验

### 人类 `/verification` 视图

#### 模型看到的内容

无。`/verification` 输入与渲染的台账不进入模型请求，命令不写任何会话事件，其读取的完成标准状态本身也只写日志。

#### Token 影响

零直接 token 影响；命令既不增加也不移除模型可见内容。

#### KV Cache 影响

无；命令发现与直接输出从不触碰请求前缀。

## 已知限制与暂缓事项

- **设计上只读** — 撰写、扩展、放宽与运行记录保留在验证者一侧调用方使用的服务动词上；人工变更语法会复制验证者拥有的权限。
- **仅纯文本台账** — 适配器专属徽标、实时状态组件，以及基于 `verification` 会话投影的 Web 客户端面板，仍是未来的 UI 工作。
- **已发布应用中仅 Web 命令适配器** — headless、ACP 自动化与 JSON-RPC 适配器不消费 `ctx.commands`；这些调用方直接读取 `verification` 投影或服务。

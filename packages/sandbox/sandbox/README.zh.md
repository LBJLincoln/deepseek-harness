# @deepseek-ai/dsh-sandbox

[English](README.md) | 中文

进程沙箱 Service Definition。负责定义 `ctx.sandbox` 服务约定（[`SandboxProvider`](src/index.ts)）与 harness 共享的限制词汇：`SandboxMode`（`read-only`／`workspace-write`／`danger-full-access`，仅限文件操作）、`SandboxEnforcement`（`full`／`partial`，针对每种内核 ABI）、`SandboxExecutionPolicy`（每次调用的完整模式、工作区根目录与禁读根目录）、`SandboxPolicy`（其中受限制的子集），以及故障时拒绝放行的 `SANDBOX_UNAVAILABLE` 错误。作为[能力 seam 拆分](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)中的 Service Definition 角色，它只依赖 cordis（及 harness 错误基类），绝不依赖后端。

用一句话概括约定：`ctx.sandbox.confine(argv, policy)` 返回用于 spawn、应当取代调用方原始 argv 的 argv。返回值经过包装，使进程及其派生的所有进程都在限制下运行；还会附带所选后端达到的强制执行完整度、拒绝方言（`denialSignatures`）和结构化 runner 失败证据（`runnerFailureRules`）。没有可用后端时，它会抛出异常，绝不会原样传递 argv 使其不受限制地运行。[核心类型目录](../../../docs/subsystems/sandbox.md#wrapped-argv-and-classification-dialects)负责定义分类器的精确结构。

策略随调用传递，而不属于提供方：两个消费方可以同时按不同策略施加限制（bash 使用 `read-only`，而受限制的子 agent（智能体）保持其状态目录可写）；获批的升权重试只是使用更宽策略发起的新调用。

**禁读根目录（denied read roots）是策略中与模式无关的另一半。** `deniedReadRoots` 列出受限进程不得读取的目录，它们是绝对、规范化且无重复的；无论 `SandboxMode` 对写入作何规定，这些目录始终禁读。[`dsh-sandbox-policy`](../sandbox-policy/README.md) 按调用方 session 从 read barrier（读屏障）填充该字段，并通过 `normalizeDeniedReadRoots` 归一化；对于 read barrier 不禁止任何目录的 session，该字段为空，未组合 read barrier 的部署中每个 session 都是如此。若某后端能限制文件操作但无法表达非空条目，它会以 `SandboxReadDenialUnavailableError` 拒绝包装；该错误携带 `SANDBOX_UNAVAILABLE`，并指明后端与目录——请求该禁读的隔离级别声明会失败，而不是让禁读悄悄失效。

**`grantedReadRoot` 为禁读根目录定序。** 它是 read barrier（读屏障）为调用方 session 授予的工作区：作为其**严格祖先**的禁读根目录会拒绝该祖先子树的其余部分，同时保持该工作区可读；**就是**该工作区、或位于其内部的禁读根目录则照常拒绝。各后端以自己的方言表达这一先后关系，因此父目录被禁读的进程仍能读写自己的工作区。

**只支持与宿主共享文件系统和内核的限制。** 后端与宿主共享文件系统和内核（`bwrap`、Landlock、Seatbelt）；`workspaceRoot` 指向文件系统规范化后的真实主机目录。系统先解析工作区所指的目录，再做词法规范化，因此包含 `symlink/..` 的有效 cwd 会授权 `chdir` 实际到达的目录，而非无关的词法父目录。容器、microVM 与远程执行器都不是该 seam 的后端：它们会以环境一致的分组替换整个能力 seam 的 Service Provider（`ctx.shell`、`ctx.fs`）。边界及其设计理由见[沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

实现：[`@deepseek-ai/dsh-sandbox-local`](../sandbox-local/)（Linux：`bwrap`，否则使用相应平台的 Landlock launcher；macOS：`sandbox-exec`／Seatbelt）。消费方：[`@deepseek-ai/dsh-bash-sandbox`](../../shell/bash-sandbox/)（包装 `['bash', '-c', command]`）。

## 模型体验

### 间接的限制错误

#### 模型看到的内容

通过 [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) 和 [`dsh-tool-bash`](../../shell/tool-bash/README.md)，无法强制执行所请求模式时会产生错误码 `SANDBOX_UNAVAILABLE` 及以下两条精确错误之一：第一条用于根本没有可用后端，第二条用于可用后端无法表达策略中的禁读根目录。执行期 runner 失败会在第一条上追加 ` Runner failure: <detail>`。

##### 没有可用后端

```markdown
sandbox mode "<mode>" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL restricted-token runner can start (Windows) — otherwise switch the consumer to danger-full-access.
```

##### 无法表达禁读

```markdown
sandbox backend "<backend>" cannot deny reads under "<root>": <reason>; refusing to run the command with the read barrier unenforced.
```

#### Token 影响

条件性错误文本对该次调用可见，并保留在历史中直到压缩（compaction）。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **文件操作与禁读根目录构成完整的策略词汇**：该 seam 不表达网络、进程、系统调用、设备或凭据限制。
- **禁读根目录是目录，而非规则**：该 seam 没有按文件、按扩展名或带条件的禁读，任何后端也不会报告受限进程尝试打开了哪个被禁路径。
- **只支持与宿主共享文件系统和内核的限制**：容器、microVM 与远程执行需要替换能力实现，而不是在此处增加提供方。
- **拒绝报告是一种 stderr 方言**：该 seam 返回后端签名，而非类型化运行时拒绝通道，因此需要分类的消费方必须从子进程输出推断。
- **Runner 诊断使用带内通道**：退出状态与 stderr 证据无法证明匹配行由哪个进程写入，因此受限子进程若故意模仿 runner，就可能造成可用性或诊断误归因。这无法绕过约束；带外 runner 状态通道暂缓实现。
- **每个上下文只有一个提供方**：同时组合不同沙箱机制需要提供方级阶梯或独立 Cordis 上下文；调用方逐调用选择策略，而非后端标识。

# 指挥台镜像

[English](README.md) | 中文

镜像把 harness feed 从一台不接受入站连接的机器发布出去。这台机器运行 feed 和一个 pusher，pusher 把 feed 的应答复制到托管在 Supabase 项目上的中继；deck 读取中继的方式与读取 feed 完全相同，因此任何主机上的静态 deck 都能展示这台机器的实时运行。

## 组成

| 路径 | 职责 |
| --- | --- |
| `schema.sql` | 四张表：`feed_config`（pusher 令牌的摘要）、`feed_json`（每个 feed 路径一行：`/roster`、`/runs`、`/programs`、`/safety/<id>`、`/ops`）、`feed_events`（每个折叠事件一行，在运行、会话与 `seq` 上唯一）、`feed_requests`（托管 deck 请求的审查）；启用行级安全且不设策略；公开的 `deck` 存储桶。 |
| `functions/ingest/index.ts` | 受令牌保护的写入。`POST /bootstrap` 在首次使用时固定令牌并存储其 SHA-256；之后是 `POST /json`、`POST /events`、`GET /requests`、`POST /requests/:id`、`POST /upload` 与 `POST /reset`，每个都携带 `x-daliesk-token`。每个写入体都是 `{ "gz": base64(gzip(JSON)) }`。 |
| `functions/feed/index.ts` | 面向观看者的 feed 契约：`GET /roster`、`GET /runs`、`GET /programs`、`GET /safety/:id`、`GET /ops`、`GET /runs/:id/events` 与 `GET /ops/events` 上的 Server-Sent Events（每个连接至多 140 秒，从 `Last-Event-ID` 续传；`/ops/events` 发送存在运行 `ops` 下的行，新连接从 200 行之前开始）。它只提供读取：其他任何方法，包括 `POST /safety`，都回答 `405`。CORS 允许所有来源。 |
| `functions/deck/index.ts` | 从 `deck` 存储桶在 `/functions/v1/deck/` 下提供 deck 的静态导出。浏览器不会把它当作页面接收：平台以 `text/plain` 和沙箱策略应答导航，所以把导出托管在别处并指向中继。 |
| `pusher.mjs` | 与 feed 并行运行。在 `/runs`、`/roster`、`/programs` 与每个代码安全 `/safety/:id` 变化时推送它们，跟随每个运行的事件流并分批转发事件（先运行中的运行，再代码安全审查，然后其余按最新优先），并认领目标位于 `TARGET_ROOT` 之下的审查请求。 |
| `upload-deck.mjs` | 通过 `POST /upload` 把静态导出目录上传到存储桶。 |

## 部署

1. 创建一个 Supabase 项目并应用 `schema.sql`。
2. 关闭 JWT 校验部署三个函数：`ingest` 用自己的令牌鉴权，`feed` 与 `deck` 是公开读取。
3. 在仓库之外的文件里生成一个令牌并引导一次；中继只保留其摘要。丢失该文件的容器要轮换令牌：见[轮换令牌](#rotating-the-token)。

```sh
openssl rand -hex 32 > "$HOME/.dsh-mirror-token"
curl -X POST "$INGEST_URL/bootstrap" -H "x-daliesk-token: $(cat "$HOME/.dsh-mirror-token")"
```

4. 与 feed 并行运行 pusher。

```sh
INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest INGEST_TOKEN_FILE="$HOME/.dsh-mirror-token" TARGET_ROOT="$HOME/targets" node apps/command-deck/mirror/pusher.mjs
```

5. 用 `NEXT_PUBLIC_FEED_URL=https://<ref>.supabase.co/functions/v1/feed` 构建 deck，或在已构建 deck 的地址上加上带该 URL 的 `?feed=`，并把导出托管在静态主机上。

## 运营循环

[`scripts/enterprise-ops-live.sh`](../../../scripts/enterprise-ops-live.sh) 在没有 feed 服务器和 pusher 的情况下保持中继上的 `/ops` 为实时：它每隔 `OPS_INTERVAL_SECONDS`（默认 15）运行一次 [`scripts/enterprise-ops.ts`](../../../scripts/enterprise-ops.ts) `--push`，采集一份运营快照，通过 `POST /json` 以 `/ops` 发送，并通过 `POST /events` 以运行 `ops` 发送其中新的活动帧。它在自己的检出中运行，每隔 `OPS_PULL_SECONDS`（默认 300）从分支快进该检出；它从 `INGEST_TOKEN_FILE`（默认 `$HOME/.dsh-mirror-token`）读取令牌，从 `INGEST_URL` 读取中继地址；已有一个循环持有锁时，第二个循环以退出码 4 退出。每个容器启动一次，以分离方式运行：

```sh
git -C /home/user/deepseek-harness worktree add /home/user/deepseek-harness/.claude/worktrees/ops-live -B ops-live origin/claude/coding-agent-harness-u9l4gt
cd /home/user/deepseek-harness/.claude/worktrees/ops-live && pnpm install --offline --frozen-lockfile
setsid nohup bash scripts/enterprise-ops-live.sh >> /home/user/enterprise-cycles/ops-live.log 2>&1 < /dev/null &
curl -sS https://<ref>.supabase.co/functions/v1/feed/ops | head -c 200
```

工作树已存在时第一条命令会无害地失败；容器重置会抹掉令牌，所以新容器要先轮换令牌。

## 轮换令牌

中继在 `feed_config` 中只保存令牌的 SHA-256；令牌本身存放在仓库之外的一个文件里，容器重置会抹掉它。因此每个新容器都要生成一个新令牌并替换摘要，在此之前，任何使用旧令牌推送的东西都无法工作：

1. 把令牌生成到一个只有其所有者可读的文件中，并打印它的摘要，绝不打印令牌本身：

   ```sh
   umask 077 && openssl rand -hex 32 > "$HOME/.dsh-mirror-token"
   printf %s "$(tr -d '[:space:]' < "$HOME/.dsh-mirror-token")" | sha256sum | cut -d' ' -f1
   ```

2. 通过 Supabase SQL 编辑器或 Supabase MCP 的 `execute_sql` 工具，用上面打印出的摘要替换中继数据库中的摘要：

   ```sql
   insert into public.feed_config (key, value) values ('ingest_token_hash', '<digest>')
   on conflict (key) do update set value = excluded.value;
   ```

   也可以删除这一行再用新令牌调用 `POST /bootstrap`，但在调用生效之前，中继会向第一个完成 bootstrap 的人开放。

3. 检查令牌：`curl -sS -o /dev/null -w '%{http_code}\n' -H "x-daliesk-token: $(tr -d '[:space:]' < "$HOME/.dsh-mirror-token")" "$INGEST_URL/requests"` 应回答 `200`；`403` 表示摘要不匹配。

4. 启动或重启运营循环（feed 运行时还有 pusher），让它们读取新文件。

## 为什么要有信封

项目前面的 Web 应用防火墙会拒绝引用注入或路径遍历字符串的请求体，而代码安全审查的发现正是如此。base64 内的 gzip 让载荷对它不透明；响应不会被检查。

## 暴露面

feed 函数只提供读取，因此观看者发送的任何内容都不会在推送机器上启动工作：审查只在 feed 本身上启动（`pnpm run feed` 的 `POST /safety`），从不经由中继，pusher 的请求认领也找不到可认领的请求。ingest 令牌守护每一次写入。中继提供的内容是公开的：运营快照让每一行公开的文本（工具描述、标签、原因）都经过转录共用的凭据清洗（[`secret-patterns.mjs`](../../../data/transcripts/tools/secret-patterns.mjs)）并遮蔽电子邮件地址，而 pusher 转发 feed 折叠后的事件，其中带有工具名称和结果；演示结束时停止 pusher。

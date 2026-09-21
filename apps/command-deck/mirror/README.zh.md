# 指挥台镜像

[English](README.md) | 中文

镜像把 harness feed 从一台不接受入站连接的机器发布出去。这台机器运行 feed 和一个 pusher，pusher 把 feed 的应答复制到托管在 Supabase 项目上的中继；deck 读取中继的方式与读取 feed 完全相同，因此任何主机上的静态 deck 都能展示这台机器的实时运行。

## 组成

| 路径 | 职责 |
| --- | --- |
| `schema.sql` | 四张表：`feed_config`（pusher 令牌的摘要）、`feed_json`（每个 feed 路径一行：`/roster`、`/runs`、`/safety/<id>`）、`feed_events`（每个折叠事件一行，在运行、会话与 `seq` 上唯一）、`feed_requests`（托管 deck 请求的审查）；启用行级安全且不设策略；公开的 `deck` 存储桶。 |
| `functions/ingest/index.ts` | 受令牌保护的写入。`POST /bootstrap` 在首次使用时固定令牌并存储其 SHA-256；之后是 `POST /json`、`POST /events`、`GET /requests`、`POST /requests/:id`、`POST /upload` 与 `POST /reset`，每个都携带 `x-daliesk-token`。每个写入体都是 `{ "gz": base64(gzip(JSON)) }`。 |
| `functions/feed/index.ts` | 面向观看者的 feed 契约：`GET /roster`、`GET /runs`、`GET /safety/:id`、`GET /runs/:id/events` 上的 Server-Sent Events（每个连接至多 140 秒，从 `Last-Event-ID` 续传），以及 `POST /safety`，它最多等待 25 秒让 pusher 启动审查并以运行 id 应答。CORS 允许所有来源。 |
| `functions/deck/index.ts` | 从 `deck` 存储桶在 `/functions/v1/deck/` 下提供 deck 的静态导出。浏览器不会把它当作页面接收：平台以 `text/plain` 和沙箱策略应答导航，所以把导出托管在别处并指向中继。 |
| `pusher.mjs` | 与 feed 并行运行。在 `/runs`、`/roster` 与每个代码安全 `/safety/:id` 变化时推送它们，跟随每个运行的事件流并分批转发事件（先运行中的运行，再代码安全审查，然后其余按最新优先），并认领目标位于 `TARGET_ROOT` 之下的审查请求。 |
| `upload-deck.mjs` | 通过 `POST /upload` 把静态导出目录上传到存储桶。 |

## 部署

1. 创建一个 Supabase 项目并应用 `schema.sql`。
2. 关闭 JWT 校验部署三个函数：`ingest` 用自己的令牌鉴权，`feed` 与 `deck` 是公开读取。
3. 在仓库之外的文件里生成一个令牌并引导一次；中继只保留其摘要。

```sh
openssl rand -hex 32 > "$HOME/.dsh-mirror-token"
curl -X POST "$INGEST_URL/bootstrap" -H "x-daliesk-token: $(cat "$HOME/.dsh-mirror-token")"
```

4. 与 feed 并行运行 pusher。

```sh
INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest INGEST_TOKEN_FILE="$HOME/.dsh-mirror-token" TARGET_ROOT="$HOME/targets" node apps/command-deck/mirror/pusher.mjs
```

5. 用 `NEXT_PUBLIC_FEED_URL=https://<ref>.supabase.co/functions/v1/feed` 构建 deck，或在已构建 deck 的地址上加上带该 URL 的 `?feed=`，并把导出托管在静态主机上。

## 为什么要有信封

项目前面的 Web 应用防火墙会拒绝引用注入或路径遍历字符串的请求体，而代码安全审查的发现正是如此。base64 内的 gzip 让载荷对它不透明；响应不会被检查。

## 暴露面

中继上的 `POST /safety` 会为任何到达该 URL 的人在推送机器上启动一次审查。pusher 只接受位于 `TARGET_ROOT` 之下的目标以及 `sonnet`、`opus`、`haiku` 三个模型；演示结束时停止它。

# WordRoot 匿名聚合上报接收端

轻量 Go 服务，接收扩展端（license.js 的 `reportUsage`）每日上报的**纯功能计数**。
用于判断「有多少人在用、该不该开付费」，而无需看到用户查了什么词。

## 隐私边界（务必遵守）

- 扩展端 payload **只有计数**：`date / id / v / lookups / llm / pdf / epub / exports / vocabAdds`
- **不接收** 单词原文、**不读取** 客户端 IP、**不可识别** 个人
- `id` 是每台机器固定的随机匿名串，仅用于服务端按天去重（算日活设备），不可反查真人
- 默认关闭，需用户在选项页主动勾选「匿名改进计划」

## 运行

```bash
cd analytics
go run main.go                 # 默认 :8080
PORT=9000 WR_TOKEN=你的密钥 go run main.go
```

编译部署：

```bash
go build -o analytics .
./analytics   # 或放服务器 / 容器 / systemd
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/report` | 扩展端每日上报（JSON body）。token 走 `?t=` 或 header `x-wr-token` |
| GET | `/summary` | 返回按日期聚合的计数（调试用；生产应加鉴权或移除） |

## 上线前要做的事（骨架未含）

1. **持久化**：`byDate` 现在是内存，重启即丢。换成 SQLite / Postgres，并加按 `id+date` 的去重表算真实 DAU
2. **`/summary` 鉴权**：别让任何人都能看聚合数据
3. **反向代理 + HTTPS**：用 nginx/Caddy 套 TLS，把 `REPORT_URL` 填成 `https://你的域名/report`
4. **合规**：在扩展选项页和隐私政策里写明「收集何种匿名计数、用途、可随时退出」

## 与收款选型的关系

匿名上报解决「看全局用量」；**收钱是另一回事**。ExtensionPay 基于 Stripe（不支持中国大陆主体），
你可用 Paddle / Lemon Squeezy / Fungies（MoR 代收，代缴 VAT）或自建。上报数据只帮你决定
「什么时候开付费闸门」（`license.js` 的 `CONFIG.ENABLED = true`）。

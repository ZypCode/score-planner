# Zyp 平台云同步（Cloudflare Workers + KV）

一个 Worker 可服务 **多个子项目**（如 `score-planner`、以后的其它小工具）：**用户名 + 密码**登录后，按 `projectId` 分仓库存档。

## 工作原理

1. 部署 Worker 后，在前端配置 API 根地址。
2. **注册**或**登录**同一账号 → 获得会话 token（`localStorage`：`zyp-session-token-v1`，同源子路径共享）。
3. 登录后进入页面自动 **GET** 拉存档，操作过程 **PUT** 上传（防抖）。
4. **任意设备**用同一用户名、密码登录即可续玩，**不依赖**浏览器配置同步。

## 部署

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler kv namespace create SESSIONS
wrangler kv namespace create SESSIONS --preview
# 将 id 写入 wrangler.toml
wrangler deploy
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/v1/register` | `{ "username", "password" }`，密码至少 8 位 |
| POST | `/v1/login` | 同上，返回 `{ token, username }` |
| GET | `/v1/projects/:projectId` | 读存档，`Authorization: Bearer <token>` |
| PUT | `/v1/projects/:projectId` | 写 `{ "data": ... }` |

- 用户名：3–32 位，小写字母、数字、下划线（服务端会转成小写）。
- `projectId` 示例：`score-planner`。

## 新子项目接入

1. 复制或引用 [`lib/zyp-sync.js`](../lib/zyp-sync.js)，配置同一 Worker 地址（`DEFAULT_SYNC_API` 或用户设置）。
2. 登录 UI 可复用 score-planner 的云同步折叠面板逻辑。
3. 调用 `ZypSync.login` / `register` 后，用独立 `projectId` 做 `pull` / `push`。

密码在 KV 中以 PBKDF2（SHA-256，10 万次）存储哈希，无明文。
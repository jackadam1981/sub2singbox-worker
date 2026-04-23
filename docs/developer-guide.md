# 开发与部署

面向**维护本仓库**或**把服务部署到自己账号**的读者：命令怎么跑、上线要注意什么、环境变量和 KV 怎么配。

## 部署约束（必须知道）

本仓库的**正式运行形态**是：**Cloudflare Pages** 项目，逻辑在 **`pages-dist/_worker.js`**，再配上静态资源。

| 推荐 | 不推荐 |
|------|--------|
| 使用 **`npm run deploy`**（会先执行 **`predeploy`** → **`verify`**：类型检查 + 单元测试，通过后才构建并 `wrangler pages deploy`） | 默认用 **`wrangler deploy`**（那是独立 Workers 产品，不是本仓库的默认目标） |
| 绕过 npm **直接** `wrangler pages deploy`（会跳过测试） | 生产依赖未经验证的构建物 |
| 本地用 **`npm run dev`** 对齐线上行为 | 假设「Pages 控制台」和「独立 Worker 控制台」完全同一套配置 |

业务代码里的「Worker」指的是 **Pages 挂载的 `_worker.js`**，不是让你单独再建一个 Workers 同名项目。

## 本地开发

```bash
npm install
npm run check    # TypeScript 检查
npm test         # 单元测试
npm run dev      # 构建 pages-dist + wrangler pages dev（带 live-reload）
```

- **`npm run dev`**：会先构建 `pages-dist`，再启动 `wrangler pages dev`，并用 chokidar 监听源码变化后重新执行 `build:pages`。默认尽量**不整进程重启** wrangler，而是依赖其对 `_worker.js` 的监视与 live-reload；若本机不刷新，可设环境变量 **`PAGES_DEV_HARD_RESTART=1`**。监听不稳定时可设 **`CHOKIDAR_USEPOLLING=1`**。
- **`npm run dev:once`**：只构建一次再启动 dev，没有监听。

## 上线（Pages）

首次需要创建 Pages 项目（只需一次）：

```bash
npx wrangler pages project create sub2singbox-worker
```

日常发布：

```bash
npm run deploy
```

只想跑流水线、不部署：

```bash
npm run verify && npm run build:pages
```

**不要用** `npm run deploy --ignore-scripts`，否则会跳过 `predeploy` 里的校验。

环境变量与密钥：在 **Cloudflare 控制台 → Workers & Pages → 本项目 → Settings → Variables** 里为 Production / Preview 分别配置。

## 环境变量一览

### 业务默认值

| 变量 | 作用 |
|------|------|
| `ACCESS_PASSWORD` | 若设置，则请求需带 `password` / `token`（或请求头 `x-password`） |
| `DEFAULT_DEVICE` | 默认设备，如 `openwrt` |
| `DEFAULT_VERSION` | 默认 sing-box 版本字符串，影响 legacy/modern 与未传 `version` 时的行为 |
| `DEFAULT_SUBSCRIPTION_URL` | 默认订阅地址（供控制台等使用） |
| `DEFAULT_USER_AGENT` | 拉取订阅时的 UA |
| `DEFAULT_FALLBACK_USER_AGENT` | 主 UA 遇 401/403 时的备用 UA |
| `DEFAULT_TEMPLATE_URL` | 默认远程模板地址 |
| `CORS_ORIGIN` | 若设置，则对 JSON 响应附加 CORS 头 |

### 缓存 TTL（秒）

需绑定 **`CACHE_KV`** 后缓存才会真正写入 KV；未绑定时逻辑仍会运行，但相当于没有持久缓存层。

| 变量 | 含义 |
|------|------|
| `SUBSCRIPTION_CACHE_TTL` | 订阅原文 fresh 缓存时长 |
| `SUBSCRIPTION_STALE_TTL` | 订阅失败时允许使用的 stale 窗口 |
| `TEMPLATE_CACHE_TTL` | 远程模板 fresh 缓存 |
| `TEMPLATE_STALE_TTL` | 远程模板失败时 stale 窗口 |
| `RESULT_CACHE_TTL` | 转换结果缓存 |

默认值以 `src/lib/cache.ts` 为准（例如订阅 fresh 10 分钟、stale 24 小时等）。

## 绑定 KV（启用缓存）

在 **Pages 项目** 设置里绑定命名空间，**binding 名称**必须是 `CACHE_KV`。

本地 `wrangler.jsonc` 可用于打包与类型生成；线上以控制台绑定为准。示例：

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "CACHE_KV",
      "id": "YOUR_KV_NAMESPACE_ID"
    }
  ]
}
```

用 `GET /debug/cache-policy` 可确认当前策略与 KV 是否可用。

## 仓库里的脚本（package.json）

| 脚本 | 作用 |
|------|------|
| `check` | `tsc --noEmit` |
| `test` | `vitest run` |
| `verify` | `check` + `test` |
| `build` / `build:pages` | 生成 `pages-dist`（含 `_worker.js` 与静态资源） |
| `predeploy` | npm 在 `deploy` 前自动执行，等同 `verify` |
| `deploy` | `build:pages` 然后 `wrangler pages deploy pages-dist` |

## 相关文档

- 使用者向说明：[user-guide.md](./user-guide.md)
- 接口查询参数表：[api-queries.md](./api-queries.md)
- 模板与 Clash 细节：[advanced-templates.md](./advanced-templates.md)
- 设计背景：[research.md](./research.md)

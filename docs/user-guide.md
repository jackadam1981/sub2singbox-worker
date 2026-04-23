# 入门与用户指南

用大白话说明：**这个服务能帮你干什么**，以及**怎么用最少的概念上手**。

## 这个项目是干什么的？

你可以把它理解成一个**在线翻译机**：

- **输入**：你从机场或服务商拿到的「订阅」——可能是一串 `ss://`、`vmess://` 链接，也可能是 Clash 的配置片段、sing-box 的节点列表等。
- **输出**：一份可以直接给 **sing-box** 或 **Clash / Clash.Meta** 用的完整配置（JSON 或 YAML）。

它跑在 **Cloudflare Pages** 上（带 `_worker.js` 的那一种），所以你访问的是一个网站地址，在浏览器里也可以打开**操作控制台**填参数生成链接。

## 三个最常碰到的概念

1. **设备（device）**  
   表示你主要在哪种环境用：`ios`、`android`、`pc`、`openwrt`（路由器）。同一批节点，不同设备生成的「外围配置」（入站、DNS 写法等）会不一样。

2. **sing-box 版本（version）**  
   用来判断走 **旧版兼容通道** 还是 **新版通道**（文档里叫 `legacy` / `modern`）。**输出 sing-box JSON 时一般要填**；输出 Clash 时可以不填，会用服务器上的默认版本决定怎么解析订阅。

3. **模板（template）**  
   决定「节点列表」之外的那一大坨：DNS、路由、分组（selector / 自动测速）等。可以用**内建**的（如 `builtin:default`），也可以传**你自己托管的 JSON 模板**（仅对 sing-box 输出生效）。

更细的差异见 [profile-matrix.md](./profile-matrix.md)。

## 在浏览器里用

- 打开站点根路径 **`/`**：这是打包进去的**网页控制台**，适合点点选选生成订阅链接。
- **`/console.html`** 会 **302 重定向到 `/`**，避免重复入口。

自动化脚本不要解析 HTML，请用下面的 JSON 接口。

## 给程序用的：元数据与健康检查

| 路径 | 作用（通俗说） |
|------|----------------|
| `GET /info` | 返回服务名、接口列表、示例 URL，方便脚本对接。 |
| `GET /ui-version` | 返回控制台界面版本号，用来确认请求是不是打到了本 Worker。 |
| `GET /health` | 活着吗？简单探活。 |

## 真正干活的路径

| 路径 | 作用 |
|------|------|
| `GET /convert` | **生成最终配置**（sing-box JSON 或 Clash YAML）。 |
| `GET /validate` | **只检查**参数和订阅能不能转换，不返回完整配置正文。 |
| `GET /explain` | 返回**更啰嗦的调试信息**：每个订阅源是否拉取成功、用了哪个 profile、节点数量等。 |

### `/convert` 最常用的查询参数（记住这些就够）

| 参数 | 必填？ | 含义 |
|------|--------|------|
| `device` | 建议填 | `ios` / `android` / `pc` / `openwrt`（另有别名如 `router`→`openwrt`，见 profile 文档）。 |
| `version` | 输出 sing-box 时建议填 | 如 `1.11.7`、`1.13.7`；决定 legacy / modern。**`format=clash` 时可省略**。 |
| `url` | 与 `raw` 二选一（可多源） | 一个或多个订阅地址，用 `,` 或 `|` 分隔。 |
| `raw` | 同上 | 直接把订阅正文放在 URL 里（太长时注意长度限制）。 |
| `raw_base64=1` | 可选 | 表示 `raw` 要先 base64 解码。 |
| `format` | 可选 | `sing-box`（默认）或 `clash`。 |
| `template` | 可选 | 如 `builtin:default`。 |
| `template_url` / `template_raw` | 可选 | 远程或内联 JSON 模板；**目前只对 sing-box 输出生效**。 |
| `include` / `exclude` | 可选 | 用正则筛选或排除节点 tag。 |
| `strict=1` 或 `allow_partial=0` | 可选 | **任一订阅源失败则整单失败**；默认是「能解析多少算多少」。 |
| `cache=0` / `refresh=1` | 可选 | 控制是否跳过缓存、是否强制回源（详见进阶文档）。 |
| `ua` / `fallback_ua` | 可选 | 拉订阅时的 User-Agent；遇 401/403 会尝试备用 UA。 |
| `password` / `token` | 视部署而定 | 若服务端配置了访问密码，需要带上。 |

完整参数表与示例 URL 见 [api-queries.md](./api-queries.md)；环境变量见 [developer-guide.md](./developer-guide.md)。若与代码不一致，以 `src/index.ts` 为准。

### 列表类接口

| 路径 | 作用 |
|------|------|
| `GET /profiles` | 列出内建 profile（设备 × 版本通道）及建议。 |
| `GET /templates` | 内建模板列表；可加 `device`、`version` 看推荐。 |
| `GET /templates/:id` | 某个内建模板的详情与是否推荐。 |

### 调试缓存

| 路径 | 作用 |
|------|------|
| `GET /debug/cache-policy` | 返回当前缓存 TTL 策略以及 KV 是否可用。 |

## 多订阅源时怎么理解「成功」？

默认：**只要有一个源成功**，就继续生成配置，失败的源会记在统计里。  
若你希望「有一个源挂了就全失败」，加 **`strict=1`**（或 `allow_partial=0`）。

响应头里会看到 `x-source-total`、`x-source-succeeded` 等，方便排查哪个 URL 坏了。

## 出错时返回什么？

除了人类可读的 `error` 字段外，往往还有结构化字段（如 `error_detail` 里的 `stage`、`code`），便于前端或脚本分类处理。常见阶段包括：鉴权、profile、拉订阅、解析订阅、模板、渲染、输出等。

---

下一步：要自己改代码或部署到 Cloudflare，请读 [developer-guide.md](./developer-guide.md)；要写远程 JSON 模板，请读 [advanced-templates.md](./advanced-templates.md)。

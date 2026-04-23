# 模板、缓存、Clash 与错误说明

## 支持的协议与输入格式（摘要）

从订阅里解析成内部节点，再生成 sing-box outbound 或 Clash proxy。常见 URI：`ss`、`vmess`、`vless`、`trojan`、`hy2`/`hysteria2`、`tuic`、`socks`、`http`。

输入可以是：远程订阅 URL、base64 文本、Clash YAML（`proxies`）、sing-box JSON（`outbounds` 或 outbound 数组）；另有 Clash JSON `proxies`、sing-box YAML `outbounds` 等兼容，详见代码 `subscription` 模块。

## 内建模板库

通过 `template=builtin:<id>` 使用：

| ID | 特点 |
|----|------|
| `builtin:default` | 接近默认生成，可作无模板时的显式选择 |
| `builtin:manual` | 偏手动 selector，含 `Manual` / `Auto` / `Proxy` 等结构 |
| `builtin:auto` | 偏自动测速，含 `Auto` / `Fallback` 等 |

查看列表：`GET /templates`；带 profile 的推荐：`GET /templates?device=pc&version=1.13.7`。

### 当前推荐矩阵（device × 版本通道 → 模板）

- `ios + legacy` → `default`
- `ios + modern` → `default`
- `android + legacy` → `default`
- `android + modern` → `auto`
- `pc + legacy` → `manual`
- `pc + modern` → `manual`
- `openwrt + legacy` → `default`
- `openwrt + modern` → `auto`

## Clash 输出（`format=clash`）

返回可导入 Clash / Clash.Meta 的 YAML，包含 `proxies`、`proxy-groups`、`rules`。默认含 `Proxy` 手动组、`Auto` 自动测速组、`MATCH,Proxy` 规则。

当前可转为 Clash 的类型包括：`shadowsocks`、`vmess`、`vless`、`trojan`、`hysteria`、`hysteria2`、`tuic`、`socks`、`http`。

### 限制（务必知道）

- `template_url` / `template_raw` **目前只对 sing-box 输出生效**
- `format=clash` **暂不支持**自定义模板
- 复杂 Clash `proxy-groups` 在输入侧会忽略，**不做原样保留**

## 缓存策略（通俗版）

思路分三块：**订阅原文**、**远程模板**、**最终生成结果**。

- **订阅**：默认 fresh 约 10 分钟；若拉取失败，可在一段时间内用旧内容兜底（stale，默认约 24 小时）。
- **远程模板**：默认不做 fresh 缓存；失败时可用约 1 小时内的旧模板兜底。
- **结果**：`sing-box + 内建模板` 以及 `clash` 默认约缓存 5 分钟；`sing-box + 远程模板` 默认**不缓存最终结果**。

请求参数 `cache=0` 可跳过 fresh；`refresh=1` 强制回源并允许失败时用 stale。

以上数值可被环境变量覆盖，见 [developer-guide.md](./developer-guide.md)。是否真正写入 KV 取决于是否绑定 `CACHE_KV`。

## 远程 JSON 模板占位符

模板必须是合法 JSON，其中可以出现以下**字符串占位符**（渲染时替换）：

| 占位符 | 含义 |
|--------|------|
| `{{ Nodes }}` | 仅节点 outbounds |
| `{{ NodeTags }}` / `{{ NodeNames }}` | 节点 tag / 名称列表 |
| `{{ ProfileId }}` | 当前 profile id |
| `{{ Device }}` | 设备 |
| `{{ VersionChannel }}` | `legacy` 或 `modern` |
| `{{ NodeCount }}` | 节点数量 |
| `{{ Dns }}` | DNS 片段 |
| `{{ Inbounds }}` | 入站片段 |
| `{{ SelectorOutbounds }}` | 与选择器相关 outbound |
| `{{ AllOutbounds }}` | 全部相关 outbound |
| `{{ Route }}` | 路由片段 |
| `{{ Experimental }}` | 实验性字段片段 |

### 带参数的模板调用

- `{{ Nodes(filter=香港|HK) }}`
- `{{ NodeTags(filter=香港|HK) }}`
- `{{ Group(tag=HK, type=selector, filter=香港|HK, append=direct) }}`
- `{{ UrlTest(tag=AutoHK, filter=香港|HK, url=https://www.gstatic.com/generate_204) }}`

参数含义简述：`filter`/`include` 正则筛选，`exclude` 排除，`limit` 限制数量，`append` 总是追加的 tag，`fallback` 无匹配时使用，`tag`/`type`（`selector` 或 `urltest`），以及 `urltest` 的 `url`/`interval`/`tolerance`。

也支持对象指令 `$template`（如 `outboundGroups`）一次生成多组，详见原 README 示例或 `src/lib/template.ts`。

## `/validate` 与 `/explain`

- **`/validate`**：返回 `valid`、`profile`、`output_format`、`template`、`sources`、`nodes`、`checks` 等，适合「测一下能不能转」。
- **`/explain`**：更细，包括每个 source 的 fetch/parse、payload 类型、过滤后 tag、Clash 兼容数量等；可加 `include_rendered=1` 附带渲染结果。

## 结构化错误

错误 JSON 除 `error` 外，常见 `error_detail`：`stage`、`code`、`message`。常见 `stage`：`auth`、`profile`、`fetch-subscription`、`parse-subscription`、`template`、`template-render`、`output`。

## 完整查询参数表

见 [api-queries.md](./api-queries.md)。

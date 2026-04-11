# sub2singbox-worker

一个部署在 Cloudflare Workers 上的 sing-box 订阅转换 MVP。

这个仓库基于对以下项目的研读后整理出来：

- `bestnite/sub2sing-box`
- `haierkeys/singbox-subscribe-convert`
- `dzhuang/sing-box-converter`
- `Toperlock/sing-box-subscribe`

当前版本的目标不是一次性复刻它们全部能力，而是先落一个更适合 Workers 的最小可用版本：

- 支持按目标设备区分模板：`ios` / `android` / `pc` / `openwrt`
- 支持按 sing-box 版本区分模板：`legacy (1.10.0 / 1.11.7)`、`modern (1.12.0 / 1.13.7 / 1.14.0-alpha.10)`
- 支持常见 URI 订阅解析为 sing-box outbound：
  - `ss`
  - `vmess`
  - `vless`
  - `trojan`
  - `hy2` / `hysteria2`
  - `tuic`
  - `socks`
  - `http`
- 支持输入格式：
  - 远程订阅 URL
  - base64 订阅文本
  - Clash YAML（`proxies`）
  - sing-box JSON（`outbounds` 或 outbound 数组）
- 支持输出格式：
  - `sing-box` JSON
  - `clash` 完整 YAML 配置
  - `clash-provider` 仅含 `proxies` 的 YAML
- 支持远程模板：
  - `template_url`
  - `template_raw`
  - `template_raw_base64=1`
  - `template=builtin:<id>`
- 支持内建模板库：
  - `builtin:default`
  - `builtin:manual`
  - `builtin:auto`
- 暴露 Worker 接口：
  - `/health`
  - `/profiles`
  - `/templates`
  - `/templates/:id`
  - `/validate`
  - `/explain`
  - `/convert`

## 设计取向

参考项目里，比较有价值的思路主要有四类：

1. **模板驱动**
   - `bestnite/sub2sing-box` 和 `Toperlock/sing-box-subscribe` 都强调模板占位与节点插槽。
2. **多模板与多端适配**
   - `haierkeys/singbox-subscribe-convert` 明确把「iOS / Android / OpenWrt / 不同 sing-box 版本」当作核心问题。
3. **解析器抽象**
   - `dzhuang/sing-box-converter` 将原脚本整理为可复用库，更适合作为协议解析层的参考。
4. **面向在线部署**
   - `Toperlock/sing-box-subscribe` 证明了在线生成配置是有明确需求的，但 Vercel 的执行时长和文件模型不适合继续扩展，因此这里直接转向 Workers。

这个仓库当前采用的是：

- **内建 profile 生成器**，而不是把模板文件系统照搬进 Worker
- **协议 URI -> sing-box outbound** 的直接转换
- **Clash/YAML proxies -> sing-box outbound** 的转换
- **sing-box outbound -> Clash YAML** 的反向转换
- **版本差异收敛到 profile/channel**，而不是在单份模板里塞大量条件分支
- **远程 JSON 模板 + 占位符渲染**，而不是引入复杂服务端模板编辑流

## profile 说明

### 版本通道

- `legacy`: sing-box `1.10.0` / `1.11.7`
- `modern`: sing-box `1.12.0` / `1.13.7` / `1.14.0-alpha.10`

### 设备通道

- `ios`
- `android`
- `pc`
- `openwrt`

### 当前差异点

- `legacy` profile 使用旧式 DNS server 表达方式
- `modern` profile 使用 1.12+ 的 DNS server 新结构
- `modern` profile 会为使用域名的节点补 `domain_resolver`
- 当前 `modern` 通道按 `1.12.0 / 1.13.7 / 1.14.0-alpha.10` 共用一套模板策略
- `pc` profile 额外附带 `mixed` 入站
- `openwrt` profile 显式保留 `interface_name`

更完整的矩阵见：[`docs/profile-matrix.md`](docs/profile-matrix.md)

## 本地开发

```bash
npm install
npm run check
npm test
npm run dev
```

## Cloudflare 部署

```bash
npm run deploy
```

可选环境变量：

- `ACCESS_PASSWORD`: 开启访问密码保护
- `DEFAULT_DEVICE`: 默认设备，默认 `openwrt`
- `DEFAULT_VERSION`: 默认版本，默认 `1.12.0`
- `DEFAULT_SUBSCRIPTION_URL`: 默认订阅地址
- `DEFAULT_USER_AGENT`: 拉取订阅时使用的 UA
- `DEFAULT_TEMPLATE_URL`: 默认远程模板地址
- `CORS_ORIGIN`: 允许跨域的源

## API

### `GET /health`

返回服务健康状态。

### `GET /profiles`

返回内建 profile 列表与版本分层建议。

### `GET /templates`

返回当前内建模板库列表与模板元数据。

可选查询参数：

- `device`
- `version`

如果提供了这两个参数，接口会同时返回当前 profile 下的模板推荐结果。

### `GET /templates/:id`

返回单个内建模板详情，包括：

- 模板元数据
- 模板正文
- 当前 profile 下是否推荐
- 推荐排序信息

### `GET /validate`

校验当前请求参数、输入源、模板和输出格式是否可正常转换，但不返回最终配置正文。

适合：

- 检查某个订阅链接是否还能用
- 检查某个模板是否能被正确渲染
- 做前端“测试连接/测试模板”按钮

### `GET /explain`

返回更详细的转换过程解释，包括：

- profile 选择结果
- 输出格式
- 模板模式与模板来源
- 输入源逐项 fetch/parse 结果
- 节点统计
- Clash 兼容数量

可选参数：

- `include_rendered=1`
- `rendered=1`

开启后会把最终渲染结果也一起返回。

### `GET /convert`

查询参数：

- `device`: `ios | android | pc | openwrt`
- `version`: 如 `1.11.7`、`1.13.7`、`1.14.0-alpha.10`
- `url`: 一个或多个订阅 URL，支持 `,` 或 `|` 分隔
- `raw`: 直接传入订阅内容
- `raw_base64=1`: 表示 `raw` 需要先做 base64 解码
- `template_url`: 远程 JSON 模板地址
- `template_raw`: 直接传入 JSON 模板内容
- `template_raw_base64=1`: 表示 `template_raw` 需要先做 base64 解码
- `template`: 内建模板选择，如 `builtin:default`
- `format`: `sing-box | clash | clash-provider`
- `include`: 只保留匹配此正则的节点 tag
- `exclude`: 排除匹配此正则的节点 tag
- `strict=1`: 启用严格模式，任一订阅源失败即报错
- `allow_partial=0`: 等价于 `strict=1`
- `cache=0`: 跳过 fresh 缓存
- `refresh=1`: 强制回源，并允许在失败时回退 stale 缓存
- `ua`: 拉取订阅时使用的 User-Agent
- `fallback_ua`: 当主 UA 返回 401/403 时的备用 UA
- `password` / `token`: 若配置了 `ACCESS_PASSWORD`，需要携带

示例：

```text
/convert?device=openwrt&version=1.12.0&url=https://example.com/sub.txt
```

```text
/convert?device=ios&version=1.11.8&raw_base64=1&raw=<base64_subscription>
```

```text
/convert?device=pc&version=1.12.0&url=https://example.com/clash.yaml&template_url=https://example.com/template.json
```

```text
/convert?device=pc&version=1.13.7&format=clash&url=https://example.com/sub.txt
```

```text
/convert?format=clash-provider&raw=ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS
```

```text
/validate?device=pc&version=1.13.7&url=https://example.com/sub.txt|https://backup.example.com/sub.txt
```

```text
/explain?device=pc&version=1.13.7&template=builtin:manual&raw=ss://...&include_rendered=1
```

## Clash 输出说明

### `format=clash`

返回可直接导入 Clash / Clash.Meta 的完整 YAML 配置，包含：

- `proxies`
- `proxy-groups`
- `rules`

默认会生成：

- `Proxy` 手动选择组
- `Auto` 自动测速组
- `MATCH,Proxy` 规则

### `format=clash-provider`

返回仅包含 `proxies` 的 provider YAML，适合给你自己的 Clash 模板或 `proxy-providers` 使用。

### 当前支持转换为 Clash 的节点类型

- `shadowsocks`
- `vmess`
- `vless`
- `trojan`
- `hysteria`
- `hysteria2`
- `tuic`
- `socks`
- `http`

### 当前限制

- `template_url` / `template_raw` 目前只对 `sing-box` 输出生效
- `format=clash` 与 `format=clash-provider` 暂不支持自定义模板
- 复杂 Clash `proxy-groups` 目前只做输入侧忽略，不做原样保留

## 缓存策略

当前 Worker 已支持基于 KV 的缓存层。

### 默认策略

- 原始订阅：
  - fresh 缓存 `10 分钟`
  - 失败时回退 `24 小时` 内旧内容
- 远程模板：
  - 默认不做 fresh 缓存
  - 失败时允许回退 `1 小时` 内旧模板
- 最终结果：
  - `sing-box + 内建模板` / `clash` / `clash-provider` 默认缓存 `5 分钟`
  - `sing-box + 远程模板` 默认**不缓存最终结果**

### 可选环境变量

除上文配置外，缓存层还支持：

- `SUBSCRIPTION_CACHE_TTL`
- `SUBSCRIPTION_STALE_TTL`
- `TEMPLATE_CACHE_TTL`
- `TEMPLATE_STALE_TTL`
- `RESULT_CACHE_TTL`

### 调试接口

- `GET /debug/cache-policy`

会返回当前缓存策略与 KV 是否启用。

### KV 绑定

如果要启用缓存，需要为 Worker 绑定一个 KV namespace：

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

## 输入源增强

### 多源策略

当前支持一次传入多个订阅源，默认是**容错模式**：

- 只要至少有一个源成功，就继续转换
- 失败源会记录到统计信息里，但不会让整个请求失败

如果你希望“任一源失败就整体失败”，可以使用：

- `strict=1`
- 或 `allow_partial=0`

### 备用 UA

当前支持：

- `ua=...`
- `fallback_ua=...`

以及环境变量：

- `DEFAULT_USER_AGENT`
- `DEFAULT_FALLBACK_USER_AGENT`

当上游返回 `401` 或 `403` 时，会自动尝试备用 UA。

### 响应头

为方便调试输入源状态，`/convert` 响应会返回：

- `x-source-total`
- `x-source-succeeded`
- `x-source-failed`
- `x-source-mode`

### 当前额外兼容的输入格式

除了 URI / base64 / Clash YAML 以外，还支持：

- Clash JSON `proxies`
- sing-box YAML `outbounds`

## 内建模板库

当前已提供 3 个内建 sing-box 模板，可通过 `template=builtin:<id>` 直接使用：

- `builtin:default`
  - 尽量接近默认生成配置
  - 适合作为无模板模式的显式替代
- `builtin:manual`
  - 偏向手动 selector 切换
  - 提供 `Manual` / `Auto` / `Proxy` 结构
- `builtin:auto`
  - 偏向自动测速优先
  - 提供 `Auto` / `Fallback` 等结构

### 查看模板列表

```text
GET /templates
```

```text
GET /templates?device=pc&version=1.13.7
```

### 查看模板详情

```text
GET /templates/manual
```

```text
GET /templates/manual?device=pc&version=1.13.7
```

### 使用示例

```text
/convert?device=openwrt&version=1.12.0&url=https://example.com/sub.txt&template=builtin:default
```

```text
/convert?device=pc&version=1.13.7&raw=ss://...&template=builtin:manual
```

```text
/convert?device=android&version=1.13.7&raw=ss://...&template=builtin:auto
```

### 当前推荐矩阵

- `ios + legacy` -> `default`
- `ios + modern` -> `default`
- `android + legacy` -> `default`
- `android + modern` -> `auto`
- `pc + legacy` -> `manual`
- `pc + modern` -> `manual`
- `openwrt + legacy` -> `default`
- `openwrt + modern` -> `auto`

## 调试与可观测性

### 结构化错误

错误响应除了保留原有字符串 `error` 外，还会返回结构化字段：

```json
{
  "ok": false,
  "error": "存在订阅源拉取失败（strict 模式）：...",
  "error_detail": {
    "stage": "fetch-subscription",
    "code": "STRICT_SOURCE_FAILURE",
    "message": "存在订阅源拉取失败（strict 模式）：..."
  }
}
```

当前常见 `stage` 包括：

- `auth`
- `profile`
- `fetch-subscription`
- `parse-subscription`
- `template`
- `template-render`
- `output`

### `/validate`

返回：

- `valid`
- `profile`
- `output_format`
- `template`
- `sources`
- `nodes`
- `checks`

### `/explain`

返回更完整的解释对象：

- 每个 source 的 fetch/parse 状态
- source payload 类型（如 `uri-list`、`clash-json`、`clash-yaml`、`sing-box-yaml`）
- 模板模式与模板 id
- 过滤后的节点 tag 列表
- Clash 兼容节点数量

当带上 `include_rendered=1` 时，还会返回最终渲染结果。

## 远程模板占位符

当前远程模板要求是合法 JSON，支持以下占位符字符串：

- `{{ Nodes }}`: 仅节点 outbounds
- `{{ NodeTags }}` / `{{ NodeNames }}`
- `{{ ProfileId }}`
- `{{ Device }}`
- `{{ VersionChannel }}`
- `{{ NodeCount }}`
- `{{ Dns }}`
- `{{ Inbounds }}`
- `{{ SelectorOutbounds }}`
- `{{ AllOutbounds }}`
- `{{ Route }}`
- `{{ Experimental }}`

示例：

```json
{
  "dns": "{{ Dns }}",
  "inbounds": "{{ Inbounds }}",
  "outbounds": "{{ AllOutbounds }}",
  "route": "{{ Route }}",
  "meta": {
    "profile": "{{ ProfileId }}",
    "count": "{{ NodeCount }}"
  }
}
```

### 增强模板能力

现在除了基础占位符，还支持带参数的模板调用：

- `{{ Nodes(filter=香港|HK) }}`
- `{{ NodeTags(filter=香港|HK) }}`
- `{{ Group(tag=HK, type=selector, filter=香港|HK, append=direct) }}`
- `{{ UrlTest(tag=AutoHK, filter=香港|HK, url=https://www.gstatic.com/generate_204) }}`

参数说明：

- `filter` / `include`: 正则筛选匹配的节点 tag
- `exclude`: 正则排除
- `limit`: 限制匹配节点数量
- `append`: 无论是否匹配成功都追加这些 tag
- `fallback`: 仅在没有匹配节点时使用
- `tag`: 生成组的 tag
- `type`: `selector` 或 `urltest`
- `url` / `interval` / `tolerance`: `urltest` 相关参数

示例：

```json
{
  "outbounds": [
    "{{ Group(tag=HK, type=selector, filter=香港|HK, append=direct) }}",
    "{{ UrlTest(tag=AutoHK, filter=香港|HK, url=https://www.gstatic.com/generate_204) }}",
    "{{ Nodes(filter=香港|HK) }}",
    { "type": "direct", "tag": "direct" }
  ],
  "meta": {
    "hk_tags": "{{ NodeTags(filter=香港|HK) }}"
  }
}
```

另外也支持对象指令方式，更适合一次生成多个分组：

```json
{
  "outbounds": [
    {
      "$template": "outboundGroups",
      "type": "selector",
      "append": ["direct"],
      "definitions": [
        { "tag": "HK", "include": "香港|HK" },
        { "tag": "US", "include": "美国|US" }
      ]
    },
    "{{ AllOutbounds }}"
  ]
}
```

## 当前明确未做

为了先把 Workers 版本做稳，这一版还没有实现：

- KV / Cache API 缓存层
- 定时刷新与预热
- 节点国家分组、复杂 selector 规则生成
- 复杂 Clash `proxy-groups` 的原样迁移与模板化输出
- 规则集下载与自动修正

这些内容已经在文档中留了后续扩展方向，见：[`docs/research.md`](docs/research.md)

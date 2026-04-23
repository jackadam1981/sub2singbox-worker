# API 查询参数速查

本文档罗列主要接口的查询参数，便于复制查阅。行为以 `src/index.ts` 为准。

## `GET /convert`

| 参数 | 说明 |
|------|------|
| `device` | `ios` / `android` / `pc` / `openwrt`（另有别名见 [profile-matrix.md](./profile-matrix.md)） |
| `version` | 如 `1.11.7`、`1.13.7`、`1.14.0-alpha.10`。**输出 sing-box 时建议提供**；**`format=clash` 时可省略**（省略时用 `DEFAULT_VERSION` 决定解析通道） |
| `url` | 一个或多个订阅 URL，`,` 或 `|` 分隔 |
| `raw` | 直接传入订阅内容 |
| `raw_base64=1` | `raw` 需先 base64 解码 |
| `template_url` | 远程 JSON 模板地址 |
| `template_raw` | 直接传入 JSON 模板 |
| `template_raw_base64=1` | `template_raw` 需先 base64 解码 |
| `template` | 内建模板，如 `builtin:default` |
| `format` | `sing-box`（默认）或 `clash` |
| `include` | 只保留匹配该正则的节点 tag |
| `exclude` | 排除匹配该正则的节点 tag |
| `strict=1` | 任一订阅源失败即报错 |
| `allow_partial=0` | 等价于 `strict=1` |
| `cache=0` | 跳过 fresh 缓存 |
| `refresh=1` | 强制回源，失败时允许回退 stale |
| `ua` | 拉取订阅的 User-Agent |
| `fallback_ua` | 主 UA 返回 401/403 时的备用 UA |
| `password` / `token` | 配置了 `ACCESS_PASSWORD` 时需携带 |

### 示例 URL（片段）

```text
/convert?device=openwrt&version=1.13.7&url=https://example.com/sub.txt
```

```text
/convert?device=ios&version=1.11.7&raw_base64=1&raw=<base64_subscription>
```

```text
/convert?device=pc&version=1.13.7&url=https://example.com/clash.yaml&template_url=https://example.com/template.json
```

```text
/convert?device=pc&format=clash&url=https://example.com/sub.txt
```

## `GET /validate`

参数与 `/convert` 对齐（同一套订阅与模板相关参数），用于校验而不返回最终配置正文。

示例：

```text
/validate?device=pc&version=1.13.7&url=https://example.com/sub.txt|https://backup.example.com/sub.txt
```

## `GET /explain`

在 `/validate` 类信息基础上返回更细的转换过程说明。

额外可选参数：

| 参数 | 说明 |
|------|------|
| `include_rendered=1` | 在 JSON 中包含渲染结果 |
| `rendered=1` | 与上一项等价，任选其一即可 |

示例：

```text
/explain?device=pc&version=1.13.7&template=builtin:manual&raw=ss://...&include_rendered=1
```

## `GET /templates`

| 参数 | 说明 |
|------|------|
| `device` | 与 `version` 同时提供时返回当前 profile 下的模板推荐 |
| `version` | 同上 |

## `GET /templates/:id`

路径中的 `:id` 为模板标识（如 `manual` 对应内建 `builtin:manual` 的短 id，以接口返回为准）。

可选查询参数：`device`、`version`。

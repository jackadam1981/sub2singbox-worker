# 设备、版本通道与 Profile 矩阵

## 版本通道怎么分？

根据你传入的 **sing-box 版本号**（`version` 参数）解析主、次版本：

- **主版本 > 1**，或 **主版本 = 1 且次版本 ≥ 12** → **`modern`** 通道（对应 1.12.0 / 1.13.7 / 1.14.0-alpha.10 等，共用一套模板策略）。
- 否则 → **`legacy`** 通道（对应 1.10.0 / 1.11.7）。

未传 `version` 时，部分逻辑会按环境默认处理；具体以 `getVersionChannel` 与请求处理代码为准。

## 设备值与别名

`device` 传入时会规范化：

| 归一化结果 | 接受的别名示例 |
|------------|------------------|
| `ios` | `iphone`、`ipad` |
| `android` | （无额外别名） |
| `pc` | `desktop`、`windows`、`macos`、`linux` |
| `openwrt` | `router` |

## 各 Profile 差异（人话版）

以下对应 `src/lib/profiles.ts` 里每条 profile 的 **notes** 摘要，方便你选对模板而不是背 id。

| Profile ID | 通俗理解 |
|------------|----------|
| `ios-legacy` | iOS 上老版本 sing-box；DNS 用旧字段，不依赖 1.12+ 新语义。 |
| `ios-modern` | iOS 新版本；新 DNS 结构，域名类节点会补 `domain_resolver`。 |
| `android-legacy` | Android 老版本；保留 tun，字段偏旧。 |
| `android-modern` | Android 新版本；tun + modern DNS，可作通用移动端默认。 |
| `pc-legacy` | 桌面老版本；**带 mixed 入站**，DNS 旧式。 |
| `pc-modern` | 桌面新版本；mixed 入站 + hostname server 的 `domain_resolver`。 |
| `openwrt-legacy` | 路由器老版本；system stack 风格 tun，少新字段。 |
| `openwrt-modern` | 路由器新版本；**显式保留 `interface_name`**，modern DNS。 |

## 与内建模板推荐的关系

内建模板（`default` / `manual` / `auto`）的推荐结果依赖 **device + version 推导出的通道**。具体推荐表见 [advanced-templates.md](./advanced-templates.md) 中的「推荐矩阵」。

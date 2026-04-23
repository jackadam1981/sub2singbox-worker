# 文档中心

本目录存放 **sub2singbox-worker** 的说明文档，按「先读什么、再读什么」排好了顺序，方便你自己用或给别人讲清楚这个项目在干什么。

## 建议阅读顺序

| 顺序 | 文档 | 适合谁 | 内容概要 |
|------|------|--------|----------|
| 1 | [入门与用户指南](./user-guide.md) | 使用者、第一次接触仓库的人 | 项目是干什么的、核心概念、怎么用链接和接口 |
| 2 | [API 查询参数速查](./api-queries.md) | 写脚本、拼 URL 的人 | `/convert` / `validate` / `explain` 等参数与示例 |
| 3 | [开发与部署](./developer-guide.md) | 维护者、要自己部署的人 | 本地开发、`npm run deploy`、环境变量、KV 缓存绑定 |
| 4 | [模板、缓存与 Clash 输出](./advanced-templates.md) | 要写远程模板或调缓存的人 | 占位符、内建模板、缓存策略、Clash 相关限制 |
| 5 | [设备与版本矩阵](./profile-matrix.md) | 要选对 `device` / `version` 的人 | 各 profile 差异、内建模板推荐 |
| 6 | [参考项目研读](./research.md) | 想了解设计来源的人 | 四个上游项目的取舍、为何适合 Cloudflare |

根目录 [README.md](../README.md) 保留**最短**的项目说明与常用命令；细节以本目录为准。

## 文档和代码怎么对齐

- 路由与行为以 `src/index.ts` 为准。
- 缓存默认值以 `src/lib/cache.ts` 为准。
- Profile 列表与说明以 `src/lib/profiles.ts` 为准。

若文档与代码不一致，**以代码为准**，欢迎提 issue 或 PR 改文档。

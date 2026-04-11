# 参考项目研读结论

本文总结以下四个项目对本仓库的启发：

- bestnite/sub2sing-box
- haierkeys/singbox-subscribe-convert
- dzhuang/sing-box-converter
- Toperlock/sing-box-subscribe

## 1. 项目定位差异

### bestnite/sub2sing-box

偏 Go 语言工具化方案，核心特点：

- 支持订阅/单节点统一转换
- 支持模板占位符，如 `<all-proxy-tags>`、`<all-country-tags>`、`<tw>`
- 支持删除、重命名、排序、按国家分组
- 同时支持 CLI 和 HTTP API

对本项目最有价值的点：

- 模板占位思路清晰
- country/group 概念适合继续借鉴
- API 输入输出边界较明确

### haierkeys/singbox-subscribe-convert

偏“服务化 + 多模板”方案，核心特点：

- 一个订阅地址适配多个终端
- 模板是主轴，节点订阅只是数据源
- 明确处理 iOS / Android / OpenWrt 等差异
- 明确处理 sing-box 版本碎片化问题

对本项目最有价值的点：

- “设备 + 版本”的 profile 思路最适合 Cloudflare 场景
- 用固定模板矩阵替代复杂在线编辑，更适合 Worker
- `/health`、`/refresh` 等服务接口设计值得保留

### dzhuang/sing-box-converter

偏 Python 库与命令行工具，核心特点：

- 继承了 Toperlock 项目的解析能力
- 将协议解析与模板合并封装为库
- 支持 providers 配置文件
- 会做模板合法性检查、空 outbound 清理

对本项目最有价值的点：

- 解析层和模板层分离
- 对模板引用的 outbound / rule_set 做校验
- 对空组自动裁剪，避免生成不可运行配置

### Toperlock/sing-box-subscribe

偏早期的“网页实时生成配置”思路，核心特点：

- `/config/URL` 风格的在线转换
- 支持多个订阅输入、UA、过滤、前缀、emoji
- 支持多协议解析
- 模板体系非常灵活，但也相对更自由、更难约束

对本项目最有价值的点：

- URI 解析覆盖面广
- Web API 方式直观
- 支持把模板当作远程链接引用

## 2. 当前实现吸收了什么

本仓库当前版本主要吸收了以下设计：

1. **来自 haierkeys：**
   - 以设备/版本 profile 作为主要入口
   - 一个 Worker 服务多个目标终端

2. **来自 bestnite：**
   - 节点解析与配置生成分层
   - 未来可扩展到分组模板

3. **来自 dzhuang / Toperlock：**
   - 将多协议 URI 解析作为底座能力
   - 保留 Web API 直接生成配置的方式

## 3. 为什么当前不直接照搬现有项目

这四个项目都更偏以下几类运行环境：

- 本地 CLI
- 常驻服务进程
- Docker
- Vercel / Flask / Go HTTP Server

而 Cloudflare Workers 有几个现实约束：

- 单请求执行时间更短
- 不适合依赖本地文件缓存和热重载
- 不适合复杂 YAML/模板编辑工作流
- 更适合“轻状态、快速转换、按 query 参数分流”

因此当前仓库选择：

- 先做 Worker 友好的 MVP
- 用内建 profile 替代复杂模板仓库
- 先支持常见标准 URI 订阅
- 后续再扩展 YAML/Clash/sing-box JSON 输入与 KV 缓存

## 4. 设备与版本的设计结论

当前 profile 分层如下：

- `ios`
  - `legacy`: 1.10 / 1.11
  - `modern`: 1.12+
- `android`
  - `legacy`: 1.10 / 1.11
  - `modern`: 1.12+
- `pc`
  - `legacy`: 1.10 / 1.11
  - `modern`: 1.12+
- `openwrt`
  - `legacy`: 1.10 / 1.11
  - `modern`: 1.12+

这样分层的原因：

- 参考项目的核心痛点来自 1.12 前后模板不兼容
- 1.10 / 1.11 可先归并为 legacy 档
- 1.12 起 DNS server / domain_resolver 等语义变化更明显
- 设备差异主要体现在模板策略和入站方式，而不是节点解析方式

## 5. 当前版本暂未实现的能力

为了优先交付可用 MVP，以下内容暂未实现：

- Clash YAML 订阅解析
- sing-box JSON 订阅聚合
- 远程自定义模板拉取
- NotesName / Nodes 这类模板 DSL
- 国家分组、自动测速、复杂 rule_set 注入
- KV / Cache API 缓存远程订阅
- 认证密码、管理接口刷新

这些都可以在现有结构上继续扩展。

## 6. 推荐后续路线

建议按以下顺序扩展：

1. **输入扩展**
   - 支持 Clash YAML
   - 支持 sing-box JSON outbounds 输入

2. **模板扩展**
   - 将 profile 生成器升级为 profile + template 组合
   - 增加远程模板 URL 支持

3. **缓存扩展**
   - 使用 KV 缓存订阅原文和转换结果
   - 使用 Cache API 缓存可公开访问的转换响应

4. **规则扩展**
   - 增加区域分组、自动测速、媒体分流模板
   - 针对 OpenWrt / iOS 的 DNS 和 TUN 差异做更细化处理


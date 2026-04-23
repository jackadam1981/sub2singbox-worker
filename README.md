# sub2singbox-worker

在 Cloudflare Workers 上将订阅内容转换为 **sing-box JSON** 或 **Clash YAML**，并提供内置的 Web 控制台页面。

## 本地开发

```bash
npm install
npm run dev
```

- 仅本机访问：`npm run dev -- --local --ip 127.0.0.1 --port 8787`
- 局域网设备可访问（例如 OpenWrt 拉配置）：`npm run dev:lan`（监听 `0.0.0.0:8787`）

## 常用路径

- Web 控制台：`GET /`
- 元信息：`GET /info`
- 转换：`GET /convert?...`
- 校验：`GET /validate?...`
- 解释：`GET /explain?...`

## 测试

```bash
npm test
```

/**
 * 为 Cloudflare PAGES 准备 `pages-dist/`：打出 `_worker.js`（Pages 高级模式）并复制静态资源。
 * 生产发布应使用 `wrangler pages deploy pages-dist`，勿将本脚本的产物用于独立 `wrangler deploy` 作为默认路径。
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(fileURLToPath(new URL("..", import.meta.url)));
const outDir = path.join(root, "pages-dist");
const bundleDir = path.join(root, ".pages-bundle");
const staticDir = path.join(root, "pages-static");

/**
 * 由 `npm run dev` 设置。目的不是「监听产物」，而是：开发时不要在每次打包时删掉整个 `pages-dist`，
 * 否则 wrangler 对 `_worker.js` 的监视句柄容易失效；仍由 Chokidar 监听 `src` / `pages-static` 等再触发本脚本。
 */
const incremental = process.env.PAGES_BUILD_INCREMENTAL === "1";

if (!incremental) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "deploy",
    "--dry-run",
    "--outdir",
    bundleDir,
  ],
  { cwd: root, stdio: "inherit" },
);

const bundled = path.join(bundleDir, "index.js");
if (!existsSync(bundled)) {
  throw new Error(`Expected wrangler bundle at ${bundled}`);
}

// 增量构建时 pages-dist 会残留上一轮流文件的 `*-console.html` / `*-index.html`；_worker.js 只 import 其中一条，
// 旧文件留在目录里易导致 pages dev / 本地预览「看起来像改了源码却不生效」或偶发错文件。
if (existsSync(outDir)) {
  for (const name of readdirSync(outDir)) {
    if (/^[0-9a-f]{40}-(console|index)\.html$/i.test(name)) {
      unlinkSync(path.join(outDir, name));
    }
  }
}

// 除入口外，Text 模块等会生成与 index.js 同目录的附属文件（如 *-index.html），必须一并复制，
// 否则 `wrangler pages dev` 二次打包 _worker.js 时会找不到相对路径依赖。
for (const name of readdirSync(bundleDir)) {
  if (name === "README.md" || name.endsWith(".map")) {
    continue;
  }
  const from = path.join(bundleDir, name);
  const to =
    name === "index.js" ? path.join(outDir, "_worker.js") : path.join(outDir, name);
  if (statSync(from).isFile()) {
    copyFileSync(from, to);
  }
}

if (existsSync(staticDir)) {
  for (const name of readdirSync(staticDir)) {
    // 控制台 HTML 只应通过 Worker 内嵌模块返回（GET /），勿复制为静态资源：
    // 否则 GET /console.html 会走 ASSETS，易与 _worker.js 内嵌版本不一致，出现「双栏 + 旧 Clash Provider」等假象。
    if (name === "console.html") {
      continue;
    }
    const from = path.join(staticDir, name);
    const to = path.join(outDir, name);
    if (statSync(from).isDirectory()) {
      cpSync(from, to, { recursive: true });
    } else {
      copyFileSync(from, to);
    }
  }
}

// 历史构建可能在 outDir 留下 index.html；pages dev 会用它响应 GET /，覆盖 Worker 内嵌的 console UI。
const staleRootIndex = path.join(outDir, "index.html");
if (existsSync(staleRootIndex)) {
  unlinkSync(staleRootIndex);
}

// 增量构建可能仍残留根目录 console.html（旧脚本曾复制）；ASSETS 命中后会与 _worker.js 内嵌 HTML 不一致。
const staleRootConsole = path.join(outDir, "console.html");
if (existsSync(staleRootConsole)) {
  unlinkSync(staleRootConsole);
}

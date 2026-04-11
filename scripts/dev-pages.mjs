/**
 * 本地开发：对齐 Cloudflare PAGES —— `wrangler pages dev pages-dist`，不是独立 Workers dev。
 */
import chokidar from "chokidar";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(fileURLToPath(new URL("..", import.meta.url)));
const node = process.execPath;
const buildScript = path.join(root, "scripts/build-pages.mjs");
const wranglerJs = path.join(root, "node_modules/wrangler/bin/wrangler.js");

const buildEnv = {
  ...process.env,
  PAGES_BUILD_INCREMENTAL: "1",
};

/** @returns {boolean} */
function runBuild() {
  console.log("\n[dev] 正在重新构建 pages-dist…");
  try {
    execFileSync(node, [buildScript], { cwd: root, stdio: "inherit", env: buildEnv });
    console.log("[dev] 构建完成\n");
    return true;
  } catch {
    console.error("[dev] 构建失败（已保留上一份输出）\n");
    return false;
  }
}

/**
 * 触发 wrangler pages dev 的监视器（in-process reload + --live-reload 通知浏览器），
 * 避免每次保存都 SIGTERM 整个 wrangler（会断掉 /cdn-cgi/live-reload 的 WebSocket，表现为「没有热加载」）。
 */
function bumpDevArtifactsMtime() {
  const t = new Date();
  const workerPath = path.join(root, "pages-dist", "_worker.js");
  if (existsSync(workerPath)) {
    utimesSync(workerPath, t, t);
  }
  const robotsPath = path.join(root, "pages-dist", "robots.txt");
  if (existsSync(robotsPath)) {
    utimesSync(robotsPath, t, t);
  }
}

console.log(
  "[dev] Chokidar 监听：src/**/*.ts、pages-static/、wrangler.jsonc、scripts/build-pages.mjs。保存后打包；由 wrangler 监视 pages-dist 热重载 Worker，并保持 --live-reload WebSocket。",
);
console.log(
  "[dev] 请用 npm run dev，不要只跑 wrangler pages dev。若保存后无反应可设 CHOKIDAR_USEPOLLING=1；仍不刷新可设 PAGES_DEV_HARD_RESTART=1 恢复每次保存重启 wrangler。",
);

runBuild();

let wranglerChild = null;
let wranglerRestarting = false;
let userExiting = false;

const hardRestart =
  process.env.PAGES_DEV_HARD_RESTART === "1" || process.env.PAGES_DEV_HARD_RESTART === "true";

function spawnWrangler() {
  wranglerChild = spawn(
    node,
    [wranglerJs, "pages", "dev", "pages-dist", "--live-reload"],
    { cwd: root, stdio: "inherit" },
  );
  wranglerChild.on("exit", (code, signal) => {
    if (wranglerRestarting || userExiting) return;
    watcher.close().catch(() => {});
    process.exit(signal ? 1 : code ?? 0);
  });
}

function stopWranglerForRestart() {
  return new Promise((resolve) => {
    const c = wranglerChild;
    if (!c || c.killed) {
      resolve();
      return;
    }
    wranglerRestarting = true;
    const forceKill = setTimeout(() => {
      try {
        if (!c.killed) c.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 5000);
    forceKill.unref?.();
    c.once("exit", () => {
      clearTimeout(forceKill);
      wranglerRestarting = false;
      wranglerChild = null;
      resolve();
    });
    try {
      c.kill("SIGTERM");
    } catch {
      clearTimeout(forceKill);
      wranglerRestarting = false;
      wranglerChild = null;
      resolve();
    }
  });
}

async function rebuildAfterChange() {
  if (!runBuild()) return;
  bumpDevArtifactsMtime();
  if (hardRestart) {
    console.log("[dev] PAGES_DEV_HARD_RESTART：正在重启 wrangler…\n");
    await stopWranglerForRestart();
    spawnWrangler();
  }
}

let debounceTimer;
function scheduleBuild() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void rebuildAfterChange();
  }, 300);
}

const usePolling = process.env.CHOKIDAR_USEPOLLING === "1";

const watcher = chokidar.watch(
  [
    "src/**/*.ts",
    "pages-static/**",
    "wrangler.jsonc",
    "scripts/build-pages.mjs",
  ],
  {
    cwd: root,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    usePolling,
  },
);

watcher.on("all", (event, filePath) => {
  if (event === "add" || event === "change" || event === "unlink") {
    console.log(`[dev] 检测到变更: ${filePath}`);
    scheduleBuild();
  }
});

spawnWrangler();

function shutdown() {
  userExiting = true;
  watcher.close().catch(() => {});
  if (wranglerChild && !wranglerChild.killed) {
    wranglerChild.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

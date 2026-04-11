import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const stubPath = path.resolve(root, "test/stubs/console-html.ts");
const virtualId = "\0vitest-console-html";

export default defineConfig({
  plugins: [
    {
      name: "vitest-stub-console-html",
      enforce: "pre",
      resolveId(source) {
        if (
          source === "../pages-static/console.html" ||
          source.endsWith("/pages-static/console.html")
        ) {
          return virtualId;
        }
        return null;
      },
      load(id) {
        if (id === virtualId) {
          return readFileSync(stubPath, "utf-8");
        }
        return null;
      },
    },
  ],
  test: {
    environment: "node",
  },
});

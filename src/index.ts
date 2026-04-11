import { tryDecodeBase64 } from "./lib/base64";
import {
  buildClashConfigDocument,
  buildClashProviderDocument,
  toClashProxy,
} from "./lib/clash";
import { buildRenderContext, buildSingBoxConfig } from "./lib/config";
import { fetchText } from "./lib/http";
import { listProfiles, resolveProfile } from "./lib/profiles";
import {
  dedupeAndNormalizeOutbounds,
  filterOutbounds,
  parseSubscriptionPayload,
} from "./lib/subscription";
import { renderTemplate } from "./lib/template";
import type { WorkerEnv } from "./lib/types";

type OutputFormat = "sing-box" | "clash" | "clash-provider";

function jsonResponse(body: unknown, env: WorkerEnv, status = 200): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });

  applyCorsHeaders(headers, env);

  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers,
  });
}

function applyCorsHeaders(headers: Headers, env: WorkerEnv): void {
  const corsOrigin = env.CORS_ORIGIN?.trim();
  if (corsOrigin) {
    headers.set("access-control-allow-origin", corsOrigin);
    headers.set("access-control-allow-methods", "GET, OPTIONS");
  }
}

function splitSources(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAuthorized(url: URL, request: Request, env: WorkerEnv): boolean {
  if (!env.ACCESS_PASSWORD) {
    return true;
  }

  const candidates = [
    url.searchParams.get("password"),
    url.searchParams.get("token"),
    request.headers.get("x-password"),
  ];

  return candidates.some((candidate) => candidate === env.ACCESS_PASSWORD);
}

async function resolvePayloads(requestUrl: URL, env: WorkerEnv): Promise<string[]> {
  const rawInput = requestUrl.searchParams.get("raw");
  const rawIsBase64 = requestUrl.searchParams.get("raw_base64");
  if (rawInput) {
    if (rawIsBase64 === "1" || rawIsBase64 === "true") {
      const decoded = tryDecodeBase64(rawInput);
      if (!decoded) {
        throw new Error("raw_base64=1 但 raw 不是有效 base64");
      }
      return [decoded];
    }

    return [rawInput];
  }

  const sourceUrls = splitSources(
    requestUrl.searchParams.get("url") ?? env.DEFAULT_SUBSCRIPTION_URL ?? undefined,
  );
  if (sourceUrls.length === 0) {
    throw new Error("缺少订阅来源，请提供 url 或 raw 参数");
  }

  const userAgent = requestUrl.searchParams.get("ua") ?? env.DEFAULT_USER_AGENT ?? "sing-box";
  return Promise.all(sourceUrls.map((url) => fetchText(url, userAgent)));
}

async function resolveTemplate(
  requestUrl: URL,
  env: WorkerEnv,
): Promise<string | undefined> {
  const templateRaw = requestUrl.searchParams.get("template_raw");
  const templateRawBase64 = requestUrl.searchParams.get("template_raw_base64");
  if (templateRaw) {
    if (templateRawBase64 === "1" || templateRawBase64 === "true") {
      const decoded = tryDecodeBase64(templateRaw);
      if (!decoded) {
        throw new Error("template_raw_base64=1 但 template_raw 不是有效 base64");
      }
      return decoded;
    }

    return templateRaw;
  }

  const templateUrl =
    requestUrl.searchParams.get("template_url") ?? env.DEFAULT_TEMPLATE_URL ?? undefined;
  if (!templateUrl) {
    return undefined;
  }

  const userAgent = requestUrl.searchParams.get("ua") ?? env.DEFAULT_USER_AGENT ?? "sing-box";
  return fetchText(templateUrl, userAgent);
}

function resolveOutputFormat(requestUrl: URL): OutputFormat {
  const rawFormat =
    requestUrl.searchParams.get("format") ??
    requestUrl.searchParams.get("target") ??
    "sing-box";

  switch (rawFormat.trim().toLowerCase()) {
    case "singbox":
    case "sing-box":
    case "json":
      return "sing-box";
    case "clash":
      return "clash";
    case "clash-provider":
    case "clash_provider":
    case "provider":
      return "clash-provider";
    default:
      throw new Error(`不支持的输出格式: ${rawFormat}`);
  }
}

async function handleConvert(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(url, request, env)) {
    return jsonResponse(
      {
        ok: false,
        error: "认证失败，请提供正确的 password / token。",
      },
      env,
      401,
    );
  }

  const requestedDevice = url.searchParams.get("device") ?? env.DEFAULT_DEVICE ?? "openwrt";
  const requestedVersion = url.searchParams.get("version") ?? env.DEFAULT_VERSION ?? "1.12.0";
  const profile = resolveProfile(requestedDevice, requestedVersion);

  const payloads = await resolvePayloads(url, env);
  const parsedOutbounds = payloads.flatMap((payload) =>
    parseSubscriptionPayload(payload, profile.channel),
  );

  const filteredOutbounds = filterOutbounds(
    dedupeAndNormalizeOutbounds(parsedOutbounds),
    url.searchParams.get("include"),
    url.searchParams.get("exclude"),
  );

  const outputFormat = resolveOutputFormat(url);
  const supportedClashNodes = filteredOutbounds.filter((outbound) => toClashProxy(outbound) !== null);

  if (outputFormat !== "sing-box") {
    if (url.searchParams.has("template_url") || url.searchParams.has("template_raw")) {
      throw new Error("Clash 输出暂不支持 template_url / template_raw，请使用内建 Clash 输出。");
    }

    if (supportedClashNodes.length === 0) {
      throw new Error("当前节点中没有可转换为 Clash 的代理类型。");
    }

    const body =
      outputFormat === "clash-provider"
        ? buildClashProviderDocument(filteredOutbounds)
        : buildClashConfigDocument(filteredOutbounds);

    return new Response(body, {
      headers: (() => {
        const headers = new Headers({
        "content-type": "text/yaml; charset=utf-8",
        "cache-control": "no-store",
        "x-profile-id": profile.id,
        "x-node-count": String(filteredOutbounds.length),
        "x-output-format": outputFormat,
        "x-supported-node-count": String(supportedClashNodes.length),
        });
        applyCorsHeaders(headers, env);
        return headers;
      })(),
    });
  }

  const template = await resolveTemplate(url, env);
  const config = template
    ? renderTemplate(
        template,
        buildRenderContext(profile, filteredOutbounds),
      )
    : buildSingBoxConfig(profile, filteredOutbounds);

  return new Response(JSON.stringify(config, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-profile-id": profile.id,
      "x-node-count": String(filteredOutbounds.length),
      "x-template-mode": template ? "remote" : "builtin",
      "x-output-format": outputFormat,
    },
  });
}

function handleProfiles(env: WorkerEnv): Response {
  return jsonResponse(
    {
      ok: true,
      defaults: {
        device: env.DEFAULT_DEVICE ?? "openwrt",
        version: env.DEFAULT_VERSION ?? "1.12.0",
        format: "sing-box",
      },
      profiles: listProfiles(),
      guidance: {
        legacy: "sing-box 1.10.0 / 1.11.7 使用 legacy profile",
        modern: "sing-box 1.12.0 / 1.13.7 / 1.14.0-alpha.10 使用 modern profile",
        outputs: {
          "sing-box": "输出 sing-box JSON 配置",
          clash: "输出可直接导入 Clash / Clash.Meta 的完整 YAML 配置",
          "clash-provider": "输出仅含 proxies 的 Clash provider YAML",
        },
      },
    },
    env,
  );
}

function handleRoot(env: WorkerEnv): Response {
  return jsonResponse(
    {
      ok: true,
      service: "sub2singbox-worker",
      endpoints: ["/health", "/profiles", "/convert"],
      example:
        "/convert?device=openwrt&version=1.12.0&url=https://example.com/sub.txt&template_url=https://example.com/template.json",
    },
    env,
  );
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case "/":
          return handleRoot(env);
        case "/health":
          return jsonResponse({ ok: true }, env);
        case "/profiles":
          return handleProfiles(env);
        case "/convert":
          return await handleConvert(request, env);
        default:
          return jsonResponse(
            {
              ok: false,
              error: "未找到路由",
            },
            env,
            404,
          );
      }
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : "未知错误",
        },
        env,
        400,
      );
    }
  },
};

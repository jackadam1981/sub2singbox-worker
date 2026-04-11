import { tryDecodeBase64 } from "./lib/base64";
import {
  getCacheDebugInfo,
  getCachedRemoteText,
  getRemoteResourceCacheKey,
  getResultCacheKey,
  readResultCache,
  writeResultCache,
} from "./lib/cache";
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

function buildTextHeaders(
  env: WorkerEnv,
  headersInit: Record<string, string>,
): Headers {
  const headers = new Headers(headersInit);
  applyCorsHeaders(headers, env);
  return headers;
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

function shouldBypassCache(url: URL): boolean {
  const cache = url.searchParams.get("cache");
  const refresh = url.searchParams.get("refresh");
  return cache === "0" || cache === "false" || refresh === "1" || refresh === "true";
}

async function resolvePayloads(
  requestUrl: URL,
  env: WorkerEnv,
): Promise<{ payloads: string[]; cacheState: string }> {
  const rawInput = requestUrl.searchParams.get("raw");
  const rawIsBase64 = requestUrl.searchParams.get("raw_base64");
  if (rawInput) {
    if (rawIsBase64 === "1" || rawIsBase64 === "true") {
      const decoded = tryDecodeBase64(rawInput);
      if (!decoded) {
        throw new Error("raw_base64=1 但 raw 不是有效 base64");
      }
      return { payloads: [decoded], cacheState: "raw" };
    }

    return { payloads: [rawInput], cacheState: "raw" };
  }

  const sourceUrls = splitSources(
    requestUrl.searchParams.get("url") ?? env.DEFAULT_SUBSCRIPTION_URL ?? undefined,
  );
  if (sourceUrls.length === 0) {
    throw new Error("缺少订阅来源，请提供 url 或 raw 参数");
  }

  const userAgent = requestUrl.searchParams.get("ua") ?? env.DEFAULT_USER_AGENT ?? "sing-box";
  const bypassFreshCache = shouldBypassCache(requestUrl);
  const results = await Promise.all(
    sourceUrls.map(async (sourceUrl) => {
      const cached = await getCachedRemoteText(env, {
        key: getRemoteResourceCacheKey("subscription", sourceUrl),
        kind: "subscription",
        bypassFreshCache,
        loader: () => fetchText(sourceUrl, userAgent),
      });
      return cached;
    }),
  );
  return {
    payloads: results.map((result) => result.value),
    cacheState: results.map((result) => result.source).join(","),
  };
}

async function resolveTemplate(
  requestUrl: URL,
  env: WorkerEnv,
): Promise<{ template?: string; cacheState: string }> {
  const templateRaw = requestUrl.searchParams.get("template_raw");
  const templateRawBase64 = requestUrl.searchParams.get("template_raw_base64");
  if (templateRaw) {
    if (templateRawBase64 === "1" || templateRawBase64 === "true") {
      const decoded = tryDecodeBase64(templateRaw);
      if (!decoded) {
        throw new Error("template_raw_base64=1 但 template_raw 不是有效 base64");
      }
      return { template: decoded, cacheState: "raw" };
    }

    return { template: templateRaw, cacheState: "raw" };
  }

  const templateUrl =
    requestUrl.searchParams.get("template_url") ?? env.DEFAULT_TEMPLATE_URL ?? undefined;
  if (!templateUrl) {
    return { template: undefined, cacheState: "builtin" };
  }

  const userAgent = requestUrl.searchParams.get("ua") ?? env.DEFAULT_USER_AGENT ?? "sing-box";
  const cached = await getCachedRemoteText(env, {
    key: getRemoteResourceCacheKey("template", templateUrl),
    kind: "template",
    bypassFreshCache: true,
    loader: () => fetchText(templateUrl, userAgent),
  });
  return { template: cached.value, cacheState: cached.source };
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

  const payloadResult = await resolvePayloads(url, env);
  const parsedOutbounds = payloadResult.payloads.flatMap((payload) =>
    parseSubscriptionPayload(payload, profile.channel),
  );

  const filteredOutbounds = filterOutbounds(
    dedupeAndNormalizeOutbounds(parsedOutbounds),
    url.searchParams.get("include"),
    url.searchParams.get("exclude"),
  );

  const outputFormat = resolveOutputFormat(url);
  const hasRemoteTemplate =
    url.searchParams.has("template_url") ||
    url.searchParams.has("template_raw") ||
    Boolean(env.DEFAULT_TEMPLATE_URL);
  const resultCacheEnabled =
    (outputFormat === "sing-box" && !hasRemoteTemplate) ||
    outputFormat === "clash" ||
    outputFormat === "clash-provider";
  const bypassCache = shouldBypassCache(url);
  const resultCacheKey =
    resultCacheEnabled && !bypassCache
      ? getResultCacheKey(request, outputFormat, hasRemoteTemplate ? "remote" : "builtin")
      : null;
  const resultCacheState =
    hasRemoteTemplate && outputFormat === "sing-box"
      ? "bypass"
      : resultCacheKey
        ? "miss"
        : "bypass";
  const subscriptionCacheState = url.searchParams.has("url")
    ? bypassCache
      ? "bypass"
      : "network-or-cache"
    : "raw";
  const templateCacheState = hasRemoteTemplate ? "stale-only" : "builtin";

  if (resultCacheKey) {
    const cachedBody = await readResultCache(env, resultCacheKey);
    if (cachedBody) {
      if (outputFormat === "sing-box") {
        return new Response(cachedBody, {
          headers: buildTextHeaders(env, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-profile-id": profile.id,
            "x-node-count": String(filteredOutbounds.length),
            "x-template-mode": hasRemoteTemplate ? "remote" : "builtin",
            "x-output-format": outputFormat,
            "x-cache-result": "hit",
            "x-cache-subscription": subscriptionCacheState,
            "x-cache-template": templateCacheState,
          }),
        });
      }

      return new Response(cachedBody, {
        headers: buildTextHeaders(env, {
          "content-type": "text/yaml; charset=utf-8",
          "cache-control": "no-store",
          "x-profile-id": profile.id,
          "x-node-count": String(filteredOutbounds.length),
          "x-output-format": outputFormat,
          "x-cache-result": "hit",
          "x-cache-subscription": subscriptionCacheState,
          "x-cache-template": templateCacheState,
        }),
      });
    }
  }

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

    if (resultCacheKey && !hasRemoteTemplate) {
      await writeResultCache(env, resultCacheKey, body);
    }

    return new Response(body, {
      headers: buildTextHeaders(env, {
        "content-type": "text/yaml; charset=utf-8",
        "cache-control": "no-store",
        "x-profile-id": profile.id,
        "x-node-count": String(filteredOutbounds.length),
        "x-output-format": outputFormat,
        "x-supported-node-count": String(supportedClashNodes.length),
        "x-cache-result": resultCacheState,
        "x-cache-subscription": subscriptionCacheState,
        "x-cache-template": templateCacheState,
      }),
    });
  }

  const templateResult = await resolveTemplate(url, env);
  const config = templateResult.template
    ? renderTemplate(
        templateResult.template,
        buildRenderContext(profile, filteredOutbounds),
      )
    : buildSingBoxConfig(profile, filteredOutbounds);
  const body = JSON.stringify(config, null, 2);

  if (resultCacheKey && !hasRemoteTemplate) {
    await writeResultCache(env, resultCacheKey, body);
  }

  return new Response(body, {
    headers: buildTextHeaders(env, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-profile-id": profile.id,
      "x-node-count": String(filteredOutbounds.length),
      "x-template-mode": templateResult.template ? "remote" : "builtin",
      "x-output-format": outputFormat,
      "x-cache-result": resultCacheState,
      "x-cache-subscription": payloadResult.cacheState,
      "x-cache-template": templateResult.cacheState,
    }),
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
        cache: {
          subscription: "默认缓存 10 分钟，失败时回退 24 小时旧内容",
          template: "默认不做 fresh 缓存，失败时可回退最近 1 小时旧模板",
          result: "远程模板默认不缓存结果；其他输出默认缓存 5 分钟",
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
        case "/debug/cache-policy":
          return jsonResponse({ ok: true, policy: getCacheDebugInfo(env) }, env);
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

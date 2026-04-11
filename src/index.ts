import { tryDecodeBase64 } from "./lib/base64";
import { buildSingBoxConfig } from "./lib/config";
import { listProfiles, resolveProfile } from "./lib/profiles";
import {
  dedupeAndNormalizeOutbounds,
  filterOutbounds,
  parseSubscriptionPayload,
} from "./lib/subscription";
import type { WorkerEnv } from "./lib/types";

function jsonResponse(body: unknown, env: WorkerEnv, status = 200): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });

  const corsOrigin = env.CORS_ORIGIN?.trim();
  if (corsOrigin) {
    headers.set("access-control-allow-origin", corsOrigin);
    headers.set("access-control-allow-methods", "GET, OPTIONS");
  }

  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers,
  });
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

async function fetchSubscription(url: string, userAgent: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/plain, application/json;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`拉取订阅失败: ${url} (${response.status})`);
  }

  return response.text();
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
  return Promise.all(sourceUrls.map((url) => fetchSubscription(url, userAgent)));
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

  const config = buildSingBoxConfig(profile, filteredOutbounds);

  return new Response(JSON.stringify(config, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-profile-id": profile.id,
      "x-node-count": String(filteredOutbounds.length),
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
      },
      profiles: listProfiles(),
      guidance: {
        legacy: "sing-box 1.10 / 1.11 使用 legacy profile",
        modern: "sing-box 1.12+ 使用 modern profile",
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
      example: "/convert?device=openwrt&version=1.12.0&url=https://example.com/sub.txt",
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

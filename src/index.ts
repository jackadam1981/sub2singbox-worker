import { tryDecodeBase64 } from "./lib/base64";
import {
  builtinTemplateDetail,
  listBuiltinTemplateSummaries,
  builtinTemplateSummary,
  getBuiltinTemplate,
  getBuiltinTemplateRecommendation,
  listBuiltinTemplateDefinitions,
  listBuiltinTemplates,
} from "./lib/builtin-templates";
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
import { buildSingBoxConfigFromAcl4ssr } from "./lib/acl4ssr";
import { buildRenderContext, buildSingBoxConfig } from "./lib/config";
import { AppError, toErrorResponseBody } from "./lib/errors";
import { fetchText } from "./lib/http";
import { getVersionChannel, listProfiles, normalizeDevice, resolveProfile } from "./lib/profiles";
import {
  dedupeAndNormalizeOutbounds,
  filterOutbounds,
  inspectSubscriptionPayload,
  parseSubscriptionPayload,
} from "./lib/subscription";
import { renderTemplate } from "./lib/template";
import type {
  BuiltinTemplateDefinition,
  ConversionExplain,
  JsonObject,
  SourceDebugEntry,
  WorkerEnv,
} from "./lib/types";

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

function isStrictSourceMode(url: URL): boolean {
  const strict = url.searchParams.get("strict");
  const partial = url.searchParams.get("allow_partial");
  if (strict === "1" || strict === "true") {
    return true;
  }
  if (partial === "0" || partial === "false") {
    return true;
  }
  return false;
}

async function resolvePayloads(
  requestUrl: URL,
  env: WorkerEnv,
): Promise<{
  entries: Array<{
    index: number;
    source: string;
    source_type: "raw" | "url";
    fetch_status: "success" | "failed" | "skipped";
    cache_state: string;
    payload?: string;
    error?: string;
  }>;
  cacheState: string;
  sourceStats: {
    total: number;
    succeeded: number;
    failed: number;
    mode: "strict" | "tolerant";
    errors: string[];
  };
}> {
  const rawInput = requestUrl.searchParams.get("raw");
  const rawIsBase64 = requestUrl.searchParams.get("raw_base64");
  if (rawInput) {
    if (rawIsBase64 === "1" || rawIsBase64 === "true") {
      const decoded = tryDecodeBase64(rawInput);
      if (!decoded) {
        throw new Error("raw_base64=1 但 raw 不是有效 base64");
      }
      return {
        entries: [
          {
            index: 0,
            source: "raw",
            source_type: "raw",
            fetch_status: "success",
            cache_state: "raw",
            payload: decoded,
          },
        ],
        cacheState: "raw",
        sourceStats: {
          total: 1,
          succeeded: 1,
          failed: 0,
          mode: "tolerant",
          errors: [],
        },
      };
    }

    return {
      entries: [
        {
          index: 0,
          source: "raw",
          source_type: "raw",
          fetch_status: "success",
          cache_state: "raw",
          payload: rawInput,
        },
      ],
      cacheState: "raw",
      sourceStats: {
        total: 1,
        succeeded: 1,
        failed: 0,
        mode: "tolerant",
        errors: [],
      },
    };
  }

  const sourceUrls = splitSources(
    requestUrl.searchParams.get("url") ?? env.DEFAULT_SUBSCRIPTION_URL ?? undefined,
  );
  if (sourceUrls.length === 0) {
    throw new Error("缺少订阅来源，请提供 url 或 raw 参数");
  }

  const userAgent = requestUrl.searchParams.get("ua") ?? env.DEFAULT_USER_AGENT ?? "sing-box";
  const fallbackUserAgent =
    requestUrl.searchParams.get("fallback_ua") ??
    env.DEFAULT_FALLBACK_USER_AGENT ??
    undefined;
  const bypassFreshCache = shouldBypassCache(requestUrl);
  const strictMode = isStrictSourceMode(requestUrl);
  const settled = await Promise.all(
    sourceUrls.map(async (sourceUrl, index) => {
      try {
        const cached = await getCachedRemoteText(env, {
          key: getRemoteResourceCacheKey("subscription", sourceUrl),
          kind: "subscription",
          bypassFreshCache,
          loader: () =>
            fetchText(sourceUrl, userAgent, {
              fallbackUserAgent,
            }),
        });
        return {
          ok: true as const,
          entry: {
            index,
            source: sourceUrl,
            source_type: "url" as const,
            fetch_status: "success" as const,
            cache_state: cached.source,
            payload: cached.value,
          },
        };
      } catch (error) {
        return {
          ok: false as const,
          entry: {
            index,
            source: sourceUrl,
            source_type: "url" as const,
            fetch_status: "failed" as const,
            cache_state: "error",
            error: error instanceof Error ? error.message : "未知错误",
          },
        };
      }
    }),
  );

  const successes = settled.filter((item) => item.ok);
  const failures = settled.filter((item) => !item.ok);

  if (strictMode && failures.length > 0) {
    throw new AppError({
      stage: "fetch-subscription",
      code: "STRICT_SOURCE_FAILURE",
      message: `存在订阅源拉取失败（strict 模式）：${failures.map((item) => `${item.entry.source} -> ${item.entry.error}`).join(" | ")}`,
      detail: failures.map((item) => ({
        source: item.entry.source,
        error: item.entry.error,
      })),
    });
  }

  if (successes.length === 0) {
    throw new AppError({
      stage: "fetch-subscription",
      code: "ALL_SOURCES_FAILED",
      message: `所有订阅源均拉取失败：${failures.map((item) => `${item.entry.source} -> ${item.entry.error}`).join(" | ")}`,
      detail: failures.map((item) => ({
        source: item.entry.source,
        error: item.entry.error,
      })),
    });
  }

  return {
    entries: [...successes.map((item) => item.entry), ...failures.map((item) => item.entry)].sort(
      (a, b) => a.index - b.index,
    ),
    cacheState: successes.map((result) => `${result.entry.source}:${result.entry.cache_state}`).join(","),
    sourceStats: {
      total: sourceUrls.length,
      succeeded: successes.length,
      failed: failures.length,
      mode: strictMode ? "strict" : "tolerant",
      errors: failures.map((item) => `${item.entry.source} -> ${item.entry.error}`),
    },
  };
}

async function resolveTemplate(
  requestUrl: URL,
  env: WorkerEnv,
): Promise<{
  template?: string;
  cacheState: string;
  builtinTemplate?: BuiltinTemplateDefinition;
  templateSource?: {
    kind: "builtin-remote" | "builtin-fallback" | "remote" | "raw";
    url?: string;
    path?: string;
    repo?: string;
  };
}> {
  const selectedTemplate = requestUrl.searchParams.get("template");
  if (selectedTemplate?.startsWith("builtin:")) {
    const templateId = selectedTemplate.slice("builtin:".length).trim();
    const builtinTemplate = getBuiltinTemplate(templateId);
    if (!builtinTemplate) {
      throw new AppError({
        stage: "template",
        code: "BUILTIN_TEMPLATE_NOT_FOUND",
        message: `未找到内建模板: ${templateId}`,
        detail: {
          template_id: templateId,
        },
      });
    }
    if (builtinTemplate.template_url) {
      const userAgent =
        requestUrl.searchParams.get("ua") ?? env.DEFAULT_USER_AGENT ?? "sing-box";
      try {
        const cached = await getCachedRemoteText(env, {
          key: getRemoteResourceCacheKey("template", builtinTemplate.template_url),
          kind: "template",
          bypassFreshCache: true,
          loader: () => fetchText(builtinTemplate.template_url!, userAgent),
        });
        return {
          template: cached.value,
          cacheState: cached.source,
          builtinTemplate,
          templateSource: {
            kind: "builtin-remote",
            url: builtinTemplate.template_url,
            path: builtinTemplate.source_path,
            repo: builtinTemplate.source_repo,
          },
        };
      } catch {
        // Fall back to local emergency template if remote format is unavailable.
      }
    }
    return {
      template: builtinTemplate.fallback_template_text,
      cacheState: "builtin",
      builtinTemplate,
      templateSource: {
        kind: "builtin-fallback",
        url: builtinTemplate.template_url,
        path: builtinTemplate.source_path,
        repo: builtinTemplate.source_repo,
      },
    };
  }

  const templateRaw = requestUrl.searchParams.get("template_raw");
  const templateRawBase64 = requestUrl.searchParams.get("template_raw_base64");
  if (templateRaw) {
    if (templateRawBase64 === "1" || templateRawBase64 === "true") {
      const decoded = tryDecodeBase64(templateRaw);
      if (!decoded) {
        throw new Error("template_raw_base64=1 但 template_raw 不是有效 base64");
      }
      return {
        template: decoded,
        cacheState: "raw",
        templateSource: {
          kind: "raw",
        },
      };
    }

    return {
      template: templateRaw,
      cacheState: "raw",
      templateSource: {
        kind: "raw",
      },
    };
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
  return {
    template: cached.value,
    cacheState: cached.source,
    templateSource: {
      kind: "remote",
      url: templateUrl,
    },
  };
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

function resolveTemplateRecommendation(url: URL):
  | {
      device: ReturnType<typeof normalizeDevice>;
      channel: ReturnType<typeof getVersionChannel>;
      recommendation: ReturnType<typeof getBuiltinTemplateRecommendation>;
    }
  | undefined {
  const deviceParam = url.searchParams.get("device");
  const versionParam = url.searchParams.get("version");
  if (!deviceParam && !versionParam) {
    return undefined;
  }

  const device = normalizeDevice(deviceParam ?? "openwrt");
  const channel = getVersionChannel(versionParam ?? "1.12.0");
  return {
    device,
    channel,
    recommendation: getBuiltinTemplateRecommendation(device, channel),
  };
}

function summarizeTemplateMode(
  templateResult: Awaited<ReturnType<typeof resolveTemplate>>,
): "builtin" | "remote" | "raw" | "none" {
  if (templateResult.builtinTemplate) {
    return "builtin";
  }
  if (!templateResult.template) {
    return "none";
  }
  if (templateResult.cacheState === "raw") {
    return "raw";
  }
  return "remote";
}

async function renderSingBoxConfig(
  env: WorkerEnv,
  profile: ReturnType<typeof resolveProfile>,
  outbounds: ReturnType<typeof dedupeAndNormalizeOutbounds>,
  templateResult: Awaited<ReturnType<typeof resolveTemplate>>,
): Promise<JsonObject> {
  if (templateResult.builtinTemplate?.acl4ssr_config_url) {
    try {
      const aclConfig = await fetchText(
        templateResult.builtinTemplate.acl4ssr_config_url,
        env.DEFAULT_USER_AGENT ?? "sing-box",
      );
      const built = await buildSingBoxConfigFromAcl4ssr(
        profile,
        outbounds,
        aclConfig,
        async (ruleUrl: string) =>
          fetchText(ruleUrl, env.DEFAULT_USER_AGENT ?? "sing-box"),
      );
      return built.config;
    } catch {
      // Fallback to builtin/remote JSON template path below.
    }
  }

  if (templateResult.template) {
    return renderTemplate(
      templateResult.template,
      buildRenderContext(profile, outbounds),
    );
  }

  return buildSingBoxConfig(profile, outbounds);
}

function buildSourceDebugEntries(
  entries: Awaited<ReturnType<typeof resolvePayloads>>["entries"],
  channel: "legacy" | "modern",
  strictMode: boolean,
): { debugEntries: SourceDebugEntry[]; parsedOutbounds: ReturnType<typeof dedupeAndNormalizeOutbounds> } {
  const debugEntries: SourceDebugEntry[] = [];
  const parsedOutbounds = [];
  const parseFailures: SourceDebugEntry[] = [];

  for (const entry of entries) {
    if (entry.fetch_status !== "success" || !entry.payload) {
      debugEntries.push({
        index: entry.index,
        source: entry.source,
        source_type: entry.source_type,
        fetch_status: entry.fetch_status,
        parse_status: "skipped",
        cache_state: entry.cache_state,
        ...(entry.error ? { error: entry.error } : {}),
      });
      continue;
    }

    const payloadKind = inspectSubscriptionPayload(entry.payload);
    try {
      const outbounds = parseSubscriptionPayload(entry.payload, channel);
      parsedOutbounds.push(...outbounds);
      debugEntries.push({
        index: entry.index,
        source: entry.source,
        source_type: entry.source_type,
        fetch_status: "success",
        parse_status: "success",
        cache_state: entry.cache_state,
        payload_kind: payloadKind,
        parsed_outbounds: outbounds.length,
      });
    } catch (error) {
      const debugEntry: SourceDebugEntry = {
        index: entry.index,
        source: entry.source,
        source_type: entry.source_type,
        fetch_status: "success",
        parse_status: "failed",
        cache_state: entry.cache_state,
        payload_kind: payloadKind,
        error: error instanceof Error ? error.message : "未知错误",
      };
      debugEntries.push(debugEntry);
      parseFailures.push(debugEntry);
    }
  }

  if (strictMode && parseFailures.length > 0) {
    throw new AppError({
      stage: "parse-subscription",
      code: "STRICT_PARSE_FAILURE",
      message: `存在订阅源解析失败（strict 模式）：${parseFailures.map((item) => `${item.source} -> ${item.error}`).join(" | ")}`,
      detail: parseFailures as unknown as JsonObject,
    });
  }

  if (parsedOutbounds.length === 0) {
    throw new AppError({
      stage: "parse-subscription",
      code: "NO_PARSEABLE_OUTBOUNDS",
      message: "没有从输入源中解析出任何可用节点。",
      detail: debugEntries as unknown as JsonObject,
    });
  }

  return {
    debugEntries,
    parsedOutbounds,
  };
}

async function analyzeConversion(
  request: Request,
  env: WorkerEnv,
): Promise<{
  profile: ReturnType<typeof resolveProfile>;
  outputFormat: OutputFormat;
  filteredOutbounds: ReturnType<typeof dedupeAndNormalizeOutbounds>;
  supportedClashNodes: ReturnType<typeof dedupeAndNormalizeOutbounds>;
  templateResult: Awaited<ReturnType<typeof resolveTemplate>>;
  payloadResult: Awaited<ReturnType<typeof resolvePayloads>>;
  debugEntries: SourceDebugEntry[];
  explain: ConversionExplain;
}> {
  const url = new URL(request.url);
  const requestedDevice = url.searchParams.get("device") ?? env.DEFAULT_DEVICE ?? "openwrt";
  const requestedVersion = url.searchParams.get("version") ?? env.DEFAULT_VERSION ?? "1.12.0";
  let profile;
  try {
    profile = resolveProfile(requestedDevice, requestedVersion);
  } catch (error) {
    throw new AppError({
      stage: "profile",
      code: "PROFILE_RESOLUTION_FAILED",
      message: error instanceof Error ? error.message : "无法解析 profile",
      detail: {
        device: requestedDevice,
        version: requestedVersion,
      },
    });
  }

  const outputFormat = resolveOutputFormat(url);
  const strictMode = isStrictSourceMode(url);
  const payloadResult = await resolvePayloads(url, env);
  const { debugEntries, parsedOutbounds } = buildSourceDebugEntries(
    payloadResult.entries,
    profile.channel,
    strictMode,
  );

  const dedupedOutbounds = dedupeAndNormalizeOutbounds(parsedOutbounds);
  const filteredOutbounds = filterOutbounds(
    dedupedOutbounds,
    url.searchParams.get("include"),
    url.searchParams.get("exclude"),
  );
  const supportedClashNodes = filteredOutbounds.filter(
    (outbound) => toClashProxy(outbound) !== null,
  );

  if (filteredOutbounds.length === 0) {
    throw new AppError({
      stage: "output",
      code: "ALL_NODES_FILTERED_OUT",
      message: "过滤后没有剩余节点。",
      detail: {
        include: url.searchParams.get("include"),
        exclude: url.searchParams.get("exclude"),
      },
    });
  }

  if (outputFormat !== "sing-box" && supportedClashNodes.length === 0) {
    throw new AppError({
      stage: "output",
      code: "NO_CLASH_COMPATIBLE_NODES",
      message: "当前节点中没有可转换为 Clash 的代理类型。",
    });
  }

  const templateResult = await resolveTemplate(url, env);
  const explain: ConversionExplain = {
    profile: {
      id: profile.id,
      device: profile.device,
      channel: profile.channel,
    },
    output_format: outputFormat,
    template: {
      mode: summarizeTemplateMode(templateResult),
      cache_state: templateResult.cacheState,
      ...(templateResult.builtinTemplate
        ? { id: templateResult.builtinTemplate.id }
        : {}),
    },
    sources: {
      total: payloadResult.sourceStats.total,
      succeeded: payloadResult.sourceStats.succeeded,
      failed: payloadResult.sourceStats.failed,
      mode: payloadResult.sourceStats.mode,
      entries: debugEntries,
    },
    nodes: {
      parsed_total: parsedOutbounds.length,
      deduped_total: dedupedOutbounds.length,
      filtered_total: filteredOutbounds.length,
      clash_compatible_total: supportedClashNodes.length,
      tags: filteredOutbounds.map((item) => item.tag),
    },
    cache: {
      result: "analysis",
      subscription: payloadResult.cacheState,
      template: templateResult.cacheState,
    },
  };

  return {
    profile,
    outputFormat,
    filteredOutbounds,
    supportedClashNodes,
    templateResult,
    payloadResult,
    debugEntries,
    explain,
  };
}

async function handleConvert(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(url, request, env)) {
    throw new AppError({
      stage: "auth",
      code: "UNAUTHORIZED",
      status: 401,
      message: "认证失败，请提供正确的 password / token。",
    });
  }
  const analysis = await analyzeConversion(request, env);
  const {
    profile,
    outputFormat,
    filteredOutbounds,
    supportedClashNodes,
    templateResult,
    payloadResult,
  } = analysis;
  const hasRemoteTemplate = summarizeTemplateMode(templateResult) === "remote";
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
            "x-template-mode":
              templateResult.builtinTemplate || !templateResult.template
                ? "builtin"
                : "remote",
            ...(templateResult.builtinTemplate
              ? { "x-template-id": templateResult.builtinTemplate.id }
              : {}),
            "x-output-format": outputFormat,
            "x-cache-result": "hit",
            "x-cache-subscription": payloadResult.cacheState,
            "x-cache-template": templateResult.cacheState,
            "x-source-total": String(payloadResult.sourceStats.total),
            "x-source-succeeded": String(payloadResult.sourceStats.succeeded),
            "x-source-failed": String(payloadResult.sourceStats.failed),
            "x-source-mode": payloadResult.sourceStats.mode,
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
          "x-cache-subscription": payloadResult.cacheState,
          "x-cache-template": templateResult.cacheState,
          "x-source-total": String(payloadResult.sourceStats.total),
          "x-source-succeeded": String(payloadResult.sourceStats.succeeded),
          "x-source-failed": String(payloadResult.sourceStats.failed),
          "x-source-mode": payloadResult.sourceStats.mode,
        }),
      });
    }
  }

  if (outputFormat !== "sing-box") {
    if (url.searchParams.has("template_url") || url.searchParams.has("template_raw")) {
      throw new AppError({
        stage: "output",
        code: "CLASH_TEMPLATE_UNSUPPORTED",
        message: "Clash 输出暂不支持 template_url / template_raw，请使用内建 Clash 输出。",
      });
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
        "x-cache-subscription": payloadResult.cacheState,
        "x-cache-template": templateResult.cacheState,
        "x-source-total": String(payloadResult.sourceStats.total),
        "x-source-succeeded": String(payloadResult.sourceStats.succeeded),
        "x-source-failed": String(payloadResult.sourceStats.failed),
        "x-source-mode": payloadResult.sourceStats.mode,
      }),
    });
  }

  const config = await renderSingBoxConfig(
    env,
    profile,
    filteredOutbounds,
    templateResult,
  );
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
      "x-template-mode":
        templateResult.builtinTemplate || !templateResult.template
          ? "builtin"
          : "remote",
      ...(templateResult.builtinTemplate
        ? { "x-template-id": templateResult.builtinTemplate.id }
        : {}),
      "x-output-format": outputFormat,
      "x-cache-result": resultCacheState,
      "x-cache-subscription": payloadResult.cacheState,
      "x-cache-template": templateResult.cacheState,
      "x-source-total": String(payloadResult.sourceStats.total),
      "x-source-succeeded": String(payloadResult.sourceStats.succeeded),
      "x-source-failed": String(payloadResult.sourceStats.failed),
      "x-source-mode": payloadResult.sourceStats.mode,
    }),
  });
}

function handleProfiles(env: WorkerEnv): Response {
  const defaultDevice = env.DEFAULT_DEVICE ?? "openwrt";
  const defaultVersion = env.DEFAULT_VERSION ?? "1.12.0";
  const defaultProfile = resolveProfile(defaultDevice, defaultVersion);
  const defaultRecommendation = getBuiltinTemplateRecommendation(
    defaultProfile.device,
    defaultProfile.channel,
  );

  return jsonResponse(
    {
      ok: true,
      defaults: {
        device: defaultDevice,
        version: defaultVersion,
        format: "sing-box",
        recommended_template: defaultRecommendation?.primary_template_id ?? null,
      },
      profiles: listProfiles(),
      builtin_templates: listBuiltinTemplateSummaries({
        currentDevice: defaultProfile.device,
        currentChannel: defaultProfile.channel,
      }),
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
        sources: {
          tolerant: "默认容错模式，多源订阅中部分失败时只要仍有成功源就继续转换",
          strict: "strict=1 或 allow_partial=0 时启用严格模式，任一源失败即报错",
          fallback_ua: "可通过 fallback_ua 或 DEFAULT_FALLBACK_USER_AGENT 指定 401/403 时的备用 UA",
        },
      },
    },
    env,
  );
}

function handleTemplates(request: Request, env: WorkerEnv): Response {
  const url = new URL(request.url);
  const recommendationInput = resolveTemplateRecommendation(url);

  return jsonResponse(
    {
      ok: true,
      templates: listBuiltinTemplateSummaries(
        recommendationInput
          ? {
              currentDevice: recommendationInput.device,
              currentChannel: recommendationInput.channel,
            }
          : undefined,
      ),
      ...(recommendationInput
        ? {
            recommendation: recommendationInput.recommendation,
            current_profile: {
              device: recommendationInput.device,
              channel: recommendationInput.channel,
            },
          }
        : {}),
    },
    env,
  );
}

function handleTemplateDetail(request: Request, env: WorkerEnv): Response {
  const url = new URL(request.url);
  const templateId = decodeURIComponent(url.pathname.slice("/templates/".length)).trim();
  if (!templateId) {
    throw new AppError({
      stage: "template",
      code: "TEMPLATE_ID_REQUIRED",
      message: "缺少模板 ID。",
      status: 400,
    });
  }

  const template = getBuiltinTemplate(templateId);
  if (!template) {
    throw new AppError({
      stage: "template",
      code: "BUILTIN_TEMPLATE_NOT_FOUND",
      message: `未找到内建模板: ${templateId}`,
      status: 404,
    });
  }

  const recommendationInput = resolveTemplateRecommendation(url);
  return jsonResponse(
    {
      ok: true,
      template: builtinTemplateDetail(
        template,
        recommendationInput
          ? {
              currentDevice: recommendationInput.device,
              currentChannel: recommendationInput.channel,
            }
          : undefined,
      ),
      ...(recommendationInput
        ? {
            recommendation: recommendationInput.recommendation,
            current_profile: {
              device: recommendationInput.device,
              channel: recommendationInput.channel,
            },
          }
        : {}),
    },
    env,
  );
}

async function handleValidate(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(url, request, env)) {
    throw new AppError({
      stage: "auth",
      code: "UNAUTHORIZED",
      status: 401,
      message: "认证失败，请提供正确的 password / token。",
    });
  }

  const analysis = await analyzeConversion(request, env);
  return jsonResponse(
    {
      ok: true,
      valid: true,
      profile: analysis.explain.profile,
      output_format: analysis.explain.output_format,
      template: analysis.explain.template,
      sources: {
        total: analysis.explain.sources.total,
        succeeded: analysis.explain.sources.succeeded,
        failed: analysis.explain.sources.failed,
        mode: analysis.explain.sources.mode,
      },
      nodes: analysis.explain.nodes,
      checks: {
        can_render_singbox: true,
        can_render_clash:
          analysis.outputFormat === "sing-box" ||
          analysis.explain.nodes.clash_compatible_total > 0,
      },
    },
    env,
  );
}

async function handleExplain(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(url, request, env)) {
    throw new AppError({
      stage: "auth",
      code: "UNAUTHORIZED",
      status: 401,
      message: "认证失败，请提供正确的 password / token。",
    });
  }

  const includeRendered =
    url.searchParams.get("include_rendered") === "1" ||
    url.searchParams.get("rendered") === "1";
  const analysis = await analyzeConversion(request, env);

  let rendered: JsonObject | string | undefined;
  if (includeRendered) {
    if (analysis.outputFormat === "sing-box") {
      try {
        rendered = await renderSingBoxConfig(
          env,
          analysis.profile,
          analysis.filteredOutbounds,
          analysis.templateResult,
        );
      } catch (error) {
        throw error;
      }
    } else if (analysis.outputFormat === "clash") {
      rendered = buildClashConfigDocument(analysis.filteredOutbounds);
    } else {
      rendered = buildClashProviderDocument(analysis.filteredOutbounds);
    }
  }

  return jsonResponse(
    {
      ok: true,
      explain: analysis.explain,
      ...(includeRendered ? { rendered } : {}),
    },
    env,
  );
}

function handleRoot(env: WorkerEnv): Response {
  return jsonResponse(
    {
      ok: true,
      service: "sub2singbox-worker",
      endpoints: ["/health", "/profiles", "/templates", "/validate", "/explain", "/convert"],
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
        case "/templates":
          return handleTemplates(request, env);
        case "/profiles":
          return handleProfiles(env);
        case "/validate":
          return await handleValidate(request, env);
        case "/explain":
          return await handleExplain(request, env);
        case "/convert":
          return await handleConvert(request, env);
        default:
          if (url.pathname.startsWith("/templates/")) {
            return handleTemplateDetail(request, env);
          }
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
      const body = toErrorResponseBody(error);
      const status = error instanceof AppError ? error.status : 400;
      return jsonResponse(body, env, status);
    }
  },
};

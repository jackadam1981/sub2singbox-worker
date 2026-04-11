import type { JsonObject, WorkerEnv } from "./types";

const DEFAULT_SUBSCRIPTION_CACHE_TTL = 600;
const DEFAULT_SUBSCRIPTION_STALE_TTL = 86400;
const DEFAULT_TEMPLATE_CACHE_TTL = 0;
const DEFAULT_TEMPLATE_STALE_TTL = 3600;
const DEFAULT_RESULT_CACHE_TTL = 300;

interface CacheEnvelope {
  value: string;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getCachePolicy(env: WorkerEnv) {
  return {
    subscriptionCacheTtl: parsePositiveInt(
      env.SUBSCRIPTION_CACHE_TTL,
      DEFAULT_SUBSCRIPTION_CACHE_TTL,
    ),
    subscriptionStaleTtl: parsePositiveInt(
      env.SUBSCRIPTION_STALE_TTL,
      DEFAULT_SUBSCRIPTION_STALE_TTL,
    ),
    templateCacheTtl: parsePositiveInt(
      env.TEMPLATE_CACHE_TTL,
      DEFAULT_TEMPLATE_CACHE_TTL,
    ),
    templateStaleTtl: parsePositiveInt(
      env.TEMPLATE_STALE_TTL,
      DEFAULT_TEMPLATE_STALE_TTL,
    ),
    resultCacheTtl: parsePositiveInt(env.RESULT_CACHE_TTL, DEFAULT_RESULT_CACHE_TTL),
  };
}

function buildEnvelope(
  value: string,
  freshTtlSeconds: number,
  staleTtlSeconds: number,
): CacheEnvelope {
  const fetchedAt = Date.now();
  return {
    value,
    fetchedAt,
    expiresAt: fetchedAt + freshTtlSeconds * 1000,
    staleUntil: fetchedAt + staleTtlSeconds * 1000,
  };
}

async function readEnvelope(
  env: WorkerEnv,
  key: string,
): Promise<CacheEnvelope | null> {
  if (!env.CACHE_KV) {
    return null;
  }

  const raw = await env.CACHE_KV.get(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (
      typeof parsed.value === "string" &&
      typeof parsed.fetchedAt === "number" &&
      typeof parsed.expiresAt === "number" &&
      typeof parsed.staleUntil === "number"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

async function writeEnvelope(
  env: WorkerEnv,
  key: string,
  envelope: CacheEnvelope,
): Promise<void> {
  if (!env.CACHE_KV) {
    return;
  }

  const ttlSeconds = Math.max(
    60,
    Math.ceil((envelope.staleUntil - Date.now()) / 1000),
  );

  await env.CACHE_KV.put(key, JSON.stringify(envelope), {
    expirationTtl: ttlSeconds,
  });
}

export function getResultCacheKey(
  request: Request,
  format: string,
  mode: "builtin" | "remote",
): string {
  const url = new URL(request.url);
  url.searchParams.sort();
  return `result:${format}:${mode}:${url.pathname}?${url.searchParams.toString()}`;
}

export async function readResultCache(
  env: WorkerEnv,
  key: string,
): Promise<string | null> {
  if (!env.CACHE_KV) {
    return null;
  }

  return env.CACHE_KV.get(key);
}

export async function writeResultCache(
  env: WorkerEnv,
  key: string,
  value: string,
): Promise<void> {
  if (!env.CACHE_KV) {
    return;
  }

  const { resultCacheTtl } = getCachePolicy(env);
  if (resultCacheTtl <= 0) {
    return;
  }

  await env.CACHE_KV.put(key, value, {
    expirationTtl: resultCacheTtl,
  });
}

export async function getCachedRemoteText(
  env: WorkerEnv,
  options: {
    key: string;
    kind: "subscription" | "template";
    bypassFreshCache?: boolean;
    loader: () => Promise<string>;
  },
): Promise<{ value: string; source: "network" | "cache-fresh" | "cache-stale" }> {
  const policy = getCachePolicy(env);
  const freshTtl =
    options.kind === "subscription"
      ? policy.subscriptionCacheTtl
      : policy.templateCacheTtl;
  const staleTtl =
    options.kind === "subscription"
      ? policy.subscriptionStaleTtl
      : policy.templateStaleTtl;

  const now = Date.now();
  const envelope = await readEnvelope(env, options.key);

  if (!options.bypassFreshCache && envelope && now <= envelope.expiresAt) {
    return {
      value: envelope.value,
      source: "cache-fresh",
    };
  }

  try {
    const value = await options.loader();
    const newEnvelope = buildEnvelope(value, freshTtl, staleTtl);
    await writeEnvelope(env, options.key, newEnvelope);
    return {
      value,
      source: "network",
    };
  } catch (error) {
    if (envelope && now <= envelope.staleUntil) {
      return {
        value: envelope.value,
        source: "cache-stale",
      };
    }

    throw error;
  }
}

export function getRemoteResourceCacheKey(
  kind: "subscription" | "template",
  url: string,
): string {
  return `${kind}:${url}`;
}

export function getCacheDebugInfo(env: WorkerEnv): JsonObject {
  const policy = getCachePolicy(env);
  return {
    subscription_cache_ttl: policy.subscriptionCacheTtl,
    subscription_stale_ttl: policy.subscriptionStaleTtl,
    template_cache_ttl: policy.templateCacheTtl,
    template_stale_ttl: policy.templateStaleTtl,
    result_cache_ttl: policy.resultCacheTtl,
    kv_enabled: Boolean(env.CACHE_KV),
  };
}

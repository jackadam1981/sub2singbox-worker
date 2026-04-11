import { tryDecodeBase64 } from "./base64";
import type { JsonObject, JsonValue, SingBoxOutbound, VersionChannel } from "./types";

const SPECIAL_OUTBOUND_TYPES = new Set(["selector", "urltest", "direct", "block", "dns"]);
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-f:]+$/i;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutboundLike(value: unknown): value is SingBoxOutbound {
  return isJsonObject(value) && typeof value.type === "string" && typeof value.tag === "string";
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  if (index === -1) {
    return [value, ""];
  }

  return [value.slice(0, index), value.slice(index + separator.length)];
}

function parseNumber(value: string | null | undefined, fallback?: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : (fallback ?? 0);
}

function decodeTag(fragment: string | undefined, fallback: string): string {
  if (!fragment) {
    return fallback;
  }

  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function buildTls(
  url: URL,
  extra: {
    security?: string;
    sni?: string;
    host?: string;
    fingerprint?: string;
    alpn?: string;
    insecure?: string;
    publicKey?: string;
    shortId?: string;
  },
): JsonObject | undefined {
  const security = firstNonEmpty(extra.security, url.searchParams.get("security"), url.protocol === "https:" ? "tls" : undefined);
  if (!security || security === "none") {
    return undefined;
  }

  const tls: JsonObject = {
    enabled: true,
  };

  const serverName = firstNonEmpty(
    extra.sni,
    url.searchParams.get("sni"),
    url.searchParams.get("peer"),
    extra.host?.split(",")[0],
  );

  if (serverName) {
    tls.server_name = serverName;
  }

  const insecure = firstNonEmpty(extra.insecure, url.searchParams.get("insecure"), url.searchParams.get("allowInsecure"));
  if (insecure === "1" || insecure === "true") {
    tls.insecure = true;
  }

  const fingerprint = firstNonEmpty(extra.fingerprint, url.searchParams.get("fp"));
  if (fingerprint && fingerprint !== "none") {
    tls.utls = {
      enabled: true,
      fingerprint,
    };
  }

  const alpn = firstNonEmpty(extra.alpn, url.searchParams.get("alpn"));
  if (alpn) {
    tls.alpn = alpn
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const securityMode = security.toLowerCase();
  if (securityMode === "reality") {
    const publicKey = firstNonEmpty(extra.publicKey, url.searchParams.get("pbk"));
    const shortId = firstNonEmpty(extra.shortId, url.searchParams.get("sid"));
    tls.reality = {
      enabled: true,
      ...(publicKey ? { public_key: publicKey } : {}),
      ...(shortId ? { short_id: shortId } : {}),
    };
  }

  return tls;
}

function buildTransport(
  url: URL,
  options: {
    network?: string;
    host?: string;
    path?: string;
    serviceName?: string;
  },
): JsonObject | undefined {
  const network = firstNonEmpty(options.network, url.searchParams.get("type"), url.searchParams.get("network"));
  if (!network || network === "tcp") {
    return undefined;
  }

  const host = firstNonEmpty(options.host, url.searchParams.get("host"));
  const path = firstNonEmpty(options.path, url.searchParams.get("path")) ?? "/";

  switch (network) {
    case "ws":
      return {
        type: "ws",
        path,
        ...(host ? { headers: { Host: host } } : {}),
      };
    case "grpc":
      return {
        type: "grpc",
        service_name: firstNonEmpty(options.serviceName, url.searchParams.get("serviceName"), path.replace(/^\//, "")) ?? "grpc",
      };
    case "http":
      return {
        type: "http",
        path,
        ...(host ? { host: host.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
      };
    case "httpupgrade":
      return {
        type: "httpupgrade",
        path,
        ...(host ? { host } : {}),
      };
    case "quic":
      return {
        type: "quic",
      };
    default:
      return {
        type: network,
      };
  }
}

function applyDialHints(outbound: SingBoxOutbound, channel: VersionChannel): SingBoxOutbound {
  if (channel === "modern" && typeof outbound.server === "string" && /[a-z]/i.test(outbound.server)) {
    outbound.domain_resolver = "dns-remote";
  }

  return outbound;
}

function parseSsUri(uri: string): SingBoxOutbound {
  const body = uri.slice("ss://".length);
  const [withoutTag, fragment] = splitOnce(body, "#");
  const [main] = splitOnce(withoutTag, "?");

  let userInfoPart = "";
  let serverPart = "";

  if (main.includes("@")) {
    const separator = main.lastIndexOf("@");
    userInfoPart = main.slice(0, separator);
    serverPart = main.slice(separator + 1);
  } else {
    const decoded = tryDecodeBase64(main);
    if (!decoded || !decoded.includes("@")) {
      throw new Error("无法解析 ss 链接");
    }
    const separator = decoded.lastIndexOf("@");
    userInfoPart = decoded.slice(0, separator);
    serverPart = decoded.slice(separator + 1);
  }

  const decodedUserInfo = tryDecodeBase64(userInfoPart) ?? userInfoPart;
  const separator = decodedUserInfo.indexOf(":");
  if (separator === -1) {
    throw new Error("ss 用户信息缺少 method/password");
  }

  const method = decodedUserInfo.slice(0, separator);
  const password = decodedUserInfo.slice(separator + 1);
  const serverUrl = new URL(`http://${serverPart}`);

  return {
    type: "shadowsocks",
    tag: decodeTag(fragment, `ss-${serverUrl.hostname}`),
    server: serverUrl.hostname,
    server_port: parseNumber(serverUrl.port, 443),
    method,
    password,
  };
}

function parseStandardUri(uri: string): URL {
  return new URL(uri);
}

function parseVmessUri(uri: string): SingBoxOutbound {
  const payload = uri.slice("vmess://".length);
  const decoded = tryDecodeBase64(payload);
  if (!decoded) {
    throw new Error("无法解析 vmess 链接");
  }

  const config = JSON.parse(decoded) as Record<string, string>;
  const tag = decodeTag(config.ps, `vmess-${config.add ?? "node"}`);
  const fakeUrl = new URL(`vmess://${encodeURIComponent(config.id ?? "")}@${config.add}:${config.port ?? "443"}`);

  const outbound: SingBoxOutbound = {
    type: "vmess",
    tag,
    server: config.add,
    server_port: parseNumber(config.port, 443),
    uuid: config.id,
    security: config.scy || "auto",
    alter_id: parseNumber(config.aid, 0),
  };

  const tls = buildTls(fakeUrl, {
    security: config.tls,
    sni: config.sni,
    host: config.host,
    fingerprint: config.fp,
    alpn: config.alpn,
  });
  if (tls) {
    outbound.tls = tls;
  }

  const transport = buildTransport(fakeUrl, {
    network: config.net,
    host: config.host,
    path: config.path,
    serviceName: config.path,
  });
  if (transport) {
    outbound.transport = transport;
  }

  return outbound;
}

function parseVlessUri(uri: string): SingBoxOutbound {
  const url = parseStandardUri(uri);
  const outbound: SingBoxOutbound = {
    type: "vless",
    tag: decodeTag(url.hash.slice(1), `vless-${url.hostname}`),
    server: url.hostname,
    server_port: parseNumber(url.port, 443),
    uuid: decodeURIComponent(url.username),
  };

  const flow = url.searchParams.get("flow");
  if (flow) {
    outbound.flow = flow;
  }

  const packetEncoding = firstNonEmpty(url.searchParams.get("packet_encoding"), url.searchParams.get("packetEncoding"));
  if (packetEncoding) {
    outbound.packet_encoding = packetEncoding;
  }

  const tls = buildTls(url, {
    host: url.searchParams.get("host") ?? undefined,
    fingerprint: url.searchParams.get("fp") ?? undefined,
    publicKey: url.searchParams.get("pbk") ?? undefined,
    shortId: url.searchParams.get("sid") ?? undefined,
  });
  if (tls) {
    outbound.tls = tls;
  }

  const transport = buildTransport(url, {
    path: url.searchParams.get("path") ?? undefined,
    host: url.searchParams.get("host") ?? undefined,
    serviceName: url.searchParams.get("serviceName") ?? undefined,
  });
  if (transport) {
    outbound.transport = transport;
  }

  return outbound;
}

function parseTrojanUri(uri: string): SingBoxOutbound {
  const url = parseStandardUri(uri);
  const outbound: SingBoxOutbound = {
    type: "trojan",
    tag: decodeTag(url.hash.slice(1), `trojan-${url.hostname}`),
    server: url.hostname,
    server_port: parseNumber(url.port, 443),
    password: decodeURIComponent(url.username),
  };

  const tls = buildTls(url, {
    security: "tls",
    host: url.searchParams.get("host") ?? undefined,
    fingerprint: url.searchParams.get("fp") ?? undefined,
  });
  if (tls) {
    outbound.tls = tls;
  }

  const transport = buildTransport(url, {
    path: url.searchParams.get("path") ?? undefined,
    host: url.searchParams.get("host") ?? undefined,
    serviceName: url.searchParams.get("serviceName") ?? undefined,
  });
  if (transport) {
    outbound.transport = transport;
  }

  return outbound;
}

function parseHysteria2Uri(uri: string): SingBoxOutbound {
  const url = parseStandardUri(uri.replace(/^hy2:\/\//, "hysteria2://"));
  const outbound: SingBoxOutbound = {
    type: "hysteria2",
    tag: decodeTag(url.hash.slice(1), `hy2-${url.hostname}`),
    server: url.hostname,
    server_port: parseNumber(url.port, 443),
    password: decodeURIComponent(url.username),
  };

  const obfs = url.searchParams.get("obfs");
  const obfsPassword = firstNonEmpty(url.searchParams.get("obfs-password"), url.searchParams.get("obfsPassword"));
  if (obfs && obfsPassword) {
    outbound.obfs = {
      type: obfs,
      password: obfsPassword,
    };
  }

  const tls = buildTls(url, {
    security: "tls",
    sni: url.searchParams.get("sni") ?? undefined,
    insecure: url.searchParams.get("insecure") ?? undefined,
  });
  if (tls) {
    outbound.tls = tls;
  }

  return outbound;
}

function parseTuicUri(uri: string): SingBoxOutbound {
  const url = parseStandardUri(uri);
  const outbound: SingBoxOutbound = {
    type: "tuic",
    tag: decodeTag(url.hash.slice(1), `tuic-${url.hostname}`),
    server: url.hostname,
    server_port: parseNumber(url.port, 443),
    uuid: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    congestion_control: url.searchParams.get("congestion_control") ?? "bbr",
  };

  const udpRelayMode = firstNonEmpty(url.searchParams.get("udp_relay_mode"), url.searchParams.get("udpRelayMode"));
  if (udpRelayMode) {
    outbound.udp_relay_mode = udpRelayMode;
  }

  const tls = buildTls(url, {
    security: "tls",
    sni: url.searchParams.get("sni") ?? undefined,
    insecure: url.searchParams.get("insecure") ?? undefined,
    alpn: url.searchParams.get("alpn") ?? undefined,
  });
  if (tls) {
    outbound.tls = tls;
  }

  return outbound;
}

function parseSocksUri(uri: string): SingBoxOutbound {
  const url = parseStandardUri(uri);
  const outbound: SingBoxOutbound = {
    type: "socks",
    tag: decodeTag(url.hash.slice(1), `socks-${url.hostname}`),
    server: url.hostname,
    server_port: parseNumber(url.port, 1080),
  };

  if (url.username) {
    outbound.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    outbound.password = decodeURIComponent(url.password);
  }

  return outbound;
}

function parseHttpUri(uri: string): SingBoxOutbound {
  const url = parseStandardUri(uri);
  const outbound: SingBoxOutbound = {
    type: "http",
    tag: decodeTag(url.hash.slice(1), `http-${url.hostname}`),
    server: url.hostname,
    server_port: parseNumber(url.port, url.protocol === "https:" ? 443 : 80),
  };

  if (url.username) {
    outbound.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    outbound.password = decodeURIComponent(url.password);
  }

  if (url.protocol === "https:") {
    outbound.tls = { enabled: true };
  }

  return outbound;
}

function parseUriLine(uri: string): SingBoxOutbound {
  if (uri.startsWith("ss://")) {
    return parseSsUri(uri);
  }
  if (uri.startsWith("vmess://")) {
    return parseVmessUri(uri);
  }
  if (uri.startsWith("vless://")) {
    return parseVlessUri(uri);
  }
  if (uri.startsWith("trojan://")) {
    return parseTrojanUri(uri);
  }
  if (uri.startsWith("hy2://") || uri.startsWith("hysteria2://")) {
    return parseHysteria2Uri(uri);
  }
  if (uri.startsWith("tuic://")) {
    return parseTuicUri(uri);
  }
  if (uri.startsWith("socks://") || uri.startsWith("socks5://")) {
    return parseSocksUri(uri);
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return parseHttpUri(uri);
  }

  throw new Error(`暂不支持的协议: ${uri.split("://")[0] ?? uri}`);
}

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isJsonObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function extractOutboundsFromJson(value: unknown): SingBoxOutbound[] {
  if (Array.isArray(value)) {
    return value.filter(isOutboundLike);
  }

  if (!isJsonObject(value)) {
    return [];
  }

  if (Array.isArray(value.outbounds)) {
    return value.outbounds.filter(isOutboundLike);
  }

  return [];
}

function isLikelyClashYaml(content: string): boolean {
  return /^proxies:\s*$/m.test(content) || /^proxy-groups:\s*$/m.test(content);
}

export function parseSubscriptionPayload(payload: string, channel: VersionChannel): SingBoxOutbound[] {
  const content = payload.trim();
  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content);
    const outbounds = extractOutboundsFromJson(parsed)
      .filter((outbound) => !SPECIAL_OUTBOUND_TYPES.has(outbound.type))
      .map((outbound) => applyDialHints(structuredClone(outbound), channel));

    if (outbounds.length > 0) {
      return outbounds;
    }
  } catch {
    // JSON 不是必选格式，继续尝试其他解析方式。
  }

  if (isLikelyClashYaml(content)) {
    throw new Error("当前 MVP 暂不支持 Clash YAML 订阅，请先转换为 URI/Base64 或 sing-box JSON。");
  }

  if (!content.includes("://")) {
    const decoded = tryDecodeBase64(content);
    if (decoded && decoded.trim() !== content) {
      return parseSubscriptionPayload(decoded, channel);
    }
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseUriLine)
    .map((outbound) => applyDialHints(outbound, channel));
}

export function filterOutbounds(
  outbounds: SingBoxOutbound[],
  includePattern: string | null | undefined,
  excludePattern: string | null | undefined,
): SingBoxOutbound[] {
  const include = includePattern ? new RegExp(includePattern) : null;
  const exclude = excludePattern ? new RegExp(excludePattern) : null;

  return outbounds.filter((outbound) => {
    if (include && !include.test(outbound.tag)) {
      return false;
    }
    if (exclude && exclude.test(outbound.tag)) {
      return false;
    }
    return true;
  });
}

export function dedupeAndNormalizeOutbounds(outbounds: SingBoxOutbound[]): SingBoxOutbound[] {
  const seen = new Set<string>();
  const tags = new Map<string, number>();
  const deduped: SingBoxOutbound[] = [];

  for (const outbound of outbounds) {
    const cloned = structuredClone(outbound);
    const key = stableStringify(cloned);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const originalTag = cloned.tag.trim() || `${cloned.type}-node`;
    const currentCount = tags.get(originalTag) ?? 0;
    tags.set(originalTag, currentCount + 1);
    cloned.tag = currentCount === 0 ? originalTag : `${originalTag} ${currentCount + 1}`;
    deduped.push(cloned);
  }

  return deduped;
}

export function hasHostname(value: string): boolean {
  return !IPV4_PATTERN.test(value) && !IPV6_PATTERN.test(value) && /[a-z]/i.test(value);
}

import {
  buildDns,
  buildExperimental,
  buildMixedInbound,
  buildTunInbound,
} from "./config";
import type {
  DeviceProfile,
  JsonObject,
  SingBoxOutbound,
} from "./types";

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeGroupRef(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "DIRECT") {
    return "direct";
  }
  if (trimmed === "REJECT") {
    return "block";
  }
  return trimmed;
}

function resolveMemberToken(token: string, nodeTags: string[]): string[] {
  const trimmed = token.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed === ".*") {
    return [...nodeTags];
  }
  if (trimmed.startsWith("[]")) {
    return [normalizeGroupRef(trimmed.slice(2))];
  }
  try {
    const regex = new RegExp(trimmed);
    return nodeTags.filter((tag) => regex.test(tag));
  } catch {
    return [];
  }
}

function parseGroupMembers(tokens: string[], nodeTags: string[]): string[] {
  return dedupe(tokens.flatMap((token) => resolveMemberToken(token, nodeTags)));
}

function parseCustomProxyGroup(
  line: string,
  nodeTags: string[],
  warnings: string[],
): SingBoxOutbound | null {
  const content = line.slice("custom_proxy_group=".length);
  const parts = content.split("`").map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }

  const tag = parts[0];
  const groupType = parts[1].toLowerCase();

  if (groupType === "select" || groupType === "selector") {
    const outbounds = parseGroupMembers(parts.slice(2), nodeTags);
    return {
      type: "selector",
      tag,
      outbounds,
      interrupt_exist_connections: true,
    };
  }

  if (groupType === "url-test" || groupType === "urltest" || groupType === "fallback") {
    const members = parts[2] ? parseGroupMembers([parts[2]], nodeTags) : [];
    const url = parts[3] || "https://www.gstatic.com/generate_204";
    const intervalConfig = parts[4] || "";
    const [intervalSeconds, , toleranceValue] = intervalConfig.split(",");
    const interval = intervalSeconds && intervalSeconds.trim().length > 0
      ? `${intervalSeconds.trim()}s`
      : "300s";
    const tolerance = toleranceValue && toleranceValue.trim().length > 0
      ? Number(toleranceValue.trim())
      : 50;

    if (groupType === "fallback") {
      warnings.push(
        `ACL4SSR 组 "${tag}" 使用 fallback，已近似映射为 sing-box urltest。`,
      );
    }

    return {
      type: "urltest",
      tag,
      outbounds: members,
      url,
      interval,
      tolerance: Number.isFinite(tolerance) ? tolerance : 50,
      interrupt_exist_connections: true,
    };
  }

  warnings.push(`暂未支持的 ACL4SSR proxy group 类型: ${groupType} (${tag})`);
  return null;
}

function parseRulesetLine(
  line: string,
): {
  target: string;
  source: string;
} | null {
  const content = line.slice("ruleset=".length);
  const separator = content.indexOf(",");
  if (separator === -1) {
    return null;
  }
  return {
    target: content.slice(0, separator).trim(),
    source: content.slice(separator + 1).trim(),
  };
}

function buildRuleObject(
  type: string,
  value: string,
  outbound: string,
): JsonObject | null {
  switch (type) {
    case "DOMAIN-SUFFIX":
      return { domain_suffix: [value], outbound };
    case "DOMAIN":
      return { domain: [value], outbound };
    case "DOMAIN-KEYWORD":
      return { domain_keyword: [value], outbound };
    case "IP-CIDR":
    case "IP-CIDR6":
      return { ip_cidr: [value], outbound };
    case "GEOIP":
      return { geoip: [value.toLowerCase()], outbound };
    default:
      return null;
  }
}

function parseRuleListContent(content: string, outbound: string): JsonObject[] {
  const rules: JsonObject[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const [type, value] = line.split(",").map((item) => item.trim());
    if (!type || !value) {
      continue;
    }
    const rule = buildRuleObject(type, value, outbound);
    if (rule) {
      rules.push(rule);
    }
  }
  return rules;
}

export function isAcl4ssrConfig(text: string): boolean {
  return (
    text.includes("[custom]") &&
    (text.includes("ruleset=") || text.includes("custom_proxy_group="))
  );
}

export async function buildSingBoxConfigFromAcl4ssr(
  profile: DeviceProfile,
  nodes: SingBoxOutbound[],
  aclConfig: string,
  loadRuleList: (url: string) => Promise<string>,
): Promise<{
  config: JsonObject;
  summary: JsonObject;
}> {
  const nodeTags = nodes.map((node) => node.tag);
  const warnings: string[] = [];
  const groupOutbounds: SingBoxOutbound[] = [];
  const routeRules: JsonObject[] = [];
  let finalOutbound = "proxy";

  const lines = aclConfig.split(/\r?\n/).map((line) => line.trim());

  for (const line of lines) {
    if (!line || line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) {
      continue;
    }

    if (line.startsWith("custom_proxy_group=")) {
      const group = parseCustomProxyGroup(line, nodeTags, warnings);
      if (group) {
        groupOutbounds.push(group);
      }
      continue;
    }

    if (!line.startsWith("ruleset=")) {
      continue;
    }

    const parsed = parseRulesetLine(line);
    if (!parsed) {
      continue;
    }

    const outbound = parsed.target;
    const source = parsed.source;

    if (source.startsWith("[]FINAL")) {
      finalOutbound = outbound;
      continue;
    }

    if (source.startsWith("[]GEOIP,")) {
      const geoipValue = source.slice("[]GEOIP,".length).trim();
      const rule = buildRuleObject("GEOIP", geoipValue, outbound);
      if (rule) {
        routeRules.push(rule);
      }
      continue;
    }

    if (source.startsWith("http://") || source.startsWith("https://")) {
      const content = await loadRuleList(source);
      routeRules.push(...parseRuleListContent(content, outbound));
      continue;
    }
  }

  const inbounds: JsonObject[] = [buildTunInbound(profile)];
  if (profile.device === "pc") {
    inbounds.push(buildMixedInbound());
  }

  const outbounds: JsonObject[] = [
    ...groupOutbounds,
    { type: "direct", tag: "direct" },
    { type: "block", tag: "block" },
    ...nodes,
  ];

  const route: JsonObject = {
    auto_detect_interface: true,
    final: finalOutbound,
    rules: routeRules,
  };

  if (profile.channel === "modern") {
    route.default_domain_resolver = "dns-remote";
  }

  return {
    config: {
      log: {
        level: "info",
        timestamp: true,
      },
      dns: buildDns(profile),
      inbounds,
      outbounds,
      route,
      experimental: buildExperimental(profile),
    },
    summary: {
      acl4ssr: true,
      group_count: groupOutbounds.length,
      rule_count: routeRules.length,
      final_outbound: finalOutbound,
      warnings,
    },
  };
}

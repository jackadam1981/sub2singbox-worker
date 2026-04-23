import type {
  BuiltinTemplateDefinition,
  BuiltinTemplateRecommendation,
  Device,
  JsonObject,
  VersionChannel,
} from "./types";

const ALL_DEVICES: Device[] = ["ios", "android", "pc", "openwrt"];
const ALL_CHANNELS: VersionChannel[] = ["legacy", "modern"];
const ACL4SSR_REPO = "ACL4SSR/ACL4SSR";
const ACL4SSR_RAW_BASE =
  "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config";

/** 未指定模板时的默认 ACL4SSR 在线分流（与 OpenClash 常用规则同源）。 */
export const ACL4SSR_DEFAULT_ONLINE_INI_URL = `${ACL4SSR_RAW_BASE}/ACL4SSR_Online.ini`;

const DEFAULT_TEMPLATE = `{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "dns": "{{ Dns }}",
  "inbounds": "{{ Inbounds }}",
  "outbounds": "{{ AllOutbounds }}",
  "route": "{{ Route }}",
  "experimental": "{{ Experimental }}"
}`;

const MANUAL_TEMPLATE = `{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "dns": "{{ Dns }}",
  "inbounds": "{{ Inbounds }}",
  "outbounds": [
    {
      "type": "selector",
      "tag": "proxy",
      "outbounds": "{{ NodeTags(append=direct) }}"
    },
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "block",
      "tag": "block"
    },
    "{{ Nodes }}"
  ],
  "route": {
    "auto_detect_interface": true,
    "final": "proxy"
  }
}`;

const AUTO_TEMPLATE = `{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "dns": "{{ Dns }}",
  "inbounds": "{{ Inbounds }}",
  "outbounds": [
    {
      "type": "urltest",
      "tag": "proxy",
      "outbounds": "{{ NodeTags(fallback=direct) }}",
      "url": "https://www.gstatic.com/generate_204",
      "interval": "10m",
      "tolerance": 50
    },
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "block",
      "tag": "block"
    },
    "{{ Nodes }}"
  ],
  "route": {
    "auto_detect_interface": true,
    "final": "proxy"
  }
}`;

/** ACL4SSR 仓库 `Clash/config` 目录下的全部 `.ini`（与官方目录对齐）。 */
const ACL4SSR_INI_FILES = [
  "ACL4SSR.ini",
  "ACL4SSR_AdblockPlus.ini",
  "ACL4SSR_BackCN.ini",
  "ACL4SSR_Mini.ini",
  "ACL4SSR_Mini_Fallback.ini",
  "ACL4SSR_Mini_MultiMode.ini",
  "ACL4SSR_Mini_NoAuto.ini",
  "ACL4SSR_NoApple.ini",
  "ACL4SSR_NoAuto.ini",
  "ACL4SSR_NoAuto_NoApple.ini",
  "ACL4SSR_NoAuto_NoApple_NoMicrosoft.ini",
  "ACL4SSR_NoMicrosoft.ini",
  "ACL4SSR_Online.ini",
  "ACL4SSR_Online_AdblockPlus.ini",
  "ACL4SSR_Online_Full.ini",
  "ACL4SSR_Online_Full_AdblockPlus.ini",
  "ACL4SSR_Online_Full_Google.ini",
  "ACL4SSR_Online_Full_MultiMode.ini",
  "ACL4SSR_Online_Full_Netflix.ini",
  "ACL4SSR_Online_Full_NoAuto.ini",
  "ACL4SSR_Online_Mini.ini",
  "ACL4SSR_Online_Mini_AdblockPlus.ini",
  "ACL4SSR_Online_Mini_Ai.ini",
  "ACL4SSR_Online_Mini_Fallback.ini",
  "ACL4SSR_Online_Mini_MultiCountry.ini",
  "ACL4SSR_Online_Mini_MultiMode.ini",
  "ACL4SSR_Online_Mini_NoAuto.ini",
  "ACL4SSR_Online_MultiCountry.ini",
  "ACL4SSR_Online_NoAuto.ini",
  "ACL4SSR_Online_NoReject.ini",
  "ACL4SSR_WithChinaIp.ini",
  "ACL4SSR_WithChinaIp_WithGFW.ini",
  "ACL4SSR_WithGFW.ini",
] as const;

const FEATURED_BUILTIN_IDS = new Set([
  "online",
  "online_noauto",
  "online_mini_fallback",
  "online_full",
]);

/** 旧版短 id → 当前 canonical id（兼容历史链接与书签）。 */
const BUILTIN_TEMPLATE_ID_ALIASES: Record<string, string> = {
  default: "online",
  manual: "online_noauto",
  auto: "online_mini_fallback",
};

function resolveBuiltinTemplateRawId(raw: string): string {
  const key = raw.trim().toLowerCase();
  return BUILTIN_TEMPLATE_ID_ALIASES[key] ?? key;
}

function stemSansIni(file: string): string {
  return file.replace(/\.ini$/i, "");
}

function aclSuffixFromIniFile(file: string): string {
  const stem = stemSansIni(file);
  if (/^ACL4SSR$/i.test(stem)) {
    return "Base";
  }
  if (/^ACL4SSR_/i.test(stem)) {
    return stem.slice("ACL4SSR_".length);
  }
  return stem;
}

function aclIniBuiltinId(file: string): string {
  const suffix = aclSuffixFromIniFile(file);
  const slug = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "base";
}

function humanizeAclSuffix(suffix: string): string {
  return suffix.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function fallbackForAclIniFile(file: string): string {
  if (file === "ACL4SSR_Online.ini") return DEFAULT_TEMPLATE;
  if (file === "ACL4SSR_Online_NoAuto.ini") return MANUAL_TEMPLATE;
  if (file === "ACL4SSR_Online_Mini_Fallback.ini") return AUTO_TEMPLATE;
  return DEFAULT_TEMPLATE;
}

function tagsForAclIni(id: string): string[] {
  const tags = new Set<string>(["builtin", "acl4ssr"]);
  if (id === "online") {
    tags.add("default");
    tags.add("general");
  }
  if (id === "online_noauto") {
    tags.add("manual");
    tags.add("selector");
  }
  if (id === "online_mini_fallback") {
    tags.add("auto");
    tags.add("urltest");
    tags.add("fallback");
  }
  return [...tags];
}

function makeAclIniBuiltinDefinition(file: string): BuiltinTemplateDefinition {
  const id = aclIniBuiltinId(file);
  const suffix = aclSuffixFromIniFile(file);
  const title = humanizeAclSuffix(suffix);
  const rawUrl = `${ACL4SSR_RAW_BASE}/${file}`;
  return {
    id,
    title,
    description: `ACL4SSR 内建分流：${file}（与官方 Clash 配置同源，经本服务转为 sing-box）。`,
    output_format: "sing-box",
    compatible_devices: ALL_DEVICES,
    compatible_channels: ALL_CHANNELS,
    tags: tagsForAclIni(id),
    template_url: rawUrl,
    acl4ssr_config_url: rawUrl,
    source_repo: ACL4SSR_REPO,
    source_path: `Clash/config/${file}`,
    fallback_template_text: fallbackForAclIniFile(file),
    featured: FEATURED_BUILTIN_IDS.has(id),
  };
}

const BUILTIN_TEMPLATE_DEFINITIONS: BuiltinTemplateDefinition[] = (() => {
  const defs = ACL4SSR_INI_FILES.map((f) => makeAclIniBuiltinDefinition(f));
  defs.sort((a, b) => {
    const fa = a.featured ? 0 : 1;
    const fb = b.featured ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.id.localeCompare(b.id);
  });
  return defs;
})();

const BUILTIN_TEMPLATE_RECOMMENDATIONS: BuiltinTemplateRecommendation[] = [
  {
    device: "ios",
    channel: "legacy",
    primary_template_id: "online",
    alternative_template_ids: ["online_noauto", "online_mini_fallback"],
    reason: "iOS 旧版本更适合优先使用结构简单、兼容面更大的默认模板。",
  },
  {
    device: "ios",
    channel: "modern",
    primary_template_id: "online",
    alternative_template_ids: ["online_noauto", "online_mini_fallback"],
    reason: "iOS 新版本优先保证通用稳定性，默认模板更适合作为首选。",
  },
  {
    device: "android",
    channel: "legacy",
    primary_template_id: "online",
    alternative_template_ids: ["online_noauto", "online_mini_fallback"],
    reason: "Android 旧版本优先兼容性，默认模板更稳妥。",
  },
  {
    device: "android",
    channel: "modern",
    primary_template_id: "online_mini_fallback",
    alternative_template_ids: ["online", "online_noauto"],
    reason: "Android 新版本通常更适合 urltest 自动选路，减少手动切换成本。",
  },
  {
    device: "pc",
    channel: "legacy",
    primary_template_id: "online_noauto",
    alternative_template_ids: ["online", "online_mini_fallback"],
    reason: "桌面端更适合手动 selector 切换，便于观察和临时干预。",
  },
  {
    device: "pc",
    channel: "modern",
    primary_template_id: "online_noauto",
    alternative_template_ids: ["online_mini_fallback", "online"],
    reason: "桌面端新版本推荐手动 selector 作为主入口，兼顾调试和灵活性。",
  },
  {
    device: "openwrt",
    channel: "legacy",
    primary_template_id: "online",
    alternative_template_ids: ["online_mini_fallback", "online_noauto"],
    reason: "OpenWrt 旧版本优先保持稳定和兼容，默认模板更安全。",
  },
  {
    device: "openwrt",
    channel: "modern",
    primary_template_id: "online_mini_fallback",
    alternative_template_ids: ["online", "online_noauto"],
    reason: "OpenWrt 新版本更适合自动测速选路，减少无人值守场景的人工切换。",
  },
];

export function listBuiltinTemplates(): BuiltinTemplateDefinition[] {
  return BUILTIN_TEMPLATE_DEFINITIONS.map((item) => ({ ...item }));
}

export function listBuiltinTemplateDefinitions(): BuiltinTemplateDefinition[] {
  return listBuiltinTemplates();
}

export function getBuiltinTemplate(id: string): BuiltinTemplateDefinition | null {
  const normalized = id.trim().toLowerCase();
  const withoutBuiltin = normalized.startsWith("builtin:")
    ? normalized.slice("builtin:".length)
    : normalized;
  const actualId = resolveBuiltinTemplateRawId(withoutBuiltin);
  return (
    BUILTIN_TEMPLATE_DEFINITIONS.find((item) => item.id.toLowerCase() === actualId) ??
    null
  );
}

export function getBuiltinTemplateRecommendation(
  device: Device,
  channel: VersionChannel,
): BuiltinTemplateRecommendation | null {
  return (
    BUILTIN_TEMPLATE_RECOMMENDATIONS.find(
      (item) => item.device === device && item.channel === channel,
    ) ?? null
  );
}

export function builtinTemplateSummary(
  template: BuiltinTemplateDefinition,
  options?: {
    currentDevice?: Device;
    currentChannel?: VersionChannel;
  },
): JsonObject {
  const compatible =
    (!options?.currentDevice ||
      template.compatible_devices.includes(options.currentDevice)) &&
    (!options?.currentChannel ||
      template.compatible_channels.includes(options.currentChannel));

  return {
    id: template.id,
    name: template.title,
    title: template.title,
    description: template.description,
    output_format: template.output_format,
    compatible_devices: template.compatible_devices,
    compatible_channels: template.compatible_channels,
    tags: template.tags,
    featured: template.featured ?? false,
    ...(template.template_url ? { template_url: template.template_url } : {}),
    ...(template.source_repo ? { source_repo: template.source_repo } : {}),
    ...(template.source_path ? { source_path: template.source_path } : {}),
    ...(options?.currentDevice || options?.currentChannel
      ? { compatible_with_current_profile: compatible }
      : {}),
  };
}

export function listBuiltinTemplateSummaries(options?: {
  currentDevice?: Device;
  currentChannel?: VersionChannel;
}): JsonObject[] {
  return BUILTIN_TEMPLATE_DEFINITIONS.map((template) =>
    builtinTemplateSummary(template, options),
  );
}

export function builtinTemplateDetail(
  template: BuiltinTemplateDefinition,
  options?: {
    currentDevice?: Device;
    currentChannel?: VersionChannel;
  },
): JsonObject {
  const summary = builtinTemplateSummary(template, options);
  const recommendation =
    options?.currentDevice && options?.currentChannel
      ? getBuiltinTemplateRecommendation(options.currentDevice, options.currentChannel)
      : null;

  return {
    ...summary,
    ...(template.fallback_template_text
      ? { fallback_template_text: template.fallback_template_text }
      : {}),
    ...(recommendation
      ? {
          recommended_for_current_profile:
            recommendation.primary_template_id === template.id,
          recommendation_reason: recommendation.reason,
          recommendation_rank:
            recommendation.primary_template_id === template.id
              ? 1
              : recommendation.alternative_template_ids.indexOf(template.id) >= 0
                ? recommendation.alternative_template_ids.indexOf(template.id) + 2
                : null,
        }
      : {}),
  };
}

import type {
  BuiltinTemplateDefinition,
  BuiltinTemplateRecommendation,
  Device,
  JsonObject,
  VersionChannel,
} from "./types";

const ALL_DEVICES: Device[] = ["ios", "android", "pc", "openwrt"];
const ALL_CHANNELS: VersionChannel[] = ["legacy", "modern"];

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

const BUILTIN_TEMPLATE_DEFINITIONS: BuiltinTemplateDefinition[] = [
  {
    id: "default",
    title: "Default",
    description: "贴近当前默认生成逻辑的通用 sing-box 模板。",
    output_format: "sing-box",
    compatible_devices: ALL_DEVICES,
    compatible_channels: ALL_CHANNELS,
    tags: ["builtin", "default", "general"],
    template_text: DEFAULT_TEMPLATE,
    featured: true,
  },
  {
    id: "manual",
    title: "Manual Selector",
    description: "偏手动切换的简洁模板，使用单个 selector 承载全部节点。",
    output_format: "sing-box",
    compatible_devices: ALL_DEVICES,
    compatible_channels: ALL_CHANNELS,
    tags: ["builtin", "manual", "selector"],
    template_text: MANUAL_TEMPLATE,
    featured: true,
  },
  {
    id: "auto",
    title: "Auto URLTest",
    description: "偏自动选择的简洁模板，使用 urltest 作为主出站。",
    output_format: "sing-box",
    compatible_devices: ALL_DEVICES,
    compatible_channels: ALL_CHANNELS,
    tags: ["builtin", "auto", "urltest"],
    template_text: AUTO_TEMPLATE,
    featured: true,
  },
];

const BUILTIN_TEMPLATE_RECOMMENDATIONS: BuiltinTemplateRecommendation[] = [
  {
    device: "ios",
    channel: "legacy",
    primary_template_id: "default",
    alternative_template_ids: ["manual", "auto"],
    reason: "iOS 旧版本更适合优先使用结构简单、兼容面更大的默认模板。",
  },
  {
    device: "ios",
    channel: "modern",
    primary_template_id: "default",
    alternative_template_ids: ["manual", "auto"],
    reason: "iOS 新版本优先保证通用稳定性，默认模板更适合作为首选。",
  },
  {
    device: "android",
    channel: "legacy",
    primary_template_id: "default",
    alternative_template_ids: ["manual", "auto"],
    reason: "Android 旧版本优先兼容性，默认模板更稳妥。",
  },
  {
    device: "android",
    channel: "modern",
    primary_template_id: "auto",
    alternative_template_ids: ["default", "manual"],
    reason: "Android 新版本通常更适合 urltest 自动选路，减少手动切换成本。",
  },
  {
    device: "pc",
    channel: "legacy",
    primary_template_id: "manual",
    alternative_template_ids: ["default", "auto"],
    reason: "桌面端更适合手动 selector 切换，便于观察和临时干预。",
  },
  {
    device: "pc",
    channel: "modern",
    primary_template_id: "manual",
    alternative_template_ids: ["auto", "default"],
    reason: "桌面端新版本推荐手动 selector 作为主入口，兼顾调试和灵活性。",
  },
  {
    device: "openwrt",
    channel: "legacy",
    primary_template_id: "default",
    alternative_template_ids: ["auto", "manual"],
    reason: "OpenWrt 旧版本优先保持稳定和兼容，默认模板更安全。",
  },
  {
    device: "openwrt",
    channel: "modern",
    primary_template_id: "auto",
    alternative_template_ids: ["default", "manual"],
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
  const actualId = normalized.startsWith("builtin:")
    ? normalized.slice("builtin:".length)
    : normalized;
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
    template_text: template.template_text,
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

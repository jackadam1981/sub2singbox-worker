import type {
  BuiltinTemplateDefinition,
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

export function listBuiltinTemplates(): BuiltinTemplateDefinition[] {
  return BUILTIN_TEMPLATE_DEFINITIONS.map((item) => ({ ...item }));
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

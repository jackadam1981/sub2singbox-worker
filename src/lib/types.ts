export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type Device = "ios" | "android" | "pc" | "openwrt";
export type VersionChannel = "legacy" | "modern";

export interface DeviceProfile {
  id: `${Device}-${VersionChannel}`;
  device: Device;
  channel: VersionChannel;
  title: string;
  description: string;
  recommendedVersions: string[];
  notes: string[];
}

export interface BuiltinTemplateMeta {
  id: string;
  name: string;
  description: string;
  format: "sing-box";
  supportedDevices: Device[];
  supportedChannels: VersionChannel[];
  tags: string[];
}

export interface BuiltinTemplateDefinition {
  id: string;
  title: string;
  description: string;
  output_format: "sing-box";
  compatible_devices: Device[];
  compatible_channels: VersionChannel[];
  tags: string[];
  template_url?: string;
  source_repo?: string;
  source_path?: string;
  acl4ssr_config_url?: string;
  fallback_template_text: string;
  featured?: boolean;
}

export interface BuiltinTemplateRecommendation {
  device: Device;
  channel: VersionChannel;
  primary_template_id: string;
  alternative_template_ids: string[];
  reason: string;
}

export interface SourceDebugEntry {
  index: number;
  source: string;
  source_type: "raw" | "url";
  fetch_status: "success" | "failed" | "skipped";
  parse_status: "success" | "failed" | "skipped";
  cache_state: string;
  payload_kind?: string;
  parsed_outbounds?: number;
  error?: string;
}

export interface ConversionExplain {
  profile: {
    id: string;
    device: Device;
    channel: VersionChannel;
  };
  /** 与 ACL 分流正交的 sing-box 骨架：已选功能规范化串（`default` 或逗号分隔 id，见 `skeleton` 参数）。 */
  skeleton_id: string;
  output_format: string;
  template: {
    mode: "builtin" | "remote" | "raw" | "none";
    cache_state: string;
    id?: string;
  };
  sources: {
    total: number;
    succeeded: number;
    failed: number;
    mode: "strict" | "tolerant";
    entries: SourceDebugEntry[];
  };
  nodes: {
    parsed_total: number;
    deduped_total: number;
    filtered_total: number;
    clash_compatible_total: number;
    tags: string[];
  };
  cache: {
    result: string;
    subscription: string;
    template: string;
  };
}

export interface WorkerEnv {
  ACCESS_PASSWORD?: string;
  DEFAULT_DEVICE?: string;
  DEFAULT_VERSION?: string;
  DEFAULT_SUBSCRIPTION_URL?: string;
  DEFAULT_USER_AGENT?: string;
  DEFAULT_FALLBACK_USER_AGENT?: string;
  DEFAULT_TEMPLATE_URL?: string;
  CORS_ORIGIN?: string;
  SUBSCRIPTION_CACHE_TTL?: string;
  SUBSCRIPTION_STALE_TTL?: string;
  TEMPLATE_CACHE_TTL?: string;
  TEMPLATE_STALE_TTL?: string;
  RESULT_CACHE_TTL?: string;
  CACHE_KV?: {
    get(key: string): Promise<string | null>;
    put(
      key: string,
      value: string,
      options?: {
        expirationTtl?: number;
      },
    ): Promise<void>;
  };
}

export type SingBoxOutbound = JsonObject & {
  type: string;
  tag: string;
};

export interface RenderContext {
  profile: DeviceProfile;
  dns: JsonObject;
  inbounds: JsonValue[];
  selectorOutbounds: JsonObject[];
  nodeOutbounds: SingBoxOutbound[];
  nodeTags: string[];
  allOutbounds: JsonValue[];
  route: JsonObject;
  experimental: JsonObject;
}

export interface TemplateCall {
  name: string;
  args: string[];
}

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
  template_text: string;
  featured?: boolean;
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

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

export interface WorkerEnv {
  ACCESS_PASSWORD?: string;
  DEFAULT_DEVICE?: string;
  DEFAULT_VERSION?: string;
  DEFAULT_SUBSCRIPTION_URL?: string;
  DEFAULT_USER_AGENT?: string;
  CORS_ORIGIN?: string;
}

export type SingBoxOutbound = JsonObject & {
  type: string;
  tag: string;
};

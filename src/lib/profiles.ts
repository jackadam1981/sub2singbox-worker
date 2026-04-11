import type { Device, DeviceProfile, VersionChannel } from "./types";

const PROFILE_DEFINITIONS: DeviceProfile[] = [
  {
    id: "ios-legacy",
    device: "ios",
    channel: "legacy",
    title: "iOS Legacy",
    description: "适配 sing-box 1.10.0 / 1.11.7 的 iOS 远端配置模板。",
    recommendedVersions: ["1.10.0", "1.11.7"],
    notes: ["保持旧式 DNS 字段结构。", "避免依赖 1.12 以后引入的域名解析新字段。"],
  },
  {
    id: "ios-modern",
    device: "ios",
    channel: "modern",
    title: "iOS Modern",
    description: "适配 sing-box 1.12.0 / 1.13.7 / 1.14.0-alpha.10 的 iOS 远端配置模板。",
    recommendedVersions: ["1.12.0", "1.13.7", "1.14.0-alpha.10"],
    notes: ["使用 1.12+ 的 DNS server 新格式。", "为域名节点补充 domain_resolver。", "当前生成配置可兼容 1.13.7 与 1.14.0-alpha.10。"],
  },
  {
    id: "android-legacy",
    device: "android",
    channel: "legacy",
    title: "Android Legacy",
    description: "适配 sing-box 1.10.0 / 1.11.7 的 Android 模板。",
    recommendedVersions: ["1.10.0", "1.11.7"],
    notes: ["保留 tun 入站。", "偏向旧版兼容字段。"],
  },
  {
    id: "android-modern",
    device: "android",
    channel: "modern",
    title: "Android Modern",
    description: "适配 sing-box 1.12.0 / 1.13.7 / 1.14.0-alpha.10 的 Android 模板。",
    recommendedVersions: ["1.12.0", "1.13.7", "1.14.0-alpha.10"],
    notes: ["使用 tun + modern DNS。", "适合作为通用移动端默认模板。", "当前生成配置可兼容 1.13.7 与 1.14.0-alpha.10。"],
  },
  {
    id: "pc-legacy",
    device: "pc",
    channel: "legacy",
    title: "PC Legacy",
    description: "适配 sing-box 1.10.0 / 1.11.7 的桌面端模板。",
    recommendedVersions: ["1.10.0", "1.11.7"],
    notes: ["附带 mixed 入站方便本地代理。", "保留 legacy DNS 表达方式。"],
  },
  {
    id: "pc-modern",
    device: "pc",
    channel: "modern",
    title: "PC Modern",
    description: "适配 sing-box 1.12.0 / 1.13.7 / 1.14.0-alpha.10 的桌面端模板。",
    recommendedVersions: ["1.12.0", "1.13.7", "1.14.0-alpha.10"],
    notes: ["附带 mixed 入站。", "为 hostname server 自动设置 domain_resolver。", "当前生成配置可兼容 1.13.7 与 1.14.0-alpha.10。"],
  },
  {
    id: "openwrt-legacy",
    device: "openwrt",
    channel: "legacy",
    title: "OpenWrt Legacy",
    description: "适配 sing-box 1.10.0 / 1.11.7 的 OpenWrt 模板。",
    recommendedVersions: ["1.10.0", "1.11.7"],
    notes: ["使用 system stack 风格 tun。", "尽量减少新字段依赖。"],
  },
  {
    id: "openwrt-modern",
    device: "openwrt",
    channel: "modern",
    title: "OpenWrt Modern",
    description: "适配 sing-box 1.12.0 / 1.13.7 / 1.14.0-alpha.10 的 OpenWrt 模板。",
    recommendedVersions: ["1.12.0", "1.13.7", "1.14.0-alpha.10"],
    notes: ["面向路由器场景保留显式 interface_name。", "使用 modern DNS 结构。", "当前生成配置可兼容 1.13.7 与 1.14.0-alpha.10。"],
  },
];

export function normalizeDevice(value: string | null | undefined): Device {
  const normalized = value?.trim().toLowerCase();

  switch (normalized) {
    case "ios":
    case "iphone":
    case "ipad":
      return "ios";
    case "android":
      return "android";
    case "pc":
    case "desktop":
    case "windows":
    case "macos":
    case "linux":
      return "pc";
    case "openwrt":
    case "router":
      return "openwrt";
    default:
      throw new Error(`不支持的 device: ${value ?? ""}`);
  }
}

export function getVersionChannel(version: string | null | undefined): VersionChannel {
  if (!version) {
    return "modern";
  }

  const match = version.match(/(\d+)\.(\d+)/);
  if (!match) {
    return "modern";
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);

  if (major > 1 || (major === 1 && minor >= 12)) {
    return "modern";
  }

  return "legacy";
}

export function resolveProfile(
  deviceInput: string | null | undefined,
  versionInput: string | null | undefined,
): DeviceProfile {
  const device = normalizeDevice(deviceInput);
  const channel = getVersionChannel(versionInput);
  const profile = PROFILE_DEFINITIONS.find(
    (candidate) => candidate.device === device && candidate.channel === channel,
  );

  if (!profile) {
    throw new Error(`未找到可用 profile: ${device}-${channel}`);
  }

  return profile;
}

export function listProfiles(): DeviceProfile[] {
  return [...PROFILE_DEFINITIONS];
}

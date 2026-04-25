import type { DeviceProfile } from "./types";
import type { JsonObject } from "./types";

/** 控制台与文档中的分组：共用 / 仅 Sing-Box / 仅 Clash。 */
export type SkeletonFeatureScope = "shared" | "sing-box" | "clash";

export interface SkeletonFeatureDefinition {
  id: string;
  /** 短标题，用作复选框旁主文案。 */
  title: string;
  /** 面向非专业人士的可见说明（控制台展示）。 */
  description: string;
  /** 可选：悬停/补充用的技术说明。 */
  detail?: string;
  scope: SkeletonFeatureScope;
}

/**
 * 可组合的骨架功能：`skeleton` 查询串为逗号/空格/|/+ 分隔的多选。
 * 各输出格式只应用与本格式相关的项（见 `scope`）。
 */
export const SKELETON_FEATURE_DEFINITIONS: SkeletonFeatureDefinition[] = [
  {
    id: "tun_only",
    title: "只用 TUN（不开混合端口）",
    description: "适合想「全盘走隧道」的桌面用户：不再开本地 mixed 端口，只保留虚拟网卡 TUN。",
    detail: "对应关闭 PC 场景的 mixed 入站，仅保留 TUN。",
    scope: "sing-box",
  },
  {
    id: "cache_all",
    title: "全设备记住节点与缓存",
    description: "让路由器、手机、电脑等都启用本地缓存文件，减少重复握手、略省流量。",
    detail: "experimental.cache_file 对所有设备 profile 生效。",
    scope: "sing-box",
  },
  {
    id: "ipv4_dns",
    title: "DNS 解析优先走 IPv4",
    description: "当你的网络对 IPv6 DNS 不稳定时，让「去 DNS 服务器」的连接优先用 IPv4。",
    detail: "modern 通道下为远端 DoT 声明 prefer_ipv4。",
    scope: "sing-box",
  },
  {
    id: "sniff_modern",
    title: "识别流量类型（新版通道）",
    description: "在默认不开嗅探的新版通道里，也打开「嗅探」：便于按域名分流。",
    detail: "在 modern 的 TUN/mixed 入站启用 sniff。",
    scope: "sing-box",
  },
  {
    id: "sniff_override",
    title: "嗅探结果覆盖访问目标",
    description: "进阶：用嗅探到的真实域名覆盖连接目标，部分复杂站点分流更准；可能带来副作用，不熟悉请慎选。",
    detail: "sniff_override_destination；并隐含开启 modern 嗅探。",
    scope: "sing-box",
  },
  {
    id: "strict_route_all",
    title: "加强路由隔离（全设备）",
    description: "减少「本该走代理的流量从网卡漏出去」的风险；默认对部分设备已开，此项对所有设备 TUN 生效。",
    detail: "对所有设备 TUN 启用 strict_route。",
    scope: "sing-box",
  },
  {
    id: "private_direct",
    title: "局域网与私有地址直连",
    description: "家里打印机、路由器管理页、10.x/192.168.x 等流量不绕代理，更快也更安全。",
    detail: "路由前部插入 ip_is_private → direct。",
    scope: "sing-box",
  },
  {
    id: "icmp_direct",
    title: "Ping（ICMP）直连",
    description: "常见于路由器场景：Ping 测速、诊断走直连，避免被代理误伤。",
    detail: "路由前部 ICMP → direct。",
    scope: "sing-box",
  },
  {
    id: "clash_api",
    title: "给面板用的 Clash API（实验）",
    description: "开启后，支持 Clash API 的第三方工具可连上本机 sing-box 做切换、测速等（默认本机端口）。",
    detail: "experimental.clash_api，默认 127.0.0.1:9090。",
    scope: "sing-box",
  },
  {
    id: "clash_api_lan",
    title: "面板 API 开放到局域网（需要密码）",
    description:
      "让局域网设备（手机/电脑）也能连上路由器的面板 API。建议配合「访问密码」作为密钥使用，避免局域网内被随意访问。",
    detail:
      "将 external_controller 改为 0.0.0.0:9090；并要求提供 password 作为 secret（否则拒绝生成）。",
    scope: "sing-box",
  },
  {
    id: "dns_fakeip",
    title: "FakeIP 解析池（进阶）",
    description: "为「假 IP」分流准备 DNS 池；需再配合路由/DNS 规则使用，新手可暂不勾选。",
    detail: "在 DNS servers 中追加 fakeip 类型 server。",
    scope: "sing-box",
  },
  {
    id: "log_debug",
    title: "调试日志（更啰嗦）",
    description: "出问题排查时打开；日常可关。Sing-Box 与 Clash 都会把日志级别调到 debug。",
    detail: "Sing-Box：log.level；Clash：log-level。",
    scope: "shared",
  },
  {
    id: "dns_anti_leak",
    title: "DNS 防泄漏",
    description:
      "尽量让系统通过代理进行 DNS 查询，避免 DNS 直连泄露：Sing-Box 会把 DNS 流量交给自身 DNS 模块；Clash 会在 TUN 上接管/劫持 DNS（必要时自动开启 TUN）。",
    detail:
      "Sing-Box：路由前部 protocol=dns → hijack-dns；Clash：tun.dns-hijack（needTun 时自动启用 tun）。",
    scope: "shared",
  },
  {
    id: "clash_tun",
    title: "Clash 虚拟网卡（TUN）",
    description: "用系统级虚拟网卡接管流量，适合 Clash Meta 类客户端「全局规则」用法。",
    detail: "tun：stack=mixed，auto-route 等。",
    scope: "clash",
  },
  {
    id: "clash_fake_ip",
    title: "Clash 假 IP 模式（Meta）",
    description: "用假 IP 加速域名分流与回退；与 Meta 的 fake-ip DNS 行为一致，不熟悉可先不选。",
    detail: "dns.enhanced-mode: fake-ip 等。",
    scope: "clash",
  },
  {
    id: "clash_sniffer",
    title: "Clash 嗅探（识别域名）",
    description: "对加密流量做 SNI/HTTP 等嗅探，便于「按域名」规则；部分环境可能与隐私或兼容性有关。",
    detail: "写入 Meta 风格 sniffer 块。",
    scope: "clash",
  },
];

const KNOWN_FEATURE_IDS = new Set(SKELETON_FEATURE_DEFINITIONS.map((item) => item.id));

/** 序列化时的稳定顺序（与 DEFAULT 比较后输出子集）。 */
export const SKELETON_FEATURE_ORDER = [
  "tun_only",
  "cache_all",
  "ipv4_dns",
  "sniff_modern",
  "sniff_override",
  "strict_route_all",
  "private_direct",
  "icmp_direct",
  "clash_api",
  "clash_api_lan",
  "dns_fakeip",
  "log_debug",
  "dns_anti_leak",
  "clash_tun",
  "clash_fake_ip",
  "clash_sniffer",
] as const;

export function listSkeletonFeatureSummaries(): JsonObject[] {
  return SKELETON_FEATURE_DEFINITIONS.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    scope: item.scope,
    ...(item.detail ? { detail: item.detail } : {}),
  }));
}

export interface SkeletonBuildFlags {
  includePcMixedInbound: boolean;
  experimentalCacheAllDevices: boolean;
  modernDnsPreferIpv4: boolean;
  sniffModern: boolean;
  sniffOverrideDestination: boolean;
  strictRouteAllDevices: boolean;
  privateDirect: boolean;
  icmpDirect: boolean;
  clashApi: boolean;
  clashApiLan: boolean;
  logDebug: boolean;
  dnsFakeipServer: boolean;
  clashTun: boolean;
  /** DNS 防泄漏：按输出格式启用对应的 DNS 劫持/接管方案。 */
  dnsAntiLeak: boolean;
  clashFakeIpDns: boolean;
  clashSniffer: boolean;
}

export const DEFAULT_SKELETON_FLAGS: SkeletonBuildFlags = {
  includePcMixedInbound: true,
  experimentalCacheAllDevices: false,
  modernDnsPreferIpv4: false,
  sniffModern: false,
  sniffOverrideDestination: false,
  strictRouteAllDevices: false,
  privateDirect: false,
  icmpDirect: false,
  clashApi: false,
  clashApiLan: false,
  logDebug: false,
  dnsFakeipServer: false,
  clashTun: false,
  dnsAntiLeak: false,
  clashFakeIpDns: false,
  clashSniffer: false,
};

function isFeatureActive(id: (typeof SKELETON_FEATURE_ORDER)[number], f: SkeletonBuildFlags): boolean {
  switch (id) {
    case "tun_only":
      return !f.includePcMixedInbound;
    case "cache_all":
      return f.experimentalCacheAllDevices;
    case "ipv4_dns":
      return f.modernDnsPreferIpv4;
    case "sniff_modern":
      return f.sniffModern;
    case "sniff_override":
      return f.sniffOverrideDestination;
    case "strict_route_all":
      return f.strictRouteAllDevices;
    case "dns_anti_leak":
      return f.dnsAntiLeak;
    case "private_direct":
      return f.privateDirect;
    case "icmp_direct":
      return f.icmpDirect;
    case "clash_api":
      return f.clashApi;
    case "clash_api_lan":
      return f.clashApiLan;
    case "log_debug":
      return f.logDebug;
    case "dns_fakeip":
      return f.dnsFakeipServer;
    case "clash_tun":
      return f.clashTun;
    case "clash_fake_ip":
      return f.clashFakeIpDns;
    case "clash_sniffer":
      return f.clashSniffer;
    default:
      return false;
  }
}

export function serializeSkeletonFlags(flags: SkeletonBuildFlags): string {
  const active = SKELETON_FEATURE_ORDER.filter((id) => isFeatureActive(id, flags));
  return active.length > 0 ? active.join(",") : "default";
}

function applyFeatureToken(flags: SkeletonBuildFlags, token: string): SkeletonBuildFlags {
  const next: SkeletonBuildFlags = { ...flags };
  switch (token) {
    case "tun_only":
      next.includePcMixedInbound = false;
      return next;
    case "cache_all":
      next.experimentalCacheAllDevices = true;
      return next;
    case "ipv4_dns":
      next.modernDnsPreferIpv4 = true;
      return next;
    case "sniff_modern":
      next.sniffModern = true;
      return next;
    case "sniff_override":
      next.sniffOverrideDestination = true;
      next.sniffModern = true;
      return next;
    case "strict_route_all":
      next.strictRouteAllDevices = true;
      return next;
    case "dns_anti_leak":
    // 兼容旧 token（实现不同，但目标一致，统一合并为一个功能开关）
    case "dns_hijack":
    case "clash_dns_hijack":
      next.dnsAntiLeak = true;
      return next;
    case "private_direct":
      next.privateDirect = true;
      return next;
    case "icmp_direct":
      next.icmpDirect = true;
      return next;
    case "clash_api":
      next.clashApi = true;
      return next;
    case "clash_api_lan":
      next.clashApi = true;
      next.clashApiLan = true;
      return next;
    case "log_debug":
      next.logDebug = true;
      return next;
    case "dns_fakeip":
      next.dnsFakeipServer = true;
      return next;
    case "clash_tun":
      next.clashTun = true;
      return next;
    case "clash_fake_ip":
      next.clashFakeIpDns = true;
      return next;
    case "clash_sniffer":
      next.clashSniffer = true;
      return next;
    default:
      throw new Error(
        `未知骨架功能「${token}」。可选：${[...KNOWN_FEATURE_IDS].sort().join(", ")}；多个用逗号、空格、| 或 + 分隔。`,
      );
  }
}

export function parseSkeletonQuery(raw: string | null | undefined): SkeletonBuildFlags {
  const s = raw?.trim() ?? "";
  if (!s || /^default$/i.test(s)) {
    return { ...DEFAULT_SKELETON_FLAGS };
  }
  const tokens = s
    .split(/[\s,|+]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) {
    return { ...DEFAULT_SKELETON_FLAGS };
  }
  let flags: SkeletonBuildFlags = { ...DEFAULT_SKELETON_FLAGS };
  for (const t of tokens) {
    if (t === "default") {
      continue;
    }
    flags = applyFeatureToken(flags, t);
  }
  return flags;
}

/** 插入到 sing-box route.rules 最前（与 ACL 规则合并时同样顺序）。 */
export function buildSkeletonRoutePrepend(
  flags: SkeletonBuildFlags,
  _profile: DeviceProfile,
): JsonObject[] {
  const prepend: JsonObject[] = [];
  if (flags.privateDirect) {
    prepend.push({ ip_is_private: true, action: "route", outbound: "direct" });
  }
  if (flags.icmpDirect) {
    prepend.push({ network: ["icmp"], action: "route", outbound: "direct" });
  }
  if (flags.dnsAntiLeak) {
    prepend.push({ protocol: ["dns"], action: "hijack-dns" });
  }
  return prepend;
}

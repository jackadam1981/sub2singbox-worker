import type { SkeletonBuildFlags } from "./skeleton-presets";
import { DEFAULT_SKELETON_FLAGS, buildSkeletonRoutePrepend } from "./skeleton-presets";
import type {
  DeviceProfile,
  JsonObject,
  JsonValue,
  RenderContext,
  SingBoxOutbound,
} from "./types";

export function buildTunInbound(profile: DeviceProfile, flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS): JsonObject {
  const base: JsonObject = {
    type: "tun",
    tag: "tun-in",
    mtu: 9000,
    auto_route: true,
    strict_route:
      profile.device === "openwrt" || profile.device === "ios" || flags.strictRouteAllDevices,
  };

  const sniffOn = profile.channel === "legacy" || flags.sniffModern;
  if (sniffOn) {
    base.sniff = true;
    if (flags.sniffOverrideDestination) {
      base.sniff_override_destination = true;
    }
  }

  if (profile.channel === "modern") {
    // sing-box 1.10+ requires explicit tun prefixes; otherwise startup fails with:
    // "missing interface address"
    base.address = ["172.18.0.1/30"];
  }

  if (profile.device === "openwrt") {
    base.interface_name = "singtun0";
    base.stack = "system";
    // Recommended on Linux routers with fw4: better routing/perf and fewer docker-bridge conflicts.
    base.auto_redirect = true;
  } else if (profile.device === "android") {
    base.stack = profile.channel === "modern" ? "mixed" : "gvisor";
  } else {
    base.stack = "system";
  }

  return base;
}

export function buildMixedInbound(profile: DeviceProfile, flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS): JsonObject {
  const inbound: JsonObject = {
    type: "mixed",
    tag: "mixed-in",
    listen: "127.0.0.1",
    listen_port: 2080,
  };

  const sniffOn = profile.channel === "legacy" || flags.sniffModern;
  if (sniffOn) {
    inbound.sniff = true;
    if (flags.sniffOverrideDestination) {
      inbound.sniff_override_destination = true;
    }
  }

  return inbound;
}

export function buildDns(profile: DeviceProfile, flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS): JsonObject {
  const fakeipServer: JsonObject | null =
    flags.dnsFakeipServer && profile.channel === "modern"
      ? {
          type: "fakeip",
          tag: "dns-fakeip",
          inet4_range: "198.18.0.0/15",
          inet6_range: "fc00::/18",
        }
      : null;

  if (profile.channel === "modern") {
    const remoteServer: JsonObject = {
      type: "tls",
      tag: "dns-remote",
      server: "1.1.1.1",
      server_port: 853,
      detour: "proxy",
    };
    if (flags.modernDnsPreferIpv4) {
      remoteServer.strategy = "prefer_ipv4";
    }
    const servers: JsonObject[] = [
      {
        type: "local",
        tag: "dns-local",
      },
      remoteServer,
    ];
    if (fakeipServer) {
      servers.push(fakeipServer);
    }
    return {
      servers,
      rules: [],
      final: "dns-remote",
    };
  }

  const servers: JsonObject[] = [
    {
      address: "local",
      tag: "dns-local",
    },
    {
      address: "tls://1.1.1.1",
      tag: "dns-remote",
      detour: "proxy",
    },
  ];
  if (fakeipServer) {
    servers.push(fakeipServer);
  }
  return {
    servers,
    rules: [],
    final: "dns-remote",
  };
}

export function buildSelectorOutbounds(nodeTags: string[]): JsonObject[] {
  const selectionTargets = nodeTags.length > 0 ? nodeTags : ["direct"];

  return [
    {
      type: "selector",
      tag: "proxy",
      outbounds: ["auto", ...selectionTargets, "direct"],
      interrupt_exist_connections: true,
    },
    {
      type: "urltest",
      tag: "auto",
      outbounds: selectionTargets,
      url: "https://www.gstatic.com/generate_204",
      interval: "10m",
      tolerance: 50,
      interrupt_exist_connections: true,
    },
    {
      type: "direct",
      tag: "direct",
    },
    {
      type: "block",
      tag: "block",
    },
  ];
}

export function buildRoute(profile: DeviceProfile, flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS): JsonObject {
  const prepend = buildSkeletonRoutePrepend(flags, profile);
  const route: JsonObject = {
    auto_detect_interface: true,
    final: "proxy",
    rules: prepend,
  };

  if (profile.channel === "modern") {
    route.default_domain_resolver = "dns-remote";
  }

  return route;
}

export function buildExperimental(
  profile: DeviceProfile,
  flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS,
): JsonObject {
  const enabled =
    flags.experimentalCacheAllDevices === true
      ? true
      : profile.device === "openwrt" || profile.device === "pc";
  const exp: JsonObject = {
    cache_file: {
      enabled,
    },
  };
  if (flags.clashApi) {
    exp.clash_api = {
      external_controller: flags.clashApiLan ? "0.0.0.0:9090" : "127.0.0.1:9090",
    };
  }
  return exp;
}

export function buildProfileInbounds(
  profile: DeviceProfile,
  flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS,
): JsonObject[] {
  const inbounds: JsonObject[] = [buildTunInbound(profile, flags)];
  if (profile.device === "pc" && flags.includePcMixedInbound) {
    inbounds.push(buildMixedInbound(profile, flags));
  }
  return inbounds;
}

export function buildRenderContext(
  profile: DeviceProfile,
  nodes: SingBoxOutbound[],
  flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS,
): RenderContext {
  const inbounds = buildProfileInbounds(profile, flags);

  const selectorOutbounds = buildSelectorOutbounds(nodes.map((node) => node.tag));
  const allOutbounds: JsonValue[] = [...selectorOutbounds, ...nodes];
  const logLevel = flags.logDebug ? "debug" : "info";
  const generatedConfig: JsonObject = {
    log: {
      level: logLevel,
      timestamp: true,
    },
    dns: buildDns(profile, flags),
    inbounds,
    outbounds: allOutbounds,
    route: buildRoute(profile, flags),
    experimental: buildExperimental(profile, flags),
  };

  return {
    profile,
    dns: generatedConfig.dns as JsonObject,
    inbounds,
    selectorOutbounds,
    nodeOutbounds: nodes,
    allOutbounds,
    route: generatedConfig.route as JsonObject,
    experimental: generatedConfig.experimental as JsonObject,
    nodeTags: nodes.map((node) => node.tag),
  };
}

export function buildSingBoxConfig(
  profile: DeviceProfile,
  nodes: SingBoxOutbound[],
  flags: SkeletonBuildFlags = DEFAULT_SKELETON_FLAGS,
): JsonObject {
  const context = buildRenderContext(profile, nodes, flags);
  const logLevel = flags.logDebug ? "debug" : "info";

  return {
    log: {
      level: logLevel,
      timestamp: true,
    },
    dns: context.dns,
    inbounds: context.inbounds,
    outbounds: context.allOutbounds,
    route: context.route,
    experimental: context.experimental,
  };
}

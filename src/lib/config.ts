import type {
  DeviceProfile,
  JsonObject,
  JsonValue,
  RenderContext,
  SingBoxOutbound,
} from "./types";

export function buildTunInbound(profile: DeviceProfile): JsonObject {
  const base: JsonObject = {
    type: "tun",
    tag: "tun-in",
    mtu: 9000,
    auto_route: true,
    strict_route: profile.device === "openwrt" || profile.device === "ios",
    sniff: true,
  };

  if (profile.device === "openwrt") {
    base.interface_name = "singtun0";
    base.stack = "system";
  } else if (profile.device === "android") {
    base.stack = profile.channel === "modern" ? "mixed" : "gvisor";
  } else {
    base.stack = "system";
  }

  return base;
}

export function buildMixedInbound(): JsonObject {
  return {
    type: "mixed",
    tag: "mixed-in",
    listen: "127.0.0.1",
    listen_port: 2080,
    sniff: true,
    set_system_proxy: false,
  };
}

export function buildDns(profile: DeviceProfile): JsonObject {
  if (profile.channel === "modern") {
    return {
      servers: [
        {
          type: "local",
          tag: "dns-local",
        },
        {
          type: "tls",
          tag: "dns-remote",
          server: "1.1.1.1",
          server_port: 853,
          detour: "proxy",
        },
      ],
      rules: [],
      final: "dns-remote",
    };
  }

  return {
    servers: [
      {
        address: "local",
        tag: "dns-local",
      },
      {
        address: "tls://1.1.1.1",
        tag: "dns-remote",
        detour: "proxy",
      },
    ],
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

export function buildRoute(profile: DeviceProfile): JsonObject {
  const route: JsonObject = {
    auto_detect_interface: true,
    final: "proxy",
    rules: [],
  };

  if (profile.channel === "modern") {
    route.default_domain_resolver = "dns-remote";
  }

  return route;
}

export function buildExperimental(profile: DeviceProfile): JsonObject {
  return {
    cache_file: {
      enabled: profile.device === "openwrt" || profile.device === "pc",
    },
  };
}

export function buildRenderContext(
  profile: DeviceProfile,
  nodes: SingBoxOutbound[],
): RenderContext {
  const inbounds = [buildTunInbound(profile)];
  if (profile.device === "pc") {
    inbounds.push(buildMixedInbound());
  }

  const selectorOutbounds = buildSelectorOutbounds(nodes.map((node) => node.tag));
  const allOutbounds: JsonValue[] = [...selectorOutbounds, ...nodes];
  const generatedConfig: JsonObject = {
    log: {
      level: "info",
      timestamp: true,
    },
    dns: buildDns(profile),
    inbounds,
    outbounds: allOutbounds,
    route: buildRoute(profile),
    experimental: buildExperimental(profile),
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
  };
}

export function buildSingBoxConfig(profile: DeviceProfile, nodes: SingBoxOutbound[]): JsonObject {
  const context = buildRenderContext(profile, nodes);

  return {
    log: {
      level: "info",
      timestamp: true,
    },
    dns: context.dns,
    inbounds: context.inbounds,
    outbounds: context.allOutbounds,
    route: context.route,
    experimental: context.experimental,
  };
}

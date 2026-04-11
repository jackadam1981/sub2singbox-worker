import type { DeviceProfile, JsonObject, JsonValue, SingBoxOutbound } from "./types";

function buildTunInbound(profile: DeviceProfile): JsonObject {
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

function buildMixedInbound(): JsonObject {
  return {
    type: "mixed",
    tag: "mixed-in",
    listen: "127.0.0.1",
    listen_port: 2080,
    sniff: true,
    set_system_proxy: false,
  };
}

function buildDns(profile: DeviceProfile): JsonObject {
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

function buildSelectorOutbounds(nodeTags: string[]): JsonObject[] {
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

function buildRoute(profile: DeviceProfile): JsonObject {
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

export function buildSingBoxConfig(profile: DeviceProfile, nodes: SingBoxOutbound[]): JsonObject {
  const inbounds = [buildTunInbound(profile)];
  if (profile.device === "pc") {
    inbounds.push(buildMixedInbound());
  }

  const outbounds: JsonValue[] = [
    ...buildSelectorOutbounds(nodes.map((node) => node.tag)),
    ...nodes,
  ];

  return {
    log: {
      level: "info",
      timestamp: true,
    },
    dns: buildDns(profile),
    inbounds,
    outbounds,
    route: buildRoute(profile),
    experimental: {
      cache_file: {
        enabled: profile.device === "openwrt" || profile.device === "pc",
      },
    },
  };
}

import YAML from "yaml";

import type { JsonObject, SingBoxOutbound } from "./types";

type ClashProxy = JsonObject & {
  name: string;
  type: string;
  server: string;
  port: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parsePluginOpts(input: unknown): JsonObject | undefined {
  if (isObject(input)) {
    return input as JsonObject;
  }

  if (typeof input !== "string" || input.trim().length === 0) {
    return undefined;
  }

  const result: JsonObject = {};
  for (const item of input.split(";")) {
    const [rawKey, rawValue] = item.split("=");
    const key = rawKey?.trim();
    const value = rawValue?.trim();
    if (!key || !value) {
      continue;
    }
    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function readTls(outbound: SingBoxOutbound): Record<string, unknown> | undefined {
  return isObject(outbound.tls) ? outbound.tls : undefined;
}

function readTransport(outbound: SingBoxOutbound): Record<string, unknown> | undefined {
  return isObject(outbound.transport) ? outbound.transport : undefined;
}

function applyCommonTlsFields(proxy: ClashProxy, outbound: SingBoxOutbound): void {
  const tls = readTls(outbound);
  if (!tls || getBoolean(tls.enabled) !== true) {
    return;
  }

  proxy.tls = true;

  const serverName = getString(tls.server_name);
  if (serverName) {
    proxy.servername = serverName;
    proxy.sni = serverName;
  }

  if (getBoolean(tls.insecure) === true) {
    proxy["skip-cert-verify"] = true;
  }

  const utls = isObject(tls.utls) ? tls.utls : undefined;
  const fingerprint = utls ? getString(utls.fingerprint) : undefined;
  if (fingerprint) {
    proxy["client-fingerprint"] = fingerprint;
  }

  const alpn = Array.isArray(tls.alpn)
    ? tls.alpn.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  if (alpn.length > 0) {
    proxy.alpn = alpn;
  }

  const reality = isObject(tls.reality) ? tls.reality : undefined;
  if (reality && getBoolean(reality.enabled) === true) {
    const publicKey = getString(reality.public_key);
    const shortId = getString(reality.short_id);
    proxy["reality-opts"] = {
      ...(publicKey ? { "public-key": publicKey } : {}),
      ...(shortId ? { "short-id": shortId } : {}),
    };
  }
}

function applyCommonTransport(proxy: ClashProxy, outbound: SingBoxOutbound): void {
  const transport = readTransport(outbound);
  if (!transport) {
    return;
  }

  const type = getString(transport.type);
  if (!type) {
    return;
  }

  switch (type) {
    case "ws": {
      proxy.network = "ws";
      const path = getString(transport.path) ?? "/";
      const headers = isObject(transport.headers) ? (transport.headers as JsonObject) : undefined;
      proxy["ws-opts"] = {
        path,
        ...(headers ? { headers } : {}),
      };
      return;
    }
    case "grpc": {
      proxy.network = "grpc";
      proxy["grpc-opts"] = {
        "grpc-service-name": getString(transport.service_name) ?? "grpc",
      };
      return;
    }
    case "http": {
      proxy.network = "http";
      proxy["h2-opts"] = {
        ...(Array.isArray(transport.host) ? { host: transport.host } : {}),
        ...(getString(transport.path) ? { path: getString(transport.path) } : {}),
      };
      return;
    }
    case "httpupgrade": {
      proxy.network = "http";
      const host = getString(transport.host);
      proxy["ws-opts"] = {
        path: getString(transport.path) ?? "/",
        ...(host ? { headers: { Host: host } } : {}),
      };
      return;
    }
    default:
      proxy.network = type;
  }
}

export function toClashProxy(outbound: SingBoxOutbound): ClashProxy | null {
  const server = getString(outbound.server);
  const port = getNumber(outbound.server_port);
  const name = getString(outbound.tag);
  const type = getString(outbound.type);

  if (!server || !port || !name || !type) {
    return null;
  }

  switch (type) {
    case "shadowsocks": {
      const method = getString(outbound.method);
      const password = getString(outbound.password);
      if (!method || !password) {
        return null;
      }

      const proxy: ClashProxy = {
        name,
        type: "ss",
        server,
        port,
        cipher: method,
        password,
        udp: true,
      };

      const plugin = getString(outbound.plugin);
      const pluginOpts = parsePluginOpts(outbound.plugin_opts);
      if (plugin) {
        proxy.plugin = plugin;
      }
      if (pluginOpts) {
        proxy["plugin-opts"] = pluginOpts;
      }
      return proxy;
    }
    case "vmess": {
      const uuid = getString(outbound.uuid);
      if (!uuid) {
        return null;
      }

      const proxy: ClashProxy = {
        name,
        type: "vmess",
        server,
        port,
        uuid,
        alterId: getNumber(outbound.alter_id) ?? 0,
        cipher: getString(outbound.security) ?? "auto",
        udp: true,
      };
      applyCommonTlsFields(proxy, outbound);
      applyCommonTransport(proxy, outbound);
      return proxy;
    }
    case "vless": {
      const uuid = getString(outbound.uuid);
      if (!uuid) {
        return null;
      }

      const proxy: ClashProxy = {
        name,
        type: "vless",
        server,
        port,
        uuid,
        udp: true,
      };
      const flow = getString(outbound.flow);
      if (flow) {
        proxy.flow = flow;
      }
      const packetEncoding = getString(outbound.packet_encoding);
      if (packetEncoding) {
        proxy["packet-encoding"] = packetEncoding;
      }
      applyCommonTlsFields(proxy, outbound);
      applyCommonTransport(proxy, outbound);
      return proxy;
    }
    case "trojan": {
      const password = getString(outbound.password);
      if (!password) {
        return null;
      }

      const proxy: ClashProxy = {
        name,
        type: "trojan",
        server,
        port,
        password,
        udp: true,
      };
      applyCommonTlsFields(proxy, outbound);
      applyCommonTransport(proxy, outbound);
      return proxy;
    }
    case "hysteria2": {
      const password = getString(outbound.password);
      if (!password) {
        return null;
      }

      const proxy: ClashProxy = {
        name,
        type: "hysteria2",
        server,
        port,
        password,
      };
      applyCommonTlsFields(proxy, outbound);
      const obfs = isObject(outbound.obfs) ? outbound.obfs : undefined;
      const obfsType = obfs ? getString(obfs.type) : undefined;
      const obfsPassword = obfs ? getString(obfs.password) : undefined;
      if (obfsType) {
        proxy.obfs = obfsType;
      }
      if (obfsPassword) {
        proxy["obfs-password"] = obfsPassword;
      }
      return proxy;
    }
    case "hysteria": {
      const proxy: ClashProxy = {
        name,
        type: "hysteria",
        server,
        port,
      };
      const auth = getString(outbound.auth_str);
      if (auth) {
        proxy["auth-str"] = auth;
      }
      const obfs = getString(outbound.obfs);
      const obfsPassword = getString(outbound.obfs_password);
      if (obfs) {
        proxy.obfs = obfs;
      }
      if (obfsPassword) {
        proxy["obfs-password"] = obfsPassword;
      }
      const upMbps = getNumber(outbound.up_mbps);
      const downMbps = getNumber(outbound.down_mbps);
      if (upMbps !== undefined) {
        proxy.up = upMbps;
      }
      if (downMbps !== undefined) {
        proxy.down = downMbps;
      }
      applyCommonTlsFields(proxy, outbound);
      return proxy;
    }
    case "tuic": {
      const uuid = getString(outbound.uuid);
      const password = getString(outbound.password);
      if (!uuid || !password) {
        return null;
      }

      const proxy: ClashProxy = {
        name,
        type: "tuic",
        server,
        port,
        uuid,
        password,
        "congestion-controller": getString(outbound.congestion_control) ?? "bbr",
      };
      const udpRelayMode = getString(outbound.udp_relay_mode);
      if (udpRelayMode) {
        proxy["udp-relay-mode"] = udpRelayMode;
      }
      applyCommonTlsFields(proxy, outbound);
      return proxy;
    }
    case "socks": {
      const proxy: ClashProxy = {
        name,
        type: "socks5",
        server,
        port,
        udp: true,
      };
      const username = getString(outbound.username);
      const password = getString(outbound.password);
      if (username) {
        proxy.username = username;
      }
      if (password) {
        proxy.password = password;
      }
      return proxy;
    }
    case "http": {
      const proxy: ClashProxy = {
        name,
        type: "http",
        server,
        port,
      };
      const username = getString(outbound.username);
      const password = getString(outbound.password);
      if (username) {
        proxy.username = username;
      }
      if (password) {
        proxy.password = password;
      }
      const tls = readTls(outbound);
      if (tls && getBoolean(tls.enabled) === true) {
        proxy.tls = true;
      }
      return proxy;
    }
    default:
      return null;
  }
}

export function buildClashProviderDocument(outbounds: SingBoxOutbound[]): string {
  const proxies = outbounds
    .map((outbound) => toClashProxy(outbound))
    .filter((proxy): proxy is ClashProxy => proxy !== null);

  return YAML.stringify({ proxies });
}

export function buildClashConfigDocument(outbounds: SingBoxOutbound[]): string {
  const proxies = outbounds
    .map((outbound) => toClashProxy(outbound))
    .filter((proxy): proxy is ClashProxy => proxy !== null);

  const proxyNames = proxies.map((proxy) => proxy.name);
  const autoTargets = proxyNames.length > 0 ? proxyNames : ["DIRECT"];

  return YAML.stringify({
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    "unified-delay": true,
    ipv6: true,
    proxies,
    "proxy-groups": [
      {
        name: "Proxy",
        type: "select",
        proxies: ["Auto", ...proxyNames, "DIRECT", "REJECT"],
      },
      {
        name: "Auto",
        type: "url-test",
        url: "https://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 50,
        proxies: autoTargets,
      },
    ],
    rules: ["MATCH,Proxy"],
  });
}

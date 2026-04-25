import { describe, expect, it } from "vitest";

import { buildSingBoxConfig } from "../src/lib/config";
import { resolveProfile } from "../src/lib/profiles";
import { parseSkeletonQuery, serializeSkeletonFlags } from "../src/lib/skeleton-presets";

describe("skeleton feature combinations", () => {
  it("parses empty and default as baseline", () => {
    const a = parseSkeletonQuery(null);
    const b = parseSkeletonQuery("default");
    expect(serializeSkeletonFlags(a)).toBe("default");
    expect(serializeSkeletonFlags(b)).toBe("default");
  });

  it("combines tun_only with ipv4_dns", () => {
    const flags = parseSkeletonQuery("tun_only ipv4_dns");
    expect(flags.includePcMixedInbound).toBe(false);
    expect(flags.modernDnsPreferIpv4).toBe(true);
    expect(flags.experimentalCacheAllDevices).toBe(false);
    expect(serializeSkeletonFlags(flags)).toBe("tun_only,ipv4_dns");
  });

  it("combines all three features", () => {
    const flags = parseSkeletonQuery("cache_all+tun_only|ipv4_dns");
    expect(flags.includePcMixedInbound).toBe(false);
    expect(flags.experimentalCacheAllDevices).toBe(true);
    expect(flags.modernDnsPreferIpv4).toBe(true);
  });

  it("tun_only removes mixed inbound on PC", () => {
    const profile = resolveProfile("pc", "1.13.7");
    const nodes = [
      {
        type: "shadowsocks",
        tag: "N1",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "p",
      },
    ];
    const cfg = buildSingBoxConfig(profile, nodes, parseSkeletonQuery("tun_only")) as {
      inbounds: Array<{ tag: string; type: string }>;
    };
    expect(cfg.inbounds.some((i) => i.tag === "mixed-in")).toBe(false);
    expect(cfg.inbounds.some((i) => i.tag === "tun-in")).toBe(true);
  });

  it("baseline keeps mixed inbound on PC", () => {
    const profile = resolveProfile("pc", "1.13.7");
    const nodes = [
      {
        type: "shadowsocks",
        tag: "N1",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "p",
      },
    ];
    const cfg = buildSingBoxConfig(profile, nodes, parseSkeletonQuery("")) as {
      inbounds: Array<{ tag: string }>;
    };
    expect(cfg.inbounds.some((i) => i.tag === "mixed-in")).toBe(true);
  });

  it("ipv4_dns adds strategy on modern dns-remote", () => {
    const profile = resolveProfile("android", "1.13.7");
    const nodes = [
      {
        type: "shadowsocks",
        tag: "N1",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "p",
      },
    ];
    const cfg = buildSingBoxConfig(profile, nodes, parseSkeletonQuery("ipv4_dns")) as {
      dns: { servers: Array<{ tag?: string; strategy?: string }> };
    };
    const remote = cfg.dns.servers.find((s) => s.tag === "dns-remote");
    expect(remote?.strategy).toBe("prefer_ipv4");
  });

  it("cache_all enables experimental cache on ios", () => {
    const profile = resolveProfile("ios", "1.13.7");
    const nodes = [
      {
        type: "shadowsocks",
        tag: "N1",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "p",
      },
    ];
    const cfg = buildSingBoxConfig(profile, nodes, parseSkeletonQuery("cache_all")) as {
      experimental: { cache_file: { enabled: boolean } };
    };
    expect(cfg.experimental.cache_file.enabled).toBe(true);
  });

  it("dns_anti_leak prepends hijack-dns rule", () => {
    const profile = resolveProfile("pc", "1.13.7");
    const nodes = [
      {
        type: "shadowsocks",
        tag: "N1",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "p",
      },
    ];
    const cfg = buildSingBoxConfig(profile, nodes, parseSkeletonQuery("dns_anti_leak")) as {
      route: { rules: Array<{ action?: string; protocol?: string[] }> };
    };
    expect(cfg.route.rules[0]).toMatchObject({ protocol: ["dns"], action: "hijack-dns" });
  });

  it("sniff_modern enables sniff on modern tun", () => {
    const profile = resolveProfile("android", "1.13.7");
    const flags = parseSkeletonQuery("sniff_modern");
    const cfg = buildSingBoxConfig(profile, [], flags) as {
      inbounds: Array<{ tag: string; sniff?: boolean }>;
    };
    const tun = cfg.inbounds.find((i) => i.tag === "tun-in");
    expect(tun?.sniff).toBe(true);
  });
});

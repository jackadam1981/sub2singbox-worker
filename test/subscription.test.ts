import { describe, expect, it } from "vitest";

import {
  dedupeAndNormalizeOutbounds,
  parseSubscriptionPayload,
} from "../src/lib/subscription";

describe("subscription parser", () => {
  it("parses ss uri from base64 subscription content", () => {
    const plain = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const base64Subscription = Buffer.from(plain, "utf-8").toString("base64");
    const outbounds = parseSubscriptionPayload(base64Subscription, "legacy");

    expect(outbounds).toHaveLength(1);
    expect(outbounds[0].type).toBe("shadowsocks");
    expect(outbounds[0].tag).toBe("HK-SS");
    expect(outbounds[0].server).toBe("1.2.3.4");
  });

  it("parses vmess uri and injects transport/tls", () => {
    const vmessObject = {
      v: "2",
      ps: "VMESS-HK",
      add: "vmess.example.com",
      port: "443",
      id: "11111111-1111-1111-1111-111111111111",
      aid: "0",
      net: "ws",
      host: "cdn.example.com",
      path: "/ws",
      tls: "tls",
      sni: "vmess.example.com",
    };

    const uri = `vmess://${Buffer.from(JSON.stringify(vmessObject)).toString("base64")}`;
    const outbounds = parseSubscriptionPayload(uri, "modern");

    expect(outbounds).toHaveLength(1);
    expect(outbounds[0].type).toBe("vmess");
    expect(outbounds[0].domain_resolver).toBe("dns-remote");
    expect(outbounds[0].tls).toMatchObject({ enabled: true, server_name: "vmess.example.com" });
    expect(outbounds[0].transport).toMatchObject({ type: "ws", path: "/ws" });
  });

  it("deduplicates objects and renames duplicate tags", () => {
    const outbounds = dedupeAndNormalizeOutbounds([
      {
        type: "shadowsocks",
        tag: "Node",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "pass",
      },
      {
        type: "shadowsocks",
        tag: "Node",
        server: "2.2.2.2",
        server_port: 443,
        method: "aes-256-gcm",
        password: "pass",
      },
      {
        type: "shadowsocks",
        tag: "Node",
        server: "2.2.2.2",
        server_port: 443,
        method: "aes-256-gcm",
        password: "pass",
      },
    ]);

    expect(outbounds).toHaveLength(2);
    expect(outbounds[0].tag).toBe("Node");
    expect(outbounds[1].tag).toBe("Node 2");
  });

  it("parses clash yaml proxies", () => {
    const yaml = `
proxies:
  - name: HK-WS
    type: vmess
    server: vmess.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    alterId: 0
    cipher: auto
    tls: true
    network: ws
    ws-opts:
      path: /ws
      headers:
        Host: cdn.example.com
  - name: SG-SS
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-256-gcm
    password: pass
`;

    const outbounds = parseSubscriptionPayload(yaml, "modern");
    expect(outbounds).toHaveLength(2);
    expect(outbounds[0].type).toBe("vmess");
    expect(outbounds[0].transport).toMatchObject({ type: "ws", path: "/ws" });
    expect(outbounds[1].type).toBe("shadowsocks");
    expect(outbounds[1].tag).toBe("SG-SS");
  });

  it("parses clash https and hysteria proxies", () => {
    const yaml = `
proxies:
  - name: HTTPS-NODE
    type: https
    server: secure.example.com
    port: 443
    username: user
    password: pass
  - name: HY-NODE
    type: hysteria
    server: hy.example.com
    port: 8443
    auth-str: token
    up: 20
    down: 100
    sni: hy.example.com
`;

    const outbounds = parseSubscriptionPayload(yaml, "modern");
    expect(outbounds).toHaveLength(2);
    expect(outbounds[0]).toMatchObject({
      type: "http",
      server: "secure.example.com",
      tls: { enabled: true },
    });
    expect(outbounds[1]).toMatchObject({
      type: "hysteria",
      auth_str: "token",
      up_mbps: 20,
      down_mbps: 100,
    });
  });
});

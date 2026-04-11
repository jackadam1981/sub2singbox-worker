import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { buildClashConfigDocument, toClashProxy } from "../src/lib/clash";

describe("clash output", () => {
  it("converts sing-box outbound to clash proxy", () => {
    const proxy = toClashProxy({
      type: "vmess",
      tag: "HK-VMESS",
      server: "vmess.example.com",
      server_port: 443,
      uuid: "11111111-1111-1111-1111-111111111111",
      alter_id: 0,
      security: "auto",
      tls: {
        enabled: true,
        server_name: "vmess.example.com",
      },
      transport: {
        type: "ws",
        path: "/ws",
        headers: {
          Host: "cdn.example.com",
        },
      },
    });

    expect(proxy).toMatchObject({
      name: "HK-VMESS",
      type: "vmess",
      server: "vmess.example.com",
      port: 443,
      tls: true,
      network: "ws",
    });
    expect(proxy?.["ws-opts"]).toMatchObject({ path: "/ws" });
  });

  it("builds full clash config yaml", () => {
    const yamlText = buildClashConfigDocument([
      {
        type: "shadowsocks",
        tag: "HK-SS",
        server: "1.2.3.4",
        server_port: 443,
        method: "aes-256-gcm",
        password: "pass",
      },
    ]);

    const parsed = YAML.parse(yamlText) as {
      proxies: Array<{ name: string }>;
      "proxy-groups": Array<{ name: string }>;
      rules: string[];
    };

    expect(parsed.proxies[0].name).toBe("HK-SS");
    expect(parsed["proxy-groups"].map((item) => item.name)).toEqual(["Proxy", "Auto"]);
    expect(parsed.rules).toContain("MATCH,Proxy");
  });
});

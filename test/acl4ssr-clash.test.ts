import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { buildClashYamlFromAcl4ssrIni } from "../src/lib/acl4ssr";

describe("ACL4SSR → Clash YAML", () => {
  it("merges minimal ini with nodes and FINAL rule", async () => {
    const nodes = [
      {
        type: "shadowsocks",
        tag: "HK-1",
        server: "1.2.3.4",
        server_port: 443,
        method: "aes-256-gcm",
        password: "secret",
      },
    ];

    const ini = `[custom]
custom_proxy_group=Proxy\`select\`[]DIRECT\`.*
ruleset=Proxy,[]FINAL`;

    const { yaml, warnings } = await buildClashYamlFromAcl4ssrIni(
      nodes,
      ini,
      async () => "",
    );

    expect(warnings.length).toBe(0);
    const doc = YAML.parse(yaml) as {
      proxies: Array<{ name: string }>;
      "proxy-groups": Array<{ name: string; type: string; proxies: string[] }>;
      rules: string[];
    };

    expect(doc.proxies[0].name).toBe("HK-1");
    expect(doc["proxy-groups"][0].name).toBe("Proxy");
    expect(doc["proxy-groups"][0].proxies).toContain("DIRECT");
    expect(doc["proxy-groups"][0].proxies).toContain("HK-1");
    expect(doc.rules).toContain("MATCH,Proxy");
  });

  it("appends rules from fetched rule list", async () => {
    const nodes = [
      {
        type: "shadowsocks",
        tag: "N1",
        server: "1.1.1.1",
        server_port: 8388,
        method: "aes-128-gcm",
        password: "p",
      },
    ];
    const ini = `[custom]
custom_proxy_group=P\`select\`[]DIRECT\`.*
ruleset=P,https://rules.example/list.txt
ruleset=P,[]FINAL`;

    const { yaml } = await buildClashYamlFromAcl4ssrIni(nodes, ini, async (url) => {
      expect(url).toBe("https://rules.example/list.txt");
      return "DOMAIN-SUFFIX,example.com\nIP-CIDR,10.0.0.0/8,no-resolve";
    });

    const doc = YAML.parse(yaml) as { rules: string[] };
    expect(doc.rules.some((r) => r.startsWith("DOMAIN-SUFFIX,example.com,P"))).toBe(true);
    expect(doc.rules.some((r) => r.includes("10.0.0.0/8") && r.endsWith(",no-resolve"))).toBe(
      true,
    );
    expect(doc.rules).toContain("MATCH,P");
  });
});

import { describe, expect, it } from "vitest";

import worker from "../src/index";

describe("worker routes", () => {
  it("returns a sing-box config from /convert", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const rawBase64 = Buffer.from(rawContent, "utf-8").toString("base64");
    const request = new Request(
      `https://example.com/convert?device=openwrt&version=1.12.0&raw_base64=1&raw=${encodeURIComponent(rawBase64)}`,
    );

    const response = await worker.fetch(request, {});
    const data = (await response.json()) as {
      outbounds: Array<{ tag: string }>;
      dns: { servers: Array<{ type?: string }> };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-profile-id")).toBe("openwrt-modern");
    expect(response.headers.get("x-node-count")).toBe("1");
    expect(data.outbounds.some((item: { tag: string }) => item.tag === "HK-SS")).toBe(true);
    expect(data.dns.servers[0].type).toBe("local");
    expect(response.headers.get("x-template-mode")).toBe("builtin");
  });

  it("protects /convert when ACCESS_PASSWORD is configured", async () => {
    const request = new Request("https://example.com/convert?device=ios&version=1.12.0&raw=ss://abc");
    const response = await worker.fetch(request, { ACCESS_PASSWORD: "secret" });

    expect(response.status).toBe(401);
  });

  it("renders remote template placeholders", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const template = `{
      "outbounds": "{{ Nodes }}",
      "meta": {
        "profile": "{{ ProfileId }}",
        "count": "{{ NodeCount }}"
      }
    }`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://template.example/config.json") {
        return new Response(template, { status: 200 });
      }
      return originalFetch(input as RequestInfo, init);
    };

    try {
      const request = new Request(
        `https://example.com/convert?device=pc&version=1.12.0&raw=${encodeURIComponent(rawContent)}&template_url=${encodeURIComponent("https://template.example/config.json")}`,
      );
      const response = await worker.fetch(request, {});
      const data = (await response.json()) as {
        outbounds: Array<{ tag: string }>;
        meta?: { profile: string; count: number };
        error?: string;
      };

      expect(response.status).toBe(200);
      expect(response.headers.get("x-template-mode")).toBe("remote");
      expect(data.meta?.profile).toBe("pc-modern");
      expect(data.meta?.count).toBe(1);
      expect(data.outbounds[0].tag).toBe("HK-SS");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

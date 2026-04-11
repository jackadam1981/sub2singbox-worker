import { describe, expect, it } from "vitest";
import YAML from "yaml";

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

  it("returns clash yaml when format=clash", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const request = new Request(
      `https://example.com/convert?device=pc&version=1.13.7&format=clash&raw=${encodeURIComponent(rawContent)}`,
    );

    const response = await worker.fetch(request, {});
    const text = await response.text();
    const data = YAML.parse(text) as {
      proxies: Array<{ name: string }>;
      "proxy-groups": Array<{ name: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/yaml");
    expect(response.headers.get("x-output-format")).toBe("clash");
    expect(data.proxies[0].name).toBe("HK-SS");
    expect(data["proxy-groups"][0].name).toBe("Proxy");
  });

  it("returns clash provider yaml when format=clash-provider", async () => {
    const rawContent = "http://user:pass@proxy.example.com:8080#HTTP-NODE";
    const request = new Request(
      `https://example.com/convert?device=pc&version=1.13.7&format=clash-provider&raw=${encodeURIComponent(rawContent)}`,
    );

    const response = await worker.fetch(request, {});
    const text = await response.text();
    const data = YAML.parse(text) as {
      proxies: Array<{ name: string; type: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-output-format")).toBe("clash-provider");
    expect(data.proxies).toHaveLength(1);
    expect(data.proxies[0]).toMatchObject({
      name: "HTTP-NODE",
      type: "http",
    });
  });

  it("tolerates partial source failures by default", async () => {
    const okUrl = "https://source.example/success";
    const badUrl = "https://source.example/fail";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === okUrl) {
        return new Response(
          "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS",
          { status: 200 },
        );
      }
      if (url === badUrl) {
        return new Response("upstream error", { status: 500 });
      }
      return originalFetch(input as RequestInfo, init);
    };

    try {
      const request = new Request(
        `https://example.com/convert?device=pc&version=1.13.7&url=${encodeURIComponent(okUrl)}|${encodeURIComponent(badUrl)}`,
      );
      const response = await worker.fetch(request, {});
      const data = (await response.json()) as { outbounds: Array<{ tag: string }> };

      expect(response.status).toBe(200);
      expect(response.headers.get("x-source-mode")).toBe("tolerant");
      expect(response.headers.get("x-source-total")).toBe("2");
      expect(response.headers.get("x-source-succeeded")).toBe("1");
      expect(response.headers.get("x-source-failed")).toBe("1");
      expect(data.outbounds.some((item) => item.tag === "HK-SS")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails on partial source failure in strict mode", async () => {
    const okUrl = "https://source.example/success";
    const badUrl = "https://source.example/fail";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === okUrl) {
        return new Response(
          "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS",
          { status: 200 },
        );
      }
      if (url === badUrl) {
        return new Response("upstream error", { status: 500 });
      }
      return originalFetch(input as RequestInfo, init);
    };

    try {
      const request = new Request(
        `https://example.com/convert?device=pc&version=1.13.7&strict=1&url=${encodeURIComponent(okUrl)}|${encodeURIComponent(badUrl)}`,
      );
      const response = await worker.fetch(request, {});
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toContain("strict 模式");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries with fallback ua when primary ua is forbidden", async () => {
    const url = "https://source.example/ua-protected";
    const originalFetch = globalThis.fetch;
    const seenUas: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (requestUrl === url) {
        const headers = new Headers(init?.headers);
        const ua = headers.get("User-Agent") ?? "";
        seenUas.push(ua);
        if (ua === "primary-ua") {
          return new Response("forbidden", { status: 403 });
        }
        return new Response(
          "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS",
          { status: 200 },
        );
      }
      return originalFetch(input as RequestInfo, init);
    };

    try {
      const request = new Request(
        `https://example.com/convert?device=pc&version=1.13.7&ua=primary-ua&fallback_ua=clash.meta&url=${encodeURIComponent(url)}`,
      );
      const response = await worker.fetch(request, {});

      expect(response.status).toBe(200);
      expect(seenUas).toEqual(["primary-ua", "clash.meta"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

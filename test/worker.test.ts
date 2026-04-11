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

  it("allows clash convert without version (uses server default channel)", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const request = new Request(
      `https://example.com/convert?device=pc&format=clash&raw=${encodeURIComponent(rawContent)}`,
    );
    const response = await worker.fetch(request, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("x-output-format")).toBe("clash");
  });

  it("requires version for sing-box convert (no default)", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const request = new Request(
      `https://example.com/convert?device=pc&raw=${encodeURIComponent(rawContent)}`,
    );
    const response = await worker.fetch(request, {});
    const data = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("version");
  });

  it("rejects deprecated format=clash-provider", async () => {
    const request = new Request(
      "https://example.com/convert?device=pc&version=1.13.7&format=clash-provider",
    );
    const response = await worker.fetch(request, {});
    const data = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("不支持的输出格式");
  });

  it("lists builtin templates", async () => {
    const response = await worker.fetch(new Request("https://example.com/templates"), {});
    const data = (await response.json()) as {
      templates: Array<{ id: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.templates.some((item) => item.id === "default")).toBe(true);
    expect(data.templates.some((item) => item.id === "manual")).toBe(true);
    expect(data.templates.some((item) => item.id === "auto")).toBe(true);
  });

  it("returns template recommendations for current profile", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/templates?device=pc&version=1.13.7"),
      {},
    );
    const data = (await response.json()) as {
      recommendation?: { primary_template_id: string };
      templates: Array<{ id: string; compatible_with_current_profile?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(data.recommendation?.primary_template_id).toBe("manual");
    expect(
      data.templates.some(
        (item) => item.id === "manual" && item.compatible_with_current_profile === true,
      ),
    ).toBe(true);
  });

  it("returns builtin template detail by id", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/templates/manual?device=pc&version=1.13.7"),
      {},
    );
    const data = (await response.json()) as {
      template: {
        id: string;
        template_text: string;
        recommended_for_current_profile?: boolean;
        recommendation_rank?: number;
      };
      recommendation?: { primary_template_id: string };
    };

    expect(response.status).toBe(200);
    expect(data.template.id).toBe("manual");
    expect(data.template.template_text).toContain('"type": "selector"');
    expect(data.template.recommended_for_current_profile).toBe(true);
    expect(data.template.recommendation_rank).toBe(1);
    expect(data.recommendation?.primary_template_id).toBe("manual");
  });

  it("validates conversion inputs without rendering response body", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const request = new Request(
      `https://example.com/validate?device=openwrt&version=1.12.0&raw=${encodeURIComponent(rawContent)}`,
    );
    const response = await worker.fetch(request, {});
    const data = (await response.json()) as {
      valid: boolean;
      profile: { id: string };
      nodes: { filtered_total: number };
    };

    expect(response.status).toBe(200);
    expect(data.valid).toBe(true);
    expect(data.profile.id).toBe("openwrt-modern");
    expect(data.nodes.filtered_total).toBe(1);
  });

  it("explains conversion pipeline details", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const request = new Request(
      `https://example.com/explain?device=pc&version=1.13.7&raw=${encodeURIComponent(rawContent)}`,
    );
    const response = await worker.fetch(request, {});
    const data = (await response.json()) as {
      explain: {
        output_format: string;
        sources: { total: number; entries: Array<{ payload_kind?: string }> };
        nodes: { filtered_total: number; tags: string[] };
      };
    };

    expect(response.status).toBe(200);
    expect(data.explain.output_format).toBe("sing-box");
    expect(data.explain.sources.total).toBe(1);
    expect(data.explain.sources.entries[0].payload_kind).toContain("uri");
    expect(data.explain.nodes.filtered_total).toBe(1);
    expect(data.explain.nodes.tags).toContain("HK-SS");
  });

  it("renders builtin template by id", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const request = new Request(
      `https://example.com/convert?device=pc&version=1.13.7&raw=${encodeURIComponent(rawContent)}&template=${encodeURIComponent("builtin:manual")}`,
    );

    const response = await worker.fetch(request, {});
    const data = (await response.json()) as {
      outbounds: Array<{ tag: string; type: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-template-mode")).toBe("builtin");
    expect(response.headers.get("x-template-id")).toBe("manual");
    expect(data.outbounds.some((item) => item.tag === "proxy" && item.type === "selector")).toBe(
      true,
    );
    expect(data.outbounds.some((item) => item.tag === "HK-SS")).toBe(true);
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
      const data = (await response.json()) as {
        error: string;
        error_detail: { stage: string; code: string };
      };

      expect(response.status).toBe(400);
      expect(data.error).toContain("strict 模式");
      expect(data.error_detail.stage).toBe("fetch-subscription");
      expect(data.error_detail.code).toBe("STRICT_SOURCE_FAILURE");
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

  it("GET / serves console HTML; GET /info serves meta JSON", async () => {
    const r1 = await worker.fetch(new Request("https://example.com/"), {});
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-type")).toContain("text/html");
    expect(r1.headers.get("x-sub2sb-console")).toBe("v3");
    const html = await r1.text();
    expect(html).toContain("sub2singbox");
    expect(html).toContain("UI v3");
    expect(html).toContain('data-sub2sb-worker="v3"');

    const r2 = await worker.fetch(new Request("https://example.com/info"), {});
    expect(r2.status).toBe(200);
    const meta = (await r2.json()) as { ok: boolean; endpoints: string[]; console_ui: string };
    expect(meta.ok).toBe(true);
    expect(meta.endpoints).toContain("/info");
    expect(meta.endpoints).toContain("/ui-version");
    expect(meta.console_ui).toBe("v3");

    const r3 = await worker.fetch(new Request("https://example.com/ui-version"), {});
    expect(r3.status).toBe(200);
    const ver = (await r3.json()) as { ok: boolean; console_ui: string; source: string };
    expect(ver.ok).toBe(true);
    expect(ver.console_ui).toBe("v3");
    expect(ver.source).toBe("worker");
  });

  it("GET /console.html redirects to / (avoid stale static ASSETS copy)", async () => {
    const r = await worker.fetch(new Request("https://example.com/console.html"), {});
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://example.com/");
  });
});

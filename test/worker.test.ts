import { describe, expect, it } from "vitest";
import YAML from "yaml";

import worker from "../src/index";

describe("worker routes", () => {
  it("returns a sing-box config from /convert", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const rawBase64 = Buffer.from(rawContent, "utf-8").toString("base64");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("ACL4SSR_Online.ini")) {
        return new Response(
          `[custom]
custom_proxy_group=P\`select\`[]DIRECT\`.*
ruleset=P,[]FINAL`,
          { status: 200 },
        );
      }
      return originalFetch(input as RequestInfo, init);
    };

    try {
      const request = new Request(
        `https://example.com/convert?device=openwrt&version=1.12.0&raw_base64=1&raw=${encodeURIComponent(rawBase64)}`,
      );

      const response = await worker.fetch(request, {});
      const data = (await response.json()) as {
        outbounds: Array<{ tag: string }>;
        dns: { servers: Array<{ type?: string }> };
        route: { final: string };
      };

      expect(response.status).toBe(200);
      expect(response.headers.get("x-profile-id")).toBe("openwrt-modern");
      expect(response.headers.get("x-node-count")).toBe("1");
      expect(data.outbounds.some((item: { tag: string }) => item.tag === "HK-SS")).toBe(true);
      expect(data.dns.servers[0].type).toBe("local");
      expect(data.route.final).toBe("P");
      expect(response.headers.get("x-template-mode")).toBe("builtin");
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("ACL4SSR_Online.ini")) {
        return new Response(
          `[custom]
custom_proxy_group=P\`select\`[]DIRECT\`.*
ruleset=P,[]FINAL`,
          { status: 200 },
        );
      }
      return originalFetch(input as RequestInfo, init);
    };

    try {
      const request = new Request(
        `https://example.com/convert?device=pc&version=1.13.7&format=clash&raw=${encodeURIComponent(rawContent)}`,
      );

      const response = await worker.fetch(request, {});
      const text = await response.text();
      const data = YAML.parse(text) as {
        proxies: Array<{ name: string }>;
        "proxy-groups": Array<{ name: string }>;
        rules: string[];
      };

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/yaml");
      expect(response.headers.get("x-output-format")).toBe("clash");
      expect(response.headers.get("x-clash-layout")).toBe("acl4ssr-ini");
      expect(data.proxies[0].name).toBe("HK-SS");
      expect(data["proxy-groups"][0].name).toBe("P");
      expect(data.rules).toContain("MATCH,P");
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it("lists builtin templates", async () => {
    const response = await worker.fetch(new Request("https://example.com/templates"), {});
    const data = (await response.json()) as {
      templates: Array<{ id: string; name: string; template_url?: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.templates.length).toBeGreaterThanOrEqual(30);
    expect(data.templates.some((item) => item.id === "online")).toBe(true);
    expect(data.templates.some((item) => item.id === "online_noauto")).toBe(true);
    expect(data.templates.some((item) => item.id === "online_mini_fallback")).toBe(true);
    expect(data.templates.every((item) => typeof item.template_url === "string")).toBe(true);
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
    expect(data.recommendation?.primary_template_id).toBe("online_noauto");
    expect(
      data.templates.some(
        (item) => item.id === "online_noauto" && item.compatible_with_current_profile === true,
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
        fallback_template_text: string;
        recommended_for_current_profile?: boolean;
        recommendation_rank?: number;
        template_url?: string;
      };
      recommendation?: { primary_template_id: string };
    };

    expect(response.status).toBe(200);
    expect(data.template.id).toBe("online_noauto");
    expect(data.template.fallback_template_text).toContain('"type": "selector"');
    expect(data.template.template_url).toContain("raw.githubusercontent.com/ACL4SSR/ACL4SSR");
    expect(data.template.recommended_for_current_profile).toBe(true);
    expect(data.template.recommendation_rank).toBe(1);
    expect(data.recommendation?.primary_template_id).toBe("online_noauto");
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

  it("lists combinable skeleton features on /profiles", async () => {
    const response = await worker.fetch(new Request("https://example.com/profiles"), {});
    const data = (await response.json()) as {
      skeletons: Array<{ id: string; scope: string }>;
    };
    expect(response.status).toBe(200);
    const ids = new Set(data.skeletons.map((s) => s.id));
    expect(ids.has("tun_only")).toBe(true);
    expect(ids.has("cache_all")).toBe(true);
    expect(ids.has("ipv4_dns")).toBe(true);
    expect(ids.has("clash_tun")).toBe(true);
    expect(ids.has("default")).toBe(false);
    expect(data.skeletons.length).toBeGreaterThanOrEqual(16);
    const allowedScopes = new Set(["shared", "sing-box", "clash"]);
    for (const s of data.skeletons) {
      expect(allowedScopes.has(s.scope)).toBe(true);
    }
    expect(data.skeletons.filter((s) => s.scope === "shared").map((s) => s.id).sort()).toEqual(
      ["dns_anti_leak", "log_debug"].sort(),
    );
    expect(data.skeletons.filter((s) => s.scope === "clash").length).toBe(3);
  });

  it("rejects invalid skeleton id", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const response = await worker.fetch(
      new Request(
        `https://example.com/validate?device=pc&version=1.13.7&raw=${encodeURIComponent(rawContent)}&skeleton=not-a-real-id`,
      ),
      {},
    );
    expect(response.status).toBe(400);
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
    expect(data.explain.skeleton_id).toBe("default");
    expect(data.explain.output_format).toBe("sing-box");
    expect(data.explain.sources.total).toBe(1);
    expect(data.explain.sources.entries[0].payload_kind).toContain("uri");
    expect(data.explain.nodes.filtered_total).toBe(1);
    expect(data.explain.nodes.tags).toContain("HK-SS");
  });

  it("explain reflects combined skeleton query", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const response = await worker.fetch(
      new Request(
        `https://example.com/explain?device=pc&version=1.13.7&raw=${encodeURIComponent(rawContent)}&skeleton=tun_only,ipv4_dns`,
      ),
      {},
    );
    const data = (await response.json()) as { explain: { skeleton_id: string } };
    expect(response.status).toBe(200);
    expect(data.explain.skeleton_id).toBe("tun_only,ipv4_dns");
  });

  it("renders builtin template by id", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_NoAuto.ini") {
        return new Response(
          `{
            "dns": "{{ Dns }}",
            "inbounds": "{{ Inbounds }}",
            "outbounds": [
              {
                "type": "selector",
                "tag": "proxy",
                "outbounds": "{{ NodeTags(append=direct) }}"
              },
              { "type": "direct", "tag": "direct" },
              "{{ Nodes }}"
            ],
            "route": "{{ Route }}"
          }`,
          { status: 200 },
        );
      }
      return originalFetch(input as RequestInfo, init);
    };
    const request = new Request(
      `https://example.com/convert?device=pc&version=1.13.7&raw=${encodeURIComponent(rawContent)}&template=${encodeURIComponent("builtin:manual")}`,
    );

    try {
      const response = await worker.fetch(request, {});
      const data = (await response.json()) as {
        outbounds?: Array<{ tag: string; type: string }>;
        error?: string;
      };

      expect(response.status).toBe(200);
      expect(response.headers.get("x-template-mode")).toBe("builtin");
      expect(response.headers.get("x-template-id")).toBe("online_noauto");
      expect(data.outbounds?.some((item) => item.tag === "HK-SS")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("builds sing-box route from ACL4SSR remote config", async () => {
    const rawContent = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_NoAuto.ini") {
        return new Response(
          `[custom]
ruleset=🚀 节点选择,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Telegram.list
ruleset=🎯 全球直连,[]GEOIP,CN
ruleset=🐟 漏网之鱼,[]FINAL
custom_proxy_group=🚀 节点选择\`select\`[]DIRECT\`.*
custom_proxy_group=🎯 全球直连\`select\`[]DIRECT\`[]🚀 节点选择
custom_proxy_group=🐟 漏网之鱼\`select\`[]🚀 节点选择\`[]🎯 全球直连\`.*
enable_rule_generator=true
overwrite_original_rules=true`,
          { status: 200 },
        );
      }
      if (url === "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Telegram.list") {
        return new Response(
          `DOMAIN-SUFFIX,telegram.org
IP-CIDR,91.108.0.0/16,no-resolve`,
          { status: 200 },
        );
      }
      return originalFetch(input as RequestInfo, init);
    };

    try {
      const request = new Request(
        `https://example.com/convert?device=pc&version=1.13.7&raw=${encodeURIComponent(rawContent)}&template=${encodeURIComponent("builtin:manual")}`,
      );
      const response = await worker.fetch(request, {});
      const data = (await response.json()) as {
        outbounds: Array<{ tag: string; type: string }>;
        route: { rules: Array<Record<string, unknown>>; final: string };
      };

      expect(response.status).toBe(200);
      expect(data.outbounds.some((item) => item.tag === "🚀 节点选择" && item.type === "selector")).toBe(
        true,
      );
      expect(data.route.final).toBe("🐟 漏网之鱼");
      expect(
        data.route.rules.some(
          (rule) =>
            Array.isArray(rule.domain_suffix) &&
            rule.domain_suffix.includes("telegram.org") &&
            rule.outbound === "🚀 节点选择",
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns template recommendations for current profile", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/templates?device=pc&version=1.13.7"),
      {},
    );
    const data = (await response.json()) as {
      recommendation: {
        primary_template_id: string;
        alternative_template_ids: string[];
      };
      current_profile: {
        device: string;
        channel: string;
      };
    };

    expect(response.status).toBe(200);
    expect(data.current_profile).toEqual({
      device: "pc",
      channel: "modern",
    });
    expect(data.recommendation.primary_template_id).toBe("online_noauto");
    expect(data.recommendation.alternative_template_ids).toContain("online_mini_fallback");
  });

  it("returns builtin template detail by id again", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/templates/manual?device=pc&version=1.13.7"),
      {},
    );
    const data = (await response.json()) as {
      template: {
        id: string;
        template_url?: string;
        fallback_template_text?: string;
        recommended_for_current_profile?: boolean;
        recommendation_rank?: number;
      };
    };

    expect(response.status).toBe(200);
    expect(data.template.id).toBe("online_noauto");
    expect(typeof data.template.template_url).toBe("string");
    expect(typeof data.template.fallback_template_text).toBe("string");
    expect(data.template.recommended_for_current_profile).toBe(true);
    expect(data.template.recommendation_rank).toBe(1);
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
      if (url.includes("ACL4SSR_Online.ini")) {
        return new Response(
          `[custom]
custom_proxy_group=P\`select\`[]DIRECT\`.*
ruleset=P,[]FINAL`,
          { status: 200 },
        );
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
      if (url.includes("ACL4SSR_Online.ini")) {
        return new Response(
          `[custom]
custom_proxy_group=P\`select\`[]DIRECT\`.*
ruleset=P,[]FINAL`,
          { status: 200 },
        );
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
      if (requestUrl.includes("ACL4SSR_Online.ini")) {
        return new Response(
          `[custom]
custom_proxy_group=P\`select\`[]DIRECT\`.*
ruleset=P,[]FINAL`,
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

import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";

class MockKVNamespace {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cache behavior", () => {
  it("returns debug cache policy", async () => {
    const request = new Request("https://example.com/debug/cache-policy");
    const response = await worker.fetch(request, {
      CACHE_KV: new MockKVNamespace(),
    });
    const data = (await response.json()) as {
      policy: {
        subscription_cache_ttl: number;
        template_cache_ttl: number;
        result_cache_ttl: number;
      };
    };

    expect(response.status).toBe(200);
    expect(data.policy.subscription_cache_ttl).toBe(600);
    expect(data.policy.template_cache_ttl).toBe(0);
    expect(data.policy.result_cache_ttl).toBe(300);
  });

  it("uses result cache for builtin outputs", async () => {
    const kv = new MockKVNamespace();
    const request = new Request(
      "https://example.com/convert?device=openwrt&version=1.12.0&raw=ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS",
    );

    const first = await worker.fetch(request, { CACHE_KV: kv });
    const second = await worker.fetch(request, { CACHE_KV: kv });
    const body = await second.text();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache-result")).toBe("hit");
    expect(body).toContain("ss-1.2.3.4");
  });

  it("uses stale subscription cache on upstream failure", async () => {
    const kv = new MockKVNamespace();
    const subscriptionUrl = "https://example.com/sub.txt";
    const originalFetch = globalThis.fetch;
    let firstRequest = true;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === subscriptionUrl) {
        if (firstRequest) {
          firstRequest = false;
          return new Response(
            "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS",
            { status: 200 },
          );
        }
        return new Response("upstream error", { status: 500 });
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;

    try {
      const first = await worker.fetch(
        new Request(
          `https://example.com/convert?device=openwrt&version=1.12.0&url=${encodeURIComponent(subscriptionUrl)}`,
        ),
        { CACHE_KV: kv },
      );
      const second = await worker.fetch(
        new Request(
          `https://example.com/convert?device=openwrt&version=1.12.0&url=${encodeURIComponent(subscriptionUrl)}&refresh=1`,
        ),
        { CACHE_KV: kv },
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.headers.get("x-cache-subscription")).toContain("cache-stale");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not result-cache remote template mode", async () => {
    const kv = new MockKVNamespace();
    const templateUrl = "https://template.example/config.json";
    const originalFetch = globalThis.fetch;
    let requestCount = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === templateUrl) {
        requestCount += 1;
        return new Response(
          `{"outbounds":"{{ Nodes }}","meta":{"count":"{{ NodeCount }}"}}`,
          { status: 200 },
        );
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;

    try {
      const raw = encodeURIComponent(
        "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:443#HK-SS",
      );
      const request = new Request(
        `https://example.com/convert?device=pc&version=1.13.7&raw=${raw}&template_url=${encodeURIComponent(templateUrl)}`,
      );
      const first = await worker.fetch(request, { CACHE_KV: kv });
      const second = await worker.fetch(request, { CACHE_KV: kv });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(requestCount).toBe(2);
      expect(second.headers.get("x-template-mode")).toBe("remote");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

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
  });

  it("protects /convert when ACCESS_PASSWORD is configured", async () => {
    const request = new Request("https://example.com/convert?device=ios&version=1.12.0&raw=ss://abc");
    const response = await worker.fetch(request, { ACCESS_PASSWORD: "secret" });

    expect(response.status).toBe(401);
  });
});

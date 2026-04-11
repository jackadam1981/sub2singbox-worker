import { describe, expect, it } from "vitest";

import { buildRenderContext } from "../src/lib/config";
import { resolveProfile } from "../src/lib/profiles";
import { renderTemplate } from "../src/lib/template";
import type { JsonValue } from "../src/lib/types";

describe("template renderer", () => {
  it("injects nodes and tags into template placeholders", () => {
    const text = `{
      "inbounds": "{{ Inbounds }}",
      "outbounds": "{{ AllOutbounds }}",
      "meta": {
        "profile": "{{ ProfileId }}",
        "count": "{{ NodeCount }}"
      },
      "experimental": "{{ Experimental }}"
    }`;

    const profile = resolveProfile("openwrt", "1.12.0");
    const nodes = [
      {
        type: "shadowsocks",
        tag: "HK",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "pass",
      },
    ];

    const rendered = renderTemplate(text, buildRenderContext(profile, nodes));

    const outbounds = rendered.outbounds as JsonValue[];
    expect(outbounds).toHaveLength(5);
    expect((rendered.meta as { profile: string; count: number }).profile).toBe("openwrt-modern");
    expect((rendered.meta as { profile: string; count: number }).count).toBe(1);
    expect((outbounds[4] as { tag: string }).tag).toBe("HK");
  });

  it("supports filtered node tags and generated groups", () => {
    const text = `{
      "outbounds": [
        "{{ Group(tag=HK, type=selector, filter=香港|HK, append=direct) }}",
        "{{ UrlTest(tag=AutoHK, filter=香港|HK, url=https://www.gstatic.com/generate_204) }}",
        "{{ Nodes(filter=香港|HK) }}",
        { "type": "direct", "tag": "direct" }
      ],
      "meta": {
        "hk_tags": "{{ NodeTags(filter=香港|HK) }}",
        "us_tags": "{{ NodeTags(filter=美国|US) }}"
      }
    }`;

    const profile = resolveProfile("pc", "1.13.7");
    const nodes = [
      {
        type: "shadowsocks",
        tag: "香港-HK-1",
        server: "1.1.1.1",
        server_port: 443,
        method: "aes-256-gcm",
        password: "pass",
      },
      {
        type: "shadowsocks",
        tag: "美国-US-1",
        server: "2.2.2.2",
        server_port: 443,
        method: "aes-256-gcm",
        password: "pass",
      },
    ];

    const rendered = renderTemplate(text, buildRenderContext(profile, nodes));
    const outbounds = rendered.outbounds as Array<Record<string, unknown>>;

    expect(outbounds).toHaveLength(4);
    expect(outbounds[0]).toMatchObject({
      type: "selector",
      tag: "HK",
      outbounds: ["香港-HK-1", "direct"],
    });
    expect(outbounds[1]).toMatchObject({
      type: "urltest",
      tag: "AutoHK",
      outbounds: ["香港-HK-1"],
    });
    expect(outbounds[2]).toMatchObject({
      type: "shadowsocks",
      tag: "香港-HK-1",
    });
    expect(rendered.meta).toEqual({
      hk_tags: ["香港-HK-1"],
      us_tags: ["美国-US-1"],
    });
  });
});

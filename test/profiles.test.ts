import { describe, expect, it } from "vitest";

import { getVersionChannel, resolveProfile } from "../src/lib/profiles";

describe("profile resolution", () => {
  it("maps 1.11 to legacy", () => {
    expect(getVersionChannel("1.11.7")).toBe("legacy");
    expect(resolveProfile("ios", "1.11.7").id).toBe("ios-legacy");
  });

  it("maps 1.12 to modern", () => {
    expect(getVersionChannel("1.12.0")).toBe("modern");
    expect(resolveProfile("openwrt", "1.12.0").id).toBe("openwrt-modern");
  });

  it("normalizes common device aliases", () => {
    expect(resolveProfile("windows", "1.12.3").id).toBe("pc-modern");
    expect(resolveProfile("router", "1.11.3").id).toBe("openwrt-legacy");
  });
});

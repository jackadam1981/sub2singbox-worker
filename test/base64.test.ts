import { describe, expect, it } from "vitest";

import { decodeRawSubscriptionBase64 } from "../src/lib/base64";

describe("decodeRawSubscriptionBase64", () => {
  it("decodes single blob with PEM-style line breaks", () => {
    const plain = "ss://YWVzLTEyOC1nY206dGVzdA==@1.1.1.1:8388#n";
    const b64 = Buffer.from(plain, "utf-8").toString("base64");
    const wrapped = b64.replace(/(.{12})/g, "$1\n").trim();

    const decoded = decodeRawSubscriptionBase64(wrapped);
    expect(decoded).toBe(plain);
  });

  it("decodes multiple lines each with own base64 padding", () => {
    const a = Buffer.from("Hello", "utf-8").toString("base64");
    const b = Buffer.from("World", "utf-8").toString("base64");
    const decoded = decodeRawSubscriptionBase64(`${a}\n${b}`);
    expect(decoded).toBe("Hello\nWorld");
  });

  it("decodes single-line concatenation of padded base64 chunks", () => {
    const a = Buffer.from("Hello", "utf-8").toString("base64");
    const b = Buffer.from("World", "utf-8").toString("base64");
    const decoded = decodeRawSubscriptionBase64(`${a}${b}`);
    expect(decoded).toBe("HelloWorld");
  });

  it("returns null for invalid input", () => {
    expect(decodeRawSubscriptionBase64("not-base64!!!")).toBeNull();
  });
});

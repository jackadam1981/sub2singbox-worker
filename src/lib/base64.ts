const BASE64_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

function normalizeBase64(input: string): string {
  const compact = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  return compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
}

export function looksLikeBase64(input: string): boolean {
  const compact = input.replace(/\s+/g, "");
  return compact.length > 0 && compact.length % 4 !== 1 && BASE64_PATTERN.test(compact);
}

export function decodeBase64(input: string): string {
  const normalized = normalizeBase64(input);

  if (typeof Buffer !== "undefined") {
    return Buffer.from(normalized, "base64").toString("utf-8");
  }

  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function tryDecodeBase64(input: string): string | null {
  if (!looksLikeBase64(input)) {
    return null;
  }

  try {
    return decodeBase64(input);
  } catch {
    return null;
  }
}

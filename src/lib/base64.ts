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

/** 去掉空白后的紧凑串里，是否存在「padding = 之后仍跟 base64 主体」——多为多段独立 Base64 拼在一行。 */
function hasConcatenatedBase64Runs(compact: string): boolean {
  return /=+[A-Za-z0-9+/]/.test(compact);
}

function tryDecodeBase64Chunks(chunks: string[], joiner: string): string | null {
  const parts: string[] = [];
  for (const c of chunks) {
    const d = tryDecodeBase64(c);
    if (d === null) return null;
    parts.push(d);
  }
  return parts.join(joiner);
}

/**
 * 订阅 raw + raw_base64=1 的解码：支持整段（可含换行/空格等空白）、多行各自带 padding 的 Base64，
 * 以及单行内多段 `...=` + `...=` 拼接。
 */
export function decodeRawSubscriptionBase64(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const multiRun = hasConcatenatedBase64Runs(compact);

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (multiRun) {
    if (lines.length >= 2) {
      return tryDecodeBase64Chunks(lines, "\n");
    }
    if (lines.length === 1) {
      const chunks = lines[0].split(/(?<==)(?=[A-Za-z0-9+/])/);
      if (chunks.length >= 2) {
        return tryDecodeBase64Chunks(chunks, "");
      }
    }
  }

  return tryDecodeBase64(trimmed);
}

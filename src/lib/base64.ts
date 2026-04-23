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

  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeBase64ToUtf8Strict(normalized: string): string {
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

/**
 * Decode "subscription-style" base64 blobs that may contain line breaks, or multiple
 * base64 chunks concatenated on one line (each chunk typically ends with '=' padding).
 */
export function decodeRawSubscriptionBase64(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const tryDecodeUtf8 = (b64: string): string | null => {
    if (!looksLikeBase64(b64)) {
      return null;
    }
    try {
      const normalized = normalizeBase64(b64);
      return decodeBase64ToUtf8Strict(normalized);
    } catch {
      return null;
    }
  };

  const isPlausibleDecodedText = (text: string): boolean => {
    if (!text) {
      return false;
    }

    // Heuristic: PEM-wrapped single base64 blobs often decode into garbled multi-line
    // strings when split incorrectly. Real subscription text is mostly printable.
    let printable = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 9 || code === 10 || code === 13) {
        printable += 1;
        continue;
      }
      if (code >= 32 && code <= 126) {
        printable += 1;
      }
    }

    if (printable / text.length < 0.85) {
      return false;
    }

    // If it looks like a URI scheme, don't allow newlines to break the scheme/host portion.
    const schemeMatch = text.match(/^[a-z][a-z0-9+.-]*:\/\//i);
    if (schemeMatch) {
      const prefix = text.slice(0, Math.min(text.length, 256));
      if (prefix.includes("\n")) {
        return false;
      }
    }

    return true;
  };

  const splitConcatenatedBase64 = (value: string): string[] | null => {
    if (value.length % 4 !== 0) {
      return null;
    }

    for (let len = 4; len <= value.length - 4; len += 4) {
      const head = value.slice(0, len);
      const tail = value.slice(len);
      const decodedHead = tryDecodeUtf8(head);
      if (!decodedHead) {
        continue;
      }

      const tailParts = splitConcatenatedBase64(tail);
      if (!tailParts) {
        continue;
      }

      return [decodedHead, ...tailParts];
    }

    const whole = tryDecodeUtf8(value);
    if (whole) {
      return [whole];
    }

    return null;
  };

  if (/\r?\n/.test(trimmed)) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, "").trim())
      .filter(Boolean);

    const parts: string[] = [];
    for (const line of lines) {
      const decodedLine = tryDecodeUtf8(line);
      if (!decodedLine) {
        return null;
      }
      parts.push(decodedLine);
    }
    const joined = parts.join("\n");
    if (isPlausibleDecodedText(joined)) {
      return joined;
    }
  }

  const compactAll = trimmed.replace(/\s+/g, "");
  const singleBlob = tryDecodeUtf8(compactAll);
  if (singleBlob) {
    return singleBlob;
  }

  const concatenated = splitConcatenatedBase64(compactAll);
  if (concatenated) {
    return concatenated.join("");
  }

  return null;
}

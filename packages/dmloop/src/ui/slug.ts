const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function normalizeBase(text: string): string {
  // 34 (not 40) leaves room for the "-xxxx" random suffix within the slug cap.
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34);
}

/** 4-char [a-z0-9] random suffix via WebCrypto (no dependency). */
export function slugSuffix(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

export function withRandomSuffix(text: string, suffix: string): string {
  // "ws" fallback keeps names that normalize to nothing (e.g. emoji-only, or CJK
  // with no pinyin mapping) valid and zero-input. Result always matches the
  // backend slug regex ^[a-z0-9]+(?:-[a-z0-9]+)*$ (octo-multica workspace.go).
  return `${normalizeBase(text) || "ws"}-${suffix}`;
}

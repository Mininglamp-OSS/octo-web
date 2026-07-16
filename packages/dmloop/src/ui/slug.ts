const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function normalizeBase(text: string): string {
  // 34 (not 40) leaves room for the "-xxxx" random suffix within the slug cap.
  // Re-strip a trailing dash AFTER truncation: slice(34) can land on a dash and
  // would otherwise yield "base-" → "base--suffix", breaking the backend regex.
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/, "");
}

/** 4-char [a-z0-9] random suffix via WebCrypto (no dependency). */
export function slugSuffix(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

export function withRandomSuffix(text: string, suffix: string): string {
  // "ws" fallback keeps names that normalize to nothing (emoji-only / unmapped CJK)
  // valid + zero-input; result always matches the backend regex ^[a-z0-9]+(?:-[a-z0-9]+)*$.
  return `${normalizeBase(text) || "ws"}-${suffix}`;
}

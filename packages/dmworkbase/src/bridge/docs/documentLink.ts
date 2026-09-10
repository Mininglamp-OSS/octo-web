export interface ValidatedDocsDocument {
  docId: string;
  url: string;
}

/** Normalize trusted configuration, never a document URL supplied by an error. */
export function normalizeDocsOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) ||
        url.username || url.password || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Return a canonical absolute link; fail closed without an independent origin. */
export function validateDocsDocumentLink(
  value: unknown,
  trustedOrigin: string,
  allowRelative = false,
): ValidatedDocsDocument | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { docId, url } = value as Record<string, unknown>;
  if (typeof docId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(docId) ||
      typeof url !== "string") return undefined;
  const origin = normalizeDocsOrigin(trustedOrigin);
  if (!origin) return undefined;
  const path = `/d/${docId}`;
  const canonical = `${origin}${path}`;
  if (url !== canonical && !(allowRelative && url === path)) return undefined;
  return { docId, url: canonical };
}

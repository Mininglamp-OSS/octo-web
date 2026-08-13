export interface CookieLike {
  name: string;
  domain?: string;
  path?: string;
  secure?: boolean;
}

export interface SessionLike {
  cookies: {
    get(filter: { url?: string; domain?: string }): Promise<CookieLike[]>;
    remove(url: string, name: string): Promise<void>;
  };
  clearAuthCache(): Promise<void>;
}

export type ClearAuthSessionResult =
  | { ok: true; cleared: number; partial?: true }
  | { ok: false; code: "internal-error" };

function removalUrl(cookie: CookieLike): string | undefined {
  if (!cookie.domain) return undefined;
  const domain = cookie.domain.replace(/^\./, "");
  if (!domain) return undefined;
  try {
    return new URL(`${cookie.secure ? "https" : "http"}://${domain}${cookie.path || "/"}`).toString();
  } catch {
    return undefined;
  }
}

function parseOrigin(value: string): { origin: string; hostname: string } | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return { origin: url.origin, hostname: url.hostname };
  } catch {
    return undefined;
  }
}

export async function clearAuthSessionCookies(params: {
  session: SessionLike;
  origins: Iterable<string>;
  log: { warn(message: string): void };
}): Promise<ClearAuthSessionResult> {
  try {
    const targets = new Map<string, string>();
    Array.from(params.origins).forEach((value) => {
      const parsed = parseOrigin(value);
      if (parsed) targets.set(parsed.origin, parsed.hostname);
    });

    let cleared = 0;
    let partial = false;
    const entries = Array.from(targets.entries());
    for (let i = 0; i < entries.length; i += 1) {
      const [origin, hostname] = entries[i];
      try {
        const cookies = [
          ...(await params.session.cookies.get({ url: origin })),
          ...(await params.session.cookies.get({ domain: hostname })),
        ];
        const seen = new Set<string>();
        for (let j = 0; j < cookies.length; j += 1) {
          const cookie = cookies[j];
          const key = `${cookie.name}\0${cookie.domain || ""}\0${cookie.path || ""}`;
          const url = removalUrl(cookie);
          if (seen.has(key) || !url) continue;
          seen.add(key);
          await params.session.cookies.remove(url, cookie.name);
          cleared += 1;
        }
      } catch (error) {
        partial = true;
        params.log.warn(`clearAuthSession: cookie sweep failed for ${origin}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    try {
      await params.session.clearAuthCache();
    } catch (error) {
      partial = true;
      params.log.warn(`clearAuthSession: clearAuthCache failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    return partial ? { ok: true, cleared, partial: true } : { ok: true, cleared };
  } catch (error) {
    params.log.warn(`clearAuthSession: unexpected failure: ${error instanceof Error ? error.message : "unknown error"}`);
    return { ok: false, code: "internal-error" };
  }
}

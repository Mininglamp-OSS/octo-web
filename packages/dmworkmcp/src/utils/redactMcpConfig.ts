/** Mask literal secret values in an mcp.json for read-only display.
 *
 * The unified backend has NO secret scanner (it was deliberately removed), and a
 * plugin's `mcp.json` is rendered to every viewer of its detail — including on a
 * `public` / `system` plugin readable by any authenticated caller. A hand-written
 * literal credential would therefore be exposed. This masks the secret-carrying
 * values while keeping the surrounding keys/structure so a viewer still sees which
 * variables the server needs. It is a display-only guard; the owner's edit/copy
 * flow reads the raw config.
 *
 * Coverage: `env` / `headers` values, a URL's query params + userinfo, and stdio
 * `args`. Values that are an EXACT `${KEY}` placeholder are kept (they are the
 * authored fill-in slots, not secrets); a value that merely CONTAINS `${…}`
 * (e.g. `sk-live-abc${X}`) is still masked.
 *
 * Fails CLOSED: any input this cannot confidently parse and round-trip (malformed
 * JSON, a non-`mcpServers` shape) returns `null` so the caller can render a
 * localized "unavailable" notice rather than leaking the untrusted original.
 */
const MASK = "••••••";
/** The authoring convention is a WHOLE value equal to `${KEY}`. */
const WHOLE_PLACEHOLDER = /^\$\{[^}]+\}$/;

function isPlaceholder(v: unknown): boolean {
  return typeof v === "string" && WHOLE_PLACEHOLDER.test(v);
}

/** Mask a scalar unless it is an exact placeholder or empty. */
function maskValue(v: unknown): unknown {
  if (typeof v !== "string" || v === "" || isPlaceholder(v)) return v;
  return MASK;
}

/** Keep scheme://host/path visible (the endpoint is not the secret) but blank
 *  every query-param value and any userinfo — the standard place a hosted MCP
 *  server carries a token. Unparseable URLs are masked whole.
 *
 *  Exported for the connector quick-start builder: a connector's `url` is not
 *  covered by the author's user-supplied env/header declaration, so a token in
 *  its query string would otherwise render verbatim on the public detail. */
export function redactUrl(url: string): string {
  if (isPlaceholder(url)) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return MASK;
  }
  if (u.username) u.username = MASK;
  if (u.password) u.password = MASK;
  for (const key of Array.from(u.searchParams.keys())) {
    if (!isPlaceholder(u.searchParams.get(key) ?? "")) u.searchParams.set(key, MASK);
  }
  return u.toString();
}

export function redactMcpConfig(raw: string): string | null {
  if (!raw || !raw.trim()) return raw;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  const servers = (doc as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== "object") {
    return null;
  }
  for (const server of Object.values(servers as Record<string, unknown>)) {
    if (!server || typeof server !== "object") continue;
    const s = server as Record<string, unknown>;
    if (typeof s.url === "string") s.url = redactUrl(s.url);
    // A stdio arg that is not a flag (does not start with "-") is a positional
    // value that may carry a token/secret — mask it; flags stay visible.
    if (Array.isArray(s.args)) {
      s.args = s.args.map((a) =>
        typeof a === "string" && !a.startsWith("-") ? maskValue(a) : a
      );
    }
    for (const field of ["env", "headers"] as const) {
      const map = s[field];
      if (!map || typeof map !== "object") continue;
      for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
        (map as Record<string, unknown>)[k] = maskValue(v);
      }
    }
  }
  try {
    return JSON.stringify(doc, null, 2);
  } catch {
    return null;
  }
}

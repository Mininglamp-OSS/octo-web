import { isSecretKey } from "./constants";
import { PLACEHOLDER_PATTERN } from "../api/pluginWire";

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
 * Because the config is FREE-FORM hostile input, this is strict-whitelist +
 * fail-CLOSED: it returns `null` (→ caller renders a localized "unavailable"
 * notice) for anything it cannot fully model — malformed JSON, a non-`mcpServers`
 * shape, a non-object server entry, or a server carrying a key outside
 * {@link MODELED_SERVER_KEYS}. Within a modeled server it masks `env`/`headers`
 * values (any non-placeholder, incl. non-string), URL query params + userinfo,
 * and secret-bearing `args` (both `--flag=value` and the value after a
 * secret-named flag). An exact `${KEY}` placeholder is kept; a value that merely
 * contains `${…}` is masked.
 */
const MASK = "••••••";
/** ASCII marker for inside a URL — a Unicode MASK would percent-encode to
 *  mojibake through URL serialization. */
const URL_MASK = "REDACTED";
export const REDACTION_UNAVAILABLE = null;

/** Server-object keys this guard understands. Anything else (a server-level
 *  `token`/`oauth`/`credentials`, an unknown field) makes the whole config fail
 *  closed rather than round-trip an unmodeled — possibly secret — value. */
const MODELED_SERVER_KEYS = new Set([
  "type",
  "transport",
  "url",
  "command",
  "args",
  "env",
  "headers",
  // Structural, non-secret keys common clients add; safe to keep verbatim.
  "cwd",
  "timeout",
  "disabled",
  "description",
  "name",
  "icon",
  "autoApprove",
  "alwaysAllow",
]);

function isPlaceholder(v: unknown): boolean {
  return typeof v === "string" && PLACEHOLDER_PATTERN.test(v);
}

/** Mask a value unless it is an exact placeholder or empty string. A non-string
 *  (number/bool/object/array) is always masked — it can't be shown safely and is
 *  never a legitimate credential slot. */
function maskValue(v: unknown): unknown {
  if (v === "" || isPlaceholder(v)) return v;
  return MASK;
}

/** Keep scheme://host/path visible (the endpoint is not the secret) but blank
 *  EVERY query-param value (rebuilt, so duplicate keys can't slip a second value
 *  through) and any userinfo. Uses an ASCII marker so serialization doesn't
 *  mojibake. A relative/opaque URL keeps its path and only drops a query string;
 *  a value with no query is returned unchanged. */
export function redactUrl(url: string): string {
  if (isPlaceholder(url)) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    // Not absolute — strip only a query string, keep the (endpoint) path.
    const q = url.indexOf("?");
    return q === -1 ? url : `${url.slice(0, q)}?${URL_MASK}`;
  }
  if (u.username) u.username = URL_MASK;
  if (u.password) u.password = URL_MASK;
  if (u.search) {
    const masked = Array.from(u.searchParams.keys())
      .map((k) => `${encodeURIComponent(k)}=${URL_MASK}`)
      .join("&");
    u.search = masked ? `?${masked}` : "";
  }
  return u.toString();
}

/** Redact secret-bearing args while keeping flags and positionals (a package
 *  name / path is informational, not a secret). Covers `--flag=value` (mask the
 *  RHS) and the value token immediately after a secret-named flag. */
function redactArgs(args: unknown[]): unknown[] {
  const out: unknown[] = [];
  let maskNext = false;
  for (const a of args) {
    if (typeof a !== "string") {
      out.push(MASK);
      maskNext = false;
      continue;
    }
    if (maskNext) {
      out.push(isPlaceholder(a) ? a : MASK);
      maskNext = false;
      continue;
    }
    const inline = a.match(/^(--?[A-Za-z0-9_.-]+)=(.*)$/);
    if (inline) {
      const [, flag, val] = inline;
      out.push(isPlaceholder(val) || val === "" ? a : `${flag}=${MASK}`);
      continue;
    }
    if (/^--?[A-Za-z0-9_.-]+$/.test(a)) {
      // A bare flag; mask the following token only if the flag names a secret.
      maskNext = isSecretKey(a.replace(/^--?/, ""));
      out.push(a);
      continue;
    }
    // Bare positional (package name, path, subcommand) — informational, keep.
    out.push(a);
  }
  return out;
}

export function redactMcpConfig(raw: string): string | null {
  if (!raw || !raw.trim()) return raw;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return REDACTION_UNAVAILABLE;
  }
  const servers = (doc as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return REDACTION_UNAVAILABLE;
  }
  for (const server of Object.values(servers as Record<string, unknown>)) {
    // A non-object server entry is unmodeled — fail closed rather than
    // re-serialize it (e.g. a bare string could be a raw credential).
    if (!server || typeof server !== "object" || Array.isArray(server)) {
      return REDACTION_UNAVAILABLE;
    }
    const s = server as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      if (!MODELED_SERVER_KEYS.has(key)) return REDACTION_UNAVAILABLE;
    }
    if (typeof s.url === "string") s.url = redactUrl(s.url);
    if (Array.isArray(s.args)) s.args = redactArgs(s.args);
    for (const field of ["env", "headers"] as const) {
      const map = s[field];
      if (!map || typeof map !== "object" || Array.isArray(map)) {
        // A present-but-non-object env/headers is unmodeled → fail closed.
        if (map !== undefined) return REDACTION_UNAVAILABLE;
        continue;
      }
      for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
        (map as Record<string, unknown>)[k] = maskValue(v);
      }
    }
  }
  try {
    return JSON.stringify(doc, null, 2);
  } catch {
    return REDACTION_UNAVAILABLE;
  }
}

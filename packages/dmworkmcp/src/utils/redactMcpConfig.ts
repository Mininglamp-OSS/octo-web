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
 * Because the config is FREE-FORM hostile input, the output is REBUILT from a
 * whitelist rather than mutating and re-serializing the parsed document — so a
 * root sibling key (VS Code's `inputs`, a stray `secrets`, …) or an unmodeled /
 * wrong-typed server field can never survive verbatim. It returns `null`
 * (→ caller renders a localized "unavailable" notice) for structurally unmodelable
 * input: malformed JSON, a missing/invalid `mcpServers`, or a non-object server
 * entry. Within each server only known fields are re-emitted: `env`/`headers`
 * values are masked (any non-placeholder, incl. non-string), the URL's query +
 * userinfo + fragment are masked, `args` are redacted, and structural fields
 * (`command`, `type`, `cwd`, …) are copied verbatim only when correctly typed.
 * An exact `${KEY}` placeholder is kept; a value that merely contains `${…}` is
 * masked.
 *
 * Documented residuals (display-only `<pre>`, org-scoped visibility): a secret
 * embedded in a `command` shell one-liner or a URL path segment is kept, same
 * accepted posture as "the endpoint is not the secret".
 */
const MASK = "••••••";
/** ASCII marker for inside a URL — a Unicode MASK would percent-encode to
 *  mojibake through URL serialization. */
const URL_MASK = "REDACTED";

/** Structural server fields copied verbatim when correctly typed. These are the
 *  executable / endpoint / behavioural fields, not credential carriers (a secret
 *  hand-embedded in `command` is a documented residual). */
const STRING_FIELDS = ["type", "transport", "command", "cwd"] as const;

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
 *  through), the fragment, and any userinfo. Uses an ASCII marker so serialization
 *  doesn't mojibake. A relative / protocol-relative URL is handled by the same
 *  rules on the string-fallback path, so userinfo and fragment are masked there
 *  too; a value with no query/userinfo/fragment is returned unchanged. */
export function redactUrl(url: string): string {
  if (isPlaceholder(url)) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    // Not an absolute URL (relative `/x` or protocol-relative `//user:pw@h`):
    // mask userinfo, query, and fragment via string ops so the same parts the
    // absolute branch masks don't survive here.
    let rest = url;
    let frag = "";
    const h = rest.indexOf("#");
    if (h !== -1) {
      frag = `#${URL_MASK}`;
      rest = rest.slice(0, h);
    }
    const q = rest.indexOf("?");
    if (q !== -1) rest = `${rest.slice(0, q)}?${URL_MASK}`;
    // Protocol-relative userinfo: //user:pass@host → //REDACTED@host.
    rest = rest.replace(/^(\/\/)[^/@?#]*@/, `$1${URL_MASK}@`);
    return rest + frag;
  }
  if (u.username) u.username = URL_MASK;
  if (u.password) u.password = URL_MASK;
  if (u.search) {
    const masked = Array.from(u.searchParams.keys())
      .map((k) => `${encodeURIComponent(k)}=${URL_MASK}`)
      .join("&");
    u.search = masked ? `?${masked}` : "";
  }
  if (u.hash) u.hash = `#${URL_MASK}`;
  return u.toString();
}

/** A positional arg only goes through redactUrl when it actually looks like a
 *  URL (has a scheme, is protocol-relative, or carries a query) — otherwise
 *  `new URL()` mis-parses shapes like `Authorization: Bearer x` (scheme
 *  `authorization:`) and mutates them. */
function hasUrlShape(a: string): boolean {
  return /:\/\//.test(a) || a.startsWith("//") || a.includes("?");
}

/** Flags whose following token is a header/env injection carrying a value
 *  (`--header "Authorization: …"`, `-e API_KEY=…`) — the flag name itself isn't
 *  secret-shaped, so mask the value that follows it. */
const VALUE_INJECT_FLAGS = new Set(["--header", "-H", "--headers", "--env", "-e"]);

/** Redact secret-bearing args while keeping flags and non-secret positionals (a
 *  package name / path is informational). Covers `--flag=value` and secret
 *  `KEY=value` (mask the RHS), the value token after a secret-named or
 *  header/env-injecting flag, and a URL-shaped positional (mask its query). */
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
    const inline = a.match(/^(-{0,2}[A-Za-z0-9_.-]+)=(.*)$/);
    if (inline) {
      const [, key, val] = inline;
      // A dashed flag (`--api-key=…`) always masks its value; a bare `KEY=value`
      // only when the KEY names a secret (so `FOO=bar` / `--rm` stay readable).
      const shouldMask = key.startsWith("-") || isSecretKey(key);
      out.push(shouldMask && val !== "" && !isPlaceholder(val) ? `${key}=${MASK}` : a);
      continue;
    }
    if (/^--?[A-Za-z0-9_.-]+$/.test(a)) {
      // A bare flag; mask the following token when the flag names a secret or
      // injects a header/env value.
      maskNext = isSecretKey(a.replace(/^--?/, "")) || VALUE_INJECT_FLAGS.has(a);
      out.push(a);
      continue;
    }
    // Bare positional — only URL-shaped values get query/userinfo masking.
    out.push(hasUrlShape(a) ? redactUrl(a) : a);
  }
  return out;
}

/** Rebuild one server object from known fields only — nothing else is copied. */
function redactServer(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of STRING_FIELDS) {
    if (typeof s[k] === "string") out[k] = s[k];
  }
  if (typeof s.disabled === "boolean") out.disabled = s.disabled;
  if (typeof s.timeout === "number") out.timeout = s.timeout;
  if (typeof s.url === "string") out.url = redactUrl(s.url);
  if (Array.isArray(s.args)) out.args = redactArgs(s.args);
  // Tool allow-lists are arrays of tool names; keep only the string members so a
  // `{token: …}` object hidden under the key can't ride through.
  for (const k of ["autoApprove", "alwaysAllow"] as const) {
    if (Array.isArray(s[k])) {
      out[k] = (s[k] as unknown[]).filter((x) => typeof x === "string");
    }
  }
  for (const field of ["env", "headers"] as const) {
    const map = s[field];
    if (map && typeof map === "object" && !Array.isArray(map)) {
      const masked: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
        masked[k] = maskValue(v);
      }
      out[field] = masked;
    }
  }
  return out;
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
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return null;
  }
  // Rebuild a fresh document; only mcpServers (and only known server fields) is
  // re-emitted, so any root sibling or unmodeled field is dropped, not leaked.
  const outServers: Record<string, unknown> = {};
  for (const [key, server] of Object.entries(servers as Record<string, unknown>)) {
    // A non-object server entry is unmodelable — fail closed rather than guess.
    if (!server || typeof server !== "object" || Array.isArray(server)) {
      return null;
    }
    outServers[key] = redactServer(server as Record<string, unknown>);
  }
  try {
    return JSON.stringify({ mcpServers: outServers }, null, 2);
  } catch {
    return null;
  }
}

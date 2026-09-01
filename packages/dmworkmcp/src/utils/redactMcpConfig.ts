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

/** Turns a detected secret occurrence into its display form. The expert spec
 *  uses an opaque marker (`••••••` / `REDACTED`); the connector copy-paste
 *  snippet uses a fillable `${KEY}` placeholder keyed on the `hint` (param /
 *  flag / header name) so the snippet stays usable. */
export type SecretMask = (hint: string) => string;

const OPAQUE_VALUE: SecretMask = () => MASK;
const OPAQUE_URL: SecretMask = () => URL_MASK;

/** Keep scheme://host/path visible (the endpoint is not the secret) but mask
 *  userinfo, EVERY query-param value (an exact `${KEY}` placeholder is kept), and
 *  the fragment. Pure string ops so an arbitrary mask token (including a Unicode
 *  placeholder) round-trips without URL-encoding into mojibake, and so relative /
 *  protocol-relative URLs get the same depth as absolute ones. */
export function redactUrlDeep(url: string, mask: SecretMask): string {
  if (!url || isPlaceholder(url)) return url;
  let s = url;
  let frag = "";
  const h = s.indexOf("#");
  if (h !== -1) {
    frag = s.length > h + 1 ? `#${mask("fragment")}` : s.slice(h);
    s = s.slice(0, h);
  }
  s = s.replace(/([?&])([^=&#]+)=([^&#]*)/g, (whole, sep: string, rawKey: string, val: string) => {
    let decoded = val;
    try {
      decoded = decodeURIComponent(val);
    } catch {
      /* keep raw */
    }
    if (isPlaceholder(decoded)) return whole;
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      /* keep raw */
    }
    return `${sep}${rawKey}=${mask(key)}`;
  });
  // Userinfo: scheme://user:pass@host or protocol-relative //user:pass@host.
  s = s.replace(
    /^([a-z][a-z0-9+.-]*:\/\/|\/\/)([^/@?#]*)@/i,
    (_w, scheme: string) => `${scheme}${mask("userinfo")}@`
  );
  return s + frag;
}

/** Opaque-marker URL redaction for the expert spec surface. */
export function redactUrl(url: string): string {
  return redactUrlDeep(url, OPAQUE_URL);
}

/** A positional arg only goes through redactUrlDeep when it actually looks like a
 *  URL (has a scheme, is protocol-relative, or carries a query) — otherwise a
 *  colon-bearing token like `Authorization: Bearer x` would be treated as a URL. */
function hasUrlShape(a: string): boolean {
  return /:\/\//.test(a) || a.startsWith("//") || a.includes("?");
}

/** Flags whose following token is a header/env injection carrying a value
 *  (`--header "Authorization: …"`, `-e API_KEY=…`) — the flag name itself isn't
 *  secret-shaped, so mask the value that follows it. */
const VALUE_INJECT_FLAGS = new Set(["--header", "-H", "--headers", "--env", "-e"]);

/** `Header: value` shape (mask the value, keep the header name). */
const HEADER_PAIR = /^([A-Za-z][A-Za-z0-9-]*): ?(.+)$/;

/** Redact secret-bearing args while keeping flags and non-secret positionals (a
 *  package name / path is informational). `mask` selects the display form. */
export function redactArgs(args: unknown[], mask: SecretMask): unknown[] {
  const out: unknown[] = [];
  let maskNext = false;
  let maskHint = "value";
  for (const a of args) {
    if (typeof a !== "string") {
      out.push(mask("value"));
      maskNext = false;
      continue;
    }
    if (maskNext) {
      maskNext = false;
      if (isPlaceholder(a)) {
        out.push(a);
        continue;
      }
      // `-e API_KEY=…` → keep the key, mask the value.
      const kv = a.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
      if (kv && kv[2] !== "" && !isPlaceholder(kv[2])) {
        out.push(`${kv[1]}=${mask(kv[1])}`);
        continue;
      }
      // `--header "Authorization: Bearer …"` → keep the header name, mask value.
      const hp = a.match(HEADER_PAIR);
      if (hp) {
        out.push(`${hp[1]}: ${mask(hp[1])}`);
        continue;
      }
      out.push(mask(maskHint));
      continue;
    }
    const inline = a.match(/^(-{0,2}[A-Za-z0-9_.-]+)=(.*)$/);
    if (inline) {
      const [, key, val] = inline;
      // A dashed flag (`--api-key=…`) always masks its value; a bare `KEY=value`
      // only when the KEY names a secret (so `FOO=bar` / `--rm` stay readable).
      const shouldMask = key.startsWith("-") || isSecretKey(key);
      out.push(
        shouldMask && val !== "" && !isPlaceholder(val)
          ? `${key}=${mask(key.replace(/^-+/, ""))}`
          : a
      );
      continue;
    }
    // A secret-named `Header: value` positional → mask the value, keep the name;
    // a non-secret colon token (Content-Type: …) falls through unchanged.
    const hp = a.match(HEADER_PAIR);
    if (hp && isSecretKey(hp[1])) {
      out.push(`${hp[1]}: ${mask(hp[1])}`);
      continue;
    }
    if (/^--?[A-Za-z0-9_.-]+$/.test(a)) {
      const name = a.replace(/^--?/, "");
      // Mask the following token when the flag names a secret or injects a value.
      maskNext = isSecretKey(name) || VALUE_INJECT_FLAGS.has(a);
      maskHint = name;
      out.push(a);
      continue;
    }
    // Bare positional — only URL-shaped values get query/userinfo masking.
    out.push(hasUrlShape(a) ? redactUrlDeep(a, mask) : a);
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
  if (typeof s.url === "string") out.url = redactUrlDeep(s.url, OPAQUE_URL);
  if (Array.isArray(s.args)) out.args = redactArgs(s.args, OPAQUE_VALUE);
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

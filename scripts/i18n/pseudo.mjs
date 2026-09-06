/**
 * Pseudo-localization transform for i18n resource strings.
 *
 * Produces an en-XA locale (W3C / Chrome / Android convention) from the
 * en-US source. Three visual signals give the reviewer immediate feedback:
 *
 *   1. Accented substitutions (a-z / A-Z -> á, β, ç, Ä, Ɓ, ...) — proves
 *      the string was routed through the i18n system and is not a
 *      hard-coded English literal.
 *   2. 40 % length padding — the industry default for exposing narrow
 *      containers before they ship (W3C "Text size in translation",
 *      IBM Guidelines to Design Global Solutions).
 *   3. Wrapping brackets — anything that clips reveals truncated layout
 *      without needing a design mock.
 *
 * Interpolation tokens ({{name}}) and single-character atoms are
 * preserved so runtime substitution and small UI atoms stay intact.
 */

const ACCENT_MAP = {
  a: "á", b: "β", c: "ç", d: "δ", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "í",
  j: "ĵ", k: "ķ", l: "ĺ", m: "ɱ", n: "ñ", o: "ö", p: "ρ", q: "ǫ", r: "ŕ",
  s: "š", t: "ţ", u: "ú", v: "ν", w: "ω", x: "ẋ", y: "ý", z: "ž",
  A: "Ä", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Í",
  J: "Ĵ", K: "Ķ", L: "Ĺ", M: "Ɱ", N: "Ñ", O: "Ö", P: "Ρ", Q: "Ǫ", R: "Ŕ",
  S: "Š", T: "Ţ", U: "Ú", V: "Ν", W: "Ω", X: "Ẋ", Y: "Ý", Z: "Ž",
};

const PLACEHOLDER_PATTERN = /\{\{\s*[\w.-]+\s*\}\}/g;
// URL-shaped substrings are preserved verbatim — accenting `https://a.com/x.png`
// yields characters a reviewer eyeballing an en-XA screen cannot tell apart
// from real link corruption. Covers http/https/mailto/tel plus scheme-relative
// (`//host/…`) — the shapes that actually appear in the current locale files.
// A run stops at whitespace or a closing markdown-link paren.
const URL_PATTERN = /(?:https?:\/\/|mailto:|tel:|\/\/)[^\s)]+/g;
const DEFAULT_PADDING_RATIO = 0.4;

// Single-code-point padder so `pad * ratio` matches the documented percentage
// exactly. Middle-dot is visible in narrow containers and never appears in
// real English copy.
const PAD_CHAR = "·";

// Bracket the placeholder index with a printable non-alphabetic marker that
// survives the accent map (which only rewrites ASCII a-zA-Z) and never
// appears in real i18n copy. Chosen over a NUL byte so the source file
// stays plain text and diffs render on GitHub.
const MASK_OPEN = "«";  // «
const MASK_CLOSE = "»"; // »
const MASK_MATCH = /«(\d+)»/g;

export function transformString(input, { paddingRatio = DEFAULT_PADDING_RATIO } = {}) {
  if (typeof input !== "string") return input;
  if (input.length === 0) return input;

  const preserved = [];
  // Mask URLs first so a `{{name}}` inside a URL still masks as a URL, not a
  // placeholder. Both patterns funnel through the same «N» sentinel list.
  const mask = (pattern, text) => text.replace(pattern, (match) => {
    const marker = `${MASK_OPEN}${preserved.length}${MASK_CLOSE}`;
    preserved.push(match);
    return marker;
  });
  const masked = mask(PLACEHOLDER_PATTERN, mask(URL_PATTERN, input));

  const accented = Array.from(masked)
    .map((ch) => (ACCENT_MAP[ch] || ch))
    .join("");

  const restored = accented.replace(MASK_MATCH, (_, index) => preserved[Number(index)]);

  const visibleInput = input.replace(URL_PATTERN, "").replace(PLACEHOLDER_PATTERN, "");
  const visibleLength = Array.from(visibleInput).length;
  const padCount = Math.ceil(visibleLength * paddingRatio);
  const padding = padCount > 0 ? PAD_CHAR.repeat(padCount) : "";

  // Skip bracket + padding for very short atoms (single visible char) — brackets
  // would double the width of a "×" or "?" and produce noise, not signal.
  if (visibleLength <= 1) return restored;

  return `[${restored}${padding}]`;
}

export function transformResource(resource, options) {
  if (Array.isArray(resource)) {
    return resource.map((item) => transformResource(item, options));
  }
  if (resource && typeof resource === "object") {
    const result = {};
    for (const [key, value] of Object.entries(resource)) {
      result[key] = transformResource(value, options);
    }
    return result;
  }
  return transformString(resource, options);
}

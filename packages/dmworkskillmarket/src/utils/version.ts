/**
 * Version-label rules, mirrored from the backend so the form can object before a
 * round trip. The server is still the gate — this only saves the user a 400.
 *
 * A label is exactly three numeric parts (1.0.1) and may only move forward or
 * stay put. Parts are compared NUMERICALLY: 1.10.0 follows 1.9.0, which a string
 * comparison gets backwards.
 */

const VERSION_PATTERN = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;

export function isValidVersion(v: string): boolean {
  return VERSION_PATTERN.test(v.trim());
}

function parts(v: string): number[] | null {
  const trimmed = v.trim();
  if (!VERSION_PATTERN.test(trimmed)) return null;
  return trimmed.split(".").map((n) => Number(n));
}

/**
 * Whether `next` may replace `current`.
 *
 * Unchanged always passes, and an unorderable `current` cannot block anything —
 * both mirror the server, which needs those exemptions so plugins carrying a
 * label minted before the format was tightened stay editable. A malformed `next`
 * is refused regardless.
 */
export function isVersionForward(current: string | undefined, next: string): boolean {
  const cur = (current ?? "").trim();
  const nxt = next.trim();
  if (cur === nxt) return true;
  const nextParts = parts(nxt);
  if (!nextParts) return false;
  const currentParts = parts(cur);
  if (!currentParts) return true;
  for (let i = 0; i < currentParts.length; i += 1) {
    if (nextParts[i] !== currentParts[i]) return nextParts[i] > currentParts[i];
  }
  return true;
}

/**
 * The i18n key for what is wrong with `next`, or null when it is acceptable.
 * Returning a key rather than a message keeps this callable from both packages.
 */
export function versionErrorKey(current: string | undefined, next: string): string | null {
  const nxt = next.trim();
  if (!nxt) return null; // emptiness is the caller's required-field concern
  if (!isValidVersion(nxt)) return "skillMarket.plugin.versionFormatInvalid";
  if (!isVersionForward(current, nxt)) return "skillMarket.plugin.versionMustNotDecrease";
  return null;
}

/** Next patch label, used to seed an upgrade form. */
export function nextPatch(current: string | undefined): string {
  const p = parts(current ?? "");
  if (!p) return "1.0.0";
  return `${p[0]}.${p[1]}.${p[2] + 1}`;
}

/**
 * Version-label rules, mirrored from the backend so the form can object before a
 * round trip. The server is still the gate — this only saves the user a 400.
 *
 * A label is exactly three numeric parts (1.0.1) and may only move forward or
 * stay put. Parts are compared NUMERICALLY: 1.10.0 follows 1.9.0, which a string
 * comparison gets backwards.
 *
 * The format rule has one exemption, and it is the server's, not a convenience:
 * a label that is byte-for-byte the one the row already stores is accepted even
 * when malformed. Labels like `1.0`, `v1.2.3` and `2.0.0-beta.1` reached
 * production before the format was tightened, and every save re-sends the stored
 * value, so without the exemption tightening the format would retroactively make
 * those rows unsavable. See `isStoredVersionLabel` below.
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
 * Whether `next` is byte-for-byte — modulo surrounding space — the label the row
 * ALREADY STORES. Mirrors the server's `isStoredVersionLabel`
 * (internal/service/plugin/import.go), the predicate behind
 * `WriteRequest.grandfatheredVersion`.
 *
 * `stored` must come from the fetched row, never from the form: the exemption
 * exists so a label minted before the format was tightened stays savable, not so
 * a caller can nominate its own malformed value as grandfathered. `undefined`
 * mirrors a NULL current_version — no stored label, so no exemption.
 */
export function isStoredVersionLabel(stored: string | undefined, next: string): boolean {
  return stored !== undefined && stored.trim() === next.trim();
}

/**
 * The i18n key for what is wrong with `next`, or null when it is acceptable.
 * Returning a key rather than a message keeps this callable from both packages.
 *
 * `stored` opts into the server's grandfathering exemption and must be the
 * row's own `current_version`. Pass it on the SAVE surfaces — `/plugins/upsert`
 * (Service.update) and `/plugins/import` (resolveImportFields) both accept a
 * malformed label that equals the stored one, so refusing it here would leave
 * every legacy-labeled plugin with a permanently dead Save button.
 *
 * OMIT it on the review-submit surfaces. `SubmitReview`
 * (internal/service/plugin/review.go) gates on `validVersion` with no
 * grandfathering at all, so exempting the stored label there would only move the
 * dead end from the button to a 400.
 */
export function versionErrorKey(
  current: string | undefined,
  next: string,
  stored?: string
): string | null {
  const nxt = next.trim();
  if (!nxt) return null; // emptiness is the caller's required-field concern
  // Format first, then ordering — the same order as Service.update, whose
  // forward-only check passes an unchanged label through before buildWrite's
  // format gate ever sees it.
  if (!isValidVersion(nxt) && !isStoredVersionLabel(stored, nxt)) {
    return "skillMarket.plugin.versionFormatInvalid";
  }
  if (!isVersionForward(current, nxt)) return "skillMarket.plugin.versionMustNotDecrease";
  return null;
}

/** Next patch label, used to seed an upgrade form. */
export function nextPatch(current: string | undefined): string {
  const p = parts(current ?? "");
  if (!p) return "1.0.0";
  return `${p[0]}.${p[1]}.${p[2] + 1}`;
}

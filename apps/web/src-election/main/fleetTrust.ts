/**
 * Pure helpers for the main-process fleet trust handler.
 *
 * The main process is the trust authority, so it re-validates the fleet
 * path shape AND the decoded segment values — a percent-encoded separator
 * (fleet/a%2F..%2Fb/issues/c%0D%0Ad) can pass a raw 4-segment shape gate
 * and decode into path traversal afterwards. Only RFC 3986 unreserved
 * characters (plus ~) are accepted in a decoded segment.
 */

const SAFE_FLEET_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;

/** Decode a raw pathname segment; null if it is not a safe fleet segment. */
export function decodeSafeFleetSegment(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return SAFE_FLEET_SEGMENT_RE.test(decoded) ? decoded : null;
}

/** True when the pathname is a well-formed, decode-safe fleet deep link. */
export function isFleetIssuePathShape(pathname: string): boolean {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (
    segments.length !== 4 ||
    segments[0] !== "fleet" ||
    segments[2] !== "issues"
  ) {
    return false;
  }
  return (
    decodeSafeFleetSegment(segments[1]) !== null &&
    decodeSafeFleetSegment(segments[3]) !== null
  );
}

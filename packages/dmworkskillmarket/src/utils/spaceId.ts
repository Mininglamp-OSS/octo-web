// Local copy of @octo/base's shell-safe space-id guard. The skillmarket package
// cannot resolve the deep `@octo/base/src/Utils/spaceId` path the connector
// package imports, and pulling the full `@octo/base` barrel in just for this
// helper breaks the unit-test bundle, so the small guard is duplicated here.
// Keep it byte-identical to packages/dmworkbase/src/Utils/spaceId.ts.

const SHELL_SAFE_SPACE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Space ids embedded in shell command examples must remain one bounded token.
 * Server-issued hex, UUID, and readable slug forms are accepted; whitespace,
 * shell metacharacters, traversal-shaped values, and option-like prefixes are
 * rejected.
 */
export function isShellSafeSpaceId(raw?: string): boolean {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  return (
    SHELL_SAFE_SPACE_ID_RE.test(value) && value !== ".." && !/^[-.]/.test(value)
  );
}

export function sanitizeShellSpaceId(raw?: string): string {
  return isShellSafeSpaceId(raw) ? (raw as string).trim() : "<space-id>";
}

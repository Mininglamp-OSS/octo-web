/**
 * file:// drive-root navigation guard — pure helpers.
 *
 * Extracted from main/index.ts so the decision logic is unit-testable
 * without importing electron (the parent module has heavy side-effects).
 */

/**
 * Returns true if `url` is a file:// navigation to a drive root or bare
 * root path — the artifact of RouteManager pushState-ing "/"-prefixed
 * SPA paths under the file:// protocol (e.g. "/" resolves to "file:///E:/").
 *
 * Positive match only: drive-root patterns like "/E:/", "/E:", "/".
 * Does NOT match real file paths ("/E:/login", "/E:/octo/build/index.html")
 * so legitimate navigations are not swallowed.
 */
export function isDriveRootFileNavigation(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "file:") return false;
  const pathname = parsed.pathname || "";
  // Unix root or Windows drive root: "/", "/E:/", "/E:"
  if (pathname === "/") return true;
  if (/^\/[A-Za-z]:\/?$/.test(pathname)) return true;
  return false;
}

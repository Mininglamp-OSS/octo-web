/**
 * The packaged Electron renderer is one file:// document. SPA history
 * navigation may change the visible pathname, but it must not change the
 * document URL used when returning to the shell.
 */
const initialShellDocumentUrl =
  typeof window !== "undefined" ? window.location.href : ""

export function buildShellDocumentUrl(
  shellHref: string,
  currentHref: string,
  query?: string,
): string {
  const shellUrl = new URL(shellHref)
  const currentUrl = new URL(currentHref)
  const shellSid = shellUrl.searchParams.get("sid")

  if (query !== undefined) shellUrl.search = query

  const sid = currentUrl.searchParams.get("sid") || shellSid
  if (sid && !shellUrl.searchParams.has("sid")) {
    shellUrl.searchParams.set("sid", sid)
  }
  shellUrl.hash = ""
  return shellUrl.toString()
}

/** Return the document URL captured before SPA history navigation can run. */
export function getShellDocumentUrl(query?: string): string {
  const currentHref = typeof window !== "undefined" ? window.location.href : initialShellDocumentUrl
  if (!initialShellDocumentUrl.startsWith("file:")) return currentHref
  return buildShellDocumentUrl(initialShellDocumentUrl, currentHref, query)
}

/** Navigate back to the packaged shell document instead of reloading a route path. */
export function replaceWithShellDocument(): void {
  if (typeof window === "undefined") return
  window.location.replace(getShellDocumentUrl())
}

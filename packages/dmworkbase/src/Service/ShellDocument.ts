/**
 * The packaged Electron renderer is one file:// document. SPA history
 * navigation may change the visible pathname, but it must not change the
 * document URL used when returning to the shell.
 */
function normalizeShellDocumentUrl(href: string): string {
  const url = new URL(href)
  const sid = url.searchParams.get("sid")
  url.search = ""
  if (sid) url.searchParams.set("sid", sid)
  url.hash = ""
  return url.toString()
}

// The first renderer document can be an OIDC callback document. Keep only the
// shell document and session sid; callback credentials and __octo_route are
// single-use input and must never be replayed by a later shell replacement.
const initialShellDocumentUrl = (() => {
  if (typeof window === "undefined") return ""
  try {
    return normalizeShellDocumentUrl(window.location.href)
  } catch {
    return ""
  }
})()

export function buildShellDocumentUrl(
  shellHref: string,
  currentHref: string,
  query?: string,
): string {
  const shellUrl = new URL(shellHref)
  const currentUrl = new URL(currentHref)
  const shellSid = shellUrl.searchParams.get("sid")

  shellUrl.search = ""
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

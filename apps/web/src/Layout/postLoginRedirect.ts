import {
  buildShellDocumentUrl,
  getShellDocumentUrl,
} from "../../../../packages/dmworkbase/src/Service/ShellDocument"

export function buildPostLoginRedirectUrl(
  currentHref: string,
  origin: string,
  basePath: string,
  query: string
): string {
  const currentUrl = new URL(currentHref);

  if (currentUrl.protocol === "file:") {
    // History API routes such as /drive are not filesystem documents. Use the
    // URL captured at renderer boot so bind/invite redirects always return to
    // build/index.html rather than navigating to file:///drive.
    const shellHref = getShellDocumentUrl()
    return buildShellDocumentUrl(
      shellHref.startsWith("file:") ? shellHref : currentHref,
      currentHref,
      query,
    )
  }

  return `${origin}${basePath}/${query}`;
}

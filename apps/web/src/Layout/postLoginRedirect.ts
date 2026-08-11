export function buildPostLoginRedirectUrl(
  currentHref: string,
  origin: string,
  basePath: string,
  query: string
): string {
  const currentUrl = new URL(currentHref);

  if (currentUrl.protocol === "file:") {
    const originalSid = currentUrl.searchParams.get("sid");
    currentUrl.search = query;
    // Packaged Electron sessions are stored in sid-scoped buckets. The OIDC
    // callback reload carries the freshly authenticated sid, so dropping it
    // here makes the next renderer load appear logged out (and can leave a
    // blank shell after the login redirect).
    if (originalSid && !currentUrl.searchParams.has("sid")) {
      currentUrl.searchParams.set("sid", originalSid);
    }
    currentUrl.hash = "";
    return currentUrl.toString();
  }

  return `${origin}${basePath}/${query}`;
}

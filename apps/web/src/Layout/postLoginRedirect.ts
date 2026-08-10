export function buildPostLoginRedirectUrl(
  currentHref: string,
  origin: string,
  basePath: string,
  query: string
): string {
  const currentUrl = new URL(currentHref);

  if (currentUrl.protocol === "file:") {
    currentUrl.search = query;
    currentUrl.hash = "";
    return currentUrl.toString();
  }

  const normalizedBasePath = basePath ? `/${basePath.replace(/^\/+|\/+$/g, "")}` : "";
  return `${origin}${normalizedBasePath || "/"}${query}`;
}

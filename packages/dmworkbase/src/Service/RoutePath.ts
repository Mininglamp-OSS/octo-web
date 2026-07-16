export function normalizeRoutePath(path?: string): string {
  if (!path) return "/";

  let routePath = path.trim();
  if (!routePath) return "/";

  const searchStart = routePath.search(/[?#]/);
  if (searchStart >= 0) {
    routePath = routePath.slice(0, searchStart);
  }

  if (!routePath.startsWith("/")) {
    routePath = `/${routePath}`;
  }

  routePath = routePath.replace(/\/+$/, "");
  return routePath || "/";
}

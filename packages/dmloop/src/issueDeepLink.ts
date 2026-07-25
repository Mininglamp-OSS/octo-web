export const LOOP_ROUTE_PATH = "/loop";
export const FLEET_ISSUE_DEEP_LINK_PREFIX = "/fleet";

const PENDING_ISSUE_DEEP_LINK_KEY = "octo.loop.pendingIssueDeepLink";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let inMemoryPendingIssueDeepLink: LoopIssueDeepLink | null = null;

export interface LoopIssueDeepLink {
  workspaceSlug: string;
  issueIdentifier: string;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseLoopIssueDeepLink(pathname: string): LoopIssueDeepLink | null {
  const [pathOnly] = pathname.split(/[?#]/);
  const segments = pathOnly.replace(/\/+$/, "").split("/").filter(Boolean);
  if (
    segments.length === 4 &&
    segments[0] === "fleet" &&
    segments[2] === "issues"
  ) {
    const workspaceSlug = decodeSegment(segments[1]);
    const issueIdentifier = decodeSegment(segments[3]);
    if (!workspaceSlug || !issueIdentifier) return null;
    return {
      workspaceSlug,
      issueIdentifier,
    };
  }
  return null;
}

export function buildFleetIssueDeepLink(workspaceSlug: string, issueIdentifier: string): string {
  return `${FLEET_ISSUE_DEEP_LINK_PREFIX}/${encodeURIComponent(workspaceSlug)}/issues/${encodeURIComponent(issueIdentifier)}`;
}

export function savePendingLoopIssueDeepLink(
  link: LoopIssueDeepLink,
  sessionStore: SessionStorageLike
): void {
  inMemoryPendingIssueDeepLink = link;
  sessionStore.setItem(PENDING_ISSUE_DEEP_LINK_KEY, JSON.stringify(link));
}

export function readPendingLoopIssueDeepLink(
  sessionStore: SessionStorageLike
): LoopIssueDeepLink | null {
  let raw: string | null = null;
  try {
    raw = sessionStore.getItem(PENDING_ISSUE_DEEP_LINK_KEY);
  } catch {
    return inMemoryPendingIssueDeepLink;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LoopIssueDeepLink>;
    if (typeof parsed.workspaceSlug !== "string" || typeof parsed.issueIdentifier !== "string") {
      return null;
    }
    if (!parsed.workspaceSlug || !parsed.issueIdentifier) {
      return null;
    }
    return {
      workspaceSlug: parsed.workspaceSlug,
      issueIdentifier: parsed.issueIdentifier,
    };
  } catch {
    return null;
  }
}

export function consumePendingLoopIssueDeepLink(
  sessionStore: SessionStorageLike
): LoopIssueDeepLink | null {
  const pending = readPendingLoopIssueDeepLink(sessionStore);
  try {
    sessionStore.removeItem(PENDING_ISSUE_DEEP_LINK_KEY);
  } catch {
    // Storage can be unavailable; clear the in-memory fallback below.
  }
  inMemoryPendingIssueDeepLink = null;
  return pending;
}

export function normalizeCurrentLoopIssueDeepLink(): LoopIssueDeepLink | null {
  if (typeof window === "undefined") return null;
  const link = parseLoopIssueDeepLink(window.location.pathname);
  if (!link) return null;
  try {
    savePendingLoopIssueDeepLink(link, window.sessionStorage);
  } catch {
    // Storage can be unavailable; the live path can still be parsed during this boot.
  }
  try {
    // Fleet issue links are standalone product links; query-based flows such as
    // CLI authorization are handled by their own route before this normalization.
    window.history.replaceState(window.history.state, "", LOOP_ROUTE_PATH);
  } catch {
    // Keep the original URL when History is unavailable.
  }
  return link;
}

function writeBrowserPath(path: string, mode: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === "push") window.history.pushState(window.history.state, "", path);
    else window.history.replaceState(window.history.state, "", path);
  } catch {
    // Best effort: routeRight still opens the issue even if browser history is unavailable.
  }
}

export function pushFleetIssueDeepLink(workspaceSlug: string, issueIdentifier: string): void {
  if (!workspaceSlug || !issueIdentifier) return;
  writeBrowserPath(buildFleetIssueDeepLink(workspaceSlug, issueIdentifier), "push");
}

export function replaceFleetIssueDeepLink(workspaceSlug: string, issueIdentifier: string): void {
  if (!workspaceSlug || !issueIdentifier) return;
  writeBrowserPath(buildFleetIssueDeepLink(workspaceSlug, issueIdentifier), "replace");
}

export function replaceLoopRootPath(): void {
  writeBrowserPath(LOOP_ROUTE_PATH, "replace");
}

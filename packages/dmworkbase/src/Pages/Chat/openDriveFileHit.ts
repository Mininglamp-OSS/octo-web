import type { DriveSearchHit } from "../../Service/SearchTypes";

// Routing for a clicked global-search drive hit, extracted from Chat's
// onOpenDriveHit so the contract is unit-tested against the real code rather
// than a mirror: folder hits have no preview and must never open a tab; file
// hits open the standalone preview page `/drive/f/<fileId>?name=&size=&spaceId=`
// (intercepted by apps/web Layout outside the app shell). name/size ride in the
// query so the panel can label the file before the presigned URL resolves.

/** Minimal shape of the window the opener returns — kept structural so tests
 *  can supply a plain object and production can pass a real `Window`. */
export interface OpenedTab {
  opener: unknown;
  location: { href: string };
}

export interface OpenDriveFileHitDeps {
  /** Opens a blank tab (production: `window.open`). Returns null when blocked. */
  open: (url: string, target: string) => OpenedTab | null;
  /** Called when the popup was blocked (production: a Toast warning). */
  onBlocked: () => void;
}

/** The standalone-preview URL for a file hit, or null for a folder (no preview). */
export function buildDriveFileHitUrl(hit: DriveSearchHit): string | null {
  if (hit.type === "folder") return null;
  const params = new URLSearchParams({
    name: hit.name || "",
    size: hit.size != null ? String(hit.size) : "",
    spaceId: hit.space_id,
  });
  return `/drive/f/${encodeURIComponent(String(hit.file_id))}?${params.toString()}`;
}

/**
 * Open a clicked file hit in a new standalone-preview tab. Folder hits are
 * skipped (client-side backstop: the panel already excludes them server-side
 * via filters.types). Uses the about:blank-first + opener=null pattern to dodge
 * the noopener null-return popup-blocker false positive.
 */
export function openDriveFileHit(hit: DriveSearchHit, deps: OpenDriveFileHitDeps): void {
  const url = buildDriveFileHitUrl(hit);
  if (url === null) {
    console.warn(
      "[GlobalSearch] folder hit should be filtered out server-side; skipping"
    );
    return;
  }
  const opened = deps.open("about:blank", "_blank");
  if (!opened) {
    deps.onBlocked();
    return;
  }
  try {
    opened.opener = null;
  } catch {
    // Some sandboxes freeze the opener setter; continue navigating. about:blank
    // is same-origin so the residual risk is already contained.
  }
  opened.location.href = url;
}

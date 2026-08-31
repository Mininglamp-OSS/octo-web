import type { DriveSearchHit } from "../../Service/SearchTypes";
import { buildDocLink } from "../../Utils/docLink";

// Routing for a clicked global-search drive hit, extracted from Chat's
// onOpenDriveHit so the contract is unit-tested against the real code rather
// than a mirror: folder hits have no preview and must never open a tab; doc
// hits open the docs standalone reader `/d/<ref_id>` via buildDocLink (a doc
// file_id would 400 on the blob-download preview); blob hits open the
// standalone preview page `/drive/f/<fileId>?name=&size=&spaceId=`
// (intercepted by apps/web Layout outside the app shell). name/size ride in the
// query so the panel can label the file before the presigned URL resolves.

/** Minimal shape of the window the opener returns — kept structural so tests
 *  can supply a plain object and production can pass a real `Window`. */
export interface OpenedTab {
  opener: unknown;
  location: { href: string };
}

/** Minimal shape of the Electron system-browser links bridge (desktopBridge's
 *  DesktopLinksBridge) — kept structural so tests can pass a plain object. */
export interface DesktopLinksOpener {
  openExternal(url: string): Promise<{ ok: boolean; reason?: string }>;
}

export interface OpenDriveFileHitDeps {
  /** Opens a blank tab (production: `window.open`). Returns null when blocked. */
  open: (url: string, target: string) => OpenedTab | null;
  /** Called when the popup was blocked (production: a Toast warning). */
  onBlocked: () => void;
  /**
   * A clicked hit has no preview (a folder, or a doc hit missing its ref_id).
   * Surfaces user-visible feedback (production: a Toast warning) so a click that
   * resolves to nothing does not look broken — console.warn stays for logs but
   * is invisible to the user.
   */
  onUnavailable?: () => void;
  /**
   * Desktop shell only: the Electron system-browser links bridge, or null on
   * web (production: getElectronLinksBridge()). When present the hit opens
   * through the IPC bridge instead of window.open — Electron's
   * setWindowOpenHandler denies the web-era about:blank window.open
   * (apps/web src-election/main/externalLink.ts), so the web path would always
   * false-positive as "popup blocked" on desktop.
   */
  getLinksBridge?: () => DesktopLinksOpener | null | undefined;
  /**
   * Resolve a (possibly root-relative) hit URL to an absolute http(s) URL the
   * system browser can open (production:
   * resolveDocLinkForExternalOpen(url, apiUrlOrigin())). Only consulted on the
   * desktop bridge branch.
   */
  toAbsoluteUrl?: (url: string) => string;
}

/** The preview URL for a hit, or null when there is nothing to open (a folder,
 *  or a doc hit missing its ref_id). Doc hits route to the /d/:docId standalone
 *  reader via buildDocLink; blob hits route to the /drive/f/:fileId preview. */
export function buildDriveFileHitUrl(hit: DriveSearchHit): string | null {
  if (hit.type === "folder") return null;
  if (hit.type === "doc") {
    // A doc hit is a cloud document, not a blob: route it to the docs
    // standalone reader (same target as a cloud-doc tab hit), never to the
    // blob-download preview which 400s on a doc file_id. ref_id is the docId;
    // absent it we cannot build a link, so skip (return null).
    if (!hit.ref_id) return null;
    return buildDocLink({ docId: hit.ref_id });
  }
  const params = new URLSearchParams({
    name: hit.name || "",
    size: hit.size != null ? String(hit.size) : "",
    spaceId: hit.space_id,
  });
  return `/drive/f/${encodeURIComponent(String(hit.file_id))}?${params.toString()}`;
}

/**
 * Open a clicked hit in a new tab. Folder hits, and doc hits missing a ref_id,
 * are skipped (folders are a client-side backstop — the panel already excludes
 * them server-side via filters.types; a doc without ref_id has no reader link).
 * Uses the about:blank-first + opener=null pattern to dodge the noopener
 * null-return popup-blocker false positive.
 */
export function openDriveFileHit(hit: DriveSearchHit, deps: OpenDriveFileHitDeps): void {
  const url = buildDriveFileHitUrl(hit);
  if (url === null) {
    if (hit.type === "doc") {
      console.warn("[GlobalSearch] doc hit missing ref_id; skipping", {
        file_id: hit.file_id,
      });
    } else {
      console.warn(
        "[GlobalSearch] folder hit should be filtered out server-side; skipping"
      );
    }
    deps.onUnavailable?.();
    return;
  }
  const linksBridge = deps.getLinksBridge?.();
  if (linksBridge) {
    // Desktop shell: setWindowOpenHandler routes every window.open to the system
    // browser, so the about:blank dance below can never yield a usable window
    // reference. Resolve the (root-relative on file://) URL to an absolute one
    // and hand it to the IPC bridge; a rejected/blocked open surfaces the same
    // warning as the web popup-blocked path. Mirrors Chat's onOpenDoc branch.
    const absoluteUrl = deps.toAbsoluteUrl ? deps.toAbsoluteUrl(url) : url;
    void linksBridge
      .openExternal(absoluteUrl)
      .then((result) => {
        if (!result.ok) deps.onBlocked();
      })
      .catch(() => deps.onBlocked());
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

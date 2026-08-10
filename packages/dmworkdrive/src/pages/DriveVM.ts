import { useEffect, useReducer } from 'react';
import { t, WKApp } from '@octo/base';
import { ProviderListener } from '@octo/base';
import * as api from '../api/driveApi';
import type { Space, CreateSpaceReq } from '../bridge/types';
import type { Crumb } from '../ui/Breadcrumb';
import { Toast } from '../utils/toast';
import { spaceDisplayName } from '../utils/spaceName';

/**
 * Shared drive view-model backing the two-pane layout.
 *
 * The space sidebar (WKLayout.contentLeft) and the file view
 * (WKLayout.contentRight) mount into two independent WKViewQueue subtrees, so
 * plain React props/context can't bridge them. This ProviderListener is the
 * single source of truth both panes subscribe to via `useDriveVM`: selecting a
 * space or navigating a folder mutates the VM and fans out to both panes.
 *
 * Space-list loading (formerly `useSpaceList`) lives here because both panes
 * need it — the sidebar to render the list, the content pane to resolve the
 * active space's name/type. Per-file concerns (browse listing, uploads, folder
 * ops) stay local to the content pane; they key off `activeSpaceId` +
 * `currentParentId` and don't cross the pane boundary.
 */
export class DriveVM extends ProviderListener {
  spaces: Space[] = [];
  spacesLoading = true;
  spacesError: string | null = null;
  activeSpaceId: string | null = null;
  path: Crumb[] = [];
  /** File id to flash/scroll to after a focus jump (e.g. "view in drive" from
   *  a chat file card). Consumed by FileList; cleared by DriveContent ~2s later. */
  highlightFileId: number | null = null;

  private loadStarted = false;
  /** uid the cached spaces belong to; guards against an in-tab user change. */
  private loadedUid: string | null = null;
  /**
   * Monotonic load generation. Each loadSpaces() call claims the next value;
   * only the latest generation may commit its result. A rapid space switch
   * (reset → loadSpaces, twice) would otherwise let the FIRST load's response
   * land after the second reset — committing the previous tenant's spaces and
   * selecting a personal space whose id isn't in the new list (activeSpaceId
   * dangling → empty toolbar / cross-tenant browse). Mirrors dmloop's seq guard.
   */
  private loadSeq = 0;

  /**
   * Monotonic focus generation, same rationale as `loadSeq`: two quick
   * "view in drive" clicks race across `getAncestors`, and the slower
   * request MUST NOT overwrite state the newer click already committed.
   * Every focusFile call claims the next value and every state write
   * checks it's still the newest before touching the VM.
   */
  private focusSeq = 0;

  get personalSpace(): Space | null {
    return this.spaces.find((s) => s.type === 'personal') ?? null;
  }

  get sharedSpaces(): Space[] {
    return this.spaces.filter((s) => s.type === 'shared');
  }

  get activeSpace(): Space | null {
    return this.spaces.find((s) => s.id === this.activeSpaceId) ?? null;
  }

  /** Current folder id (0 = space root), derived from the path stack. */
  get currentParentId(): number {
    return this.path.length ? this.path[this.path.length - 1].id : 0;
  }

  /** Kick off the initial space load once, on first pane mount. */
  ensureLoaded(): void {
    const uid = WKApp.loginInfo.uid ?? '';
    if (this.loadStarted) {
      // Same singleton, different user in-tab (no full page reload): drop the
      // prior user's cached spaces and reload under the new identity.
      if (this.loadedUid !== uid) this.reset();
      return;
    }
    this.loadStarted = true;
    this.loadedUid = uid;
    void this.loadSpaces();
  }

  /**
   * Drop all cached per-tenant state on a host Space switch (or in-tab user
   * change) and immediately reload for the new context. The drive request
   * headers (X-Space-Id / token) follow the host, so a stale space list /
   * breadcrumb must never outlive the switch. No-op before the first load —
   * nothing tenant-specific is cached yet. Logout is covered separately by the
   * host's hard redirect (App.logout → window.location.replace), which tears
   * down this module-level singleton entirely.
   */
  reset(): void {
    if (!this.loadStarted) return;
    // Bump both generation counters so any in-flight loadSpaces AND any
    // in-flight focusFile that started under the previous tenant will fail
    // their post-await guards and refuse to commit to the freshly-reset
    // VM. Without the focusSeq bump, a "view in drive" jump that was
    // awaiting getAncestors when a host tenant switch fires reset() will
    // still pass its `seq === this.focusSeq` check and write the previous
    // tenant's activeSpaceId/path/highlight into the new tenant's VM,
    // leaving a dangling activeSpaceId that DriveContent then browses
    // under the wrong X-Space-Id. Reviewer Jerry-Xin / yujiawei / Octo-Q
    // round-4 P1 on PR #1322: focusSeq alone serializes focus-vs-focus
    // but does NOT cover focus-vs-reset.
    this.loadSeq++;
    this.focusSeq++;
    this.spaces = [];
    this.spacesError = null;
    this.activeSpaceId = null;
    this.path = [];
    this.highlightFileId = null;
    this.loadedUid = WKApp.loginInfo.uid ?? '';
    this.spacesLoading = true;
    this.notifyListener();
    void this.loadSpaces();
  }

  /**
   * Load the space list, guaranteeing a personal space exists, and land on it
   * when nothing is selected yet. Mirrors the old useSpaceList contract.
   */
  async loadSpaces(): Promise<void> {
    const seq = ++this.loadSeq;
    this.spacesLoading = true;
    this.spacesError = null;
    this.notifyListener();
    try {
      let list = await api.listSpaces();
      if (seq !== this.loadSeq) return; // superseded by a newer load — drop it.
      if (!list.some((s) => s.type === 'personal')) {
        const personal = await api.ensurePersonalSpace();
        if (seq !== this.loadSeq) return;
        list = [personal, ...list];
      }
      this.spaces = list;
      if (!this.activeSpaceId) {
        const personal = list.find((s) => s.type === 'personal');
        if (personal) this.selectSpace(personal.id);
      }
    } catch (err: unknown) {
      if (seq !== this.loadSeq) return; // stale failure must not clobber newer state.
      this.spacesError = (err as Error)?.message ?? 'load failed';
      Toast.error(t('drive.toast.loadFailed'));
    } finally {
      if (seq === this.loadSeq) {
        this.spacesLoading = false;
        this.notifyListener();
      }
    }
  }

  /** Select a space and reset folder navigation to its root. */
  selectSpace(spaceId: string): void {
    const space = this.spaces.find((s) => s.id === spaceId);
    this.activeSpaceId = spaceId;
    this.path = [{ id: 0, name: space ? spaceDisplayName(space, t) : t('drive.file.root') }];
    this.notifyListener();
  }

  /** Descend into a subfolder. */
  enterFolder(id: number, name: string): void {
    this.path = [...this.path, { id, name }];
    this.notifyListener();
  }

  /** Jump to a crumb in the path trail (truncating deeper folders). */
  navigateTo(index: number): void {
    this.path = this.path.slice(0, index + 1);
    this.notifyListener();
  }

  /** Jump to a file in a space, opening the correct breadcrumb path and
   *  marking the file for flash highlight. When parentId is 0 / undefined
   *  the target lives at the space root — set path to just the space
   *  root crumb (the personal-space-root case that always worked).
   *  For a parentId > 0 (target buried in nested folders — the common case
   *  once save-to-drive can pick any target folder in any space) we fetch
   *  the ancestor chain from the backend and rebuild the breadcrumb, so
   *  the left sidebar shows the correct hierarchy and each ancestor is
   *  navigable back up.
   *
   *  Safety net: `ensureLoaded()` is called first so a caller who has
   *  never opened drive still has a `spaces` list to look up the target
   *  in. If the target space is not in the loaded list (caller was
   *  removed from a shared space between save and this click), toast and
   *  skip — do NOT switch to a nonexistent space (would render a dangling
   *  activeSpaceId with an empty toolbar).
   *
   *  Ancestor fetch is best-effort: a 4xx / network hiccup falls back to
   *  the space-root breadcrumb rather than blocking the jump. The file
   *  itself is still highlighted; the user can see it lives in this
   *  space even if the intermediate folders didn't paint.
   */
  async focusFile(spaceId: string, fileId: number, parentId?: number): Promise<void> {
    // Claim the newest focus generation. Any await point below re-checks this
    // before touching state: two quick "view in drive" clicks (from a
    // stack of message cards, or a click-into-drive followed by another
    // click before ancestors resolve) must not see the slower resolution
    // overwrite the newer one. Same discipline as loadSeq in loadSpaces.
    const seq = ++this.focusSeq;

    // Kick the first-time load if it hasn't started yet, then AWAIT its
    // outcome — the previous version called both ensureLoaded (fire-and-
    // forget) AND await loadSpaces (a fresh load) whenever the space
    // wasn't found, so the cold path always paid for two listSpaces
    // round-trips. Now: if loadStarted is false we ensure + await the
    // already-in-flight load; if loadStarted is true we don't re-fetch
    // unless we still don't know about the space.
    if (!this.loadStarted) {
      this.ensureLoaded();
    }
    if (this.spacesLoading) {
      // Wait for the current load to settle via a listener-driven yield.
      await new Promise<void>((resolve) => {
        const off = this.addListener(() => {
          if (!this.spacesLoading) {
            off();
            resolve();
          }
        });
      });
    }
    if (seq !== this.focusSeq) return;
    let space = this.spaces.find((s) => s.id === spaceId);
    if (!space) {
      // Reload once — the space may have been added between the last
      // loadSpaces and this click (shared-space invite acceptance, etc.).
      await this.loadSpaces();
      if (seq !== this.focusSeq) return;
      space = this.spaces.find((s) => s.id === spaceId);
    }
    if (!space) {
      Toast.error(t('drive.toast.spaceNotFound'));
      return;
    }
    // Resolve ancestors FIRST, then commit activeSpaceId / path /
    // highlightFileId / notifyListener in one atomic block. The earlier
    // version split the transition across the await: activeSpaceId
    // updated synchronously → DriveContent's useFileList observed the
    // new space with the previous space's path (currentParentId was a
    // folder id from another space) → issued a cross-space
    // `browse({space_id: <new>, parent_id: <old space's folder>})` that
    // 404/403'd during the ancestors round-trip. Reviewer flagged this
    // as the deep-jump race (Jerry-Xin / yujiawei / Octo-Q PR #1322).
    let ancestors: Array<{ id: number; name: string }> = [];
    if (parentId && parentId !== 0) {
      try {
        ancestors = await api.getAncestors(fileId);
      } catch {
        // Best-effort — leave ancestors empty and land on the space root.
        ancestors = [];
      }
      if (seq !== this.focusSeq) return;
    }
    const rootCrumb: Crumb = { id: 0, name: spaceDisplayName(space, t) };
    this.activeSpaceId = spaceId;
    this.path = ancestors.length === 0
      ? [rootCrumb]
      : [rootCrumb, ...ancestors.map((a) => ({ id: a.id, name: a.name }))];
    this.highlightFileId = fileId;
    this.notifyListener();
  }

  clearHighlight(): void {
    if (this.highlightFileId === null) return;
    this.highlightFileId = null;
    this.notifyListener();
  }

  /** Create a shared space, merge it into the list, and return it. Throws on failure. */
  async createShared(name: string): Promise<Space> {
    const req: CreateSpaceReq = { name };
    const space = await api.createSharedSpace(req);
    this.spaces = [...this.spaces, space];
    this.notifyListener();
    return space;
  }
}

/**
 * Subscribe a pane to a DriveVM: re-renders on `notifyListener()` and triggers
 * the one-shot space load on first mount. Works across the WKViewQueue subtree
 * boundary via `ProviderListener.addListener` (see Provider.tsx rationale).
 */
export function useDriveVM(vm: DriveVM): DriveVM {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const off = vm.addListener(force);
    vm.ensureLoaded();
    return off;
  }, [vm]);
  return vm;
}

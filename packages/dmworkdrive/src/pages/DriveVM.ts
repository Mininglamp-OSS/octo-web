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
    this.ensureLoaded();
    let space = this.spaces.find((s) => s.id === spaceId);
    // If the caller triggered focusFile before the first-time load
    // resolved, `spaces` may still be empty here — retry once after a
    // notifyListener tick would happen (loadSpaces is fire-and-forget).
    // The simpler cover: rely on the caller's expectation that a saved-
    // hit space is one the caller currently belongs to (the batch
    // transferred-state lookup gates on membership), so the space either
    // is in the list at focus time, or won't be after a load either.
    if (!space) {
      // Reload once — the space may have been added between last
      // loadSpaces and this click (shared-space invite acceptance, etc.).
      await this.loadSpaces();
      space = this.spaces.find((s) => s.id === spaceId);
    }
    if (!space) {
      Toast.error(t('drive.toast.spaceNotFound'));
      return;
    }
    this.activeSpaceId = spaceId;
    const rootCrumb: Crumb = { id: 0, name: spaceDisplayName(space, t) };
    if (!parentId || parentId === 0) {
      this.path = [rootCrumb];
    } else {
      let ancestors: Array<{ id: number; name: string }> = [];
      try {
        ancestors = await api.getAncestors(fileId);
      } catch {
        // Best-effort — leave ancestors empty and land on the space root.
        ancestors = [];
      }
      this.path = [rootCrumb, ...ancestors.map((a) => ({ id: a.id, name: a.name }))];
    }
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

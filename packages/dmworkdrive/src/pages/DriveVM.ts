import { useEffect, useReducer } from 'react';
import { t } from '@octo/base';
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

  private loadStarted = false;

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
    if (this.loadStarted) return;
    this.loadStarted = true;
    void this.loadSpaces();
  }

  /**
   * Load the space list, guaranteeing a personal space exists, and land on it
   * when nothing is selected yet. Mirrors the old useSpaceList contract.
   */
  async loadSpaces(): Promise<void> {
    this.spacesLoading = true;
    this.spacesError = null;
    this.notifyListener();
    try {
      let list = await api.listSpaces();
      if (!list.some((s) => s.type === 'personal')) {
        const personal = await api.ensurePersonalSpace();
        list = [personal, ...list];
      }
      this.spaces = list;
      if (!this.activeSpaceId) {
        const personal = list.find((s) => s.type === 'personal');
        if (personal) this.selectSpace(personal.id);
      }
    } catch (err: unknown) {
      this.spacesError = (err as Error)?.message ?? 'load failed';
      Toast.error(t('drive.toast.loadFailed'));
    } finally {
      this.spacesLoading = false;
      this.notifyListener();
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

import React, { useState, useEffect, useMemo } from 'react';
import { useI18n, t } from '@octo/base';
import { Modal, Spin, Select } from '@douyinfe/semi-ui';
import { Folder, ChevronRight } from 'lucide-react';
import * as api from '../../api/driveApi';
import type { DriveEntry, Space } from '../../bridge/types';
import { Toast } from '../../utils/toast';
import { ROLE_RANK } from '../../utils/roleLabel';
import { spaceDisplayName } from '../../utils/spaceName';
import Breadcrumb, { Crumb } from '../Breadcrumb';
import './index.css';

/** Rank floor for save targets — mirrors backend imtransfer.assertUploader
 *  (uploader_downloader+). Spaces where the caller's role sits below this
 *  are still listed (transparency: "you are a member here"), but disabled
 *  in the dropdown so the user can't pick them and hit a 403. */
const UPLOADER_RANK = ROLE_RANK.uploader_downloader; // = 40

// Client-side upload gate for a Space: transparency layer only — the drive
// backend's `assertUploader` is the final authority (see
// `internal/modules/imtransfer/service.go`), so this predicate is deliberately
// permissive at the edges:
//
//   - `viewer_role` absent → server didn't say (legacy or downgraded response).
//     Show the space as selectable; if the caller can't upload the POST
//     returns 403 and we keep the modal open for retry.
//   - `custom` role → `ROLE_RANK.custom = 10`, well below the uploader floor,
//     but the rank is a UI hint, not a permission decision. A `custom` role
//     may or may not carry upload rights; the backend knows and will 403 if
//     not. Reviewer Jerry-Xin P2-8: unconditionally disabling `custom` locks
//     legitimate users out with no way to proceed.
//
// Everything else gates on rank ≥ UPLOADER_RANK. This is enough to disable
// obviously non-uploader roles (`downloader`, `preview_only`) so users don't
// hit an easily-avoidable 403.
function spaceUploadable(s: Space): boolean {
  if (!s.viewer_role) return true;
  if (s.viewer_role === 'custom') return true;
  return (ROLE_RANK[s.viewer_role as keyof typeof ROLE_RANK] ?? 0) >= UPLOADER_RANK;
}

export interface SaveToDriveModalProps {
  visible: boolean;
  /** Spaces the caller currently belongs to (from DriveVM.spaces). Callers pass
   *  the shared VM's list so the modal reflects any recently added shared
   *  spaces without a second listSpaces round-trip. */
  spaces: Space[];
  /** Default selection — usually the current active-space id, so users who
   *  already had a space open see it pre-selected. Falls back to the caller's
   *  personal space when the default's rank is below uploader_downloader. */
  defaultSpaceId?: string | null;
  /** Return true on success to close the modal; false leaves it open. */
  onConfirm: (targetSpaceId: string, targetParentId: number) => Promise<boolean>;
  onClose: () => void;
  /** When true, the picker is being kept open while the caller resolves its
   *  data prerequisites (spaces list, viewer_role, etc.). Body renders a
   *  loading placeholder in the modal shell instead of the picker controls
   *  so the user sees progress and can still Cancel. Confirm is disabled.
   *  Set by SaveToDriveModalHost in module.tsx during cold-start (user has
   *  never opened Drive this session and vm.spaces has not arrived yet). */
  spacesLoading?: boolean;
  /** When set, the caller's initial space-list fetch failed. The modal body
   *  renders an error card with a Retry button (wired to `onRetry`) instead
   *  of the picker or the loading shell — otherwise the shell spins
   *  forever with only a toast to signal the problem (Octo-Q round-2 P2 on
   *  PR #1322). Confirm is disabled while this is set. */
  spacesError?: string | null;
  /** Callback for the retry button rendered alongside `spacesError`.
   *  Typically re-issues the underlying `listSpaces` request. When absent
   *  no retry affordance is shown. */
  onRetry?: () => void;
}

/**
 * Save-to-drive target picker. Two levels:
 *   1. Space dropdown — caller's own spaces; entries below
 *      uploader_downloader are visible but disabled (transparency without
 *      letting the user pick a 403).
 *   2. Folder tree — browse `type=folder` in the selected space, with
 *      breadcrumb back-navigation. The current folder is the destination.
 *
 * Visual language mirrors MoveModal so the two pickers feel like one
 * primitive; the two are DELIBERATELY separate components: MoveModal's
 * semantics ("move/copy an existing DriveEntry within a space", with a
 * `sameAsOrigin` no-op guard) do not fit "save a chat message into any
 * folder in any space" — trying to overload MoveModal would poison its
 * types and its guard logic.
 */
export default function SaveToDriveModal({
  visible,
  spaces,
  defaultSpaceId,
  onConfirm,
  onClose,
  spacesLoading = false,
  spacesError = null,
  onRetry,
}: SaveToDriveModalProps) {
  const { t: ti } = useI18n();

  // Compute the pre-selected space when the modal opens. Prefer the caller-
  // supplied default, but drop it if the caller lacks upload rank there
  // (would land in a "disabled" option). Otherwise pick the personal space,
  // otherwise the first uploader-eligible space, otherwise the first space.
  const initialSpaceId = useMemo(() => {
    if (defaultSpaceId) {
      const sp = spaces.find((s) => s.id === defaultSpaceId);
      if (sp && spaceUploadable(sp)) return sp.id;
    }
    const personal = spaces.find((s) => s.type === 'personal' && spaceUploadable(s));
    if (personal) return personal.id;
    const anyUploadable = spaces.find(spaceUploadable);
    if (anyUploadable) return anyUploadable.id;
    return spaces[0]?.id ?? null;
  }, [defaultSpaceId, spaces]);

  const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId);
  const [path, setPath] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<DriveEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // React 17 has no built-in mounted flag; setState after unmount logs a
  // dev warning (Octo-Q / yujiawei P2-3: on the success path onConfirm
  // → done()→ReactDOM.unmountComponentAtNode(host) runs before handleOk's
  // finally, so `setSubmitting(false)` used to hit an unmounted tree).
  const mountedRef = React.useRef(true);
  React.useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const activeSpace = spaces.find((s) => s.id === spaceId) ?? null;
  const rootName = activeSpace ? spaceDisplayName(activeSpace, t) : ti('drive.file.root');

  // Reset picker state whenever the modal opens or the selected space
  // changes: breadcrumb collapses to the space root. Fires a folder
  // browse of the root once path is at the root — the effect on `path`
  // below owns fetching so a spaceId change collapses path FIRST and
  // then the browse observes the fresh (spaceId, root) pair; this fixes
  // yujiawei P2-1 (space change used to fire a browse with the previous
  // space's parent_id because the two effects both keyed on `spaceId`).
  useEffect(() => {
    if (!visible) return;
    setSpaceId(initialSpaceId);
  }, [visible, initialSpaceId]);

  useEffect(() => {
    if (!visible) return;
    setPath([{ id: 0, name: rootName }]);
  }, [visible, spaceId, rootName]);

  const currentId = path.length ? path[path.length - 1].id : 0;
  // Browse keyed on (spaceId, path-last-id): the reset above collapses
  // path first, so the two effects sequence rather than race. `alive`
  // guards against out-of-order responses if the user descends fast.
  useEffect(() => {
    if (!visible || !spaceId) return;
    // Additional guard: don't fire a browse if `path` is empty. That
    // happens for a single render tick between the spaceId change and
    // the reset effect below observing it — otherwise the parent_id
    // would be `0` combined with a still-inconsistent spaceId. Empty
    // path means "reset is in flight; wait one commit."
    if (path.length === 0) return;
    let alive = true;
    setLoading(true);
    api
      .browse({ space_id: spaceId, parent_id: currentId, type: 'folder', page_size: 200 })
      .then((res) => {
        if (!alive) return;
        const list = (res.entries ?? []).filter((e) => e.type === 'folder');
        setFolders(list);
        // Surface the 200-entry cap. `list.length === 200` isn't a
        // guaranteed signal (could be exactly 200 with no next page),
        // but `res.page?.next_cursor` / `res.total > list.length` is
        // the authoritative check. Fall back to length-based when the
        // backend doesn't return totals. Reviewer Jerry-Xin P2-7.
        const total = (res.page as unknown as { total?: number })?.total;
        setTruncated(typeof total === 'number' ? total > list.length : list.length >= 200);
      })
      .catch(() => {
        if (alive) Toast.error(t('drive.toast.loadFailed'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [visible, spaceId, currentId, path.length]);

  const handleOk = async (): Promise<void> => {
    if (submitting || !spaceId) return;
    setSubmitting(true);
    try {
      const ok = await onConfirm(spaceId, currentId);
      if (ok) onClose();
    } finally {
      // onConfirm's success path may synchronously unmount this modal
      // (via ReactDOM.unmountComponentAtNode on the portal host); guard
      // the setState so React 17 doesn't warn.
      if (mountedRef.current) setSubmitting(false);
    }
  };

  // Atomic space change: set spaceId AND collapse path to the new space's
  // root in the SAME handler, so there is no render tick during which
  // `spaceId=B` while `path` still holds A's folder ids. The earlier
  // passive-effect version left a one-tick desync window where a fast
  // Confirm click would call onConfirm(B, A_folderId) — filing the save
  // into the wrong folder (Jerry-Xin round-3 blocking on PR #1322).
  // React 17 auto-batches state updates dispatched inside an event
  // handler, so these two setState calls commit together; Confirm and
  // the browse effect both observe the consistent (B, [B_root]) pair.
  const handleSpaceChange = (nextSpaceId: string): void => {
    const nextSpace = spaces.find((s) => s.id === nextSpaceId) ?? null;
    const nextRootName = nextSpace ? spaceDisplayName(nextSpace, t) : ti('drive.file.root');
    setSpaceId(nextSpaceId);
    setPath([{ id: 0, name: nextRootName }]);
  };

  const okDisabled = spacesLoading || !!spacesError || !spaceId || (activeSpace ? !spaceUploadable(activeSpace) : true);

  return (
    <Modal
      title={ti('drive.saveModal.title')}
      visible={visible}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText={ti('drive.common.confirm')}
      cancelText={ti('drive.common.cancel')}
      okButtonProps={{ disabled: okDisabled }}
      maskClosable={false}
    >
      {spacesError ? (
        // Failure state: give the user something they can act on. Retry
        // triggers the caller's onRetry (typically vm.loadSpaces); Cancel
        // dismisses the picker via the modal's own footer. Confirm stays
        // disabled via okDisabled above.
        <div className="drive-save drive-save--loading">
          <div className="drive-save__center drive-save__empty" role="alert">
            {spacesError}
          </div>
          {onRetry && (
            <div className="drive-save__center">
              <button
                type="button"
                className="drive-save__item"
                onClick={onRetry}
                style={{ width: 'auto' }}
              >
                {ti('drive.common.retry')}
              </button>
            </div>
          )}
        </div>
      ) : spacesLoading ? (
        // Cold-start body: user right-clicked without having opened Drive
        // this session. Show a compact centred spinner so the click is
        // acknowledged and Cancel stays clickable; the host wrapper flips
        // this off the moment vm.spaces arrives.
        <div className="drive-save drive-save--loading">
          <div className="drive-save__center">
            <Spin size="middle" />
          </div>
        </div>
      ) : (
        <div className="drive-save">
        <div className="drive-save__space">
          <label className="drive-save__label">{ti('drive.saveModal.selectSpace')}</label>
          <Select
            value={spaceId ?? undefined}
            onChange={(v) => handleSpaceChange(String(v))}
            style={{ width: '100%' }}
            optionList={spaces.map((s) => ({
              value: s.id,
              label: spaceDisplayName(s, t),
              disabled: !spaceUploadable(s),
            }))}
          />
        </div>
        <div className="drive-save__folder">
          <Breadcrumb path={path} onNavigate={(i) => setPath((p) => p.slice(0, i + 1))} />
          <div className="drive-save__list">
            {loading ? (
              <div className="drive-save__center">
                <Spin size="small" />
              </div>
            ) : folders.length === 0 ? (
              <div className="drive-save__center drive-save__empty">
                {ti('drive.saveModal.noSubfolder')}
              </div>
            ) : (
              folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="drive-save__item"
                  onClick={() => setPath((p) => [...p, { id: f.id, name: f.name }])}
                >
                  <Folder size={16} className="drive-save__item-icon" />
                  <span className="drive-save__item-name" title={f.name}>
                    {f.name}
                  </span>
                  <ChevronRight size={14} className="drive-save__item-arrow" />
                </button>
              ))
            )}
          </div>
          {/*
            Surface the folder-list page cap so users don't wonder why a
            folder they expect to see is absent. The reviewer flagged
            silent truncation past 200 subfolders (Jerry-Xin P2-7) —
            uncommon but not impossible in a big shared space. Since the
            picker is a single-page browse (matches MoveModal today),
            direct users to descend into a subfolder to see more, or use
            the drive app for exhaustive navigation.
          */}
          {truncated && (
            <div className="drive-save__truncated" role="status">
              {ti('drive.saveModal.folderTruncated')}
            </div>
          )}
        </div>
        </div>
      )}
    </Modal>
  );
}

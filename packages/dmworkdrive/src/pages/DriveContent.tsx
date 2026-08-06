import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, buildDocLink } from '@octo/base';
import { Button, Modal, Spin } from '@douyinfe/semi-ui';
import { FolderPlus, FilePlus2, UserPlus, Users } from 'lucide-react';
import { useFileList } from '../hooks/useFileList';
import { useDriveOps } from '../hooks/useDriveOps';
import { useUpload } from '../hooks/useUpload';
import { useMembers } from '../hooks/useMembers';
import { useSelection } from '../hooks/useSelection';
import { useDropzone } from '../hooks/useDropzone';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { runBatch } from '../hooks/runBatch';
import type { DriveEntry } from '../bridge/types';
import * as api from '../api/driveApi';
import { Toast } from '../utils/toast';
import { triggerBrowserDownload } from '../utils/download';
import { spaceDisplayName } from '../utils/spaceName';
import Breadcrumb from '../ui/Breadcrumb';
import FileList from '../ui/FileList';
import EmptyState from '../ui/EmptyState';
import BulkActionBar from '../ui/BulkActionBar';
import DropzoneOverlay from '../ui/DropzoneOverlay';
import FilterChips from '../ui/FilterChips';
import NameInputModal from '../ui/NameInputModal';
import MoveModal from '../ui/MoveModal';
import UploadButton from '../ui/UploadButton';
import UploadProgress from '../ui/UploadProgress';
import MountDocsModal from '../ui/MountDocsModal';
import ShareModal from '../ui/ShareModal';
import InviteModal from '../ui/InviteModal';
import MemberModal from '../ui/MemberModal';
import { DriveVM, useDriveVM } from './DriveVM';
import './DrivePage.css';

/**
 * Right-pane file view (WKLayout.contentRight). Reads the active space + folder
 * path from the shared VM and owns everything scoped to the current folder:
 * browsing, folder CRUD, Type-2 upload/download, Type-1 mount + jump-to-docs,
 * sharing, and (shared-space) member invites. Space selection lives in the
 * sidebar; switching spaces re-renders this pane without remounting the rail.
 */
export default function DriveContent({ vm }: { vm: DriveVM }) {
  useDriveVM(vm);
  const { t } = useI18n();

  const activeSpaceId = vm.activeSpaceId;
  const currentParentId = vm.currentParentId;
  const activeSpace = vm.activeSpace;

  const {
    entries,
    loading: filesLoading,
    loadingMore,
    total,
    hasMore,
    reload,
    loadMore,
    filter: typeFilter,
    setFilter: setTypeFilter,
  } = useFileList(activeSpaceId, currentParentId);
  const ops = useDriveOps();
  const upload = useUpload(reload);

  // Selection is scoped to <space>::<parent> so navigating between folders
  // never carries stale ids into a listing they don't belong to.
  const selectionContextKey = activeSpaceId ? `${activeSpaceId}::${currentParentId}` : null;
  const selection = useSelection(entries, selectionContextKey);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Per-row transient state for batch ops. Pending = in flight, half-opacity
  // + non-interactive; removing = op succeeded, row plays the fade-out
  // animation for one frame before the parent removes it from entries.
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [removingIds, setRemovingIds] = useState<Set<number>>(() => new Set());

  // Drag-drop upload target. Reuses useUpload.addFiles so dropped files
  // flow through the exact same presigned-URL / progress pipeline as
  // <UploadButton>. Disabled when the current space is missing or the
  // user lacks upload permission.
  const canUploadRef = useRef(false);
  const dropzone = useDropzone({
    disabled: !activeSpaceId,
    onDrop: (files) => {
      if (!canUploadRef.current || !activeSpaceId) return;
      upload.addFiles(files, activeSpaceId, currentParentId);
    },
  });

  const handleDownload = useCallback(
    async (entry: DriveEntry) => {
      try {
        const { url, filename } = await api.getDownloadUrl(entry.id);
        // M-3: validate the signed GET URL before handing it to the browser.
        api.assertSafePresignedURL(url);
        triggerBrowserDownload(url, filename || entry.name);
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.download.failed'));
      }
    },
    [t],
  );

  // Type-1 doc: jump to the standalone docs page (preview/editor). The mounted
  // entry carries the doc id in ref_id; buildDocLink is the same /d/:docId form
  // used by forwarded-doc links (@octo/base). Carry the doc's OWN space as ?sp=
  // so cross-space recipients hit the right doc; when absent, omit sp (do NOT
  // fall back to entry.space_id — that is drive's mount space, wrong across tenants).
  const handleOpenDoc = useCallback(
    (entry: DriveEntry) => {
      if (!entry.ref_id) {
        Toast.error(t('drive.toast.opFailed'));
        return;
      }
      window.open(
        buildDocLink({ docId: entry.ref_id, space: entry.doc_space_id }),
        '_blank',
        'noopener,noreferrer',
      );
    },
    [t],
  );

  // ── Modal state ─────────────────────────────────────────────────────────
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DriveEntry | null>(null);
  const [moveState, setMoveState] = useState<{ entries: DriveEntry[]; mode: 'move' | 'copy' } | null>(null);
  const [mountModalOpen, setMountModalOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DriveEntry | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);

  // Close every modal when the active space changes: a modal target (rename /
  // move / share entry, or an open invite/member/mount dialog) belongs to the
  // space it was opened in. Carrying it into a newly selected space would hand a
  // stale entry to a dialog now scoped to different membership/permissions.
  useEffect(() => {
    setFolderModalOpen(false);
    setRenameTarget(null);
    setMoveState(null);
    setMountModalOpen(false);
    setShareTarget(null);
    setInviteModalOpen(false);
    setMemberModalOpen(false);
  }, [activeSpaceId]);

  // Clear the row flash ~2s after focusFile lands, so the CSS animation stops
  // and the row returns to its normal state. Re-arms on every new highlight.
  const highlightFileId = vm.highlightFileId;
  useEffect(() => {
    if (highlightFileId == null) return;
    const timer = window.setTimeout(() => vm.clearHighlight(), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightFileId, vm]);

  const openFolder = useCallback((entry: DriveEntry) => {
    vm.enterFolder(entry.id, entry.name);
  }, [vm]);

  const handleDelete = useCallback(
    (entry: DriveEntry) => {
      const isFolder = entry.type === 'folder';
      // Folder deletion is a cascade soft-delete on the backend
      // (folder/service.go SoftDeleteSubtree), so surface a stronger warning up
      // front with the word "文件夹" highlighted for scan-ability. Non-folder
      // entries (blob / doc) keep the lightweight generic confirm.
      const content = isFolder
        ? (
            <span>
              {t('drive.delete.folderConfirmPrefix')}
              <span style={{ color: 'var(--wk-danger)', fontWeight: 500 }}>
                {' '}{t('drive.delete.folderWord')}{' '}
              </span>
              {`"${entry.name}" `}
              {t('drive.delete.folderConfirmSuffix')}
            </span>
          )
        : `${t('drive.delete.content')} "${entry.name}"`;

      Modal.confirm({
        title: isFolder ? t('drive.delete.folderTitle') : t('drive.delete.title'),
        content,
        okText: t('drive.file.delete'),
        cancelText: t('drive.common.cancel'),
        okButtonProps: { type: 'danger' },
        onOk: async () => {
          const ok = await ops.deleteEntry(entry);
          if (ok) reload();
        },
      });
    },
    [ops, reload, t],
  );

  const hasSpace = !!activeSpaceId;
  const isShared = activeSpace?.type === 'shared';
  const isPersonal = activeSpace?.type === 'personal';

  // Per-role button gating (backend rank order, see ROLE_RANK). In a shared
  // space the capabilities come from the current user's membership role; in a
  // personal space the owner has full rights (useMembers isn't fetched there,
  // so grant directly). Hiding actions the backend would reject with 403 keeps
  // the UI honest — e.g. a downloader sees only download + share.
  const m = useMembers(activeSpaceId, isShared);
  const canUpload = isPersonal || (isShared && m.canUpload);
  const canEdit = isPersonal || (isShared && m.canEdit);
  const canDownload = isPersonal || (isShared && m.canDownload);
  const canShare = isPersonal || (isShared && m.canShare);
  const canManage = isShared && m.canManage; // invite + member mgmt: shared-space admin+

  // Keep the drop-target's permission check current — useDropzone only
  // captured a closure over its initial values, so we sync the ref every
  // render. This avoids re-registering the whole hook when permissions
  // change (which would drop the enter counter mid-drag).
  useEffect(() => {
    canUploadRef.current = !!canUpload;
  }, [canUpload]);

  // Infinite scroll: as the sentinel scrolls into view (200px rootMargin so
  // the next page is landing as the user approaches the bottom), fire
  // loadMore(). loadMore() itself is a no-op when !hasMore or already
  // loading, so double-triggers are cheap.
  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    hasMore,
    loading: filesLoading || loadingMore,
    onLoadMore: loadMore,
  });

  // ── Batch ops ────────────────────────────────────────────────────────────
  // Content shape for the batch-delete confirm. Three shapes:
  //  - all files → light generic prompt, no danger keyword.
  //  - all folders → "N 项文件夹" highlighted; suffix warns about cascade.
  //  - mixed → same cascade warning framed around "M 项文件夹 among N total".
  const buildBatchDeleteContent = useCallback(
    (files: DriveEntry[], folders: DriveEntry[]) => {
      const total = files.length + folders.length;
      if (folders.length === 0) {
        return t('drive.bulk.deleteContentFiles', { values: { count: String(total) } });
      }
      const danger = (text: string) => (
        <span style={{ color: 'var(--wk-danger)', fontWeight: 500 }}>{text}</span>
      );
      if (files.length === 0) {
        return (
          <span>
            {t('drive.bulk.deleteContentFoldersPrefix')}
            {' '}
            {danger(t('drive.bulk.deleteContentFoldersWord', { values: { count: String(total) } }))}
            {' '}
            {t('drive.bulk.deleteContentFoldersSuffix')}
          </span>
        );
      }
      return (
        <span>
          {t('drive.bulk.deleteContentMixedPrefix', { values: { count: String(total) } })}
          {' '}
          {danger(t('drive.bulk.deleteContentMixedWord', { values: { folderCount: String(folders.length) } }))}
          {t('drive.bulk.deleteContentMixedSuffix')}
        </span>
      );
    },
    [t],
  );

  // Present a batch result as an alert-style dialog. Success-only paths get a
  // Toast; anything with failures uses a Modal so the user can read the list.
  const reportBatchResult = useCallback(
    (
      action: 'delete' | 'move' | 'download',
      succeeded: DriveEntry[],
      failed: Array<{ entry: DriveEntry; error: string }>,
    ) => {
      const actionLabel = t(`drive.bulk.action${action.charAt(0).toUpperCase()}${action.slice(1)}`);
      if (failed.length === 0) {
        Toast.success(
          `${t('drive.bulk.resultTitleAllOk')} · ${t('drive.bulk.resultSummarySuccess', {
            values: { count: String(succeeded.length) },
          })}`,
        );
        return;
      }
      // Sample first 8 failed rows; anything more folds under "…".
      const shown = failed.slice(0, 8);
      const rest = failed.length - shown.length;
      Modal.warning({
        title:
          succeeded.length === 0
            ? t('drive.bulk.resultTitleAllFailed')
            : t('drive.bulk.resultTitlePartial'),
        content: (
          <div>
            {succeeded.length > 0 && (
              <div style={{ color: 'var(--wk-ok)', marginBottom: 8 }}>
                ✓ {t('drive.bulk.resultSummarySuccess', { values: { count: String(succeeded.length) } })}
              </div>
            )}
            <div style={{ color: 'var(--wk-danger)', marginBottom: 6, fontWeight: 500 }}>
              ✕ {t('drive.bulk.resultSummaryFailed', { values: { count: String(failed.length) } })} · {actionLabel}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflowY: 'auto', fontSize: 13 }}>
              {shown.map((f) => (
                <li key={f.entry.id} style={{ marginBottom: 2 }}>
                  {f.entry.name}{' '}
                  <span style={{ color: 'var(--wk-text-tertiary)' }}>— {f.error}</span>
                </li>
              ))}
              {rest > 0 && (
                <li style={{ color: 'var(--wk-text-tertiary)', listStyle: 'none', marginTop: 4 }}>
                  … +{rest}
                </li>
              )}
            </ul>
          </div>
        ),
        okText: t('drive.bulk.resultOk'),
        hasCancel: false,
      });
    },
    [t],
  );

  const selectedEntries = selection.selectedEntries;
  const handleBulkDelete = useCallback(() => {
    if (selectedEntries.length === 0) return;
    const folders = selectedEntries.filter((e) => e.type === 'folder');
    const files = selectedEntries.filter((e) => e.type !== 'folder');
    const hasFolder = folders.length > 0;

    Modal.confirm({
      title:
        folders.length > 0 && files.length > 0
          ? t('drive.bulk.deleteTitleMixed')
          : folders.length > 0
            ? t('drive.bulk.deleteTitleFolders')
            : t('drive.bulk.deleteTitleFiles'),
      content: buildBatchDeleteContent(files, folders),
      okText: t('drive.file.delete'),
      cancelText: t('drive.common.cancel'),
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        setBulkBusy(true);
        // Mark every row as pending up front so users see the whole batch
        // dim as work starts.
        const batchIds = selectedEntries.map((e) => e.id);
        setPendingIds(new Set(batchIds));
        try {
          const { succeeded, failed } = await runBatch(
            selectedEntries,
            async (entry) => {
              const ok = await ops.deleteEntry(entry);
              if (!ok) throw new Error(t('drive.toast.opFailed'));
            },
            {
              // Per-row transition on each item as it settles: successful
              // rows flip pending → removing (fades out); failed rows just
              // drop the pending tint so they're back to a normal row.
              onSettled: (r) => {
                setPendingIds((prev) => {
                  const next = new Set(prev);
                  next.delete(r.entry.id);
                  return next;
                });
                if (r.ok) {
                  setRemovingIds((prev) => {
                    const next = new Set(prev);
                    next.add(r.entry.id);
                    return next;
                  });
                }
              },
            },
          );
          // Give the removal animation (260ms) time to finish before we
          // reload — otherwise the list re-renders under the transition
          // and the fade-out looks like a hard cut.
          await new Promise((r) => setTimeout(r, 280));
          if (succeeded.length > 0) reload();
          setRemovingIds(new Set());
          selection.clear();
          reportBatchResult('delete', succeeded, failed);
        } finally {
          setBulkBusy(false);
        }
      },
    });
    // hasFolder is destructured for a future 'folder-aware' danger surface;
    // silence the unused-var lint without changing behaviour.
    void hasFolder;
  }, [selectedEntries, buildBatchDeleteContent, ops, reload, selection, reportBatchResult, t]);

  const handleBulkMove = useCallback(() => {
    if (selectedEntries.length === 0) return;
    // Batch move uses the same MoveModal as single-row moves; the picker
    // shows the current space's folder tree, hides every folder in the
    // batch, and runs a loop of ops.moveEntry() under runBatch on confirm.
    // Cross-space is backend-rejected (folder/service.go:148,
    // file/service.go:273) so the picker's same-space scope is a feature.
    setMoveState({ entries: selectedEntries, mode: 'move' });
  }, [selectedEntries]);

  const handleBulkDownload = useCallback(async () => {
    if (selectedEntries.length === 0) return;
    // Backend has no zip endpoint; loop signed-URL downloads. Skip folders —
    // getDownloadUrl only serves blobs.
    const blobs = selectedEntries.filter((e) => e.type === 'blob');
    if (blobs.length === 0) {
      Toast.info(t('drive.bulk.download'));
      return;
    }
    setBulkBusy(true);
    try {
      const { succeeded, failed } = await runBatch(blobs, async (entry) => {
        const { url, filename } = await api.getDownloadUrl(entry.id);
        api.assertSafePresignedURL(url);
        triggerBrowserDownload(url, filename || entry.name);
      });
      reportBatchResult('download', succeeded, failed);
    } finally {
      setBulkBusy(false);
    }
  }, [selectedEntries, reportBatchResult, t]);

  // While anything is selected, the header morphs into the batch bar; this
  // keeps the active batch focused and prevents accidental clicks on the
  // regular toolbar (new folder / upload) that shouldn't apply per-item.
  const showBulkBar = selection.hasSelection;

  const showSelectionCheckboxes = useMemo(
    () => canEdit || canDownload, // Selection is only useful if some batch op is available.
    [canEdit, canDownload],
  );

  return (
    <main className="drive-main">
      {showBulkBar ? (
        <BulkActionBar
          count={selection.count}
          canEdit={canEdit}
          canDownload={canDownload}
          busy={bulkBusy}
          onDelete={handleBulkDelete}
          onMove={handleBulkMove}
          onDownload={handleBulkDownload}
          onClear={selection.clear}
        />
      ) : (
        <div className="drive-main__header">
          <Breadcrumb path={vm.path} onNavigate={(i) => vm.navigateTo(i)} />
          <div className="drive-main__actions">
            <FilterChips value={typeFilter} onChange={setTypeFilter} />
            {canUpload && (
              <UploadButton
                disabled={!hasSpace}
                onFiles={(files) => {
                  if (activeSpaceId) upload.addFiles(files, activeSpaceId, currentParentId);
                }}
              />
            )}
            {canEdit && (
              <Button
                className="drive-btn"
                icon={<FolderPlus size={16} />}
                disabled={!hasSpace}
                onClick={() => setFolderModalOpen(true)}
              >
                {t('drive.file.newFolder')}
              </Button>
            )}
            {/* Mount doc = adding content (like upload), gated at uploader_downloader+;
                unmount/remove is editor+ and lives in the file row menu. */}
            {canUpload && (
              <Button
                className="drive-btn"
                icon={<FilePlus2 size={16} />}
                disabled={!hasSpace}
                onClick={() => setMountModalOpen(true)}
              >
                {t('drive.mount.title')}
              </Button>
            )}
            {canManage && (
              <Button
                className="drive-btn"
                icon={<UserPlus size={16} />}
                onClick={() => setInviteModalOpen(true)}
              >
                {t('drive.invite.title')}
              </Button>
            )}
            {canManage && (
              <Button
                className="drive-btn"
                icon={<Users size={16} />}
                onClick={() => setMemberModalOpen(true)}
              >
                {t('drive.member.title')}
              </Button>
            )}
          </div>
        </div>
      )}

      <UploadProgress items={upload.items} onRetry={upload.retry} onDismiss={upload.dismiss} />

      <div className="drive-main__body" {...dropzone.bind}>
        {canUpload && (
          <DropzoneOverlay
            active={dropzone.isDraggingOver}
            targetName={vm.path[vm.path.length - 1]?.name}
          />
        )}
        {!hasSpace && vm.spacesLoading ? (
          <div className="drive-main__center">
            <Spin />
          </div>
        ) : !filesLoading && entries.length === 0 ? (
          // Split the empty state into three variants so preview_only users
          // don't see an upload CTA that would 403, and filter-empty offers
          // a one-click reset rather than looking like the folder is empty.
          <EmptyState
            variant={
              typeFilter !== 'all'
                ? 'filter-empty'
                : canUpload
                  ? 'folder-empty'
                  : 'folder-empty-readonly'
            }
            onClearFilter={typeFilter !== 'all' ? () => setTypeFilter('all') : undefined}
          />
        ) : (
          <FileList
            entries={entries}
            loading={filesLoading}
            onOpenFolder={openFolder}
            onOpenDoc={handleOpenDoc}
            onRename={setRenameTarget}
            onMove={(entry) => setMoveState({ entries: [entry], mode: 'move' })}
            onCopy={(entry) => setMoveState({ entries: [entry], mode: 'copy' })}
            onDelete={handleDelete}
            onShare={setShareTarget}
            onDownload={handleDownload}
            canDownload={canDownload}
            canEdit={canEdit}
            canShare={canShare}
            highlightFileId={highlightFileId}
            selection={
              showSelectionCheckboxes
                ? {
                    isSelected: selection.isSelected,
                    toggle: selection.toggle,
                    isAllSelected: selection.isAllSelected,
                    isIndeterminate: selection.isIndeterminate,
                    toggleAll: selection.toggleAll,
                  }
                : undefined
            }
            pendingIds={pendingIds}
            removingIds={removingIds}
          />
        )}
        {hasMore && (
          <>
            {loadingMore && (
              <div className="drive-main__loading-more">
                <Spin size="small" />
              </div>
            )}
            <div ref={sentinelRef} className="drive-main__sentinel" aria-hidden="true" />
          </>
        )}
        {total !== null && !hasMore && entries.length > 0 && total > entries.length && (
          <p className="drive-main__truncated">
            {t('drive.file.truncated')} ({entries.length}/{total})
          </p>
        )}
      </div>

      <NameInputModal
        visible={folderModalOpen}
        title={t('drive.file.newFolder')}
        placeholder={t('drive.file.folderNamePlaceholder')}
        onClose={() => setFolderModalOpen(false)}
        onSubmit={async (name) => {
          if (!activeSpaceId) return false;
          const ok = await ops.createFolder(activeSpaceId, currentParentId, name);
          if (ok) reload();
          return ok;
        }}
      />

      <NameInputModal
        visible={!!renameTarget}
        title={t('drive.file.renameTitle')}
        initialValue={renameTarget?.name ?? ''}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (name) => {
          if (!renameTarget) return false;
          const ok = await ops.renameEntry(renameTarget, name);
          if (ok) reload();
          return ok;
        }}
      />

      <MoveModal
        visible={!!moveState}
        mode={moveState?.mode ?? 'move'}
        entries={moveState?.entries ?? null}
        spaceId={activeSpaceId}
        rootName={activeSpace ? spaceDisplayName(activeSpace, t) : t('drive.file.root')}
        onClose={() => setMoveState(null)}
        onConfirm={async (targetParentId) => {
          if (!moveState || moveState.entries.length === 0) return false;
          const { entries: targets, mode } = moveState;
          // Single-item path: preserve legacy behaviour (return whatever
          // ops.moveEntry / copyEntry returned so a rejected op keeps the
          // modal open with the picker state intact).
          if (targets.length === 1) {
            const [only] = targets;
            const ok =
              mode === 'move'
                ? await ops.moveEntry(only, targetParentId)
                : await ops.copyEntry(only, targetParentId, only.name);
            if (ok) {
              reload();
              // Clear this single-item selection if the row was batch-checked
              // (single move via row menu doesn't touch selection at all).
              if (selection.isSelected(only.id)) selection.clear();
            }
            return ok;
          }
          // Batch path: loop the single-id endpoints under runBatch and
          // report a summary. Return true iff ANY item succeeded so the
          // modal closes on partial success (users can inspect the failed-
          // list in the reportBatchResult modal).
          const { succeeded, failed } = await runBatch(targets, async (entry) => {
            const ok =
              mode === 'move'
                ? await ops.moveEntry(entry, targetParentId)
                : await ops.copyEntry(entry, targetParentId, entry.name);
            if (!ok) throw new Error(t('drive.toast.opFailed'));
          });
          if (succeeded.length > 0) {
            reload();
            selection.clear();
          }
          reportBatchResult(mode === 'move' ? 'move' : 'move', succeeded, failed);
          return succeeded.length > 0;
        }}
      />

      <MountDocsModal
        visible={mountModalOpen}
        spaceId={activeSpaceId}
        parentId={currentParentId}
        onClose={() => setMountModalOpen(false)}
        onMounted={reload}
      />

      <ShareModal
        visible={!!shareTarget}
        entry={shareTarget}
        onClose={() => setShareTarget(null)}
      />

      <InviteModal
        visible={inviteModalOpen}
        spaceId={activeSpaceId}
        onClose={() => setInviteModalOpen(false)}
      />

      <MemberModal
        visible={memberModalOpen}
        spaceId={activeSpaceId}
        onClose={() => setMemberModalOpen(false)}
      />
    </main>
  );
}

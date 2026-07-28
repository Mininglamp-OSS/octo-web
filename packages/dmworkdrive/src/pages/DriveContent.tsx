import React, { useCallback, useState } from 'react';
import { useI18n, buildDocLink } from '@octo/base';
import { Button, Modal, Spin } from '@douyinfe/semi-ui';
import { FolderPlus, FilePlus2, UserPlus, Users } from 'lucide-react';
import { useFileList } from '../hooks/useFileList';
import { useDriveOps } from '../hooks/useDriveOps';
import { useUpload } from '../hooks/useUpload';
import { useMembers } from '../hooks/useMembers';
import type { DriveEntry } from '../bridge/types';
import * as api from '../api/driveApi';
import { Toast } from '../utils/toast';
import { triggerBrowserDownload } from '../utils/download';
import { spaceDisplayName } from '../utils/spaceName';
import Breadcrumb from '../ui/Breadcrumb';
import FileList from '../ui/FileList';
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

  const { entries, loading: filesLoading, reload } = useFileList(activeSpaceId, currentParentId);
  const ops = useDriveOps();
  const upload = useUpload(reload);

  const handleDownload = useCallback(
    async (entry: DriveEntry) => {
      try {
        const { url, filename } = await api.getDownloadUrl(entry.id);
        // M-3: validate the signed GET URL before handing it to the browser.
        api.assertSafeUploadURL(url);
        triggerBrowserDownload(url, filename || entry.name);
      } catch (err: unknown) {
        Toast.error((err as Error)?.message || t('drive.download.failed'));
      }
    },
    [t],
  );

  // Type-1 doc: jump to the standalone docs page (preview/editor). The mounted
  // entry carries the doc id in ref_id; buildDocLink is the same /d/:docId form
  // used by forwarded-doc links (@octo/base).
  const handleOpenDoc = useCallback(
    (entry: DriveEntry) => {
      if (!entry.ref_id) {
        Toast.error(t('drive.toast.opFailed'));
        return;
      }
      window.open(buildDocLink({ docId: entry.ref_id }), '_blank', 'noopener,noreferrer');
    },
    [t],
  );

  // ── Modal state ─────────────────────────────────────────────────────────
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DriveEntry | null>(null);
  const [moveState, setMoveState] = useState<{ entry: DriveEntry; mode: 'move' | 'copy' } | null>(null);
  const [mountModalOpen, setMountModalOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DriveEntry | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);

  const openFolder = useCallback((entry: DriveEntry) => {
    vm.enterFolder(entry.id, entry.name);
  }, [vm]);

  const handleDelete = useCallback(
    (entry: DriveEntry) => {
      Modal.confirm({
        title: t('drive.delete.title'),
        content: `${t('drive.delete.content')} "${entry.name}"`,
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

  return (
    <main className="drive-main">
      <div className="drive-main__header">
        <Breadcrumb path={vm.path} onNavigate={(i) => vm.navigateTo(i)} />
        <div className="drive-main__actions">
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
              icon={<FilePlus2 size={16} />}
              disabled={!hasSpace}
              onClick={() => setMountModalOpen(true)}
            >
              {t('drive.mount.title')}
            </Button>
          )}
          {canManage && (
            <Button
              icon={<UserPlus size={16} />}
              onClick={() => setInviteModalOpen(true)}
            >
              {t('drive.invite.title')}
            </Button>
          )}
          {canManage && (
            <Button
              icon={<Users size={16} />}
              onClick={() => setMemberModalOpen(true)}
            >
              {t('drive.member.title')}
            </Button>
          )}
        </div>
      </div>

      <UploadProgress items={upload.items} onRetry={upload.retry} onDismiss={upload.dismiss} />

      <div className="drive-main__body">
        {!hasSpace && vm.spacesLoading ? (
          <div className="drive-main__center">
            <Spin />
          </div>
        ) : (
          <FileList
            entries={entries}
            loading={filesLoading}
            onOpenFolder={openFolder}
            onOpenDoc={handleOpenDoc}
            onRename={setRenameTarget}
            onMove={(entry) => setMoveState({ entry, mode: 'move' })}
            onCopy={(entry) => setMoveState({ entry, mode: 'copy' })}
            onDelete={handleDelete}
            onShare={setShareTarget}
            onDownload={handleDownload}
            canDownload={canDownload}
            canEdit={canEdit}
            canShare={canShare}
          />
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
        entry={moveState?.entry ?? null}
        spaceId={activeSpaceId}
        rootName={activeSpace ? spaceDisplayName(activeSpace, t) : t('drive.file.root')}
        onClose={() => setMoveState(null)}
        onConfirm={async (targetParentId) => {
          if (!moveState) return false;
          const { entry, mode } = moveState;
          const ok =
            mode === 'move'
              ? await ops.moveEntry(entry, targetParentId)
              : await ops.copyEntry(entry, targetParentId, entry.name);
          if (ok) reload();
          return ok;
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

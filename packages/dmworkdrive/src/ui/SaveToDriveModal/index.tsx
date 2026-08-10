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
}: SaveToDriveModalProps) {
  const { t: ti } = useI18n();

  // Compute the pre-selected space when the modal opens. Prefer the caller-
  // supplied default, but drop it if the caller lacks upload rank there
  // (would land in a "disabled" option). Otherwise pick the personal space,
  // otherwise the first uploader-eligible space, otherwise the first space.
  const initialSpaceId = useMemo(() => {
    const canUpload = (s: Space): boolean => {
      if (!s.viewer_role) return true; // unknown role → don't pre-gate
      return (ROLE_RANK[s.viewer_role as keyof typeof ROLE_RANK] ?? 0) >= UPLOADER_RANK;
    };
    if (defaultSpaceId) {
      const sp = spaces.find((s) => s.id === defaultSpaceId);
      if (sp && canUpload(sp)) return sp.id;
    }
    const personal = spaces.find((s) => s.type === 'personal' && canUpload(s));
    if (personal) return personal.id;
    const anyUploadable = spaces.find(canUpload);
    if (anyUploadable) return anyUploadable.id;
    return spaces[0]?.id ?? null;
  }, [defaultSpaceId, spaces]);

  const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId);
  const [path, setPath] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const activeSpace = spaces.find((s) => s.id === spaceId) ?? null;
  const rootName = activeSpace ? spaceDisplayName(activeSpace, t) : ti('drive.file.root');

  // Reset picker state whenever the modal opens or the selected space
  // changes: breadcrumb collapses to the space root; folder list re-fetches.
  useEffect(() => {
    if (!visible) return;
    setSpaceId(initialSpaceId);
  }, [visible, initialSpaceId]);

  useEffect(() => {
    if (!visible) return;
    setPath([{ id: 0, name: rootName }]);
  }, [visible, spaceId, rootName]);

  const currentId = path.length ? path[path.length - 1].id : 0;

  useEffect(() => {
    if (!visible || !spaceId) return;
    let alive = true;
    setLoading(true);
    api
      .browse({ space_id: spaceId, parent_id: currentId, type: 'folder', page_size: 200 })
      .then((res) => {
        if (alive) {
          setFolders((res.entries ?? []).filter((e) => e.type === 'folder'));
        }
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
  }, [visible, spaceId, currentId]);

  const handleOk = async (): Promise<void> => {
    if (submitting || !spaceId) return;
    setSubmitting(true);
    try {
      const ok = await onConfirm(spaceId, currentId);
      if (ok) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  // Space is uploadable if viewer_role is unknown (be permissive; backend
  // is the final gate) or its rank meets the uploader floor.
  const spaceUploadable = (s: Space): boolean => {
    if (!s.viewer_role) return true;
    return (ROLE_RANK[s.viewer_role as keyof typeof ROLE_RANK] ?? 0) >= UPLOADER_RANK;
  };

  const okDisabled = !spaceId || (activeSpace ? !spaceUploadable(activeSpace) : true);

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
      <div className="drive-save">
        <div className="drive-save__space">
          <label className="drive-save__label">{ti('drive.saveModal.selectSpace')}</label>
          <Select
            value={spaceId ?? undefined}
            onChange={(v) => setSpaceId(String(v))}
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
        </div>
      </div>
    </Modal>
  );
}

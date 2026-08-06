import React, { useState, useEffect } from 'react';
import { useI18n, t } from '@octo/base';
import { Modal, Spin } from '@douyinfe/semi-ui';
import { Folder, ChevronRight } from 'lucide-react';
import * as api from '../../api/driveApi';
import type { DriveEntry } from '../../bridge/types';
import { Toast } from '../../utils/toast';
import Breadcrumb, { Crumb } from '../Breadcrumb';
import './index.css';

export interface MoveModalProps {
  visible: boolean;
  mode: 'move' | 'copy';
  /**
   * Items being moved / copied. A single-entry array is equivalent to the
   * pre-batch legacy shape, so single-row callers can just pass `[entry]`.
   * Empty or null → modal renders nothing and OK stays disabled.
   */
  entries: DriveEntry[] | null;
  spaceId: string | null;
  /** Space display name, shown as the breadcrumb root. */
  rootName: string;
  /**
   * Return true to close (caller ran the move/copy). Signature is unchanged
   * from the single-entry days — the caller runs the actual per-item loop
   * (via runBatch) and reports back with true iff *at least one item*
   * settled successfully.
   */
  onConfirm: (targetParentId: number) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Folder picker for move/copy. Navigates the destination space's folder tree
 * (browse type=folder) with breadcrumb back-navigation; the current folder is
 * the destination. When a batch of folders is being moved, every folder in
 * the batch is hidden from the picker so none of them can be nested in
 * itself; deeper cycles are still left to the backend to reject.
 *
 * Batch caveat: same-space only. The backend rejects cross-space moves at
 * folder/service.go:148 and file/service.go:273, so the picker only shows
 * the current space's folder tree by design.
 */
export default function MoveModal({
  visible,
  mode,
  entries,
  spaceId,
  rootName,
  onConfirm,
  onClose,
}: MoveModalProps) {
  const { t: ti } = useI18n();
  const [path, setPath] = useState<Crumb[]>([{ id: 0, name: rootName }]);
  const [folders, setFolders] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currentId = path.length ? path[path.length - 1].id : 0;
  const batch = entries ?? [];
  const primary = batch[0] ?? null;
  const isBatch = batch.length > 1;

  useEffect(() => {
    if (visible) setPath([{ id: 0, name: rootName }]);
  }, [visible, rootName]);

  useEffect(() => {
    if (!visible || !spaceId) return;
    let alive = true;
    setLoading(true);
    // Hide every folder in the batch from the destination list so users
    // can't nest a folder inside itself (self-move) OR inside another
    // folder that's ALSO being moved (destination would disappear).
    // Deeper cycles (descendant of a moved folder) are still backend-
    // rejected; this is the shallow guard.
    const hiddenIds = new Set(batch.filter((e) => e.type === 'folder').map((e) => e.id));
    api
      .browse({ space_id: spaceId, parent_id: currentId, type: 'folder', page_size: 200 })
      .then((res) => {
        if (alive) {
          setFolders(
            (res.entries ?? []).filter((e) => e.type === 'folder' && !hiddenIds.has(e.id)),
          );
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
    // batch identity doesn't need to be in deps — hiddenIds is derived from
    // entries which is stable per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, spaceId, currentId, entries]);

  const handleOk = async () => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await onConfirm(currentId);
    setSubmitting(false);
    if (ok) onClose();
  };

  // For MOVE, target = origin is a no-op. In a batch, this only fires when
  // every item shares the same parent AND that parent === current picker
  // location. Copy allows it (produces a duplicate).
  const commonParentId =
    mode === 'move' && batch.length > 0
      ? batch.every((e) => e.parent_id === batch[0].parent_id)
        ? batch[0].parent_id
        : null
      : null;
  const sameAsOrigin = commonParentId !== null && currentId === commonParentId;
  const okDisabled = !spaceId || batch.length === 0 || sameAsOrigin;

  return (
    <Modal
      title={
        mode === 'move'
          ? isBatch
            ? ti('drive.move.batchTitle', { values: { count: String(batch.length) } })
            : ti('drive.move.title')
          : ti('drive.copy.title')
      }
      visible={visible}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText={ti('drive.common.confirm')}
      cancelText={ti('drive.common.cancel')}
      okButtonProps={{ disabled: okDisabled }}
      maskClosable={false}
    >
      <div className="drive-move">
        {isBatch && primary && (
          <div className="drive-move__batch-summary">
            {ti('drive.move.batchSummary', {
              values: { count: String(batch.length), first: primary.name },
            })}
          </div>
        )}
        <Breadcrumb path={path} onNavigate={(i) => setPath((p) => p.slice(0, i + 1))} />
        <div className="drive-move__list">
          {loading ? (
            <div className="drive-move__center">
              <Spin size="small" />
            </div>
          ) : folders.length === 0 ? (
            <div className="drive-move__center drive-move__empty">{ti('drive.move.noSubfolder')}</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                className="drive-move__item"
                onClick={() => setPath((p) => [...p, { id: f.id, name: f.name }])}
              >
                <Folder size={16} className="drive-move__item-icon" />
                <span className="drive-move__item-name" title={f.name}>
                  {f.name}
                </span>
                <ChevronRight size={14} className="drive-move__item-arrow" />
              </button>
            ))
          )}
        </div>
        {sameAsOrigin && <div className="drive-move__hint">{ti('drive.move.sameLocation')}</div>}
      </div>
    </Modal>
  );
}

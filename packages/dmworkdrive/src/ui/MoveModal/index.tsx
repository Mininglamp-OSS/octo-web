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
  entry: DriveEntry | null;
  spaceId: string | null;
  /** Space display name, shown as the breadcrumb root. */
  rootName: string;
  /** Return true to close (caller ran the move/copy). */
  onConfirm: (targetParentId: number) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Folder picker for move/copy. Navigates the destination space's folder tree
 * (browse type=folder) with breadcrumb back-navigation; the current folder is
 * the destination. The moved folder itself is hidden so it can't be nested in
 * itself; deeper cycles are left to the backend to reject.
 */
export default function MoveModal({
  visible,
  mode,
  entry,
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

  useEffect(() => {
    if (visible) setPath([{ id: 0, name: rootName }]);
  }, [visible, rootName]);

  useEffect(() => {
    if (!visible || !spaceId) return;
    let alive = true;
    setLoading(true);
    api
      .browse({ space_id: spaceId, parent_id: currentId, type: 'folder', page_size: 200 })
      .then((res) => {
        if (alive) {
          setFolders((res.entries ?? []).filter((e) => e.type === 'folder' && e.id !== entry?.id));
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
  }, [visible, spaceId, currentId, entry?.id]);

  const handleOk = async () => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await onConfirm(currentId);
    setSubmitting(false);
    if (ok) onClose();
  };

  // Moving into the current parent is a no-op; copying there is allowed.
  const sameAsOrigin = mode === 'move' && !!entry && currentId === entry.parent_id;
  const okDisabled = !spaceId || !entry || sameAsOrigin;

  return (
    <Modal
      title={mode === 'move' ? ti('drive.move.title') : ti('drive.copy.title')}
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

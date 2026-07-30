import React from 'react';
import { useI18n } from '@octo/base';
import { Modal, Button, Spin, Tag } from '@douyinfe/semi-ui';
import { FileText } from 'lucide-react';
import { useMountableDocs } from '../../hooks/useMountableDocs';
import type { MountableDoc } from '../../bridge/types';
import './index.css';

export interface MountDocsModalProps {
  visible: boolean;
  spaceId: string | null;
  parentId: number;
  onClose: () => void;
  /** Called after a successful mount so the caller can refresh the file list. */
  onMounted: () => void;
}

/**
 * Lists the online docs the user may hand-mount into the current space/folder
 * (v4: manual mount is the only path in) and mounts a chosen one. The modal
 * stays open after each mount so the user can add several; mounted docs drop
 * out of the candidate list.
 */
export default function MountDocsModal({
  visible,
  spaceId,
  parentId,
  onClose,
  onMounted,
}: MountDocsModalProps) {
  const { t } = useI18n();
  const { docs, loading, mounting, mount } = useMountableDocs(spaceId, parentId, visible);

  const handleMount = async (doc: MountableDoc) => {
    const ok = await mount(doc);
    if (ok) onMounted();
  };

  return (
    <Modal
      title={t('drive.mount.title')}
      visible={visible}
      onCancel={onClose}
      footer={null}
      maskClosable={!mounting}
      width={520}
    >
      <div className="drive-mount">
        {loading ? (
          <div className="drive-mount__center">
            <Spin />
          </div>
        ) : docs.length === 0 ? (
          <div className="drive-mount__center drive-mount__empty">{t('drive.mount.empty')}</div>
        ) : (
          docs.map((doc) => (
            <div key={doc.doc_id} className="drive-mount__row">
              <FileText size={18} className="drive-mount__icon" />
              <span className="drive-mount__title" title={doc.title}>
                {doc.title || t('drive.mount.untitled')}
              </span>
              <Tag size="small" color={doc.access_type === 'owner' ? 'violet' : 'blue'}>
                {doc.access_type === 'owner' ? t('drive.mount.owner') : t('drive.mount.member')}
              </Tag>
              <Button size="small" disabled={mounting} onClick={() => handleMount(doc)}>
                {t('drive.mount.add')}
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

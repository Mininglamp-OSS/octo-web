import React, { useEffect, useState } from 'react';
import { useI18n, buildDocLink } from '@octo/base';
import { Modal, Input, Button, Spin } from '@douyinfe/semi-ui';
import { Copy, Check } from 'lucide-react';
import { useShare } from '../../hooks/useShare';
import type { DriveEntry } from '../../bridge/types';
import { buildShareLink } from '../../utils/links';
import { Toast } from '../../utils/toast';
import './index.css';

export interface ShareModalProps {
  visible: boolean;
  entry: DriveEntry | null;
  onClose: () => void;
}

/**
 * WeCom-style one-shot share. Opening the modal immediately generates a link
 * (no permission/expiry/password options) and copies it to the clipboard:
 *
 * - blob → a permanent public download link (reused if the file already has a
 *   valid one), permission fixed to download.
 * - doc  → the doc's own `/d/:docId` address; drive does not gate access, so we
 *   only note that the document's own sharing settings apply.
 */
export default function ShareModal({ visible, entry, onClose }: ShareModalProps) {
  const { t } = useI18n();
  const isDoc = entry?.type === 'doc';
  // Never auto-load the share list — ensure() does its own lookup, and the
  // WeCom flow shows a single link rather than a manageable list.
  const { ensure, creating } = useShare(entry?.id ?? null, false);

  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible || !entry) return;
    let cancelled = false;
    setLink('');
    setCopied(false);

    (async () => {
      let url = '';
      if (isDoc) {
        // Pure frontend: same /d/:docId address used to open the mounted doc.
        url = entry.ref_id ? buildDocLink({ docId: entry.ref_id }) : '';
      } else {
        const share = await ensure();
        url = share ? buildShareLink(share.id) : '';
      }
      if (cancelled) return;
      if (!url) {
        Toast.error(t('drive.share.generateFailed'));
        return;
      }
      setLink(url);
      try {
        await navigator.clipboard?.writeText(url);
        if (!cancelled) setCopied(true);
      } catch {
        // Clipboard blocked (non-secure ctx); the link is still shown to copy.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, entry, isDoc, ensure, t]);

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      Toast.success(t('drive.share.copied'));
    } catch {
      Toast.error(link);
    }
  };

  const message = isDoc ? t('drive.share.docGenerated') : t('drive.share.blobGenerated');

  return (
    <Modal
      title={`${t('drive.share.title')}${entry ? ` · ${entry.name}` : ''}`}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={480}
    >
      {creating && !link ? (
        <div className="drive-share__center">
          <Spin />
          <p className="drive-share__muted">{t('drive.share.generating')}</p>
        </div>
      ) : (
        <div className="drive-share__oneshot">
          <p className="drive-share__message">{message}</p>
          {isDoc && <p className="drive-share__muted">{t('drive.share.docPermissionFallback')}</p>}
          <div className="drive-share__linkrow">
            <Input value={link} readonly style={{ flex: 1 }} />
            <Button
              theme="solid"
              icon={copied ? <Check size={16} /> : <Copy size={16} />}
              onClick={handleCopy}
            >
              {copied ? t('drive.share.copied') : t('drive.share.copyLink')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

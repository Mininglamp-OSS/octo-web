import React, { useEffect, useState } from 'react';
import { useI18n, buildDocLink } from '@octo/base';
import { Modal, Input, Button, Spin } from '@douyinfe/semi-ui';
import { Copy, Check, Link2Off } from 'lucide-react';
import { useShare } from '../../hooks/useShare';
import type { DriveEntry } from '../../bridge/types';
import { buildShareLink } from '../../utils/links';
import { Toast } from '../../utils/toast';
import { copyToClipboard } from '@octo/base';
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
 *   valid one), permission fixed to download. The user can explicitly revoke it.
 * - doc  → the doc's own `/d/:docId` address; drive does not gate access, so we
 *   only note that the document's own sharing settings apply (nothing to revoke).
 */
export default function ShareModal({ visible, entry, onClose }: ShareModalProps) {
  const { t } = useI18n();
  const isDoc = entry?.type === 'doc';
  // Never auto-load the share list — ensure() does its own lookup, and the
  // WeCom flow shows a single link rather than a manageable list.
  const { ensure, revoke, creating } = useShare(entry?.id ?? null, false);

  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  /** id of the blob share backing `link`, so it can be revoked. Empty for docs. */
  const [shareId, setShareId] = useState('');
  const [revoked, setRevoked] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (!visible || !entry) return;
    let cancelled = false;
    setLink('');
    setCopied(false);
    setShareId('');
    setRevoked(false);

    (async () => {
      let url = '';
      if (isDoc) {
        // Pure frontend: same bare /d/:docId address used to open the mounted doc.
        // buildDocLink ignores Space inputs; authenticated open-context resolves the
        // canonical home Space instead of trusting the Drive mount context.
        url = entry.ref_id ? buildDocLink({ docId: entry.ref_id, space: entry.doc_space_id }) : '';
      } else {
        const share = await ensure();
        if (cancelled) return;
        url = share ? buildShareLink(share.id) : '';
        if (share) setShareId(share.id);
      }
      if (cancelled) return;
      if (!url) {
        Toast.error(t('drive.share.generateFailed'));
        return;
      }
      setLink(url);
      // Best-effort auto-copy on open. Uses the shared @octo/base
      // copyToClipboard helper (iOS-safe + execCommand fallback for
      // plain-HTTP LAN deployments). Failure is quiet — the user can
      // still hit the Copy button (same helper) or select the input.
      const ok = await copyToClipboard(url);
      if (!cancelled && ok) setCopied(true);
    })();

    return () => {
      cancelled = true;
    };
    // `t` is intentionally omitted: it's only read for the error toast, and the
    // i18n `t` identity can change per render — including it would re-run the
    // effect (re-issuing ensure()) on every state update. The real triggers are
    // the open/entry inputs. Matches InviteLandingPage's [token]-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry, isDoc, ensure]);

  const handleCopy = async () => {
    if (!link) return;
    const ok = await copyToClipboard(link);
    if (ok) {
      setCopied(true);
      Toast.success(t('drive.share.copied'));
    } else {
      // Both clipboard APIs failed (rare — sandboxed iframe / permission block).
      // Show the link so the user can select and copy manually.
      Toast.error(t('drive.share.copyFailed'));
    }
  };

  const handleRevoke = async () => {
    if (!shareId || revoking) return;
    setRevoking(true);
    // useShare.revoke toasts success/failure itself; only clear the link on success.
    const ok = await revoke(shareId);
    setRevoking(false);
    if (ok) {
      setLink('');
      setShareId('');
      setRevoked(true);
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
      ) : revoked ? (
        <div className="drive-share__oneshot">
          <p className="drive-share__message">{t('drive.share.revoked')}</p>
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
          {!isDoc && shareId && (
            <div className="drive-share__revokerow">
              <Button
                theme="borderless"
                type="danger"
                icon={<Link2Off size={16} />}
                loading={revoking}
                onClick={handleRevoke}
              >
                {t('drive.share.revoke')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

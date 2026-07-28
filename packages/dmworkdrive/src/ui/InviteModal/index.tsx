import React, { useState } from 'react';
import { useI18n } from '@octo/base';
import { Modal, Select, Button, Spin, Tag, Tabs, TabPane } from '@douyinfe/semi-ui';
import { Copy, Trash2, Link2, UserPlus } from 'lucide-react';
import { useInvite } from '../../hooks/useInvite';
import OrgPickerModal from '../OrgPickerModal';
import type { DriveRole } from '../../bridge/types';
import { buildInviteLink } from '../../utils/links';
import { formatTime } from '../../utils/format';
import { Toast } from '../../utils/toast';
import './index.css';

export interface InviteModalProps {
  visible: boolean;
  spaceId: string | null;
  onClose: () => void;
}

const DAY = 86400;

async function copy(text: string, okMsg: string) {
  try {
    await navigator.clipboard?.writeText(text);
    Toast.success(okMsg);
  } catch {
    Toast.error(text);
  }
}

/**
 * Invite members to a shared space, two ways (no approval, P1 v4): a token
 * invite link, and picking org members to add directly. Role + expiry apply to
 * whichever method is used.
 */
export default function InviteModal({ visible, spaceId, onClose }: InviteModalProps) {
  const { t } = useI18n();
  const { invites, loading, creating, create, revoke, addMembers } = useInvite(spaceId, visible);

  const [role, setRole] = useState<DriveRole>('editor');
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [orgOpen, setOrgOpen] = useState(false);

  const roleOptions = [
    { label: t('drive.invite.roleEditor'), value: 'editor' },
    { label: t('drive.invite.roleUploaderDownloader'), value: 'uploader_downloader' },
    { label: t('drive.invite.roleDownloader'), value: 'downloader' },
    { label: t('drive.invite.rolePreview'), value: 'preview_only' },
  ];
  const expiryOptions = [
    { label: t('drive.share.expiry1d'), value: 1 },
    { label: t('drive.share.expiry7d'), value: 7 },
    { label: t('drive.share.expiry30d'), value: 30 },
  ];

  return (
    <>
      <Modal
        title={t('drive.invite.title')}
        visible={visible}
        onCancel={onClose}
        footer={null}
        width={560}
      >
        <div className="drive-invite__common">
          <div className="drive-invite__field">
            <span className="drive-invite__label">{t('drive.invite.role')}</span>
            <Select
              optionList={roleOptions}
              value={role}
              onChange={(v) => setRole(v as DriveRole)}
              style={{ width: 180 }}
            />
          </div>
        </div>

        <Tabs type="line">
          <TabPane tab={t('drive.invite.byLink')} itemKey="link">
            <div className="drive-invite__linkbar">
              <div className="drive-invite__field">
                <span className="drive-invite__label">{t('drive.share.expiry')}</span>
                <Select
                  optionList={expiryOptions}
                  value={expiryDays}
                  onChange={(v) => setExpiryDays(v as number)}
                  style={{ width: 140 }}
                />
              </div>
              <Button
                theme="solid"
                icon={<Link2 size={16} />}
                loading={creating}
                onClick={() => create(role, expiryDays * DAY)}
              >
                {t('drive.invite.genLink')}
              </Button>
            </div>

            <div className="drive-invite__list">
              {loading ? (
                <div className="drive-invite__center">
                  <Spin />
                </div>
              ) : invites.length === 0 ? (
                <div className="drive-invite__center drive-invite__empty">{t('drive.invite.none')}</div>
              ) : (
                invites.map((inv) => (
                  <div key={inv.id} className="drive-invite__row">
                    <Tag size="small" color="violet">
                      {inv.role}
                    </Tag>
                    <span className="drive-invite__expiry">
                      {inv.expires_at ? `${t('drive.share.expiresAt')} ${formatTime(inv.expires_at)}` : ''}
                    </span>
                    <Button
                      theme="borderless"
                      type="tertiary"
                      size="small"
                      icon={<Copy size={16} />}
                      aria-label={t('drive.invite.copyLink')}
                      onClick={() => copy(buildInviteLink(inv.token), t('drive.invite.copied'))}
                    />
                    <Button
                      theme="borderless"
                      type="danger"
                      size="small"
                      icon={<Trash2 size={16} />}
                      aria-label={t('drive.invite.revoke')}
                      onClick={() => revoke(inv.id)}
                    />
                  </div>
                ))
              )}
            </div>
          </TabPane>

          <TabPane tab={t('drive.invite.byOrg')} itemKey="org">
            <div className="drive-invite__orgpane">
              <p className="drive-invite__hint">{t('drive.invite.byOrgHint')}</p>
              <Button icon={<UserPlus size={16} />} onClick={() => setOrgOpen(true)}>
                {t('drive.invite.pickMembers')}
              </Button>
            </div>
          </TabPane>
        </Tabs>
      </Modal>

      <OrgPickerModal
        visible={orgOpen}
        spaceId={spaceId ?? undefined}
        onClose={() => setOrgOpen(false)}
        onConfirm={async (uids) => {
          await addMembers(uids, role);
        }}
      />
    </>
  );
}

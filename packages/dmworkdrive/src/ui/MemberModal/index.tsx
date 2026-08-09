import React from 'react';
import { useI18n, WKApp } from '@octo/base';
import { Modal, Select, Button, Spin, Tag, Popconfirm, Avatar } from '@douyinfe/semi-ui';
import { UserMinus } from 'lucide-react';
import { useMembers } from '../../hooks/useMembers';
import type { DriveRole } from '../../bridge/types';
import { ROLE_LABEL_KEY } from '../../utils/roleLabel';
import { formatTime } from '../../utils/format';
import './index.css';

export interface MemberModalProps {
  visible: boolean;
  spaceId: string | null;
  onClose: () => void;
}

// Roles a manager may assign. super_admin (creator-fixed) and custom are never
// assignable through the UI; `admin` is filtered out unless the actor is the
// super_admin (backend enforces the same rule in member/service.go).
const ASSIGNABLE: DriveRole[] = [
  'admin',
  'editor',
  'uploader_downloader',
  'downloader',
  'preview_only',
];

/**
 * Shared-space member roster: lists members with their role + join time and,
 * for admin+ actors, lets them change roles or remove members. super_admin and
 * the actor's own row are never mutable; only the super_admin may grant admin.
 *
 * Identity shows the octo-server display name (resolved by the drive backend),
 * with the raw uid as fallback + hover title; the avatar is rendered from the
 * uid via WKApp.shared.avatarUser, matching the rest of the app.
 */
export default function MemberModal({ visible, spaceId, onClose }: MemberModalProps) {
  const { t } = useI18n();
  const {
    members,
    loading,
    busyUid,
    currentUid,
    superAdminUid,
    canManage,
    canGrantAdmin,
    updateRole,
    remove,
  } = useMembers(spaceId, visible);

  const roleLabel = (r: DriveRole) => t(ROLE_LABEL_KEY[r] ?? ROLE_LABEL_KEY.custom);

  // A member's dropdown always includes their current role (so it renders even
  // when not otherwise assignable, e.g. a peer admin seen by a non-super-admin).
  const optionsFor = (current: DriveRole) => {
    const roles = ASSIGNABLE.filter((r) => r !== 'admin' || canGrantAdmin);
    const set = roles.includes(current) ? roles : [current, ...roles];
    return set.map((r) => ({ label: roleLabel(r), value: r }));
  };

  return (
    <Modal
      title={t('drive.member.title')}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <div className="drive-member">
        {loading ? (
          <div className="drive-member__center">
            <Spin />
          </div>
        ) : members.length === 0 ? (
          <div className="drive-member__center drive-member__empty">
            {t('drive.member.empty')}
          </div>
        ) : (
          members.map((m) => {
            const isCreator = m.uid === superAdminUid;
            const isSelf = m.uid === currentUid;
            const editable = canManage && !isCreator && !isSelf;
            const busy = busyUid === m.uid;
            return (
              <div key={m.uid} className="drive-member__row">
                <Avatar
                  size="small"
                  color="light-blue"
                  className="drive-member__avatar"
                  src={WKApp.shared.avatarUser(m.uid)}
                  alt={m.name || m.uid}
                >
                  {(m.name || m.uid).slice(0, 1).toUpperCase()}
                </Avatar>
                <div className="drive-member__id">
                  <span className="drive-member__uid" title={m.uid}>
                    {m.name || m.uid}
                  </span>
                  <span className="drive-member__meta">
                    {isSelf && (
                      <Tag size="small" color="green">
                        {t('drive.member.you')}
                      </Tag>
                    )}
                    {isCreator && (
                      <Tag size="small" color="violet">
                        {t('drive.member.creator')}
                      </Tag>
                    )}
                    <span className="drive-member__joined">
                      {t('drive.member.joinedAt')} {formatTime(m.created_at)}
                    </span>
                  </span>
                </div>

                {editable ? (
                  <Select
                    size="small"
                    className="drive-member__role"
                    optionList={optionsFor(m.role)}
                    value={m.role}
                    disabled={busy}
                    onChange={(v) => {
                      if (v && v !== m.role) updateRole(m.uid, v as DriveRole);
                    }}
                  />
                ) : (
                  <Tag size="small" className="drive-member__roleTag">
                    {roleLabel(m.role)}
                  </Tag>
                )}

                {editable ? (
                  <Popconfirm
                    title={t('drive.member.removeConfirm')}
                    okText={t('drive.member.remove')}
                    cancelText={t('drive.common.cancel')}
                    okButtonProps={{ type: 'danger' }}
                    onConfirm={() => remove(m.uid)}
                  >
                    <Button
                      size="small"
                      type="danger"
                      theme="borderless"
                      disabled={busy}
                      icon={<UserMinus size={14} />}
                      aria-label={t('drive.member.remove')}
                    />
                  </Popconfirm>
                ) : (
                  <span className="drive-member__removeSlot" />
                )}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

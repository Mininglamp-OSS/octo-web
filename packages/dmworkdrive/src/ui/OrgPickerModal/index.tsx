import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useI18n } from '@octo/base';
import { Modal, Input, Spin, Tag } from '@douyinfe/semi-ui';
import { Check, Search } from 'lucide-react';
import { useOrgSearch } from '../../hooks/useOrgSearch';
import { useMembers } from '../../hooks/useMembers';
import { ROLE_LABEL_KEY } from '../../utils/roleLabel';
import type { OrgCandidate, DriveRole } from '../../bridge/types';
import './index.css';

export interface OrgPickerModalProps {
  visible: boolean;
  spaceId?: string;
  onClose: () => void;
  /** Receives the selected uids; the caller performs the actual add/invite. */
  onConfirm: (uids: string[]) => void | Promise<void>;
}

/**
 * Searchable multi-select org-member picker. Reusable across flows (P1: invite
 * members). Selection is kept locally and returned as uids on confirm; the
 * caller owns what "picking" means (add as member, etc.).
 *
 * Candidates already in the drive shared space are shown with their current
 * role but disabled (not selectable), so an inviter can see who is already in
 * and cannot re-add them. Membership is matched by uid — the org candidate list
 * (octo space members) and the drive member list live in different systems but
 * share the same user uid.
 */
export default function OrgPickerModal({ visible, spaceId, onClose, onConfirm }: OrgPickerModalProps) {
  const { t } = useI18n();
  const { candidates, loading, query, search } = useOrgSearch(spaceId);
  const { members } = useMembers(spaceId ?? null, visible);
  const [selected, setSelected] = useState<Record<string, OrgCandidate>>({});
  const [submitting, setSubmitting] = useState(false);

  /** uid → current drive role for members already in this shared space. */
  const memberRoleByUid = useMemo(() => {
    const map: Record<string, DriveRole> = {};
    for (const m of members) map[m.uid] = m.role;
    return map;
  }, [members]);

  // Reset selection each time the modal opens.
  useEffect(() => {
    if (visible) {
      setSelected({});
      search('');
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(
    (c: OrgCandidate) => {
      if (memberRoleByUid[c.uid]) return; // already a member — not selectable
      setSelected((prev) => {
        const next = { ...prev };
        if (next[c.uid]) delete next[c.uid];
        else next[c.uid] = c;
        return next;
      });
    },
    [memberRoleByUid],
  );

  const selectedUids = Object.keys(selected);

  const handleConfirm = async () => {
    if (selectedUids.length === 0 || submitting) return;
    setSubmitting(true);
    await onConfirm(selectedUids);
    setSubmitting(false);
    onClose();
  };

  const label = (c: OrgCandidate) => c.name || c.username || c.uid;
  const sub = (c: OrgCandidate) => c.username || c.email || c.phone || '';
  const roleLabel = (r: DriveRole) => t(ROLE_LABEL_KEY[r] ?? ROLE_LABEL_KEY.custom);

  return (
    <Modal
      title={t('drive.org.title')}
      visible={visible}
      onCancel={onClose}
      onOk={handleConfirm}
      confirmLoading={submitting}
      okText={
        selectedUids.length ? `${t('drive.org.confirm')} (${selectedUids.length})` : t('drive.org.confirm')
      }
      cancelText={t('drive.common.cancel')}
      okButtonProps={{ disabled: selectedUids.length === 0 }}
      width={480}
    >
      <Input
        prefix={<Search size={16} />}
        value={query}
        onChange={search}
        placeholder={t('drive.org.searchPlaceholder')}
        autoFocus
      />
      <div className="drive-org__list">
        {loading ? (
          <div className="drive-org__center">
            <Spin />
          </div>
        ) : candidates.length === 0 ? (
          <div className="drive-org__center drive-org__empty">
            {query.trim() ? t('drive.org.noResult') : t('drive.org.hint')}
          </div>
        ) : (
          candidates.map((c) => {
            const joinedRole = memberRoleByUid[c.uid];
            const joined = !!joinedRole;
            const on = !!selected[c.uid];
            return (
              <button
                key={c.uid}
                type="button"
                className={`drive-org__row${on ? ' drive-org__row--on' : ''}${joined ? ' drive-org__row--joined' : ''}`}
                aria-label={label(c)}
                aria-pressed={on}
                aria-disabled={joined}
                disabled={joined}
                onClick={() => toggle(c)}
              >
                <span className="drive-org__check">{on && <Check size={16} />}</span>
                <span className="drive-org__name">{label(c)}</span>
                {sub(c) && <span className="drive-org__sub">{sub(c)}</span>}
                {joined && (
                  <span className="drive-org__joined">
                    <Tag size="small" color="grey">
                      {roleLabel(joinedRole)}
                    </Tag>
                    <span className="drive-org__joined-hint">{t('drive.org.joined')}</span>
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}


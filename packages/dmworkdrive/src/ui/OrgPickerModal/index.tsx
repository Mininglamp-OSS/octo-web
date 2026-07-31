import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useI18n, WKApp } from '@octo/base';
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
  const { candidates, loading, query, search, error, incomplete, retry } = useOrgSearch();
  const { members } = useMembers(spaceId ?? null, visible);
  const [selected, setSelected] = useState<Record<string, OrgCandidate>>({});
  const [submitting, setSubmitting] = useState(false);

  /** uid → current drive role for members already in this shared space. */
  const memberRoleByUid = useMemo(() => {
    const map: Record<string, DriveRole> = {};
    for (const m of members) map[m.uid] = m.role;
    return map;
  }, [members]);

  // Reset picker-local state whenever it opens/closes or the target drive space
  // changes. Clearing `selected` on a spaceId change is the guard that stops
  // Space A's picks from being confirmed against Space B. On becoming visible we
  // either retry a failed roster load or, for a good cache, just reset the local
  // query filter — reopening a successfully-cached picker never re-fetches
  // (search('') is a purely local reset; the roster is loaded once by
  // useOrgSearch and reloaded only on the host `space-changed` event). Gating on
  // `visible` skips this for a mounted-but-hidden picker.
  useEffect(() => {
    setSelected({});
    if (!visible) return;
    if (error) retry();
    else search('');
  }, [visible, spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A host octo-space switch (drive `spaceId` unchanged) reloads the roster in
  // useOrgSearch but leaves this modal's `selected` untouched. Subscribe to the
  // same host event and clear the selection synchronously, so a stale pick from
  // the previous tenant can't be confirmed into the new space — the API
  // interceptor injects the latest X-Space-Id at request time, so a stale uid
  // would be added to the wrong space. Mounted for the modal's whole lifetime
  // (the picker is always mounted, hidden or not); loading also gates confirm
  // below, covering the reload in-flight window.
  useEffect(() => {
    const handler = () => setSelected({});
    WKApp.mittBus.on('space-changed', handler);
    return () => WKApp.mittBus.off('space-changed', handler);
  }, []);

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
    // Guards against a stale confirm: `!visible` (a space switch hid the picker),
    // and `loading` (a host space-changed is reloading the roster — block the
    // in-flight window so a pre-switch selection can't be submitted mid-reload).
    if (!visible || selectedUids.length === 0 || submitting || loading) return;
    setSubmitting(true);
    await onConfirm(selectedUids);
    setSubmitting(false);
    onClose();
  };

  const label = (c: OrgCandidate) => c.name || c.uid;
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
      okButtonProps={{ disabled: selectedUids.length === 0 || loading }}
      width={480}
    >
      <Input
        prefix={<Search size={16} />}
        value={query}
        onChange={search}
        placeholder={t('drive.org.searchPlaceholder')}
        autoFocus
      />
      {incomplete && !loading && !error && (
        <div className="drive-org__notice">{t('drive.org.incomplete')}</div>
      )}
      <div className="drive-org__list">
        {loading ? (
          <div className="drive-org__center">
            <Spin />
          </div>
        ) : error ? (
          <div className="drive-org__center drive-org__error">
            <span className="drive-org__empty">{t('drive.org.loadFailed')}</span>
            <button type="button" className="drive-org__retry" onClick={retry}>
              {t('drive.org.retry')}
            </button>
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

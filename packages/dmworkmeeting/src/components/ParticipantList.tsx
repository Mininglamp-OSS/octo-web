import React from 'react';
import { t } from '@octo/base';
import type { MeetingRole, Participant } from '../service/contracts';

export interface RoleControlsCapabilities {
  /** Viewer's own role — H can act on anyone; C only on M (§5, FD-23). */
  viewerRole: MeetingRole;
}

export interface ParticipantListProps {
  participants: Participant[];
  capabilities: RoleControlsCapabilities;
  onMute?: (uid: string) => void;
  onRemove?: (uid: string) => void;
  onSetRole?: (uid: string, role: MeetingRole) => void;
}

/** A control target is greyed unless the viewer's role authorizes it. C may only
 * act on M; the final authority is server-side — this only pre-greys the UI. */
export function canActOn(viewerRole: MeetingRole, targetRole: MeetingRole): boolean {
  if (viewerRole === 'host') return true;
  if (viewerRole === 'cohost') return targetRole === 'member';
  return false;
}

export default function ParticipantList({ participants, capabilities, onMute, onRemove, onSetRole }: ParticipantListProps) {
  return (
    <ul className="meeting-participants" aria-label={t('meeting.room.participants')}>
      {participants.map((p) => {
        const actionable = canActOn(capabilities.viewerRole, p.role);
        return (
          <li key={p.uid} className="meeting-participant">
            <span className="meeting-participant-name">{p.displayName ?? p.uid}</span>
            <span className="meeting-participant-role">{p.role}</span>
            {onMute && (
              <button type="button" disabled={!actionable} aria-disabled={!actionable} onClick={() => onMute(p.uid)}>
                {t('meeting.room.muteAll')}
              </button>
            )}
            {onRemove && (
              <button type="button" disabled={!actionable} aria-disabled={!actionable} onClick={() => onRemove(p.uid)}>
                ✕
              </button>
            )}
            {onSetRole && capabilities.viewerRole === 'host' && p.role === 'member' && (
              <button type="button" onClick={() => onSetRole(p.uid, 'cohost')}>
                → cohost
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

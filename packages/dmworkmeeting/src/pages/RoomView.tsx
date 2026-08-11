import React, { useState } from 'react';
import { t } from '@octo/base';
import type { MeetingRole, Participant } from '../service/contracts';
import { MeetingApiClient, newIdempotencyKey } from '../service/MeetingApiClient';
import { emitMeetingTelemetry } from '../state/telemetry';
import VideoGrid from '../components/VideoGrid';
import ControlBar from '../components/ControlBar';
import ParticipantList from '../components/ParticipantList';

export interface RoomViewProps {
  meetingId: string;
  participants: Participant[];
  viewerRole: MeetingRole;
  reconnecting: boolean;
  serviceAvailable: boolean;
  canShare: boolean;
  /** Media handle is null (SDK absent or connect failed) — show a notice and keep controls greyed. */
  mediaUnavailable?: boolean;
  activeSpeakerUid?: string;
  maxTiles?: number;
  onLeave: () => void;
}

/**
 * Room view (§5). Screen-share and mute-all issue real server calls (single
 * holder / host authority); mic/camera are local media toggles. Per-participant
 * role controls are intentionally NOT wired here — they require a realtime
 * participant roster that depends on the service-owned snapshot + event channel
 * (see PR residual blockers), so the list renders self only for now. During
 * reconnect / media-unavailable an overlay greys controls; capability gating is
 * server-authoritative.
 */
export default function RoomView(props: RoomViewProps) {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (sharing) {
        await MeetingApiClient.stopShare(props.meetingId, { idempotencyKey: newIdempotencyKey() });
        setSharing(false);
      } else {
        await MeetingApiClient.startShare(props.meetingId, { idempotencyKey: newIdempotencyKey() });
        setSharing(true);
      }
    } catch {
      // A SHARE_CONFLICT / forbidden leaves the local state unchanged; the
      // server remains authoritative for the single-holder rule.
    } finally {
      setBusy(false);
    }
  };

  const muteAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await MeetingApiClient.mute(props.meetingId, { all: true, muted: true }, { idempotencyKey: newIdempotencyKey() });
      emitMeetingTelemetry({ kind: 'error', endpoint: '/v1/meetings/controls/mute' });
    } catch {
      // Authoritative capability is server-side; a forbidden is a no-op here.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="meeting-room">
      {props.reconnecting && (
        <div className="meeting-reconnecting-overlay" role="status" aria-live="polite">
          {t('meeting.room.reconnecting')}
        </div>
      )}
      {props.mediaUnavailable && (
        <div className="meeting-media-unavailable" role="alert" aria-live="assertive">
          {t('meeting.room.mediaUnavailable')}
        </div>
      )}
      <VideoGrid participants={props.participants} maxTiles={props.maxTiles} activeSpeakerUid={props.activeSpeakerUid} />
      <ParticipantList participants={props.participants} capabilities={{ viewerRole: props.viewerRole }} />
      <ControlBar
        micOn={micOn}
        cameraOn={cameraOn}
        sharing={sharing}
        canShare={props.canShare}
        canMuteAll={props.viewerRole === 'host' || props.viewerRole === 'cohost'}
        reconnecting={props.reconnecting}
        serviceAvailable={props.serviceAvailable}
        onToggleMic={() => setMicOn((v: boolean) => !v)}
        onToggleCamera={() => setCameraOn((v: boolean) => !v)}
        onToggleShare={() => void toggleShare()}
        onMuteAll={() => void muteAll()}
        onLeave={props.onLeave}
      />
    </div>
  );
}

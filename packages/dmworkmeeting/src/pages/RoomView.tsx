import React, { useState } from 'react';
import { t } from '@octo/base';
import type { MeetingRole, Participant } from '../service/contracts';
import VideoGrid from '../components/VideoGrid';
import ControlBar from '../components/ControlBar';
import ParticipantList from '../components/ParticipantList';

export interface RoomViewProps {
  participants: Participant[];
  viewerRole: MeetingRole;
  reconnecting: boolean;
  serviceAvailable: boolean;
  canShare: boolean;
  activeSpeakerUid?: string;
  maxTiles?: number;
  onLeave: () => void;
}

/**
 * Room view (§5). Media is attached by the livekitRoom layer. During reconnect
 * an overlay greys controls/share; capability gating is server-authoritative.
 */
export default function RoomView(props: RoomViewProps) {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharing, setSharing] = useState(false);

  return (
    <div className="meeting-room">
      {props.reconnecting && (
        <div className="meeting-reconnecting-overlay" role="status" aria-live="polite">
          {t('meeting.room.reconnecting')}
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
        onToggleShare={() => setSharing((v: boolean) => !v)}
        onLeave={props.onLeave}
      />
    </div>
  );
}

import React from 'react';
import type { Participant } from '../service/contracts';

export interface VideoGridProps {
  participants: Participant[];
  /** Conservative tile cap; beyond this, tiles virtualize (§13, OD-02 pending). */
  maxTiles?: number;
  activeSpeakerUid?: string;
}

/** Renders participant tiles. Beyond maxTiles the overflow count is surfaced
 * rather than rendering unbounded tiles (§13). Media tracks are attached by the
 * livekitRoom layer, not here. */
export default function VideoGrid({ participants, maxTiles = 16, activeSpeakerUid }: VideoGridProps) {
  const visible = participants.slice(0, maxTiles);
  const overflow = participants.length - visible.length;
  return (
    <div className="meeting-video-grid" role="group">
      {visible.map((p) => (
        <div
          key={p.uid}
          className="meeting-tile"
          data-active-speaker={p.uid === activeSpeakerUid ? 'true' : undefined}
        >
          <span>{p.displayName ?? p.uid}</span>
        </div>
      ))}
      {overflow > 0 && <div className="meeting-tile-overflow">+{overflow}</div>}
    </div>
  );
}

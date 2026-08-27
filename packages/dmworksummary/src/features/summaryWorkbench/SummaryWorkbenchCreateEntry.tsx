import React, { useState } from "react";
import { Spin } from "@douyinfe/semi-ui";
import type { SummaryListItem } from "../../types/summary";
import LegacySummaryCreatePage from "../../pages/SummaryCreatePage";
import SummaryWorkbenchEntry from "./Entry";
import SummaryWorkbenchFeature from "./SummaryWorkbenchFeature";
import useCurrentSummarySpaceId from "./useCurrentSummarySpaceId";
import "./SummaryWorkbenchFeature.css";

export interface SummaryWorkbenchCreateEntryProps {
  onCreated?: () => void;
  derivedFromTask?: SummaryListItem;
  channel?: { channelID: string; channelType: number };
  embedded?: boolean;
  onClose?: () => void;
  onSubmit?: (taskId: number) => void;
  onOpenTask?: (taskId: number) => void;
  source?: string;
  legacyInitialMode?: "normal" | "agent";
}

export default function SummaryWorkbenchCreateEntry(
  props: SummaryWorkbenchCreateEntryProps
) {
  const spaceId = useCurrentSummarySpaceId();
  const [showLegacySchedule, setShowLegacySchedule] = useState(false);
  const entryKey = [
    spaceId,
    props.channel?.channelID ?? "global",
    props.channel?.channelType ?? "global",
    props.derivedFromTask?.task_id ?? "new",
  ].join(":");

  return (
    <>
      {/* Keep the assistant mounted while the Legacy schedule editor is
                open so returning does not discard unsent text or local scope. */}
      <div
        className="wk-summary-workbench-entry-host"
        hidden={showLegacySchedule}
      >
        <SummaryWorkbenchEntry
          key={entryKey}
          spaceId={spaceId}
          renderPending={() => (
            <div className="wk-summary-workbench-entry-loading" role="status">
              <Spin />
            </div>
          )}
          renderNew={() => (
            <SummaryWorkbenchFeature
              key={entryKey}
              spaceId={spaceId}
              channel={props.channel}
              derivedFromTask={props.derivedFromTask}
              embedded={props.embedded}
              source={props.source}
              onCreated={props.onCreated}
              onOpenTask={props.onOpenTask}
              onOpenScheduledSummary={() => setShowLegacySchedule(true)}
            />
          )}
          renderLegacy={() => (
            <LegacySummaryCreatePage
              onCreated={props.onCreated}
              derivedFromTask={props.derivedFromTask}
              channel={props.channel}
              embedded={props.embedded}
              onClose={props.onClose}
              onSubmit={props.onSubmit}
              source={props.source}
              initialMode={props.legacyInitialMode}
            />
          )}
        />
      </div>

      {showLegacySchedule && (
        <LegacySummaryCreatePage
          key={`legacy-schedule:${entryKey}`}
          onCreated={props.onCreated}
          channel={props.channel}
          embedded={props.embedded}
          onClose={props.onClose}
          onSubmit={props.onSubmit}
          source={props.source}
          initialMode="normal"
          initialScheduleOpen
          onBackToWorkbench={() => setShowLegacySchedule(false)}
        />
      )}
    </>
  );
}

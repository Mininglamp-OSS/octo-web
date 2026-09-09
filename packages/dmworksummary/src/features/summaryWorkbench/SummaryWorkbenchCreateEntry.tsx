import React from "react";
import { Spin } from "@douyinfe/semi-ui";
import type { SummaryReferenceTask } from "../../types/summary";
import type { SummaryMessagingPort } from "../../host";
import LegacySummaryCreatePage from "../../pages/SummaryCreatePage";
import SummaryWorkbenchEntry from "./Entry";
import SummaryWorkbenchFeature from "./SummaryWorkbenchFeature";
import useCurrentSummarySpaceId from "./useCurrentSummarySpaceId";
import "./SummaryWorkbenchFeature.css";

export interface SummaryWorkbenchCreateEntryProps {
  onCreated?: () => void;
  derivedFromTask?: SummaryReferenceTask;
  channel?: { channelID: string; channelType: number };
  embedded?: boolean;
  onClose?: () => void;
  onSubmit?: (taskId: number) => void;
  onOpenTask?: (taskId: number) => void;
  source?: string;
  legacyInitialMode?: "normal" | "agent";
  messaging?: SummaryMessagingPort;
}

export default function SummaryWorkbenchCreateEntry(
  props: SummaryWorkbenchCreateEntryProps
) {
  const spaceId = useCurrentSummarySpaceId();
  const entryKey = [
    spaceId,
    props.channel?.channelID ?? "global",
    props.channel?.channelType ?? "global",
    props.derivedFromTask?.task_id ?? "new",
  ].join(":");

  return (
    <div className="wk-summary-workbench-entry-host">
      <SummaryWorkbenchEntry
        key={entryKey}
        spaceId={spaceId}
        renderPending={() => (
          <div className="wk-summary-workbench-entry-loading" role="status">
            <Spin />
          </div>
        )}
        renderNew={(availability) => (
          <SummaryWorkbenchFeature
            key={entryKey}
            spaceId={spaceId}
            channel={props.channel}
            derivedFromTask={props.derivedFromTask}
            embedded={props.embedded}
            source={props.source}
            onCreated={props.onCreated}
            onOpenTask={props.onOpenTask}
            maxTimeRangeDays={availability.maxTimeRangeDays}
            directTeamWorkflow={availability.directTeamWorkflow}
            messaging={props.messaging}
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
            messaging={props.messaging}
          />
        )}
      />
    </div>
  );
}

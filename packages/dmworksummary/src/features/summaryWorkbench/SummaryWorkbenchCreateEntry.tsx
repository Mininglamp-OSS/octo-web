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
  /** "+" 语义：不恢复持久化会话，旧会话挪到「上次对话」槽位供一键返回。 */
  forceNewSession?: boolean;
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
  const [forceNewSessionPending, setForceNewSessionPending] = React.useState(
    () => Boolean(props.forceNewSession)
  );
  // Every distinct fresh-session gesture should remount this entry. Also
  // support callers that expose the next gesture as a false -> true edge.
  const previousForceNewSession = React.useRef(Boolean(props.forceNewSession));
  React.useEffect(() => {
    const forceNewSession = Boolean(props.forceNewSession);
    if (!previousForceNewSession.current && forceNewSession) {
      setForceNewSessionPending(true);
    }
    previousForceNewSession.current = forceNewSession;
  }, [props.forceNewSession]);
  const consumeForceNewSession = React.useCallback(
    () => setForceNewSessionPending(false),
    []
  );
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
            forceNewSession={forceNewSessionPending}
            onForceNewSessionConsumed={consumeForceNewSession}
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

import React from "react";
import { Spin } from "@douyinfe/semi-ui";
import type { SummaryReferenceTask } from "../../types/summary";
import type { SummaryMessagingPort } from "../../host";
import LegacySummaryCreatePage from "../../pages/SummaryCreatePage";
import SummaryWorkbenchEntry from "./Entry";
import SummaryWorkbenchFeature from "./SummaryWorkbenchFeature";
import {
  moveSummaryWorkbenchSessionToPrevious,
  type SummaryWorkbenchSessionScope,
} from "./sessionStorage";
import { summaryWorkbenchSessionScopeValue } from "./useSummaryWorkbenchSessionScope";
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

function WorkbenchLoading() {
  return (
    <div className="wk-summary-workbench-entry-loading" role="status">
      <Spin />
    </div>
  );
}

function PreparedSummaryWorkbenchFeature({
  forceNewSession = false,
  onForceNewSessionConsumed,
  ...props
}: React.ComponentProps<typeof SummaryWorkbenchFeature>) {
  const storageScope = React.useMemo<SummaryWorkbenchSessionScope>(
    () =>
      summaryWorkbenchSessionScopeValue({
        spaceId: props.spaceId,
        channelId: props.channel?.channelID,
        channelType: props.channel?.channelType,
        referencedTaskId: props.derivedFromTask?.task_id,
        messaging: props.messaging,
      }),
    [
      props.channel?.channelID,
      props.channel?.channelType,
      props.derivedFromTask?.task_id,
      props.spaceId,
      props.messaging,
    ]
  );
  const [preparedFreshSession, setPreparedFreshSession] = React.useState<
    boolean | null
  >(() => (forceNewSession ? null : false));

  React.useEffect(() => {
    if (!forceNewSession) {
      setPreparedFreshSession(false);
      return;
    }
    const moved = moveSummaryWorkbenchSessionToPrevious(storageScope);
    setPreparedFreshSession(moved);
    if (!moved) onForceNewSessionConsumed?.();
  }, [forceNewSession, onForceNewSessionConsumed, storageScope]);

  if (preparedFreshSession === null) return <WorkbenchLoading />;
  return (
    <SummaryWorkbenchFeature
      {...props}
      forceNewSession={preparedFreshSession}
      onForceNewSessionConsumed={onForceNewSessionConsumed}
    />
  );
}

export default function SummaryWorkbenchCreateEntry(
  props: SummaryWorkbenchCreateEntryProps
) {
  const spaceId = useCurrentSummarySpaceId();
  const [forceNewSessionPending, setForceNewSessionPending] = React.useState(
    () => Boolean(props.forceNewSession)
  );
  const [forceNewSessionSeq, setForceNewSessionSeq] = React.useState(0);
  // Every distinct fresh-session gesture must remount this entry so the
  // workbench's mount-time storage rotation runs exactly once for the gesture.
  const previousForceNewSession = React.useRef(Boolean(props.forceNewSession));
  React.useEffect(() => {
    const forceNewSession = Boolean(props.forceNewSession);
    if (!previousForceNewSession.current && forceNewSession) {
      setForceNewSessionPending(true);
      setForceNewSessionSeq((current) => current + 1);
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
    forceNewSessionSeq,
  ].join(":");

  return (
    <div className="wk-summary-workbench-entry-host">
      <SummaryWorkbenchEntry
        key={entryKey}
        spaceId={spaceId}
        renderPending={() => <WorkbenchLoading />}
        renderNew={(availability) => (
          <PreparedSummaryWorkbenchFeature
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

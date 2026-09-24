import React from "react";
import { Spin, Toast } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { SummaryReferenceTask } from "../../types/summary";
import type { SummaryMessagingPort } from "../../host";
import LegacySummaryCreatePage from "../../pages/SummaryCreatePage";
import SummaryWorkbenchEntry from "./Entry";
import SummaryWorkbenchFeature from "./SummaryWorkbenchFeature";
import {
  clearSummaryWorkbenchSession,
  moveSummaryWorkbenchSessionToPrevious,
  readSummaryWorkbenchSession,
  type SummaryWorkbenchSessionScope,
} from "./sessionStorage";
import {
  summaryWorkbenchSessionScopeIdentity,
  useSummaryWorkbenchSessionScope,
} from "./useSummaryWorkbenchSessionScope";
import useCurrentSummarySpaceId from "./useCurrentSummarySpaceId";
import "./SummaryWorkbenchFeature.css";

export interface SummaryWorkbenchCreateEntryProps {
  onCreated?: () => void;
  derivedFromTask?: SummaryReferenceTask;
  channel?: { channelID: string; channelType: number };
  embedded?: boolean;
  /** "+" 语义：不恢复持久化会话，旧会话挪到「上次对话」槽位供一键返回。 */
  forceNewSession?: boolean;
  onForceNewSessionConsumed?: () => void;
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
  storageScope,
  forceNewSession = false,
  onForceNewSessionConsumed,
  ...props
}: React.ComponentProps<typeof SummaryWorkbenchFeature> & {
  storageScope: SummaryWorkbenchSessionScope;
}) {
  const { t } = useI18n();
  const [preparedFreshSession, setPreparedFreshSession] = React.useState<
    boolean | null
  >(() => (forceNewSession ? null : false));

  React.useEffect(() => {
    if (!forceNewSession) {
      setPreparedFreshSession(false);
      return;
    }
    const currentPersisted = readSummaryWorkbenchSession(storageScope);
    const moved = moveSummaryWorkbenchSessionToPrevious(storageScope);
    if (!moved && currentPersisted) {
      Toast.warning(t("summary.workbench.errors.previousSessionSaveFailed"));
      clearSummaryWorkbenchSession(storageScope);
    }
    setPreparedFreshSession(true);
  }, [forceNewSession, onForceNewSessionConsumed, storageScope, t]);

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
  const storageScope = useSummaryWorkbenchSessionScope({
    spaceId,
    channelId: props.channel?.channelID,
    channelType: props.channel?.channelType,
    referencedTaskId: props.derivedFromTask?.task_id,
    messaging: props.messaging,
  });
  const storageScopeIdentity =
    summaryWorkbenchSessionScopeIdentity(storageScope);
  const [forceNewSessionPending, setForceNewSessionPending] = React.useState(
    () => Boolean(props.forceNewSession)
  );
  const [forceNewSessionSeq, setForceNewSessionSeq] = React.useState(0);
  // Every distinct fresh-session gesture must remount this entry so the
  // workbench's mount-time storage rotation runs exactly once for the gesture.
  const previousForceNewSession = React.useRef(Boolean(props.forceNewSession));
  const pendingForceNewSessionScope = React.useRef<string | null>(
    props.forceNewSession ? storageScopeIdentity : null
  );
  React.useEffect(() => {
    const forceNewSession = Boolean(props.forceNewSession);
    if (!previousForceNewSession.current && forceNewSession) {
      pendingForceNewSessionScope.current = storageScopeIdentity;
      setForceNewSessionPending(true);
      setForceNewSessionSeq((current) => current + 1);
    } else if (previousForceNewSession.current && !forceNewSession) {
      pendingForceNewSessionScope.current = null;
      setForceNewSessionPending(false);
    }
    previousForceNewSession.current = forceNewSession;
  }, [props.forceNewSession, storageScopeIdentity]);
  const forceNewSessionForCurrentScope =
    forceNewSessionPending &&
    pendingForceNewSessionScope.current === storageScopeIdentity;
  React.useEffect(() => {
    if (!forceNewSessionPending || forceNewSessionForCurrentScope) return;
    pendingForceNewSessionScope.current = null;
    setForceNewSessionPending(false);
    props.onForceNewSessionConsumed?.();
  }, [
    forceNewSessionForCurrentScope,
    forceNewSessionPending,
    props.onForceNewSessionConsumed,
  ]);
  const consumeForceNewSession = React.useCallback(() => {
    pendingForceNewSessionScope.current = null;
    setForceNewSessionPending(false);
    props.onForceNewSessionConsumed?.();
  }, [props.onForceNewSessionConsumed]);
  const entryKey = `${storageScopeIdentity}:${forceNewSessionSeq}`;

  return (
    <div className="wk-summary-workbench-entry-host">
      <SummaryWorkbenchEntry
        key={entryKey}
        spaceId={spaceId}
        renderPending={() => <WorkbenchLoading />}
        renderNew={(availability) => (
          <PreparedSummaryWorkbenchFeature
            key={entryKey}
            storageScope={storageScope}
            spaceId={spaceId}
            channel={props.channel}
            derivedFromTask={props.derivedFromTask}
            forceNewSession={forceNewSessionForCurrentScope}
            onForceNewSessionConsumed={consumeForceNewSession}
            embedded={props.embedded}
            source={props.source}
            onCreated={props.onCreated}
            onOpenTask={props.onOpenTask}
            maxTimeRangeDays={availability.maxTimeRangeDays}
            directTeamWorkflow={availability.directTeamWorkflow}
            mixedSources={availability.mixedSources}
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

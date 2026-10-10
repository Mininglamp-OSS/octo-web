import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input, Modal, Spin, Toast } from "@douyinfe/semi-ui";
import { Dap, useI18n, type DocSearchItem } from "@octo/base";
import WKApp from "@octo/base/src/App";
import type { SummaryMessagingPort } from "../../host";
import { themeLenBucket } from "../../utils/summaryHelpers";
import SummaryDetailPage from "../../pages/SummaryDetailPage";
import ChatSelectorModal from "../../components/ChatSelectorModal";
import SummaryReferencePicker from "../../components/SummaryReferencePicker";
import SummaryReferenceSidePanel from "../../components/SummaryReferenceSidePanel";
import DocumentSelectorModal from "../documentSource/DocumentSelectorModal";
import TemplateSelectorModal, {
  type TemplateSelectorLabels,
} from "../../components/TemplateSelectorModal";
import TimeRangeSelector, {
  type TimeRangeSelectorLabels,
} from "../../components/TimeRangeSelector";
import {
  MAX_CHAT_SELECT,
  MAX_DOCUMENT_SELECT,
  MAX_PARTICIPANT_SELECT,
} from "../../constants/limits";
import { TOPIC_TEMPLATES } from "../../constants/templates";
import summaryWorkbenchService from "../../Service/SummaryWorkbenchService";
import {
  summaryScopeChangeImpact,
  type SummaryScopeChangeImpact,
  type SummaryWorkbenchResponse,
} from "../../bridge/summaryWorkbench/model";
import {
  DEFAULT_SUMMARY_WORKSPACE_MAX_TIME_RANGE_DAYS,
  type SummaryWorkbenchScope,
  type SummaryWorkbenchTemplateScope,
  type SummaryWorkbenchTimeRangeScope,
  type SummaryWorkspaceInputOrigin,
} from "../../bridge/summaryWorkbench/protocol";
import useSummaryWorkbench, {
  sameSummaryWorkbenchScope,
} from "../../bridge/summaryWorkbench/useSummaryWorkbench";
import SummaryWorkbench, {
  type SummaryWorkbenchAction,
  type SummaryWorkbenchContextKind,
} from "../../ui/SummaryWorkbench";
import type { ChatCandidate, SummaryListItem } from "../../types/summary";
import { channelToChatCandidate } from "../../utils/channelConvert";
import { markAgentSummaryNotificationEligible } from "../../utils/groupSummaryNotify";
import { trackAgentSummaryQuality } from "../../utils/summaryQualityDiagnostics";
import { summaryWorkbenchSessionScopeValue } from "./useSummaryWorkbenchSessionScope";
import {
  deriveSummaryTitle,
  resolveTemplate,
} from "../../utils/templateResolver";
import { summaryTestIds } from "../../utils/testIds";
import {
  clearSummaryWorkbenchSession,
  moveSummaryWorkbenchSessionToPrevious,
  readSummaryWorkbenchPreviousSession,
  readSummaryWorkbenchSession,
  replaceSummaryWorkbenchSessionSlots,
  writeSummaryWorkbenchSession,
  type SummaryWorkbenchSessionScope,
} from "./sessionStorage";
import {
  loadParticipantCandidates,
  type ParticipantCandidateLoadResult,
} from "./participantCandidates";
import {
  canSelectParticipants,
  canGenerateFromScope,
  chatCandidatesToScope,
  documentsToScope,
  emptySummaryWorkbenchScope,
  memberCandidatesToScope,
  participantSourceChannels,
  participantSourceKey,
  removeScopeContext,
  replaceSelectedChannels,
  replaceSelectedDocuments,
  retainValidParticipants,
  scopeChannelsToCandidates,
  scopeDocumentsToItems,
  scopeParticipantsToCandidates,
  type WorkbenchMemberCandidate,
} from "./scope";
import "./SummaryWorkbenchFeature.css";

export interface SummaryWorkbenchFeatureProps {
  spaceId: string;
  channel?: { channelID: string; channelType: number };
  derivedFromTask?: Pick<SummaryListItem, "task_id" | "title">;
  embedded?: boolean;
  /** "+" 语义：不恢复持久化会话；旧会话挪到「上次对话」槽位，横条一键返回。 */
  forceNewSession?: boolean;
  onForceNewSessionConsumed?: () => void;
  source?: string;
  onCreated?: () => void;
  onOpenTask?: (taskId: number) => void;
  maxTimeRangeDays?: number;
  directTeamWorkflow?: boolean;
  messaging?: SummaryMessagingPort;
}

type OpenSelector = Exclude<SummaryWorkbenchContextKind, "template"> | null;
type ReferencedTask = Pick<SummaryListItem, "task_id" | "title">;
let referencePreviewIdSequence = 0;

function createReferencePreviewId(): string {
  referencePreviewIdSequence += 1;
  return `summary-workbench-reference-preview-${referencePreviewIdSequence}`;
}

type ParticipantCandidateState = ParticipantCandidateLoadResult & {
  sourceKey: string;
  status: "idle" | "loading" | "ready" | "error";
};

function initialScopeFor(
  channel: SummaryWorkbenchFeatureProps["channel"],
  derivedFromTask: SummaryWorkbenchFeatureProps["derivedFromTask"]
): SummaryWorkbenchScope {
  const scope = emptySummaryWorkbenchScope();
  if (channel) {
    scope.selectedChannels = chatCandidatesToScope([
      channelToChatCandidate(channel),
    ]);
  }
  if (derivedFromTask) {
    scope.referencedTaskIds = [derivedFromTask.task_id];
  }
  return scope;
}

function errorMessageKey(httpStatus?: number, kind?: string): string {
  if (httpStatus !== undefined && httpStatus >= 500) {
    return "summary.workbench.errors.serviceUnavailable";
  }
  if (kind === "protocol") return "summary.workbench.errors.protocol";
  if (kind === "transport") return "summary.workbench.errors.network";
  return "";
}

function controllerScopeChangeImpact(
  workbench: ReturnType<typeof useSummaryWorkbench>
): SummaryScopeChangeImpact | null {
  const impact = summaryScopeChangeImpact(workbench.model);
  if (impact) return impact;
  const card = workbench.viewState.card;
  if (!card || card.isStale) return null;
  if (card.actions.includes("save_preview")) return "preview";
  if (card.actions.includes("confirm_workflow")) return "team_proposal";
  return null;
}

function isAcceptedResponse(
  response?: SummaryWorkbenchResponse
): response is Exclude<SummaryWorkbenchResponse, { resultType: "error" }> {
  return Boolean(response && response.resultType !== "error");
}

export default function SummaryWorkbenchFeature({
  spaceId,
  channel,
  derivedFromTask,
  embedded = false,
  forceNewSession = false,
  onForceNewSessionConsumed,
  source,
  onCreated,
  onOpenTask,
  maxTimeRangeDays = DEFAULT_SUMMARY_WORKSPACE_MAX_TIME_RANGE_DAYS,
  directTeamWorkflow = false,
  messaging,
}: SummaryWorkbenchFeatureProps) {
  const { t, format } = useI18n();
  const featureRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const feature = featureRef.current;
    const header = feature?.querySelector<HTMLElement>(".wk-summary-workbench__header");
    if (!feature || !header) return;
    // Measure the real wrapped header; older renderers do not support CSS anchors.
    const updateHeaderHeight = () => feature.style.setProperty(
      "--wk-summary-workbench-header-height",
      `${Math.ceil(header.getBoundingClientRect().height)}px`
    );
    updateHeaderHeight();
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const [referencePreviewId] = useState(createReferencePreviewId);
  const initialScope = useMemo(
    () => initialScopeFor(channel, derivedFromTask),
    [channel?.channelID, channel?.channelType, derivedFromTask?.task_id]
  );
  const storageScope = useMemo<SummaryWorkbenchSessionScope>(
    () =>
      summaryWorkbenchSessionScopeValue({
        spaceId,
        channelId: channel?.channelID,
        channelType: channel?.channelType,
        referencedTaskId: derivedFromTask?.task_id,
        messaging,
      }),
    [
      channel?.channelID,
      channel?.channelType,
      derivedFromTask?.task_id,
      spaceId,
      messaging,
    ]
  );
  const [persistedSessionAtMount] = useState(() =>
    readSummaryWorkbenchSession(storageScope)
  );
  const [initialSessionId] = useState(() =>
    derivedFromTask || forceNewSession ? "" : persistedSessionAtMount
  );
  const [lastSessionId, setLastSessionId] = useState(() =>
    !derivedFromTask && forceNewSession && persistedSessionAtMount
      ? persistedSessionAtMount
      : !derivedFromTask
      ? readSummaryWorkbenchPreviousSession(storageScope)
      : ""
  );
  useEffect(() => {
    if (derivedFromTask) {
      clearSummaryWorkbenchSession(storageScope);
    } else if (forceNewSession) {
      // SummaryWorkbenchCreateEntry prepares the storage move before mounting
      // this runtime, so this effect only reads the committed previous slot.
      setLastSessionId(readSummaryWorkbenchPreviousSession(storageScope));
    }
    if (forceNewSession) onForceNewSessionConsumed?.();
  }, [
    derivedFromTask,
    forceNewSession,
    onForceNewSessionConsumed,
    storageScope,
  ]);
  const [openSelector, setOpenSelector] = useState<OpenSelector>(null);
  const [referencedTask, setReferencedTask] = useState<ReferencedTask | null>(
    derivedFromTask ?? null
  );
  const [referencePreviewOpen, setReferencePreviewOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [documentSelectorAvailable, setDocumentSelectorAvailable] = useState(
    () =>
      Boolean(WKApp.remoteConfig?.docsOn && WKApp.remoteConfig?.docsSearchOn)
  );
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [hasAcceptedDispatch, setHasAcceptedDispatch] = useState(false);
  const [lastFailedAction, setLastFailedAction] = useState<
    "start_team_workflow" | "chat" | null
  >(null);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(
    () => !derivedFromTask
  );
  const [pendingTemplate, setPendingTemplate] =
    useState<SummaryWorkbenchTemplateScope | null>(null);
  const notifiedTaskIds = useRef(new Set<number>());
  const handledSavedTaskIds = useRef(new Set<number>());
  const hydrationObserved = useRef(false);
  const templateFilledComposer = useRef<string | null>(null);
  const themeTrackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workbench = useSummaryWorkbench({
    spaceId,
    initialSessionId,
    initialScope,
    layout: embedded ? "panel" : "full",
    autoHydrate: initialSessionId.length > 0,
    onSessionIdChange: (sessionId) => {
      if (sessionId) {
        writeSummaryWorkbenchSession(storageScope, sessionId);
      } else {
        clearSummaryWorkbenchSession(storageScope);
      }
    },
  });
  const busy =
    workbench.viewState.isSending ||
    workbench.isHydrating ||
    workbench.isConfirming ||
    workbench.isSaving;
  // Any existing turn — accepted or failed — locks the template (#1765):
  // a started conversation stays a conversation, failure or not.
  const templateLocked =
    hasSubmitted ||
    (!workbench.isHydrating &&
      (workbench.viewState.messages.length > 0 ||
        Boolean(workbench.viewState.card)));
  const conversationEstablished =
    hasAcceptedDispatch ||
    Boolean(workbench.viewState.card) ||
    workbench.viewState.messages.some(
      (message) =>
        message.role === "assistant" && message.resultType !== "error"
    );
  const latestScopeRef = useRef(workbench.scope);
  const latestScopeChangeImpactRef = useRef<SummaryScopeChangeImpact | null>(
    controllerScopeChangeImpact(workbench)
  );
  const participantLoadSeq = useRef(0);
  const busyRef = useRef(busy);
  const pendingParticipantPruneRef = useRef<{
    sourceKey: string;
    members: WorkbenchMemberCandidate[];
  } | null>(null);
  const [participantCandidateState, setParticipantCandidateState] =
    useState<ParticipantCandidateState>({
      sourceKey: "",
      status: "idle",
      members: [],
      roles: new Map<string, number>(),
    });
  latestScopeRef.current = workbench.scope;
  latestScopeChangeImpactRef.current = controllerScopeChangeImpact(workbench);
  busyRef.current = busy;

  const applyParticipantPrune = useCallback(
    (sourceKey: string, members: WorkbenchMemberCandidate[]) => {
      const latestScope = latestScopeRef.current;
      if (participantSourceKey(latestScope) !== sourceKey) return;
      const retained = retainValidParticipants(latestScope, members);
      if (retained.removedCount === 0) return;

      const impact = latestScopeChangeImpactRef.current;
      setLastFailedAction(null);
      workbench.updateScope(retained.scope);
      Toast.warning(
        t(
          impact
            ? "summary.workbench.notice.participantsPrunedArtifactInvalidated"
            : "summary.workbench.notice.participantsPruned"
        )
      );
    },
    [t, workbench]
  );

  const refreshParticipantCandidates = useCallback(
    async (force = false) => {
      const scope = latestScopeRef.current;
      const sourceKey = participantSourceKey(scope);
      const channels = participantSourceChannels(scope);
      if (!sourceKey || !channels) {
        participantLoadSeq.current += 1;
        setParticipantCandidateState({
          sourceKey: sourceKey ?? "",
          status: "idle",
          members: [],
          roles: new Map<string, number>(),
        });
        return false;
      }
      if (
        !force &&
        participantCandidateState.sourceKey === sourceKey &&
        participantCandidateState.status === "ready"
      ) {
        return true;
      }

      const seq = ++participantLoadSeq.current;
      setParticipantCandidateState((current) => ({
        sourceKey,
        status: "loading",
        members: current.sourceKey === sourceKey ? current.members : [],
        roles:
          current.sourceKey === sourceKey
            ? current.roles
            : new Map<string, number>(),
      }));
      try {
        const result = await loadParticipantCandidates(channels, {
          currentUserId: storageScope.userId ?? "",
          spaceId,
          messaging,
        });
        if (seq !== participantLoadSeq.current) return false;
        const latestScope = latestScopeRef.current;
        if (participantSourceKey(latestScope) !== sourceKey) return false;

        setParticipantCandidateState({
          sourceKey,
          status: "ready",
          ...result,
        });
        const retained = retainValidParticipants(latestScope, result.members);
        if (retained.removedCount > 0) {
          if (busyRef.current) {
            pendingParticipantPruneRef.current = {
              sourceKey,
              members: result.members,
            };
          } else {
            applyParticipantPrune(sourceKey, result.members);
          }
        }
        return true;
      } catch {
        if (seq !== participantLoadSeq.current) return false;
        setParticipantCandidateState({
          sourceKey,
          status: "error",
          members: [],
          roles: new Map<string, number>(),
        });
        return false;
      }
    },
    [
      storageScope,
      messaging,
      applyParticipantPrune,
      participantCandidateState.sourceKey,
      participantCandidateState.status,
      spaceId,
      t,
      workbench,
    ]
  );

  const participantScopeKey = participantSourceKey(workbench.scope);
  const participantsPresent = workbench.scope.participants.length > 0;
  useEffect(() => {
    participantLoadSeq.current += 1;
    if (pendingParticipantPruneRef.current?.sourceKey !== participantScopeKey) {
      pendingParticipantPruneRef.current = null;
    }
    setParticipantCandidateState((current) =>
      current.sourceKey === (participantScopeKey ?? "")
        ? current
        : {
            sourceKey: participantScopeKey ?? "",
            status: "idle",
            members: [],
            roles: new Map<string, number>(),
          }
    );
    if (participantsPresent && participantScopeKey) {
      void refreshParticipantCandidates();
    }
  }, [participantScopeKey, participantsPresent]);

  useEffect(() => {
    if (busy) return;
    const pending = pendingParticipantPruneRef.current;
    if (!pending) return;
    pendingParticipantPruneRef.current = null;
    applyParticipantPrune(pending.sourceKey, pending.members);
  }, [applyParticipantPrune, busy]);

  // Unmount: clear the theme-input debounce so a pending track cannot fire
  // after the user has left (same rationale as the legacy page's cleanup).
  useEffect(() => {
    return () => {
      if (themeTrackTimer.current) clearTimeout(themeTrackTimer.current);
    };
  }, []);

  useEffect(() => {
    const syncDocumentCapability = () => {
      setDocumentSelectorAvailable(
        Boolean(WKApp.remoteConfig?.docsOn && WKApp.remoteConfig?.docsSearchOn)
      );
    };
    syncDocumentCapability();
    const unsubscribe =
      WKApp.remoteConfig?.addConfigChangeListener?.(syncDocumentCapability) ??
      null;
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (workbench.isHydrating) {
      hydrationObserved.current = true;
      return;
    }
    if (!hydrationObserved.current) return;
    hydrationObserved.current = false;
    // Any hydrated turn — including a failed one — counts as a started
    // conversation: keep the template gallery hidden (#1765).
    if (
      workbench.viewState.messages.length > 0 ||
      Boolean(workbench.viewState.card)
    ) {
      setHasSubmitted(true);
      setTemplateGalleryOpen(false);
    }
  }, [
    workbench.isHydrating,
    workbench.viewState.card,
    workbench.viewState.messages,
  ]);

  const referencedTaskId = workbench.scope.referencedTaskIds[0];
  useEffect(() => {
    if (referencedTaskId === undefined) {
      setReferencedTask(null);
      setReferencePreviewOpen(false);
      return;
    }

    let cancelled = false;
    setReferencedTask((current: ReferencedTask | null) =>
      current?.task_id === referencedTaskId
        ? current
        : { task_id: referencedTaskId, title: `#${referencedTaskId}` }
    );

    void summaryWorkbenchService
      .loadReferenceSummary(referencedTaskId)
      .then((detail) => {
        if (cancelled) return;
        setReferencedTask({
          task_id: referencedTaskId,
          title: detail.title || `#${referencedTaskId}`,
        });
      })
      .catch(() => {
        // History hydration only persists the reference id. Keep that
        // id selected when its display metadata cannot be refreshed.
      });

    return () => {
      cancelled = true;
    };
  }, [referencedTaskId]);

  const notifyCreated = (taskId: number, triggerMode: "normal" | "agent") => {
    if (notifiedTaskIds.current.has(taskId)) return;
    notifiedTaskIds.current.add(taskId);
    markAgentSummaryNotificationEligible(taskId);
    // DAP-247/S6（architect 裁定 · spec-props.md:333 P0）：smart_summary_started 只对应 normal
    // 「快速总结」路径;agent 创建路径不发 started,发 smart_summary_agent_saved（spec:441，props =
    // { message_count }）。agent 分支若沿用 started 会污染快速总结漏斗(错误 P0 数据)。
    if (triggerMode === "agent") {
      // message_count 就近取自 workbench 会话消息条数,对齐 AgentChatPanel 用 messages.length 的口径。
      Dap.shared.track("smart_summary_agent_saved", {
        message_count: workbench.viewState.messages.length,
      });
    } else {
      Dap.shared.track("smart_summary_started", {
        object_id: channel?.channelID,
        source,
        entry_point: source,
        entry_source: source,
        trigger_mode: triggerMode,
        // DAP-266：补 spec 维度 mode / channel_count / participant_count（就近取自 workbench.scope）。
        // DAP-271 finding 2：spec 确认需 channel_ids → 按显式键把 chatId 逗号连接成字符串(primitive,过得了
        //   sanitizer)，不泛化放行数组。finding 6：template_source 由 scope.template.isCustom 就近派生。
        mode: triggerMode,
        channel_count: workbench.scope.selectedChannels.length,
        channel_ids: workbench.scope.selectedChannels.map((c) => c.chatId).join(","),
        participant_count: workbench.scope.participants.length,
        ...(workbench.scope.template
          ? { template_source: workbench.scope.template.isCustom ? "custom" : "preset" }
          : {}),
      });
    }
    window.dispatchEvent(
      new CustomEvent("chat-summary-created", {
        detail: {
          taskId,
          channelId:
            channel?.channelID ??
            workbench.scope.selectedChannels[0]?.chatId ??
            "",
        },
      })
    );
    WKApp.mittBus.emit("summary-list-refresh-requested" as never);
    onCreated?.();
  };

  const observeWorkflow = (response?: SummaryWorkbenchResponse) => {
    if (
      response?.resultType === "workflow_started" ||
      response?.resultType === "workflow_completed"
    ) {
      notifyCreated(response.workflow.taskId, "normal");
    }
  };

  const composerHasText = workbench.viewState.inputValue.trim().length > 0;
  const composerHasCustomText = Boolean(
    composerHasText &&
      workbench.viewState.inputValue !== templateFilledComposer.current
  );
  const structuredGenerate = canGenerateFromScope(
    workbench.scope,
    composerHasCustomText
  );
  const documentScopeUnavailable =
    (workbench.scope.documents ?? []).length > 0 &&
    !documentSelectorAvailable;
  const participantScopeReady =
    workbench.scope.participants.length === 0 ||
    (Boolean(participantScopeKey) &&
      participantCandidateState.sourceKey === participantScopeKey &&
      participantCandidateState.status === "ready");
  const participantScopeInvalid = participantsPresent && !participantScopeKey;
  const participantScopeErrorMessage = participantScopeInvalid
    ? t("summary.workbench.notice.participantsUnsupportedForSelectedChats")
    : participantsPresent && participantCandidateState.status === "error"
    ? t("summary.workbench.notice.participantCandidatesLoadFailed")
    : undefined;
  const displayErrorKey = errorMessageKey(
    workbench.error?.httpStatus,
    workbench.error?.kind
  );
  const contextItems = workbench.viewState.contextItems.map((item) =>
    item.kind === "reference" &&
    referencedTask?.task_id !== undefined &&
    item.id === String(referencedTask.task_id)
      ? { ...item, label: referencedTask.title || item.label }
      : item
  );
  const availableContextKinds: SummaryWorkbenchContextKind[] =
    (workbench.scope.documents ?? []).length > 0
      ? ["chat", ...(documentSelectorAvailable ? (["document"] as const) : [])]
      : [
          "chat",
          ...(documentSelectorAvailable ? (["document"] as const) : []),
          "participant",
          "time_range",
        ];
  const viewState = {
    ...workbench.viewState,
    contextItems,
    composerFocusKey,
    isSending: busy,
    canSend:
      !busy &&
      !documentScopeUnavailable &&
      participantScopeReady &&
      (composerHasCustomText ||
        (lastFailedAction !== null && structuredGenerate) ||
        (!conversationEstablished && structuredGenerate) ||
        (templateLocked &&
          templateFilledComposer.current !== null &&
          structuredGenerate)),
    showTemplateTrigger:
      !conversationEstablished && !templateGalleryOpen,
    templateLocked,
    templateEditable: !conversationEstablished,
    sendLabelKey:
      !composerHasCustomText && structuredGenerate
        ? "summary.workbench.composer.generate"
        : "summary.workbench.composer.send",
    resumeLastSessionDisabled: busy,
    errorMessage: displayErrorKey
      ? t(displayErrorKey)
      : workbench.viewState.errorMessage || participantScopeErrorMessage,
    referencePreviewOpen,
    referencePreviewId,
    availableContextKinds,
  };

  const updateScopeWithPreviewGuard = (
    nextScope: SummaryWorkbenchScope,
    onApplied?: () => void
  ) => {
    const baseScope = workbench.scope;
    if (sameSummaryWorkbenchScope(baseScope, nextScope)) {
      onApplied?.();
      return;
    }
    const apply = () => {
      if (!sameSummaryWorkbenchScope(latestScopeRef.current, baseScope)) {
        Toast.info(t("summary.workbench.scopeChange.changedWhileConfirming"));
        return;
      }
      setLastFailedAction(null);
      workbench.updateScope(nextScope);
      onApplied?.();
    };
    const impact = controllerScopeChangeImpact(workbench);
    if (!impact) {
      apply();
      return;
    }
    Modal.confirm({
      title: t("summary.workbench.scopeChange.title"),
      content: t(
        impact === "team_proposal"
          ? "summary.workbench.scopeChange.proposalContent"
          : "summary.workbench.scopeChange.content"
      ),
      okText: t("summary.workbench.scopeChange.confirm"),
      cancelText: t("summary.common.cancel"),
      onOk: apply,
    });
  };

  const runStartedTask = async (
    request: () => Promise<SummaryWorkbenchResponse | undefined>,
    action: "start_team_workflow" | "chat" | null = null
  ) => {
    const previousInputValue = workbench.viewState.inputValue;
    const previousTemplateFilledComposer = templateFilledComposer.current;
    const responsePromise = request();

    setLastFailedAction(null);
    templateFilledComposer.current = null;
    workbench.restoreComposerValue("");
    setHasSubmitted(true);
    setTemplateGalleryOpen(false);

    const response = await responsePromise;
    if (isAcceptedResponse(response)) {
      setHasAcceptedDispatch(true);
    } else {
      // A dispatched run that fails must not resurrect the template gallery
      // (#1765): the user already started a conversation — restore the
      // composed input for retry, but keep the failure visible in place.
      workbench.restoreComposerValue(previousInputValue);
      templateFilledComposer.current = previousTemplateFilledComposer;
      setLastFailedAction(action);
    }
    return response;
  };

  const send = async () => {
    if (documentScopeUnavailable) {
      Toast.warning(t("summary.create.documentSourceUnavailable"));
      return;
    }
    if (!viewState.canSend) return;
    if (themeTrackTimer.current) {
      clearTimeout(themeTrackTimer.current);
      themeTrackTimer.current = null;
    }
    setOpenSelector(null);
    let message: string | undefined;
    let inputOrigin: SummaryWorkspaceInputOrigin;
    if (composerHasCustomText) {
      message = undefined;
      inputOrigin = "user";
    } else {
      message =
        workbench.scope.participants.length > 0
          ? t("summary.workbench.intent.team")
          : t("summary.workbench.intent.personal");
      inputOrigin = "system_intent";
    }
    const action =
      directTeamWorkflow &&
      (!conversationEstablished ||
        lastFailedAction === "start_team_workflow") &&
      workbench.scope.participants.length > 0
        ? "start_team_workflow"
        : "chat";
    const response = await runStartedTask(
      () =>
        action === "start_team_workflow"
          ? workbench.send(message, inputOrigin, action)
          : workbench.send(message, inputOrigin),
      action
    );
    if (isAcceptedResponse(response)) {
      // DAP-266：补 has_reference（是否携带引用总结）。duration_seconds（请求耗时）此处无起始
      //   时间戳可取 → DEFER。
      Dap.shared.track("smart_summary_agent_message_sent", {
        has_reference: workbench.scope.referencedTaskIds.length > 0,
      });
    }
    observeWorkflow(response);
  };

  const openTask = (taskId: number) => {
    if (onOpenTask) {
      onOpenTask(taskId);
      return;
    }
    WKApp.routeRight.popToRoot();
    WKApp.routeRight.push(<SummaryDetailPage taskId={taskId} emitSelection />);
  };

  const handleResultAction = async (action: SummaryWorkbenchAction) => {
    if (action === "confirm_workflow") {
      const response = await runStartedTask(() => workbench.confirmWorkflow());
      observeWorkflow(response);
      return;
    }
    if (action === "save_preview") {
      workbench.clearError();
      const content = workbench.model.currentPreview?.content ?? "";
      setSaveTitle(deriveSummaryTitle(content).slice(0, 100));
      setSaveDialogOpen(true);
      return;
    }
    if (action === "view_summary" || action === "view_progress") {
      const taskId = workbench.model.workflow?.taskId;
      if (taskId) openTask(taskId);
    }
  };

  const handleContextOpen = (kind: SummaryWorkbenchContextKind) => {
    // Reference is a read-only preview toggle — mutates no scope and must
    // remain usable while sending/hydrating. Gate the scope-mutating branches
    // (template / participant / other pickers) only.
    if (kind === "reference" && referencedTask) {
      setOpenSelector(null);
      setReferencePreviewOpen((open) => !open);
      return;
    }
    if (busy) return;
    if (kind === "template") {
      if (conversationEstablished) return;
      setTemplateGalleryOpen(true);
      return;
    }
    if (kind === "document" && !documentSelectorAvailable) return;
    if (kind === "participant" && !canSelectParticipants(workbench.scope)) {
      Toast.info(t("summary.workbench.notice.selectSingleChatForParticipants"));
      return;
    }
    setOpenSelector(kind);
    if (kind === "participant") {
      void refreshParticipantCandidates();
    }
  };

  const handleContextRemove = (
    kind: SummaryWorkbenchContextKind,
    id: string
  ) => {
    if (busy) return;
    if (kind === "template" && conversationEstablished) return;
    const shouldClearTemplateText =
      kind === "template" && templateFilledComposer.current !== null;
    const result = removeScopeContext(workbench.scope, kind, id);
    updateScopeWithPreviewGuard(result.scope, () => {
      if (shouldClearTemplateText) {
        templateFilledComposer.current = null;
        workbench.setComposerValue("");
      }
      if (kind === "reference") {
        setReferencedTask(null);
        setReferencePreviewOpen(false);
      }
      if (result.participantsCleared) {
        Toast.info(t("summary.workbench.notice.participantsCleared"));
      }
    });
  };

  const templateLabels = useMemo<TemplateSelectorLabels>(
    () => ({
      title: t("summary.workbench.selector.templateTitle"),
      builtInTitle: t("summary.create.templatesTitle"),
      customTitle: (count, limit) =>
        t("summary.templates.custom.myTemplatesTitleWithCount", {
          values: { count, limit },
        }),
      customSectionTitle: t("summary.templates.custom.myTemplatesTitle"),
      customCountLabel: (count, limit) => `${count}/${limit}`,
      create: t("summary.templates.custom.new"),
      edit: t("summary.templates.custom.edit"),
      delete: t("summary.templates.custom.delete"),
      reset: t("summary.templates.custom.reset"),
      cancel: t("summary.common.cancel"),
      save: t("summary.common.save"),
      clear: t("summary.workbench.selector.clearTemplate"),
      loading: t("summary.common.loading"),
      empty: t("summary.templates.custom.emptyTitle"),
      loadFailed: t("summary.common.loadingFailed"),
      retry: t("summary.common.retry"),
      limitReached: t("summary.templates.custom.limitReached"),
      createTitle: t("summary.templates.custom.createTitle"),
      editTitle: t("summary.templates.custom.editTitle"),
      nameLabel: t("summary.templates.custom.nameLabel"),
      descriptionLabel: t("summary.templates.custom.descriptionLabel"),
      namePlaceholder: t("summary.templates.custom.namePlaceholder"),
      descriptionPlaceholder: t(
        "summary.templates.custom.descriptionPlaceholder"
      ),
      customPromptTopic: t("summary.templates.custom.promptTopic"),
      customPromptContext: t("summary.templates.custom.promptContext"),
      editHint: t("summary.templates.custom.editHint"),
      deleteConfirmTitle: t("summary.templates.custom.deleteConfirmTitle"),
      deleteConfirmContent: (name) =>
        t("summary.templates.custom.deleteConfirmContent", {
          values: { name },
        }),
      createFailed: t("summary.templates.custom.createFailed"),
      updateFailed: t("summary.templates.custom.saveFailed"),
      resetFailed: t("summary.templates.custom.resetFailed"),
      deleteFailed: t("summary.templates.custom.deleteFailed"),
    }),
    [t]
  );

  const timeRangeLabels: TimeRangeSelectorLabels = {
    last7Days: t("summary.timeRange.last7d"),
    last15Days: t("summary.timeRange.last15d"),
    last30Days: t("summary.timeRange.lastMonth"),
    custom: t("summary.workbench.selector.customTimeRange"),
    clear: t("summary.workbench.selector.clearTimeRange"),
    startPlaceholder: t("summary.timeRange.startPlaceholder"),
    endPlaceholder: t("summary.timeRange.endPlaceholder"),
    customRangeAriaLabel: t("summary.workbench.selector.customTimeRange"),
    invalidOrder: t("summary.timeRange.validationEndAfterStart"),
    maxDaysExceeded: (maxDays) =>
      t("summary.timeRange.validationMaxDays", { values: { maxDays } }),
    longRangeWarning: t("summary.workbench.selector.longTimeRangeWarning"),
    formatCustomRange: (start, end) =>
      `${format.date(start)} – ${format.date(end)}`,
  };

  const resetSession = () => {
    // Distinguish the two storage-failure shapes: a READ failure means storage
    // is entirely unavailable (private mode), where the historical contract is
    // to keep going with an in-memory reset. A read that succeeds but whose
    // rotation fails (quota-exhausted writes) would otherwise silently strand
    // the user — abort that with feedback instead.
    // readSummaryWorkbenchSession already swallows read errors and returns "",
    // so a "fully blocked" storage and an "empty" session are indistinguishable
    // through it; both keep the historical in-memory-reset contract. Only a
    // readable session whose rotation fails (quota-exhausted writes) aborts.
    const currentPersisted = readSummaryWorkbenchSession(storageScope);
    const moved = moveSummaryWorkbenchSessionToPrevious(storageScope);
    if (!moved && currentPersisted) {
      // Rotation failed while a real session was persisted: keep the pending
      // theme-tracking timer so the event still fires for the session the
      // user is staying in, and surface why nothing happened.
      Toast.warning(t("summary.workbench.errors.sessionSaveFailed"));
      return;
    }
    if (themeTrackTimer.current) {
      clearTimeout(themeTrackTimer.current);
      themeTrackTimer.current = null;
    }
    if (moved) {
      setLastSessionId(readSummaryWorkbenchPreviousSession(storageScope));
    }
    setReferencedTask(derivedFromTask ?? null);
    setReferencePreviewOpen(false);
    setOpenSelector(null);
    setPendingTemplate(null);
    setHasSubmitted(false);
    setHasAcceptedDispatch(false);
    setLastFailedAction(null);
    setTemplateGalleryOpen(!derivedFromTask);
    templateFilledComposer.current = null;
    workbench.resetSession({ scope: initialScope });
  };

  const resumeLastSession = async () => {
    if (!lastSessionId || busy) return;
    const sessionToResume = lastSessionId;
    const currentPersisted = readSummaryWorkbenchSession(storageScope);
    const previousPersisted = readSummaryWorkbenchPreviousSession(storageScope);
    const hydration = await workbench.hydrateSession(sessionToResume);
    if (hydration.status === "failed" || hydration.status === "cancelled") {
      return;
    }
    if (hydration.status === "empty") {
      // The resumed session no longer exists server-side. Leave both storage
      // slots untouched (the runtime already cleared the active pointer) and
      // restore the conversation the user was reading, so an expired resume
      // never demotes the current session into the single :previous slot.
      Toast.warning(t("summary.workbench.errors.sessionExpired"));
      if (currentPersisted) {
        await workbench.hydrateSession(currentPersisted);
      } else {
        workbench.resetSession({ scope: initialScope });
      }
      setLastSessionId(readSummaryWorkbenchPreviousSession(storageScope));
      return;
    }

    // Commit the storage swap only after the target session has been
    // validated. A failed/cancelled hydration leaves both slots and the
    // recovery bar untouched.
    const demotedSessionId =
      currentPersisted && currentPersisted !== sessionToResume
        ? currentPersisted
        : "";
    const nextActiveSessionId =
      hydration.status === "hydrated" ? hydration.sessionId : "";
    const persisted = replaceSummaryWorkbenchSessionSlots(
      storageScope,
      nextActiveSessionId,
      demotedSessionId,
      {
        activeSessionId: currentPersisted || null,
        previousSessionId: previousPersisted || null,
      }
    );
    if (!persisted) {
      if (currentPersisted) {
        await workbench.hydrateSession(currentPersisted);
      } else {
        workbench.resetSession({ scope: initialScope });
      }
      setLastSessionId(readSummaryWorkbenchPreviousSession(storageScope));
      return;
    }
    setLastSessionId(demotedSessionId);
    setHasSubmitted(false);
    setHasAcceptedDispatch(false);
    setLastFailedAction(null);
    setTemplateGalleryOpen(false);
    templateFilledComposer.current = null;
  };

  const savePreview = async () => {
    const title = saveTitle.trim();
    if (!title) {
      Toast.warning(t("summary.create.titleRequired"));
      return;
    }
    const result = await workbench.savePreview(title);
    if (!result) return;
    setSaveDialogOpen(false);
    if (handledSavedTaskIds.current.has(result.task_id)) return;
    handledSavedTaskIds.current.add(result.task_id);
    // Reaching this branch means task creation/save succeeded. Transport,
    // protocol, and task-creation failures stay on the existing error path;
    // finish_status and gaps are post-save internal quality diagnostics only.
    trackAgentSummaryQuality(result, {
      object_id: channel?.channelID,
      source,
      entry_point: source,
      entry_source: source,
      trigger_mode: "agent",
    });
    Toast.success(t("summary.create.agentSummaryCreated"));
    notifyCreated(result.task_id, "agent");
    openTask(result.task_id);
  };

  const resolvedFallbackTemplates = useMemo(
    () => TOPIC_TEMPLATES.map((template) => resolveTemplate(template, t)),
    [t]
  );

  const applyTemplate = (template: SummaryWorkbenchTemplateScope) => {
    if (conversationEstablished) {
      setPendingTemplate(null);
      return;
    }
    updateScopeWithPreviewGuard({ ...workbench.scope, template }, () => {
      setPendingTemplate(null);
      templateFilledComposer.current = template.requirement;
      workbench.setComposerValue(template.requirement);
      setComposerFocusKey((current) => current + 1);
      // P1-4 (yujiawei review 5087124100): the workbench path lost this event —
      // its sole sink was the legacy SummaryCreatePage. Same payload shape as
      // the legacy emitter: no content, intent only.
      // DAP-266：补 source（应用来源=workbench）。
      // DAP-271 finding 6：template_type 由 template.isCustom 就近派生（scope 已透传 is_custom）。
      Dap.shared.track("smart_summary_template_applied", {
        template_type: template.isCustom ? "custom" : "preset",
        source: "workbench",
      });
    });
  };

  const handleTemplateChange = (
    template: SummaryWorkbenchTemplateScope | null
  ) => {
    if (busy || conversationEstablished) return;
    if (!template) {
      updateScopeWithPreviewGuard(
        { ...workbench.scope, template: null },
        () => {
          if (templateFilledComposer.current !== null) {
            templateFilledComposer.current = null;
            workbench.setComposerValue("");
          }
        }
      );
      return;
    }

    const currentInput = workbench.viewState.inputValue.trim();
    const previousRequirement = workbench.scope.template?.requirement.trim();
    if (
      currentInput &&
      currentInput !== previousRequirement &&
      currentInput !== template.requirement.trim()
    ) {
      setPendingTemplate(template);
      return;
    }
    applyTemplate(template);
  };

  return (
    <div
      ref={featureRef}
      className={`wk-summary-workbench-feature${
        referencePreviewOpen && referencedTask
          ? " wk-summary-workbench-feature--with-reference"
          : ""
      }`}
      data-testid={summaryTestIds.workbenchFeature}
    >
      <div className="wk-summary-workbench-feature__main">
        <SummaryWorkbench
          state={viewState}
          actions={{
            onInputChange: (value) => {
              setLastFailedAction(null);
              const shouldClearTemplate = Boolean(
                !conversationEstablished &&
                  !value.trim() &&
                  workbench.scope.template &&
                  templateFilledComposer.current !== null &&
                  workbench.viewState.inputValue ===
                    templateFilledComposer.current
              );
              templateFilledComposer.current = null;
              workbench.setComposerValue(value);
              if (shouldClearTemplate) {
                workbench.updateScope({
                  ...workbench.scope,
                  template: null,
                });
              }
              // P1-4 (yujiawei review 5087124100): top-of-funnel intent signal
              // was legacy-only. Mirror the legacy debounce (600ms, non-empty,
              // no content) instead of tracking every keystroke.
              if (themeTrackTimer.current)
                clearTimeout(themeTrackTimer.current);
              themeTrackTimer.current = setTimeout(() => {
                themeTrackTimer.current = null;
                if (value.trim())
                  // DAP-266：补 theme_len_bucket（长度分桶,非正文）。used_voice（是否语音输入）
                  //   此输入回调无语音来源标志 → DEFER。
                  Dap.shared.track("smart_summary_theme_input", {
                    theme_len_bucket: themeLenBucket(value.trim().length),
                  });
              }, 600);
            },
            onSend: () => void send(),
            onOpenContext: handleContextOpen,
            onRemoveContext: handleContextRemove,
            onResultAction: (action) => void handleResultAction(action),
            onNewSession: resetSession,
            onResumeLastSession: lastSessionId ? resumeLastSession : undefined,
          }}
          contextPanel={
            templateGalleryOpen && !conversationEstablished ? (
              <TemplateSelectorModal
                visible
                inline
                value={workbench.scope.template}
                labels={templateLabels}
                fallbackTemplates={resolvedFallbackTemplates}
                onChange={handleTemplateChange}
                onCancel={() => undefined}
              />
            ) : undefined
          }
        />
      </div>

      {referencePreviewOpen && referencedTask && (
        <SummaryReferenceSidePanel
          id={referencePreviewId}
          taskId={referencedTask.task_id}
          onClose={() => setReferencePreviewOpen(false)}
        />
      )}

      <ChatSelectorModal
        visible={openSelector === "chat"}
        selected={scopeChannelsToCandidates(workbench.scope.selectedChannels)}
        maxSelect={MAX_CHAT_SELECT}
        groupOnly={workbench.scope.participants.length > 0}
        onConfirm={(chats: ChatCandidate[]) => {
          if (busy) return;
          const result = replaceSelectedChannels(
            workbench.scope,
            chatCandidatesToScope(chats)
          );
          if (result.scope === workbench.scope) {
            setOpenSelector(null);
            return;
          }
          updateScopeWithPreviewGuard(result.scope, () => {
            setOpenSelector(null);
            if (result.participantsCleared) {
              Toast.info(t("summary.workbench.notice.participantsCleared"));
            }
          });
        }}
        onCancel={() => setOpenSelector(null)}
      />

      <DocumentSelectorModal
        visible={openSelector === "document" && documentSelectorAvailable}
        selected={scopeDocumentsToItems(workbench.scope.documents ?? [])}
        maxSelect={MAX_DOCUMENT_SELECT}
        onConfirm={(documents: DocSearchItem[]) => {
          if (busy) return;
          const result = replaceSelectedDocuments(
            workbench.scope,
            documentsToScope(documents)
          );
          if (result.scope === workbench.scope) {
            setOpenSelector(null);
            return;
          }
          updateScopeWithPreviewGuard(result.scope, () => {
            setOpenSelector(null);
            if (result.participantsCleared) {
              Toast.info(t("summary.workbench.notice.participantsCleared"));
            }
          });
        }}
        onCancel={() => setOpenSelector(null)}
      />

      <ChatSelectorModal
        visible={openSelector === "participant"}
        mode="members"
        maxSelect={MAX_PARTICIPANT_SELECT}
        memberCandidates={participantCandidateState.members}
        memberRoles={participantCandidateState.roles}
        memberLoading={participantCandidateState.status === "loading"}
        memberLoadError={participantCandidateState.status === "error"}
        onRetryMembers={() => void refreshParticipantCandidates(true)}
        selected={[]}
        selectedMembers={scopeParticipantsToCandidates(
          workbench.scope.participants
        )}
        onConfirm={() => undefined}
        onConfirmMembers={(members: WorkbenchMemberCandidate[]) => {
          if (busy) return;
          updateScopeWithPreviewGuard(
            {
              ...workbench.scope,
              participants: memberCandidatesToScope(members),
            },
            () => setOpenSelector(null)
          );
        }}
        onCancel={() => setOpenSelector(null)}
      />

      <Modal
        visible={openSelector === "time_range"}
        title={t("summary.workbench.selector.timeRangeTitle")}
        footer={null}
        onCancel={() => setOpenSelector(null)}
      >
        <div className="wk-summary-workbench-feature__time-range-panel">
          <TimeRangeSelector
            value={workbench.scope.timeRange}
            labels={timeRangeLabels}
            maxDays={maxTimeRangeDays}
            disabled={busy}
            onChange={(timeRange: SummaryWorkbenchTimeRangeScope | null) => {
              if (busy) return;
              updateScopeWithPreviewGuard(
                {
                  ...workbench.scope,
                  timeRange: timeRange
                    ? { ...timeRange, source: "picker" }
                    : null,
                },
                () => setOpenSelector(null)
              );
            }}
          />
        </div>
      </Modal>

      <Modal
        visible={pendingTemplate !== null && !conversationEstablished}
        title={t("summary.workbench.selector.replaceTemplateTitle")}
        okText={t("summary.workbench.selector.replaceTemplateConfirm")}
        cancelText={t("summary.common.cancel")}
        onOk={() => {
          if (pendingTemplate) applyTemplate(pendingTemplate);
        }}
        onCancel={() => setPendingTemplate(null)}
      >
        <p>{t("summary.workbench.selector.replaceTemplateContent")}</p>
      </Modal>

      <SummaryReferencePicker
        visible={openSelector === "reference"}
        onSelect={(task: SummaryListItem) => {
          if (busy) return;
          updateScopeWithPreviewGuard(
            {
              ...workbench.scope,
              referencedTaskIds: [task.task_id],
            },
            () => {
              setReferencedTask(task);
              setReferencePreviewOpen(true);
              setOpenSelector(null);
            }
          );
        }}
        onCancel={() => setOpenSelector(null)}
      />

      <Modal
        visible={saveDialogOpen}
        title={t("summary.create.saveDialogTitle")}
        onOk={() => void savePreview()}
        onCancel={() => {
          setSaveDialogOpen(false);
          workbench.clearError();
        }}
        okText={t("summary.common.confirm")}
        cancelText={t("summary.common.cancel")}
        confirmLoading={workbench.isSaving}
      >
        <Input
          value={saveTitle}
          maxLength={100}
          showClear
          autoFocus
          placeholder={t("summary.create.titlePlaceholder")}
          onChange={setSaveTitle}
        />
        {viewState.errorMessage && (
          <div className="wk-summary-workbench-feature__save-error">
            {viewState.errorMessage}
          </div>
        )}
      </Modal>

      {workbench.isHydrating && (
        <div className="wk-summary-workbench-feature__loading" aria-hidden>
          <Spin />
        </div>
      )}
    </div>
  );
}

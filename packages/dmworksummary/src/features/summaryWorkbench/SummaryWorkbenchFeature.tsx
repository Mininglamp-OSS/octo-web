import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input, Modal, Spin, Toast } from "@douyinfe/semi-ui";
import { Dap, useI18n } from "@octo/base";
import WKApp from "@octo/base/src/App";
import SummaryDetailPage from "../../pages/SummaryDetailPage";
import ChatSelectorModal from "../../components/ChatSelectorModal";
import SummaryReferencePicker from "../../components/SummaryReferencePicker";
import SummaryReferenceSidePanel from "../../components/SummaryReferenceSidePanel";
import TemplateSelectorModal, {
  type TemplateSelectorLabels,
} from "../../components/TemplateSelectorModal";
import TimeRangeSelector, {
  type TimeRangeSelectorLabels,
} from "../../components/TimeRangeSelector";
import {
  MAX_CHAT_SELECT,
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
import {
  deriveSummaryTitle,
  resolveTemplate,
} from "../../utils/templateResolver";
import { summaryTestIds } from "../../utils/testIds";
import {
  clearSummaryWorkbenchSession,
  readSummaryWorkbenchSession,
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
  emptySummaryWorkbenchScope,
  memberCandidatesToScope,
  participantSourceChannels,
  participantSourceKey,
  removeScopeContext,
  replaceSelectedChannels,
  retainValidParticipants,
  scopeChannelsToCandidates,
  scopeParticipantsToCandidates,
  type WorkbenchMemberCandidate,
} from "./scope";
import "./SummaryWorkbenchFeature.css";

export interface SummaryWorkbenchFeatureProps {
  spaceId: string;
  channel?: { channelID: string; channelType: number };
  derivedFromTask?: SummaryListItem;
  embedded?: boolean;
  source?: string;
  onCreated?: () => void;
  onOpenTask?: (taskId: number) => void;
  maxTimeRangeDays?: number;
  directTeamWorkflow?: boolean;
}

type OpenSelector = Exclude<SummaryWorkbenchContextKind, "template"> | null;
type ReferencedTask = Pick<SummaryListItem, "task_id" | "title">;
type ParticipantCandidateState = ParticipantCandidateLoadResult & {
  sourceKey: string;
  status: "idle" | "loading" | "ready" | "error";
};

function initialScopeFor(
  channel: SummaryWorkbenchFeatureProps["channel"],
  derivedFromTask: SummaryListItem | undefined
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
  source,
  onCreated,
  onOpenTask,
  maxTimeRangeDays = DEFAULT_SUMMARY_WORKSPACE_MAX_TIME_RANGE_DAYS,
  directTeamWorkflow = false,
}: SummaryWorkbenchFeatureProps) {
  const { t, format } = useI18n();
  const currentUserId = WKApp.loginInfo.uid || "";
  const initialScope = useMemo(
    () => initialScopeFor(channel, derivedFromTask),
    [channel?.channelID, channel?.channelType, derivedFromTask?.task_id]
  );
  const storageScope = useMemo<SummaryWorkbenchSessionScope>(
    () => ({
      userId: currentUserId,
      spaceId,
      channelId: channel?.channelID,
      channelType: channel?.channelType,
      referencedTaskId: derivedFromTask?.task_id,
    }),
    [
      channel?.channelID,
      channel?.channelType,
      derivedFromTask?.task_id,
      spaceId,
      currentUserId,
    ]
  );
  const [initialSessionId] = useState(() => {
    if (derivedFromTask) {
      clearSummaryWorkbenchSession(storageScope);
      return "";
    }
    return readSummaryWorkbenchSession(storageScope);
  });
  const [openSelector, setOpenSelector] = useState<OpenSelector>(null);
  const [referencedTask, setReferencedTask] = useState<ReferencedTask | null>(
    derivedFromTask ?? null
  );
  const [referencePreviewOpen, setReferencePreviewOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(true);
  const [pendingTemplate, setPendingTemplate] =
    useState<SummaryWorkbenchTemplateScope | null>(null);
  const notifiedTaskIds = useRef(new Set<number>());
  const handledSavedTaskIds = useRef(new Set<number>());
  const hydrationObserved = useRef(false);
  const templateFilledComposer = useRef<string | null>(null);
  const themeTrackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workbench = useSummaryWorkbench({
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
  const latestScopeRef = useRef(workbench.scope);
  const latestScopeChangeImpactRef = useRef<SummaryScopeChangeImpact | null>(
    controllerScopeChangeImpact(workbench)
  );
  const participantLoadSeq = useRef(0);
  const [participantCandidateState, setParticipantCandidateState] =
    useState<ParticipantCandidateState>({
      sourceKey: "",
      status: "idle",
      members: [],
      roles: new Map<string, number>(),
    });
  latestScopeRef.current = workbench.scope;
  latestScopeChangeImpactRef.current = controllerScopeChangeImpact(workbench);

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
          currentUserId,
          spaceId,
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
          const impact = latestScopeChangeImpactRef.current;
          workbench.updateScope(retained.scope);
          Toast.warning(
            t(
              impact
                ? "summary.workbench.notice.participantsPrunedArtifactInvalidated"
                : "summary.workbench.notice.participantsPruned"
            )
          );
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
      currentUserId,
      participantCandidateState.sourceKey,
      participantCandidateState.status,
      spaceId,
      t,
      workbench,
    ]
  );

  const participantScopeKey = participantSourceKey(workbench.scope);
  useEffect(() => {
    participantLoadSeq.current += 1;
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
    if (workbench.scope.participants.length > 0 && participantScopeKey) {
      void refreshParticipantCandidates(true);
    }
  }, [participantScopeKey]);

  // Unmount: clear the theme-input debounce so a pending track cannot fire
  // after the user has left (same rationale as the legacy page's cleanup).
  useEffect(() => {
    return () => {
      if (themeTrackTimer.current) clearTimeout(themeTrackTimer.current);
    };
  }, []);

  useEffect(() => {
    if (workbench.isHydrating) {
      hydrationObserved.current = true;
      return;
    }
    if (!hydrationObserved.current) return;
    hydrationObserved.current = false;
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
    workbench.viewState.messages.length,
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
    Dap.shared.track("smart_summary_started", {
      object_id: channel?.channelID,
      source,
      entry_point: source,
      entry_source: source,
      trigger_mode: triggerMode,
    });
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
  const busy =
    workbench.viewState.isSending ||
    workbench.isHydrating ||
    workbench.isConfirming ||
    workbench.isSaving;
  const participantScopeReady =
    workbench.scope.participants.length === 0 ||
    (Boolean(participantScopeKey) &&
      participantCandidateState.sourceKey === participantScopeKey &&
      participantCandidateState.status === "ready");
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
  const viewState = {
    ...workbench.viewState,
    contextItems,
    composerFocusKey,
    isSending: busy,
    canSend:
      !busy &&
      participantScopeReady &&
      (composerHasCustomText ||
        (!hasSubmitted && structuredGenerate) ||
        (hasSubmitted &&
          templateFilledComposer.current !== null &&
          structuredGenerate)),
    showTemplateTrigger: !templateGalleryOpen,
    sendLabelKey:
      !composerHasCustomText && structuredGenerate
        ? "summary.workbench.composer.generate"
        : "summary.workbench.composer.send",
    errorMessage: displayErrorKey
      ? t(displayErrorKey)
      : workbench.viewState.errorMessage,
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
    request: () => Promise<SummaryWorkbenchResponse | undefined>
  ) => {
    const previousInputValue = workbench.viewState.inputValue;
    const previousHasSubmitted = hasSubmitted;
    const previousTemplateGalleryOpen = templateGalleryOpen;
    const previousTemplateFilledComposer = templateFilledComposer.current;
    const responsePromise = request();

    templateFilledComposer.current = null;
    workbench.restoreComposerValue("");
    setHasSubmitted(true);
    setTemplateGalleryOpen(false);

    const response = await responsePromise;
    if (!isAcceptedResponse(response)) {
      workbench.restoreComposerValue(previousInputValue);
      templateFilledComposer.current = previousTemplateFilledComposer;
      setHasSubmitted(previousHasSubmitted);
      setTemplateGalleryOpen(previousTemplateGalleryOpen);
    }
    return response;
  };

  const send = async () => {
    if (!viewState.canSend) return;
    if (themeTrackTimer.current) {
      clearTimeout(themeTrackTimer.current);
      themeTrackTimer.current = undefined;
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
      !hasSubmitted &&
      workbench.scope.participants.length > 0
        ? "start_team_workflow"
        : "chat";
    const response = await runStartedTask(() =>
      action === "start_team_workflow"
        ? workbench.send(message, inputOrigin, action)
        : workbench.send(message, inputOrigin)
    );
    if (isAcceptedResponse(response)) {
      Dap.shared.track("smart_summary_agent_message_sent", {});
    }
    observeWorkflow(response);
  };

  const openTask = (taskId: number) => {
    if (embedded && onOpenTask) {
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
    if (busy) return;
    if (kind === "template") {
      setTemplateGalleryOpen(true);
      return;
    }
    if (kind === "participant" && !canSelectParticipants(workbench.scope)) {
      Toast.info(t("summary.workbench.notice.selectSingleChatForParticipants"));
      return;
    }
    setOpenSelector(kind);
    if (kind === "participant") {
      void refreshParticipantCandidates();
    }
    if (kind === "reference" && referencedTask) {
      setReferencePreviewOpen(true);
    }
  };

  const handleContextRemove = (
    kind: SummaryWorkbenchContextKind,
    id: string
  ) => {
    if (busy) return;
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

  const templateLabels: TemplateSelectorLabels = {
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
  };

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
    if (themeTrackTimer.current) {
      clearTimeout(themeTrackTimer.current);
      themeTrackTimer.current = undefined;
    }
    clearSummaryWorkbenchSession(storageScope);
    setReferencedTask(derivedFromTask ?? null);
    setReferencePreviewOpen(false);
    setOpenSelector(null);
    setPendingTemplate(null);
    setHasSubmitted(false);
    setTemplateGalleryOpen(true);
    templateFilledComposer.current = null;
    workbench.resetSession({ scope: initialScope });
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
    // P1-5 (yujiawei review 5087124100): gate the warning on finish_status,
    // not on gaps[0].detail — {finish_status:"FAILED", gaps:[]} previously
    // produced a success toast. Show gap detail when present, otherwise a
    // generic quality-gate warning.
    const qualityGateHit =
      result.finish_status === "PARTIAL" || result.finish_status === "FAILED";
    if (qualityGateHit) {
      const firstGapDetail = result.gaps?.[0]?.detail;
      if (firstGapDetail) {
        Toast.warning(
          t("summary.workbench.notice.savedWithQualityGap", {
            values: { detail: firstGapDetail },
          })
        );
      } else {
        Toast.warning(
          t("summary.workbench.notice.savedWithQualityGateWarning")
        );
      }
    } else {
      Toast.success(t("summary.create.agentSummaryCreated"));
    }
    notifyCreated(result.task_id, "agent");
    openTask(result.task_id);
  };

  const resolvedFallbackTemplates = useMemo(
    () => TOPIC_TEMPLATES.map((template) => resolveTemplate(template, t)),
    [t]
  );

  const applyTemplate = (template: SummaryWorkbenchTemplateScope) => {
    updateScopeWithPreviewGuard({ ...workbench.scope, template }, () => {
      setPendingTemplate(null);
      templateFilledComposer.current = template.requirement;
      workbench.setComposerValue(template.requirement);
      setComposerFocusKey((current) => current + 1);
      // P1-4 (yujiawei review 5087124100): the workbench path lost this event —
      // its sole sink was the legacy SummaryCreatePage. Same payload shape as
      // the legacy emitter: no content, intent only.
      Dap.shared.track("smart_summary_template_applied", {});
    });
  };

  const handleTemplateChange = (
    template: SummaryWorkbenchTemplateScope | null
  ) => {
    if (busy) return;
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
              const shouldClearTemplate = Boolean(
                !hasSubmitted &&
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
                if (value.trim())
                  Dap.shared.track("smart_summary_theme_input", {});
              }, 600);
            },
            onSend: () => void send(),
            onOpenContext: handleContextOpen,
            onRemoveContext: handleContextRemove,
            onResultAction: (action) => void handleResultAction(action),
            onNewSession: resetSession,
          }}
          contextPanel={
            templateGalleryOpen ? (
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
        visible={pendingTemplate !== null}
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
        selectedTaskId={referencedTask?.task_id}
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

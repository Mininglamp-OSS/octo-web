import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { MAX_CHAT_SELECT } from "../../constants/limits";
import { TOPIC_TEMPLATES } from "../../constants/templates";
import summaryWorkbenchService from "../../Service/SummaryWorkbenchService";
import type { SummaryWorkbenchResponse } from "../../bridge/summaryWorkbench/model";
import {
  DEFAULT_SUMMARY_WORKSPACE_MAX_TIME_RANGE_DAYS,
  type SummaryWorkbenchScope,
  type SummaryWorkbenchTemplateScope,
  type SummaryWorkbenchTimeRangeScope,
  type SummaryWorkspaceInputOrigin,
} from "../../bridge/summaryWorkbench/protocol";
import useSummaryWorkbench from "../../bridge/summaryWorkbench/useSummaryWorkbench";
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
  canSelectParticipants,
  canGenerateFromScope,
  chatCandidatesToScope,
  emptySummaryWorkbenchScope,
  memberCandidatesToScope,
  participantSourceChannel,
  removeScopeContext,
  replaceSelectedChannels,
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
}

type OpenSelector = Exclude<SummaryWorkbenchContextKind, "template"> | null;
type ReferencedTask = Pick<SummaryListItem, "task_id" | "title">;

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
}: SummaryWorkbenchFeatureProps) {
  const { t, format } = useI18n();
  const initialScope = useMemo(
    () => initialScopeFor(channel, derivedFromTask),
    [channel?.channelID, channel?.channelType, derivedFromTask?.task_id]
  );
  const storageScope = useMemo<SummaryWorkbenchSessionScope>(
    () => ({
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
  const hydrationObserved = useRef(false);
  const templateFilledComposer = useRef<string | null>(null);

  const workbench = useSummaryWorkbench({
    initialSessionId,
    initialScope,
    layout: embedded ? "panel" : "full",
    autoHydrate: initialSessionId.length > 0,
    onSessionIdChange: (sessionId) =>
      writeSummaryWorkbenchSession(storageScope, sessionId),
  });

  useEffect(() => {
    writeSummaryWorkbenchSession(storageScope, workbench.sessionId);
  }, [storageScope, workbench.sessionId]);

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
      (composerHasCustomText || (!hasSubmitted && structuredGenerate)),
    showTemplateTrigger: !templateGalleryOpen,
    sendLabelKey:
      !composerHasCustomText && structuredGenerate
        ? "summary.workbench.composer.generate"
        : "summary.workbench.composer.send",
    errorMessage: displayErrorKey
      ? t(displayErrorKey)
      : workbench.viewState.errorMessage,
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
    workbench.setComposerValue("");
    setHasSubmitted(true);
    setTemplateGalleryOpen(false);

    const response = await responsePromise;
    if (!isAcceptedResponse(response)) {
      workbench.setComposerValue(previousInputValue);
      templateFilledComposer.current = previousTemplateFilledComposer;
      setHasSubmitted(previousHasSubmitted);
      setTemplateGalleryOpen(previousTemplateGalleryOpen);
    }
    return response;
  };

  const send = async () => {
    if (!viewState.canSend) return;
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
    Dap.shared.track("smart_summary_agent_message_sent", {});
    const response = await runStartedTask(() =>
      workbench.send(message, inputOrigin)
    );
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
    workbench.updateScope(result.scope);
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
    const firstGapDetail =
      (result.finish_status === "PARTIAL" ||
        result.finish_status === "FAILED") &&
      result.gaps?.[0]?.detail;
    if (firstGapDetail) {
      Toast.warning(
        t("summary.workbench.notice.savedWithQualityGap", {
          values: { detail: firstGapDetail },
        })
      );
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
    workbench.updateScope({ ...workbench.scope, template });
    templateFilledComposer.current = template.requirement;
    workbench.setComposerValue(template.requirement);
    setComposerFocusKey((current) => current + 1);
    setPendingTemplate(null);
  };

  const handleTemplateChange = (
    template: SummaryWorkbenchTemplateScope | null
  ) => {
    if (busy) return;
    if (!template) {
      workbench.updateScope({ ...workbench.scope, template: null });
      if (templateFilledComposer.current !== null) {
        templateFilledComposer.current = null;
        workbench.setComposerValue("");
      }
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
              templateFilledComposer.current = null;
              workbench.setComposerValue(value);
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
        onConfirm={(chats: ChatCandidate[]) => {
          if (busy) return;
          const result = replaceSelectedChannels(
            workbench.scope,
            chatCandidatesToScope(chats)
          );
          workbench.updateScope(result.scope);
          setOpenSelector(null);
          if (result.participantsCleared) {
            Toast.info(t("summary.workbench.notice.participantsCleared"));
          }
        }}
        onCancel={() => setOpenSelector(null)}
      />

      <ChatSelectorModal
        visible={openSelector === "participant"}
        mode="members"
        channel={participantSourceChannel(workbench.scope)}
        selected={[]}
        selectedMembers={scopeParticipantsToCandidates(
          workbench.scope.participants
        )}
        onConfirm={() => undefined}
        onConfirmMembers={(members: WorkbenchMemberCandidate[]) => {
          if (busy) return;
          workbench.updateScope({
            ...workbench.scope,
            participants: memberCandidatesToScope(members),
          });
          setOpenSelector(null);
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
              workbench.updateScope({
                ...workbench.scope,
                timeRange,
              });
              setOpenSelector(null);
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
          setReferencedTask(task);
          setReferencePreviewOpen(true);
          workbench.updateScope({
            ...workbench.scope,
            referencedTaskIds: [task.task_id],
          });
          setOpenSelector(null);
        }}
        onCancel={() => setOpenSelector(null)}
      />

      <Modal
        visible={saveDialogOpen}
        title={t("summary.create.saveDialogTitle")}
        onOk={() => void savePreview()}
        onCancel={() => setSaveDialogOpen(false)}
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
      </Modal>

      {workbench.isHydrating && (
        <div className="wk-summary-workbench-feature__loading" aria-hidden>
          <Spin />
        </div>
      )}
    </div>
  );
}

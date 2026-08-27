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
import type {
  SummaryWorkbenchScope,
  SummaryWorkbenchTimeRangeScope,
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
  onOpenScheduledSummary?: () => void;
}

type OpenSelector = SummaryWorkbenchContextKind | null;
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

export default function SummaryWorkbenchFeature({
  spaceId,
  channel,
  derivedFromTask,
  embedded = false,
  source,
  onCreated,
  onOpenTask,
  onOpenScheduledSummary,
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
  const notifiedTaskIds = useRef(new Set<number>());

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

  const structuredGenerate = canGenerateFromScope(workbench.scope);
  const composerHasText = workbench.viewState.inputValue.trim().length > 0;
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
    isSending: busy,
    canSend: !busy && (composerHasText || structuredGenerate),
    sendLabelKey:
      !composerHasText && structuredGenerate
        ? "summary.workbench.composer.generate"
        : "summary.workbench.composer.send",
    errorMessage: displayErrorKey
      ? t(displayErrorKey)
      : workbench.viewState.errorMessage,
  };

  const send = async () => {
    if (!viewState.canSend) return;
    const message = composerHasText
      ? undefined
      : workbench.scope.participants.length > 0
      ? t("summary.workbench.intent.team")
      : t("summary.workbench.intent.personal");
    Dap.shared.track("smart_summary_agent_message_sent", {});
    observeWorkflow(await workbench.send(message));
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
      observeWorkflow(await workbench.confirmWorkflow());
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
    const result = removeScopeContext(workbench.scope, kind, id);
    workbench.updateScope(result.scope);
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
    formatCustomRange: (start, end) =>
      `${format.date(start)} – ${format.date(end)}`,
  };

  const resetSession = () => {
    clearSummaryWorkbenchSession(storageScope);
    setReferencedTask(derivedFromTask ?? null);
    setReferencePreviewOpen(false);
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
    Toast.success(t("summary.create.agentSummaryCreated"));
    notifyCreated(result.task_id, "agent");
    openTask(result.task_id);
  };

  const resolvedFallbackTemplates = useMemo(
    () => TOPIC_TEMPLATES.map((template) => resolveTemplate(template, t)),
    [t]
  );

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
            onInputChange: workbench.setComposerValue,
            onSend: () => void send(),
            onOpenContext: handleContextOpen,
            onRemoveContext: handleContextRemove,
            onResultAction: (action) => void handleResultAction(action),
            onNewSession: resetSession,
            onOpenScheduledSummary,
          }}
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

      <TemplateSelectorModal
        visible={openSelector === "template"}
        value={workbench.scope.template}
        labels={templateLabels}
        fallbackTemplates={resolvedFallbackTemplates}
        onChange={(template) => {
          if (busy) return;
          workbench.updateScope({ ...workbench.scope, template });
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
        <TimeRangeSelector
          value={workbench.scope.timeRange}
          labels={timeRangeLabels}
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

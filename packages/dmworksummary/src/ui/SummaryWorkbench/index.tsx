import React from "react";
import { useI18n, WKButton } from "@octo/base";
import { summaryTestIds } from "../../utils/testIds";
import type {
  SummaryWorkbenchAction,
  SummaryWorkbenchCardView,
  SummaryWorkbenchContextKind,
  SummaryWorkbenchMessageView,
  SummaryWorkbenchProcessView,
  SummaryWorkbenchProps,
} from "./types";
import { visibleSummaryWorkbenchActions } from "./types";
import "./index.css";

const COMPOSER_CONTEXT_KINDS: SummaryWorkbenchContextKind[] = [
  "chat",
  "participant",
  "time_range",
];

const REFERENCE_CONTEXT_KIND: SummaryWorkbenchContextKind = "reference";

const CONTEXT_LABEL_KEYS: Record<SummaryWorkbenchContextKind, string> = {
  chat: "summary.workbench.context.chat",
  participant: "summary.workbench.context.participant",
  template: "summary.workbench.context.template",
  time_range: "summary.workbench.context.timeRange",
  reference: "summary.workbench.context.reference",
};

const PROGRESS_LABEL_KEYS: Record<string, string> = {
  understand: "summary.common.agentChat.progress.understand",
  retrieve: "summary.common.agentChat.progress.retrieve",
  filter: "summary.common.agentChat.progress.filter",
  distill: "summary.common.agentChat.progress.distill",
  compose: "summary.common.agentChat.progress.compose",
  reply: "summary.common.agentChat.progress.reply",
};

const ACTION_LABEL_KEYS: Record<SummaryWorkbenchAction, string> = {
  confirm_workflow: "summary.workbench.actions.confirmWorkflow",
  save_preview: "summary.workbench.actions.savePreview",
  view_summary: "summary.workbench.actions.viewSummary",
  view_progress: "summary.workbench.actions.viewProgress",
  continue_chat: "summary.workbench.actions.continueChat",
};

const SummaryWorkbench = ({
  state,
  actions,
  className,
  contextPanel,
}: SummaryWorkbenchProps) => {
  const { t } = useI18n();
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const conversationRef = React.useRef<HTMLDivElement>(null);
  const shouldFollowConversationRef = React.useRef(true);
  const wasSendingRef = React.useRef(state.isSending);
  const isComposerDisabled = state.isSending || Boolean(state.isHydrating);
  const composerContextItems = state.contextItems.filter(
    (item) => item.kind !== REFERENCE_CONTEXT_KIND
  );
  const referenceContextItems = state.contextItems.filter(
    (item) => item.kind === REFERENCE_CONTEXT_KIND
  );
  const composerContextKinds = state.showTemplateTrigger
    ? [...COMPOSER_CONTEXT_KINDS, "template" as const]
    : COMPOSER_CONTEXT_KINDS;
  const progressSteps = state.progressSteps?.length
    ? state.progressSteps
    : state.isSending
    ? [{ phase: "understand" }]
    : [];
  const hasInlineCard = state.messages.some((message) => Boolean(message.card));
  const hasConversationContent =
    Boolean(state.isHydrating) ||
    state.messages.length > 0 ||
    progressSteps.length > 0 ||
    Boolean(state.card) ||
    !contextPanel;
  const rootClassName = [
    "wk-summary-workbench",
    `wk-summary-workbench--${state.layout}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  React.useEffect(() => {
    if (!state.composerFocusKey) return;
    composerRef.current?.focus();
  }, [state.composerFocusKey]);

  React.useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    const startedSending = state.isSending && !wasSendingRef.current;
    wasSendingRef.current = state.isSending;
    if (!startedSending && !shouldFollowConversationRef.current) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [progressSteps.length, state.isSending, state.messages.length]);

  const renderProcess = (
    processId: string,
    process: SummaryWorkbenchProcessView
  ) => {
    const latestStep = process.steps[process.steps.length - 1];
    if (!latestStep) return null;
    const isRunning = process.status === "running";
    const isFailed = process.status === "failed";
    const detailsId = `summary-process-${processId.replace(
      /[^a-zA-Z0-9_-]/g,
      "-"
    )}`;

    return (
      <details
        className={`wk-summary-workbench-process wk-summary-workbench-process--${process.status}`}
        data-card-family="process"
        data-card-type="summary_generation"
        data-card-state={process.status}
        data-testid="summary-workbench-progress"
      >
        <summary aria-controls={detailsId}>
          <span
            className={`wk-summary-workbench-process__indicator${
              isRunning
                ? " wk-summary-workbench-process__indicator--running"
                : isFailed
                ? " wk-summary-workbench-process__indicator--failed"
                : ""
            }`}
            aria-hidden="true"
          />
          <span
            className="wk-summary-workbench-process__status"
            aria-live="polite"
          >
            {isRunning
              ? t("summary.common.agentChat.generating")
              : isFailed
              ? t("summary.status.failed")
              : t("summary.status.completed")}
          </span>
          <span className="wk-summary-workbench-process__current">
            ·{" "}
            {isRunning
              ? t(
                  PROGRESS_LABEL_KEYS[latestStep.phase] ??
                    "summary.common.agentChat.progress.fallback"
                )
              : t("summary.common.agentChat.viewGenerationProcess")}
          </span>
          <svg
            className="wk-summary-workbench-process__chevron"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 6.5 8 10l4-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <ol id={detailsId} className="wk-summary-workbench-process__steps">
          {process.steps.map((step, index) => (
            <li key={`${step.phase}:${index}`}>
              <span>
                {t(
                  PROGRESS_LABEL_KEYS[step.phase] ??
                    "summary.common.agentChat.progress.fallback"
                )}
              </span>
              {step.count !== undefined && (
                <span className="wk-summary-workbench-process__count">
                  {t("summary.common.agentPanel.processedCount", {
                    values: { count: step.count },
                  })}
                </span>
              )}
            </li>
          ))}
        </ol>
      </details>
    );
  };

  const renderCard = (card: SummaryWorkbenchCardView, ownerId = "active") => {
    const cardActions = visibleSummaryWorkbenchActions(
      card.kind,
      card.actions,
      card.isStale
    );
    const isWorkflowStarted = card.kind === "workflow_started";
    const isWorkflowCompleted = card.kind === "workflow_completed";
    const isPreview =
      card.kind === "agent_preview" || card.kind === "agent_revision";
    const titleKey =
      card.kind === "team_confirmation"
        ? "summary.workbench.card.teamConfirmationTitle"
        : isWorkflowStarted
        ? "summary.workbench.card.workflowStartedTitle"
        : isWorkflowCompleted
        ? "summary.workbench.card.workflowCompletedTitle"
        : "summary.workbench.card.previewTitle";
    const badgeKey =
      card.kind === "team_confirmation"
        ? "summary.workbench.card.teamConfirmationBadge"
        : isWorkflowStarted
        ? "summary.workbench.card.workflowStartedBadge"
        : isWorkflowCompleted
        ? "summary.workbench.card.workflowCompletedBadge"
        : card.kind === "agent_revision"
        ? "summary.workbench.card.revisionBadge"
        : "summary.workbench.card.previewBadge";
    const titleId = `summary-card-${ownerId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const cardFamily =
      card.kind === "team_confirmation"
        ? "decision"
        : isWorkflowStarted || isWorkflowCompleted
        ? "object"
        : "content";

    return (
      <article
        className={`wk-summary-workbench-card wk-summary-workbench-card--${card.kind}`}
        data-card-family={cardFamily}
        data-card-type={card.kind}
        data-card-state={
          card.isStale ? "stale" : card.isHistorical ? "archived" : "active"
        }
        aria-labelledby={titleId}
        data-testid="summary-workbench-result-card"
      >
        <header className="wk-summary-workbench-card__header">
          <div>
            <span className="wk-summary-workbench-card__badge">
              {t(badgeKey)}
            </span>
            {card.isStale && (
              <span className="wk-summary-workbench-card__badge wk-summary-workbench-card__badge--stale">
                {t("summary.workbench.card.staleBadge")}
              </span>
            )}
            {isPreview && !card.isStale && (
              <span className="wk-summary-workbench-card__badge wk-summary-workbench-card__badge--state">
                {t(
                  card.isHistorical
                    ? "summary.workbench.card.historicalBadge"
                    : "summary.workbench.card.currentBadge"
                )}
              </span>
            )}
          </div>
          <h2 id={titleId}>
            {t(
              titleKey,
              isPreview ? { values: { version: card.version } } : undefined
            )}
          </h2>
        </header>

        {card.kind === "team_confirmation" && (
          <dl className="wk-summary-workbench-card__details">
            <div>
              <dt>{t("summary.workbench.card.participants")}</dt>
              <dd>{card.participantNames.join(", ")}</dd>
            </div>
            {card.templateLabel && (
              <div>
                <dt>{t("summary.workbench.card.template")}</dt>
                <dd>{card.templateLabel}</dd>
              </div>
            )}
            {card.timeRangeLabel && (
              <div>
                <dt>{t("summary.workbench.card.timeRange")}</dt>
                <dd>{card.timeRangeLabel}</dd>
              </div>
            )}
            <div>
              <dt>{t("summary.workbench.card.requirement")}</dt>
              <dd>{card.requirement}</dd>
            </div>
          </dl>
        )}

        {(isWorkflowStarted || isWorkflowCompleted) && (
          <div className="wk-summary-workbench-card__workflow">
            <p className="wk-summary-workbench-card__task-title">
              {card.taskTitle}
            </p>
            <dl className="wk-summary-workbench-card__details">
              <div>
                <dt>{t("summary.workbench.card.taskId")}</dt>
                <dd>{card.taskId}</dd>
              </div>
              {card.participantCount !== undefined && (
                <div>
                  <dt>{t("summary.workbench.card.participants")}</dt>
                  <dd>{card.participantCount}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {isPreview && (
          <div className="wk-summary-workbench-card__preview">
            <div className="wk-summary-workbench-card__content">
              {card.content}
            </div>
            {card.assumptions.length > 0 && (
              <div className="wk-summary-workbench-card__assumptions">
                <h3>{t("summary.workbench.card.assumptions")}</h3>
                <ul>
                  {card.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {cardActions.length > 0 && (
          <div className="wk-summary-workbench-card__actions">
            {cardActions.map((action) => (
              <WKButton
                key={action}
                type="button"
                variant={
                  action === "confirm_workflow" || action === "save_preview"
                    ? "primary"
                    : "secondary"
                }
                onClick={() => {
                  actions.onResultAction(action);
                  if (action === "continue_chat") composerRef.current?.focus();
                }}
              >
                {t(ACTION_LABEL_KEYS[action])}
              </WKButton>
            ))}
          </div>
        )}
      </article>
    );
  };

  const renderMessage = (message: SummaryWorkbenchMessageView) => {
    const isAssistant = message.role === "assistant";
    return (
      <article
        className={`wk-summary-workbench-message wk-summary-workbench-message--${message.role}`}
        data-result-type={message.resultType}
        data-testid="summary-workbench-message"
      >
        <span
          className="wk-summary-workbench-message__avatar"
          aria-hidden="true"
        >
          {isAssistant ? "AI" : t("summary.workbench.message.userAvatar")}
        </span>
        <div className="wk-summary-workbench-message__main">
          <header className="wk-summary-workbench-message__head">
            {t(
              isAssistant
                ? "summary.workbench.message.assistant"
                : "summary.workbench.message.user"
            )}
          </header>
          {message.process && renderProcess(message.id, message.process)}
          {message.content && (
            <div className="wk-summary-workbench-message__text">
              {message.content}
            </div>
          )}
          {message.card && renderCard(message.card, message.id)}
        </div>
      </article>
    );
  };

  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    if (state.canSend && !state.isSending) actions.onSend();
  };

  return (
    <section
      className={rootClassName}
      data-testid="summary-workbench"
      data-screen-label="smart-summary-workbench"
    >
      <header className="wk-summary-workbench__header">
        <div className="wk-summary-workbench__heading">
          <div>
            <h1>{t("summary.workbench.title")}</h1>
            {state.messages.length === 0 && (
              <p>{t("summary.workbench.subtitle")}</p>
            )}
          </div>
          <div className="wk-summary-workbench__header-actions">
            <div className="wk-summary-workbench__reference-context">
              <WKButton
                type="button"
                size="sm"
                variant="ghost"
                className={
                  referenceContextItems.length > 0
                    ? "wk-summary-workbench-context__trigger--active"
                    : undefined
                }
                aria-pressed={referenceContextItems.length > 0}
                disabled={isComposerDisabled}
                onClick={() => actions.onOpenContext(REFERENCE_CONTEXT_KIND)}
              >
                {t(CONTEXT_LABEL_KEYS[REFERENCE_CONTEXT_KIND])}
              </WKButton>
              {referenceContextItems.map((item) => (
                <span
                  className="wk-summary-workbench-context__item"
                  key={`${item.kind}:${item.id}`}
                >
                  <span>{item.label}</span>
                  <WKButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={<span aria-hidden="true">×</span>}
                    className="wk-summary-workbench-context__remove"
                    disabled={isComposerDisabled}
                    aria-label={t("summary.workbench.context.remove", {
                      values: {
                        label: item.label,
                      },
                    })}
                    onClick={() =>
                      actions.onRemoveContext(REFERENCE_CONTEXT_KIND, item.id)
                    }
                  />
                </span>
              ))}
            </div>
            {actions.onNewSession && (
              <WKButton
                type="button"
                size="sm"
                variant="primary"
                disabled={isComposerDisabled}
                onClick={actions.onNewSession}
                data-testid={summaryTestIds.agentNewSessionBtn}
              >
                {t("summary.workbench.actions.newSession")}
              </WKButton>
            )}
          </div>
        </div>
      </header>

      {hasConversationContent && (
        <div
          ref={conversationRef}
          className="wk-summary-workbench__conversation"
          role="log"
          aria-label={t("summary.workbench.message.conversation")}
          onScroll={(event) => {
            const element = event.currentTarget;
            shouldFollowConversationRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              80;
          }}
        >
          {state.isHydrating ? (
            <p className="wk-summary-workbench__empty">
              {t("summary.workbench.loadingHistory")}
            </p>
          ) : state.messages.length === 0 && !contextPanel ? (
            <div className="wk-summary-workbench__empty-message">
              <span
                className="wk-summary-workbench-message__avatar"
                aria-hidden="true"
              >
                AI
              </span>
              <div>
                <strong>{t("summary.workbench.message.assistant")}</strong>
                <p>{t("summary.workbench.empty")}</p>
              </div>
            </div>
          ) : (
            state.messages.map((message) => (
              <React.Fragment key={message.id}>
                {renderMessage(message)}
              </React.Fragment>
            ))
          )}
          {state.isSending && progressSteps.length > 0 && (
            <article
              className="wk-summary-workbench-message wk-summary-workbench-message--assistant wk-summary-workbench-message--pending"
              data-testid="summary-workbench-message"
            >
              <span
                className="wk-summary-workbench-message__avatar"
                aria-hidden="true"
              >
                AI
              </span>
              <div className="wk-summary-workbench-message__main">
                <header className="wk-summary-workbench-message__head">
                  {t("summary.workbench.message.assistant")}
                </header>
                {renderProcess("active", {
                  status: "running",
                  steps: progressSteps,
                })}
              </div>
            </article>
          )}
          {state.card &&
            !hasInlineCard &&
            renderMessage({
              id: "active-result",
              role: "assistant",
              content: "",
              card: state.card,
            })}
        </div>
      )}

      {state.errorMessage && (
        <div className="wk-summary-workbench__error" role="alert">
          {state.errorMessage}
        </div>
      )}

      {contextPanel && (
        <div
          id="summary-workbench-context-panel"
          className="wk-summary-workbench__context-panel"
        >
          {contextPanel}
        </div>
      )}

      <div
        className={`wk-summary-workbench__composer${
          isComposerDisabled ? " wk-summary-workbench__composer--disabled" : ""
        }`}
      >
        <textarea
          ref={composerRef}
          value={state.inputValue}
          placeholder={t(state.placeholderKey)}
          aria-label={t(state.placeholderKey)}
          disabled={isComposerDisabled}
          rows={2}
          onChange={(event) => actions.onInputChange(event.target.value)}
          onKeyDown={handleComposerKeyDown}
        />
        {composerContextItems.length > 0 && (
          <div className="wk-summary-workbench__selected-contexts">
            {composerContextItems.map((item) => (
              <span
                className="wk-summary-workbench-context__item"
                key={`${item.kind}:${item.id}`}
              >
                <span>{item.label}</span>
                <WKButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={<span aria-hidden="true">×</span>}
                  className="wk-summary-workbench-context__remove"
                  disabled={isComposerDisabled}
                  aria-label={t("summary.workbench.context.remove", {
                    values: {
                      label: item.label,
                    },
                  })}
                  onClick={() => actions.onRemoveContext(item.kind, item.id)}
                />
              </span>
            ))}
          </div>
        )}
        <div className="wk-summary-workbench__composer-toolbar">
          <div className="wk-summary-workbench__contexts">
            {composerContextKinds.map((kind) => {
              const hasItems = composerContextItems.some(
                (item) => item.kind === kind
              );
              return (
                <WKButton
                  key={kind}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={
                    hasItems
                      ? "wk-summary-workbench-context__trigger--active"
                      : undefined
                  }
                  aria-pressed={hasItems}
                  disabled={isComposerDisabled}
                  onClick={() => actions.onOpenContext(kind)}
                >
                  {t(CONTEXT_LABEL_KEYS[kind])}
                </WKButton>
              );
            })}
          </div>
          <WKButton
            type="button"
            size="sm"
            variant="primary"
            className="wk-summary-workbench__send"
            loading={state.isSending}
            disabled={!state.canSend || isComposerDisabled}
            onClick={actions.onSend}
          >
            {t(state.sendLabelKey ?? "summary.workbench.composer.send")}
          </WKButton>
        </div>
      </div>
    </section>
  );
};

export default SummaryWorkbench;
export { SummaryWorkbench };
export type {
  SummaryWorkbenchAction,
  SummaryWorkbenchActions,
  SummaryWorkbenchCardView,
  SummaryWorkbenchContextItem,
  SummaryWorkbenchContextKind,
  SummaryWorkbenchMessageView,
  SummaryWorkbenchProcessView,
  SummaryWorkbenchProps,
  SummaryWorkbenchResultType,
  SummaryWorkbenchViewState,
} from "./types";

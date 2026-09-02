import React from "react";
import { useI18n, WKButton } from "@octo/base";
import type {
  SummaryWorkbenchAction,
  SummaryWorkbenchCardView,
  SummaryWorkbenchContextKind,
  SummaryWorkbenchProps,
} from "./types";
import { visibleSummaryWorkbenchActions } from "./types";
import "./index.css";

const COMPOSER_CONTEXT_KINDS: SummaryWorkbenchContextKind[] = ["chat", "participant", "time_range"];

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

const SummaryWorkbench = ({ state, actions, className, contextPanel }: SummaryWorkbenchProps) => {
  const { t } = useI18n();
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
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
  const hasConversationContent =
    Boolean(state.isHydrating) ||
    state.messages.length > 0 ||
    (state.progressSteps?.length ?? 0) > 0 ||
    Boolean(state.card) ||
    !contextPanel;
  const rootClassName = ["wk-summary-workbench", `wk-summary-workbench--${state.layout}`, className]
    .filter(Boolean)
    .join(" ");

  React.useEffect(() => {
    if (!state.composerFocusKey) return;
    composerRef.current?.focus();
  }, [state.composerFocusKey]);

  const renderCard = (card: SummaryWorkbenchCardView) => {
    const cardActions = visibleSummaryWorkbenchActions(card.kind, card.actions, card.isStale);
    const isWorkflowStarted = card.kind === "workflow_started";
    const isWorkflowCompleted = card.kind === "workflow_completed";
    const isPreview = card.kind === "agent_preview" || card.kind === "agent_revision";
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

    return (
      <article
        className={`wk-summary-workbench-card wk-summary-workbench-card--${card.kind}`}
        data-testid="summary-workbench-result-card"
      >
        <header className="wk-summary-workbench-card__header">
          <div>
            <span className="wk-summary-workbench-card__badge">{t(badgeKey)}</span>
            {card.isStale && (
              <span className="wk-summary-workbench-card__badge wk-summary-workbench-card__badge--stale">
                {t("summary.workbench.card.staleBadge")}
              </span>
            )}
          </div>
          <h2>{t(titleKey, isPreview ? { values: { version: card.version } } : undefined)}</h2>
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
            <p className="wk-summary-workbench-card__task-title">{card.taskTitle}</p>
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
            <div className="wk-summary-workbench-card__content">{card.content}</div>
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

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
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
            <p>{t("summary.workbench.subtitle")}</p>
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
                    onClick={() => actions.onRemoveContext(REFERENCE_CONTEXT_KIND, item.id)}
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
              >
                {t("summary.workbench.actions.newSession")}
              </WKButton>
            )}
          </div>
        </div>
      </header>

      {hasConversationContent && (
        <div className="wk-summary-workbench__conversation" role="log" aria-live="polite">
          {state.isHydrating ? (
            <p className="wk-summary-workbench__empty">{t("summary.workbench.loadingHistory")}</p>
          ) : state.messages.length === 0 && !contextPanel ? (
            <p className="wk-summary-workbench__empty">{t("summary.workbench.empty")}</p>
          ) : (
            state.messages.map((message) => (
              <div
                key={message.id}
                className={`wk-summary-workbench-message wk-summary-workbench-message--${message.role}`}
                data-result-type={message.resultType}
              >
                {message.content}
              </div>
            ))
          )}
          {(state.progressSteps?.length ?? 0) > 0 && (
            <div
              className="wk-summary-workbench__progress"
              data-testid="summary-workbench-progress"
            >
              <span>{t("summary.common.agentChat.viewGenerationProcess")}</span>
              <ul>
                {state.progressSteps?.map((step, index) => (
                  <li key={`${step.phase}:${index}`}>
                    {t(
                      PROGRESS_LABEL_KEYS[step.phase] ??
                        "summary.common.agentChat.progress.fallback"
                    )}
                    {step.count !== undefined
                      ? ` · ${t("summary.common.agentPanel.processedCount", {
                          values: { count: step.count },
                        })}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.card && renderCard(state.card)}
        </div>
      )}

      {state.errorMessage && (
        <div className="wk-summary-workbench__error" role="alert">
          {state.errorMessage}
        </div>
      )}

      {contextPanel && (
        <div id="summary-workbench-context-panel" className="wk-summary-workbench__context-panel">
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
              <span className="wk-summary-workbench-context__item" key={`${item.kind}:${item.id}`}>
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
              const hasItems = composerContextItems.some((item) => item.kind === kind);
              return (
                <WKButton
                  key={kind}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={hasItems ? "wk-summary-workbench-context__trigger--active" : undefined}
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
  SummaryWorkbenchProps,
  SummaryWorkbenchResultType,
  SummaryWorkbenchViewState,
} from "./types";

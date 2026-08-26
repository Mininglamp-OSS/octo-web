import React from "react";
import { useI18n, WKButton } from "@octo/base";
import type {
  SummaryWorkbenchAction,
  SummaryWorkbenchCardView,
  SummaryWorkbenchContextKind,
  SummaryWorkbenchProps,
} from "./types";
import "./index.css";

const CONTEXT_KINDS: SummaryWorkbenchContextKind[] = [
  "chat",
  "participant",
  "template",
  "time_range",
];

const CONTEXT_LABEL_KEYS: Record<SummaryWorkbenchContextKind, string> = {
  chat: "summary.workbench.context.chat",
  participant: "summary.workbench.context.participant",
  template: "summary.workbench.context.template",
  time_range: "summary.workbench.context.timeRange",
};

const ACTION_LABEL_KEYS: Record<SummaryWorkbenchAction, string> = {
  confirm_workflow: "summary.workbench.actions.confirmWorkflow",
  save_preview: "summary.workbench.actions.savePreview",
  view_summary: "summary.workbench.actions.viewSummary",
  view_progress: "summary.workbench.actions.viewProgress",
  continue_chat: "summary.workbench.actions.continueChat",
};

const CARD_ACTIONS: Record<
  SummaryWorkbenchCardView["kind"],
  readonly SummaryWorkbenchAction[]
> = {
  team_confirmation: ["confirm_workflow", "continue_chat"],
  workflow_started: ["view_progress", "continue_chat"],
  workflow_completed: ["view_summary"],
  agent_preview: ["save_preview", "continue_chat"],
  agent_revision: ["save_preview", "continue_chat"],
};

function visibleActions(
  card: SummaryWorkbenchCardView
): SummaryWorkbenchAction[] {
  const uniqueActions = card.actions.filter(
    (action, index) => card.actions.indexOf(action) === index
  );
  const allowedActions = CARD_ACTIONS[card.kind];
  const validActions = uniqueActions.filter((action) =>
    allowedActions.includes(action)
  );

  if (card.kind === "team_confirmation" && card.isStale) {
    return validActions.filter((action) => action !== "confirm_workflow");
  }

  if (
    (card.kind === "agent_preview" || card.kind === "agent_revision") &&
    card.isStale
  ) {
    return validActions.filter((action) => action !== "save_preview");
  }

  return validActions;
}

const SummaryWorkbench = ({
  state,
  actions,
  className,
}: SummaryWorkbenchProps) => {
  const { t } = useI18n();
  const rootClassName = [
    "wk-summary-workbench",
    `wk-summary-workbench--${state.layout}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const renderCard = (card: SummaryWorkbenchCardView) => {
    const cardActions = visibleActions(card);
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

    return (
      <article
        className={`wk-summary-workbench-card wk-summary-workbench-card--${card.kind}`}
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
          </div>
          <h2>
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
                onClick={() => actions.onResultAction(action)}
              >
                {t(ACTION_LABEL_KEYS[action])}
              </WKButton>
            ))}
          </div>
        )}
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
    <section className={rootClassName} data-testid="summary-workbench">
      <header className="wk-summary-workbench__header">
        <h1>{t("summary.workbench.title")}</h1>
        <p>{t("summary.workbench.subtitle")}</p>
      </header>

      <div className="wk-summary-workbench__contexts">
        {CONTEXT_KINDS.map((kind) => {
          const items = state.contextItems.filter((item) => item.kind === kind);
          return (
            <div className="wk-summary-workbench-context" key={kind}>
              <WKButton
                type="button"
                size="sm"
                variant="secondary"
                className={
                  items.length > 0
                    ? "wk-summary-workbench-context__trigger--active"
                    : undefined
                }
                aria-pressed={items.length > 0}
                onClick={() => actions.onOpenContext(kind)}
              >
                {t(CONTEXT_LABEL_KEYS[kind])}
              </WKButton>
              {items.length > 0 && (
                <div className="wk-summary-workbench-context__items">
                  {items.map((item) => (
                    <span
                      className="wk-summary-workbench-context__item"
                      key={`${kind}:${item.id}`}
                    >
                      <span>{item.label}</span>
                      <WKButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<span aria-hidden="true">×</span>}
                        className="wk-summary-workbench-context__remove"
                        aria-label={t("summary.workbench.context.remove", {
                          values: { label: item.label },
                        })}
                        onClick={() => actions.onRemoveContext(kind, item.id)}
                      />
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="wk-summary-workbench__conversation"
        role="log"
        aria-live="polite"
      >
        {state.messages.length === 0 ? (
          <p className="wk-summary-workbench__empty">
            {t("summary.workbench.empty")}
          </p>
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
        {state.card && renderCard(state.card)}
      </div>

      {state.errorMessage && (
        <div className="wk-summary-workbench__error" role="alert">
          {state.errorMessage}
        </div>
      )}

      <div className="wk-summary-workbench__composer">
        <textarea
          value={state.inputValue}
          placeholder={t(state.placeholderKey)}
          aria-label={t(state.placeholderKey)}
          disabled={state.isSending}
          rows={2}
          onChange={(event) => actions.onInputChange(event.target.value)}
          onKeyDown={handleComposerKeyDown}
        />
        <WKButton
          type="button"
          variant="primary"
          loading={state.isSending}
          disabled={!state.canSend || state.isSending}
          onClick={actions.onSend}
        >
          {t("summary.workbench.composer.send")}
        </WKButton>
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

import React from "react";
import {
  AlertCircle,
  AtSign,
  Check,
  Copy,
  LoaderCircle,
  Plus,
  RefreshCw,
  Link2,
  ListFilter,
  ShieldAlert,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import type { AgentMailbox, AgentOutboundMode } from "../../bridge/types";
import {
  agentMailboxLocalpartMaxLength,
  agentMailboxLocalpartMinLength,
  isValidAgentMailboxLocalpart,
} from "../../utils";
import "./index.css";

interface Translator {
  (key: string, options?: { values?: Record<string, unknown> }): string;
}

export interface MailAddressManagementViewProps {
  mailboxes: AgentMailbox[];
  loading: boolean;
  submitting: boolean;
  error: string;
  actionError: string;
  localpart: string;
  domain: string;
  maxMailboxes: number | null;
  copiedId: string;
  createdMailbox: AgentMailbox | null;
  setupMethod: "openclaw" | "cli";
  setupPrompt: string;
  promptCopied: boolean;
  disconnectingId: string;
  deletingId: string;
  updatingAutomationId: string;
  pendingConfirmation: {
    kind: "disconnect" | "delete" | "enable-automatic-send";
    mailbox: AgentMailbox;
  } | null;
  currentMailboxId: string;
  t: Translator;
  onLocalpartChange: (value: string) => void;
  onCreate: () => void;
  onCopy: (mailbox: AgentMailbox) => void;
  onCopySetupPrompt: () => void;
  onSetupMethodChange: (method: "openclaw" | "cli") => void;
  onConnect: (mailbox: AgentMailbox) => void;
  onDisconnect: (mailbox: AgentMailbox) => void;
  onDelete: (mailbox: AgentMailbox) => void;
  onAutomationChange: (
    mailbox: AgentMailbox,
    outboundMode: AgentOutboundMode
  ) => void;
  onConfirmPendingAction: () => void;
  onCancelPendingAction: () => void;
  onSelectMailbox: (mailbox: AgentMailbox) => void;
  onManageRules: (mailbox: AgentMailbox) => void;
  onCloseSetup: () => void;
  onRefresh: () => void;
}

export default function MailAddressManagementView(
  props: MailAddressManagementViewProps
) {
  const { t } = props;
  const normalizedLocalpart = props.localpart.trim();
  const localpartValidationMessage = normalizedLocalpart
    ? normalizedLocalpart.length < agentMailboxLocalpartMinLength
      ? t("mail.addresses.localpartTooShort")
      : !isValidAgentMailboxLocalpart(normalizedLocalpart)
      ? t("mail.addresses.localpartInvalid")
      : ""
    : "";
  return (
    <main className="octo-mail-addresses">
      <section className="octo-mail-addresses__header">
        <span className="octo-mail-addresses__header-mark">
          <AtSign size={21} />
        </span>
        <span>
          <h1>{t("mail.addresses.title")}</h1>
          <p>{t("mail.addresses.description")}</p>
        </span>
        <button
          type="button"
          aria-label={t("mail.actions.refresh")}
          onClick={props.onRefresh}
        >
          <RefreshCw size={16} />
        </button>
      </section>

      <section className="octo-mail-addresses__card">
        <header>
          <span>
            <strong>{t("mail.addresses.listTitle")}</strong>
            <small>
              {t("mail.addresses.count", {
                values: { count: props.mailboxes.length },
              })}
            </small>
          </span>
        </header>

        {props.loading ? (
          <div className="octo-mail-addresses__state">
            <LoaderCircle className="is-spinning" size={22} />
            <span>{t("mail.addresses.loading")}</span>
          </div>
        ) : null}
        {!props.loading && props.error ? (
          <div className="octo-mail-addresses__state is-error">
            <AlertCircle size={23} />
            <strong>{t("mail.error.title")}</strong>
            <span>{props.error}</span>
            <button type="button" onClick={props.onRefresh}>
              {t("mail.actions.retry")}
            </button>
          </div>
        ) : null}
        {!props.loading && !props.error ? (
          <div className="octo-mail-addresses__list">
            {props.mailboxes.map((mailbox) => (
              <div className="octo-mail-address-row" key={mailbox.id}>
                <span className="octo-mail-address-row__icon">
                  <AtSign size={17} />
                </span>
                <span className="octo-mail-address-row__body">
                  <strong>{mailbox.address}</strong>
                  <small>
                    {mailbox.agentName
                      ? t("mail.agentMailboxes.connectedTo", {
                          values: { agent: mailbox.agentName },
                        })
                      : t("mail.agentMailboxes.unconnected")}
                  </small>
                </span>
                <span
                  className={`octo-mail-address-row__badge${
                    mailbox.connectState === "connected" ? " is-connected" : ""
                  }`}
                >
                  {t(
                    mailbox.connectState === "connected"
                      ? "mail.agentMailboxes.connected"
                      : "mail.agentMailboxes.unconnected"
                  )}
                </span>
                {mailbox.connectState === "connected" ? (
                  <label
                    className={`octo-mail-address-row__automation${
                      mailbox.outboundMode === "automatic_send"
                        ? " is-auto"
                        : ""
                    }`}
                    title={t(
                      mailbox.outboundMode === "automatic_send"
                        ? "mail.agentMailboxes.automaticSendDescription"
                        : "mail.agentMailboxes.manualReviewDescription"
                    )}
                  >
                    {props.updatingAutomationId === mailbox.id ? (
                      <LoaderCircle className="is-spinning" size={15} />
                    ) : null}
                    <select
                      aria-label={t("mail.agentMailboxes.outboundMode")}
                      value={mailbox.outboundMode}
                      disabled={props.updatingAutomationId === mailbox.id}
                      onChange={(event) => {
                        const outboundMode = event.target
                          .value as AgentOutboundMode;
                        if (outboundMode !== mailbox.outboundMode) {
                          props.onAutomationChange(mailbox, outboundMode);
                        }
                      }}
                    >
                      <option value="manual_confirmation">
                        {t("mail.agentMailboxes.manualReviewMode")}
                      </option>
                      <option value="automatic_send">
                        {t("mail.agentMailboxes.automaticSendMode")}
                      </option>
                    </select>
                  </label>
                ) : null}
                {mailbox.deletable === true ? (
                  <button
                    className="is-danger"
                    type="button"
                    disabled={props.deletingId === mailbox.id}
                    aria-label={t("mail.agentMailboxes.delete")}
                    title={t("mail.agentMailboxes.delete")}
                    onClick={() => props.onDelete(mailbox)}
                  >
                    {props.deletingId === mailbox.id ? (
                      <LoaderCircle className="is-spinning" size={16} />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                ) : null}
                {props.currentMailboxId === mailbox.id ? (
                  <span className="octo-mail-address-row__current">
                    {t("mail.agentMailboxes.current")}
                  </span>
                ) : (
                  <button
                    className="octo-mail-address-row__switch"
                    type="button"
                    onClick={() => props.onSelectMailbox(mailbox)}
                  >
                    {t("mail.agentMailboxes.switchTo")}
                  </button>
                )}
                {mailbox.connectState !== "connected" ? (
                  <button
                    className="octo-mail-address-row__connect"
                    type="button"
                    onClick={() => props.onConnect(mailbox)}
                  >
                    <Link2 size={15} />
                    {t("mail.agentMailboxes.connect")}
                  </button>
                ) : null}
                <button
                  className="octo-mail-address-row__rules"
                  type="button"
                  onClick={() => props.onManageRules(mailbox)}
                >
                  <ListFilter size={15} />
                  {t("mail.rules.manage")}
                </button>
                <button
                  type="button"
                  aria-label={t("mail.addresses.copy")}
                  onClick={() => props.onCopy(mailbox)}
                >
                  {props.copiedId === mailbox.id ? (
                    <Check size={16} />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
                {mailbox.connectState === "connected" ? (
                  <button
                    className="is-danger"
                    type="button"
                    disabled={props.disconnectingId === mailbox.id}
                    aria-label={t("mail.agentMailboxes.disconnect")}
                    onClick={() => props.onDisconnect(mailbox)}
                  >
                    {props.disconnectingId === mailbox.id ? (
                      <LoaderCircle className="is-spinning" size={16} />
                    ) : (
                      <Unlink size={16} />
                    )}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {!props.loading && !props.error && props.actionError ? (
          <p className="octo-mail-addresses__list-error">
            <AlertCircle size={14} />
            {props.actionError}
          </p>
        ) : null}
      </section>

      {props.maxMailboxes !== null ? (
        <section className="octo-mail-addresses__card octo-mail-addresses__create">
          <header>
            <span>
              <strong>{t("mail.addresses.createTitle")}</strong>
              <small>{t("mail.addresses.createDescription")}</small>
            </span>
          </header>
          <div className="octo-mail-addresses__form">
            <label>
              <span>{t("mail.addresses.localpart")}</span>
              <span className="octo-mail-addresses__input">
                <input
                  value={props.localpart}
                  disabled={props.mailboxes.length >= props.maxMailboxes}
                  minLength={agentMailboxLocalpartMinLength}
                  maxLength={agentMailboxLocalpartMaxLength}
                  aria-invalid={Boolean(localpartValidationMessage)}
                  aria-describedby={
                    localpartValidationMessage
                      ? "octo-mail-addresses-localpart-validation"
                      : "octo-mail-addresses-create-hint"
                  }
                  placeholder={t("mail.addresses.placeholder")}
                  onChange={(event) =>
                    props.onLocalpartChange(event.target.value.toLowerCase())
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") props.onCreate();
                  }}
                />
                <span>@{props.domain || "…"}</span>
              </span>
            </label>
            <button
              type="button"
              disabled={
                props.submitting ||
                !isValidAgentMailboxLocalpart(props.localpart) ||
                !props.domain ||
                props.mailboxes.length >= props.maxMailboxes
              }
              onClick={props.onCreate}
            >
              {props.submitting ? (
                <LoaderCircle className="is-spinning" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {t("mail.addresses.create")}
            </button>
          </div>
          {localpartValidationMessage ? (
            <p
              id="octo-mail-addresses-localpart-validation"
              className="octo-mail-addresses__validation"
              role="alert"
            >
              <AlertCircle size={14} />
              {localpartValidationMessage}
            </p>
          ) : null}
          <p
            id="octo-mail-addresses-create-hint"
            className="octo-mail-addresses__hint"
          >
            {t("mail.addresses.createLimitHint", {
              values: {
                count: props.mailboxes.length,
                limit: props.maxMailboxes,
              },
            })}{" "}
            {t("mail.addresses.createHint")}
          </p>
        </section>
      ) : null}

      {props.createdMailbox ? (
        <div
          className="octo-mail-setup-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="octo-mail-setup-title"
        >
          <button
            className="octo-mail-setup-dialog__backdrop"
            type="button"
            aria-label={t("mail.actions.cancel")}
            onClick={props.onCloseSetup}
          />
          <section className="octo-mail-setup-dialog__panel">
            <button
              className="octo-mail-setup-dialog__close"
              type="button"
              aria-label={t("mail.actions.cancel")}
              onClick={props.onCloseSetup}
            >
              <X size={18} />
            </button>
            <Link2 className="octo-mail-setup-dialog__success" size={25} />
            <h2 id="octo-mail-setup-title">
              {t("mail.agentMailboxes.connectTitle")}
            </h2>
            <p className="octo-mail-setup-dialog__address">
              {t("mail.agentMailboxes.createdAddress", {
                values: { address: props.createdMailbox.address },
              })}
            </p>
            <div
              className="octo-mail-setup-dialog__methods"
              role="group"
              aria-label={t("mail.agentMailboxes.setupMethod")}
            >
              <button
                type="button"
                aria-pressed={props.setupMethod === "openclaw"}
                className={props.setupMethod === "openclaw" ? "is-active" : ""}
                onClick={() => props.onSetupMethodChange("openclaw")}
              >
                {t("mail.agentMailboxes.openClawSetup")}
              </button>
              <button
                type="button"
                aria-pressed={props.setupMethod === "cli"}
                className={props.setupMethod === "cli" ? "is-active" : ""}
                onClick={() => props.onSetupMethodChange("cli")}
              >
                {t("mail.agentMailboxes.cliSetup")}
              </button>
            </div>
            <dl className="octo-mail-setup-dialog__method-guide">
              <div>
                <dt>{t("mail.agentMailboxes.setupScenarioLabel")}</dt>
                <dd>
                  {t(
                    props.setupMethod === "cli"
                      ? "mail.agentMailboxes.cliSetupScenario"
                      : "mail.agentMailboxes.openClawSetupScenario"
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("mail.agentMailboxes.setupBenefitLabel")}</dt>
                <dd>
                  {t(
                    props.setupMethod === "cli"
                      ? "mail.agentMailboxes.cliSetupBenefit"
                      : "mail.agentMailboxes.openClawSetupBenefit"
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("mail.agentMailboxes.setupNoticeLabel")}</dt>
                <dd>
                  {t(
                    props.setupMethod === "cli"
                      ? "mail.agentMailboxes.cliSetupNotice"
                      : "mail.agentMailboxes.openClawSetupNotice"
                  )}
                </dd>
              </div>
            </dl>
            <div className="octo-mail-setup-dialog__divider" />
            <h3>
              {t(
                props.setupMethod === "cli"
                  ? "mail.agentMailboxes.cliPromptTitle"
                  : "mail.agentMailboxes.copyPromptTitle"
              )}
            </h3>
            <p>
              {t(
                props.setupMethod === "cli"
                  ? "mail.agentMailboxes.cliPromptDescription"
                  : "mail.agentMailboxes.copyPromptDescription"
              )}
            </p>
            <pre>{props.setupPrompt}</pre>
            <button
              className="octo-mail-setup-dialog__copy"
              type="button"
              onClick={props.onCopySetupPrompt}
            >
              {props.promptCopied ? <Check size={16} /> : <Copy size={16} />}
              {t(
                props.promptCopied
                  ? "mail.agentMailboxes.promptCopied"
                  : "mail.agentMailboxes.copyPrompt"
              )}
            </button>
            <div className="octo-mail-setup-dialog__note">
              <Link2 size={15} />
              <span>
                {t(
                  props.setupMethod === "cli"
                    ? "mail.agentMailboxes.cliSkillGuide"
                    : "mail.agentMailboxes.userChoosesAgent"
                )}
              </span>
            </div>
          </section>
        </div>
      ) : null}

      {props.pendingConfirmation ? (
        <div
          className="octo-mail-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="octo-mail-confirm-title"
          aria-describedby="octo-mail-confirm-description"
        >
          <button
            className="octo-mail-confirm-dialog__backdrop"
            type="button"
            aria-label={t("mail.actions.cancel")}
            onClick={props.onCancelPendingAction}
          />
          <section className="octo-mail-confirm-dialog__panel">
            <span
              className={`octo-mail-confirm-dialog__icon${
                props.pendingConfirmation.kind === "disconnect" ||
                props.pendingConfirmation.kind === "delete"
                  ? " is-danger"
                  : ""
              }`}
            >
              {props.pendingConfirmation.kind === "disconnect" ? (
                <Unlink size={21} />
              ) : props.pendingConfirmation.kind === "delete" ? (
                <Trash2 size={21} />
              ) : (
                <ShieldAlert size={21} />
              )}
            </span>
            <div className="octo-mail-confirm-dialog__content">
              <h2 id="octo-mail-confirm-title">
                {t(
                  props.pendingConfirmation.kind === "disconnect"
                    ? "mail.agentMailboxes.disconnectTitle"
                    : props.pendingConfirmation.kind === "delete"
                    ? "mail.agentMailboxes.deleteTitle"
                    : "mail.agentMailboxes.enableAutomaticSendTitle"
                )}
              </h2>
              <p id="octo-mail-confirm-description">
                {t(
                  props.pendingConfirmation.kind === "disconnect"
                    ? "mail.agentMailboxes.disconnectConfirm"
                    : props.pendingConfirmation.kind === "delete"
                    ? "mail.agentMailboxes.deleteConfirm"
                    : "mail.agentMailboxes.enableAutomaticSendConfirm",
                  {
                    values: {
                      address: props.pendingConfirmation.mailbox.address,
                    },
                  }
                )}
              </p>
            </div>
            <footer>
              <button
                type="button"
                autoFocus
                onClick={props.onCancelPendingAction}
              >
                {t("mail.actions.cancel")}
              </button>
              <button
                className={
                  props.pendingConfirmation.kind === "disconnect" ||
                  props.pendingConfirmation.kind === "delete"
                    ? "is-danger"
                    : "is-primary"
                }
                type="button"
                onClick={props.onConfirmPendingAction}
              >
                {t(
                  props.pendingConfirmation.kind === "disconnect"
                    ? "mail.agentMailboxes.disconnect"
                    : props.pendingConfirmation.kind === "delete"
                    ? "mail.agentMailboxes.delete"
                    : "mail.agentMailboxes.enableAutomaticSend"
                )}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

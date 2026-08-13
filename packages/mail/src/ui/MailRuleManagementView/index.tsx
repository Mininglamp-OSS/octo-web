import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Edit3,
  Forward,
  LoaderCircle,
  MailCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type {
  AgentMailbox,
  MailRule,
  MailRuleInput,
} from "../../bridge/types";
import { splitAddresses } from "../../utils";
import "./index.css";

interface Translator {
  (key: string, options?: { values?: Record<string, unknown> }): string;
}

export interface MailRuleManagementViewProps {
  mailbox: AgentMailbox;
  rules: MailRule[];
  loading: boolean;
  error: string;
  actionError: string;
  saving: boolean;
  deletingId: string;
  t: Translator;
  onBack: () => void;
  onRefresh: () => void;
  onSave: (input: MailRuleInput, ruleId?: string) => Promise<boolean>;
  onSetEnabled: (rule: MailRule, enabled: boolean) => void;
  onDelete: (rule: MailRule) => void;
}

interface EditorState {
  ruleId?: string;
  name: string;
  matchFrom: string;
  matchSubject: string;
  targets: string;
  enabled: boolean;
  priority: number;
}

const emptyEditor: EditorState = {
  name: "",
  matchFrom: "",
  matchSubject: "",
  targets: "",
  enabled: true,
  priority: 0,
};

function summarizeConditions(rule: MailRule, t: Translator): string {
  const conditions: string[] = [];
  if (rule.matchFrom) {
    conditions.push(
      t("mail.rules.summary.from", { values: { value: rule.matchFrom } })
    );
  }
  if (rule.matchSubject) {
    conditions.push(
      t("mail.rules.summary.subject", {
        values: { value: rule.matchSubject },
      })
    );
  }
  return conditions.join(t("mail.rules.summary.and"));
}

export default function MailRuleManagementView(
  props: MailRuleManagementViewProps
) {
  const { t } = props;
  const [editor, setEditor] = useState<EditorState | null>(null);
  const targets = useMemo(
    () => splitAddresses(editor?.targets || ""),
    [editor?.targets]
  );
  const valid = Boolean(
    editor?.name.trim() &&
      (editor.matchFrom.trim() || editor.matchSubject.trim()) &&
      targets.length > 0 &&
      targets.length <= 5
  );

  useEffect(() => {
    if (!editor) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.saving) setEditor(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editor, props.saving]);

  const edit = (rule: MailRule) => {
    setEditor({
      ruleId: rule.id,
      name: rule.name,
      matchFrom: rule.matchFrom || "",
      matchSubject: rule.matchSubject || "",
      targets: rule.forwardTargets.join(", "),
      enabled: rule.enabled,
      priority: rule.priority,
    });
  };

  const submit = async () => {
    if (!editor || !valid || props.saving) return;
    const saved = await props.onSave(
      {
        name: editor.name.trim(),
        enabled: editor.enabled,
        priority: editor.priority,
        matchFrom: editor.matchFrom.trim() || undefined,
        matchSubject: editor.matchSubject.trim() || undefined,
        forwardTargets: targets,
      },
      editor.ruleId
    );
    if (saved) setEditor(null);
  };

  return (
    <main className="octo-mail-rules">
      <header className="octo-mail-rules__header">
        <button
          className="octo-mail-rules__back"
          type="button"
          aria-label={t("mail.actions.back")}
          onClick={props.onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="octo-mail-rules__header-mark">
          <MailCheck size={21} />
        </span>
        <span className="octo-mail-rules__header-copy">
          <h1>{t("mail.rules.title")}</h1>
          <p>
            {t("mail.rules.description", {
              values: { address: props.mailbox.address },
            })}
          </p>
        </span>
        <button
          className="octo-mail-rules__refresh"
          type="button"
          aria-label={t("mail.actions.refresh")}
          onClick={props.onRefresh}
        >
          <RefreshCw size={16} />
        </button>
        <button
          className="octo-mail-rules__create"
          type="button"
          onClick={() => setEditor({ ...emptyEditor })}
        >
          <Plus size={16} />
          {t("mail.rules.create")}
        </button>
      </header>

      <section className="octo-mail-rules__notice">
        <ShieldCheck size={19} />
        <span>
          <strong>{t("mail.rules.securityTitle")}</strong>
          {t("mail.rules.securityDescription")}
        </span>
      </section>

      {props.actionError ? (
        <div className="octo-mail-rules__action-error">
          <AlertCircle size={16} />
          {props.actionError}
        </div>
      ) : null}

      <section className="octo-mail-rules__card">
        <header>
          <span>
            <strong>{t("mail.rules.listTitle")}</strong>
            <small>
              {t("mail.rules.count", { values: { count: props.rules.length } })}
            </small>
          </span>
        </header>

        {props.loading ? (
          <div className="octo-mail-rules__state">
            <LoaderCircle className="is-spinning" size={22} />
            <span>{t("mail.rules.loading")}</span>
          </div>
        ) : null}
        {!props.loading && props.error ? (
          <div className="octo-mail-rules__state is-error">
            <AlertCircle size={24} />
            <strong>{t("mail.error.title")}</strong>
            <span>{props.error}</span>
            <button type="button" onClick={props.onRefresh}>
              {t("mail.actions.retry")}
            </button>
          </div>
        ) : null}
        {!props.loading && !props.error && props.rules.length === 0 ? (
          <div className="octo-mail-rules__state is-empty">
            <span className="octo-mail-rules__empty-mark">
              <Forward size={23} />
            </span>
            <strong>{t("mail.rules.emptyTitle")}</strong>
            <span>{t("mail.rules.emptyDescription")}</span>
            <button type="button" onClick={() => setEditor({ ...emptyEditor })}>
              <Plus size={15} />
              {t("mail.rules.create")}
            </button>
          </div>
        ) : null}
        {!props.loading && !props.error && props.rules.length > 0 ? (
          <div className="octo-mail-rule-list">
            {props.rules.map((rule) => (
              <article
                className={`octo-mail-rule-row${
                  rule.enabled ? "" : " is-disabled"
                }`}
                key={rule.id}
              >
                <label className="octo-mail-rule-switch">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) =>
                      props.onSetEnabled(rule, event.target.checked)
                    }
                  />
                  <span aria-hidden="true" />
                  <span className="octo-mail-rule-switch__label">
                    {t(
                      rule.enabled ? "mail.rules.disable" : "mail.rules.enable"
                    )}
                  </span>
                </label>
                <span className="octo-mail-rule-row__body">
                  <span className="octo-mail-rule-row__title">
                    <strong>{rule.name}</strong>
                    <small>
                      {t(
                        rule.enabled
                          ? "mail.rules.enabled"
                          : "mail.rules.disabled"
                      )}
                    </small>
                  </span>
                  <span className="octo-mail-rule-row__flow">
                    <span>
                      <b>{t("mail.rules.when")}</b>
                      {summarizeConditions(rule, t)}
                    </span>
                    <span aria-hidden="true">→</span>
                    <span>
                      <b>{t("mail.rules.then")}</b>
                      {t("mail.rules.summary.forward", {
                        values: { value: rule.forwardTargets.join(", ") },
                      })}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={t("mail.rules.edit")}
                  onClick={() => edit(rule)}
                >
                  <Edit3 size={16} />
                </button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={props.deletingId === rule.id}
                  aria-label={t("mail.actions.delete")}
                  onClick={() => props.onDelete(rule)}
                >
                  {props.deletingId === rule.id ? (
                    <LoaderCircle className="is-spinning" size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {editor ? (
        <div
          className="octo-mail-rule-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="octo-mail-rule-dialog-title"
        >
          <button
            className="octo-mail-rule-dialog__backdrop"
            type="button"
            aria-label={t("mail.actions.cancel")}
            onClick={() => !props.saving && setEditor(null)}
          />
          <section className="octo-mail-rule-dialog__panel">
            <header>
              <span>
                <small>{props.mailbox.address}</small>
                <h2 id="octo-mail-rule-dialog-title">
                  {t(
                    editor.ruleId
                      ? "mail.rules.editTitle"
                      : "mail.rules.createTitle"
                  )}
                </h2>
              </span>
              <button
                type="button"
                disabled={props.saving}
                aria-label={t("mail.actions.cancel")}
                onClick={() => setEditor(null)}
              >
                <X size={19} />
              </button>
            </header>

            <div className="octo-mail-rule-dialog__content">
              <label className="octo-mail-rule-field">
                <span>{t("mail.rules.name")}</span>
                <input
                  autoFocus
                  maxLength={100}
                  value={editor.name}
                  placeholder={t("mail.rules.namePlaceholder")}
                  onChange={(event) =>
                    setEditor({ ...editor, name: event.target.value })
                  }
                />
              </label>

              <section className="octo-mail-rule-builder">
                <header>
                  <strong>{t("mail.rules.conditionsTitle")}</strong>
                  <span>{t("mail.rules.matchAll")}</span>
                </header>
                <p>{t("mail.rules.conditionsHint")}</p>
                <label className="octo-mail-rule-builder__row">
                  <span>{t("mail.rules.from")}</span>
                  <span>{t("mail.rules.equals")}</span>
                  <input
                    value={editor.matchFrom}
                    placeholder={t("mail.rules.fromPlaceholder")}
                    onChange={(event) =>
                      setEditor({ ...editor, matchFrom: event.target.value })
                    }
                  />
                </label>
                <label className="octo-mail-rule-builder__row">
                  <span>{t("mail.rules.subject")}</span>
                  <span>{t("mail.rules.contains")}</span>
                  <input
                    value={editor.matchSubject}
                    placeholder={t("mail.rules.subjectPlaceholder")}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        matchSubject: event.target.value,
                      })
                    }
                  />
                </label>
              </section>

              <section className="octo-mail-rule-builder is-action">
                <header>
                  <strong>{t("mail.rules.actionsTitle")}</strong>
                </header>
                <label className="octo-mail-rule-builder__row is-action">
                  <span>{t("mail.rules.forwardTo")}</span>
                  <textarea
                    rows={2}
                    value={editor.targets}
                    placeholder={t("mail.rules.targetsPlaceholder")}
                    onChange={(event) =>
                      setEditor({ ...editor, targets: event.target.value })
                    }
                  />
                </label>
                <p className={targets.length > 5 ? "is-invalid" : undefined}>
                  {t("mail.rules.targetsHint", {
                    values: { count: targets.length },
                  })}
                </p>
              </section>

              <label className="octo-mail-rule-enabled">
                <input
                  type="checkbox"
                  checked={editor.enabled}
                  onChange={(event) =>
                    setEditor({ ...editor, enabled: event.target.checked })
                  }
                />
                <span>{t("mail.rules.enableAfterSave")}</span>
              </label>
            </div>

            <footer>
              <button
                type="button"
                disabled={props.saving}
                onClick={() => setEditor(null)}
              >
                {t("mail.actions.cancel")}
              </button>
              <button
                className="is-primary"
                type="button"
                disabled={!valid || props.saving}
                onClick={() => void submit()}
              >
                {props.saving ? (
                  <LoaderCircle className="is-spinning" size={16} />
                ) : null}
                {t(editor.ruleId ? "mail.actions.save" : "mail.rules.create")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

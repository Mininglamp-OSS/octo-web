import React, { useEffect, useMemo, useRef, useState } from "react";
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
import Loading from "@octo/ui/components/Loading";
import type {
  AgentMailbox,
  MailRule,
  MailRuleCondition,
  MailRuleConditionField,
  MailRuleConditionOperator,
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

interface EditorCondition extends MailRuleCondition {
  editorId: string;
}

interface EditorTarget {
  editorId: string;
  value: string;
}

interface EditorState {
  ruleId?: string;
  name: string;
  matchMode: "all" | "any";
  conditions: EditorCondition[];
  targets: EditorTarget[];
  enabled: boolean;
  priority: number;
}

function summarizeConditions(rule: MailRule, t: Translator): string {
  const conditions = effectiveConditions(rule).map((condition) =>
    t("mail.rules.summary.condition", {
      values: {
        field: t(`mail.rules.${condition.field}`),
        operator: t(`mail.rules.${condition.operator}`),
        value: condition.value,
      },
    })
  );
  return conditions.join(
    t(
      rule.matchMode === "any"
        ? "mail.rules.summary.or"
        : "mail.rules.summary.and"
    )
  );
}

const conditionFields: MailRuleConditionField[] = [
  "subject",
  "body",
  "subject_or_body",
  "from",
  "to",
];
const maxConditions = 5;

function effectiveConditions(rule: MailRule): MailRuleCondition[] {
  if (rule.conditions?.length) return rule.conditions;
  return [
    ...(rule.matchFrom
      ? ([
          { field: "from", operator: "equals", value: rule.matchFrom },
        ] as MailRuleCondition[])
      : []),
    ...(rule.matchSubject
      ? ([
          { field: "subject", operator: "contains", value: rule.matchSubject },
        ] as MailRuleCondition[])
      : []),
  ];
}

export default function MailRuleManagementView(
  props: MailRuleManagementViewProps
) {
  const { t } = props;
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MailRule | null>(null);
  const editorRowSequenceRef = useRef(0);

  const createEditorId = () => {
    editorRowSequenceRef.current += 1;
    return `mail-rule-editor-row-${editorRowSequenceRef.current}`;
  };
  const createEditorCondition = (
    condition: MailRuleCondition
  ): EditorCondition => ({ ...condition, editorId: createEditorId() });
  const createEditorTarget = (value: string): EditorTarget => ({
    value,
    editorId: createEditorId(),
  });
  const createEmptyEditor = (): EditorState => ({
    name: "",
    matchMode: "all",
    conditions: [
      createEditorCondition({
        field: "from",
        operator: "contains",
        value: "",
      }),
    ],
    targets: [createEditorTarget("")],
    enabled: true,
    priority: 0,
  });

  const targets = useMemo(() => {
    if (!editor) return [];
    return editor.targets.flatMap((target) => splitAddresses(target.value));
  }, [editor]);
  const conditionsValid = Boolean(
    editor &&
      editor.conditions.length > 0 &&
      editor.conditions.length <= maxConditions &&
      editor.conditions.every((condition) => condition.value.trim())
  );
  const targetRowsValid = Boolean(
    editor &&
      editor.targets.length > 0 &&
      editor.targets.every(
        (target) =>
          target.value.trim() !== "" &&
          splitAddresses(target.value).length === 1
      )
  );
  const valid = Boolean(
    editor?.name.trim() &&
      conditionsValid &&
      targetRowsValid &&
      targets.length > 0 &&
      targets.length <= 5
  );

  useEffect(() => {
    if (!editor && !pendingDelete) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingDelete) {
        setPendingDelete(null);
        return;
      }
      if (!props.saving) setEditor(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editor, pendingDelete, props.saving]);

  const edit = (rule: MailRule) => {
    setEditor({
      ruleId: rule.id,
      name: rule.name,
      matchMode: rule.matchMode || "all",
      conditions: effectiveConditions(rule).map(createEditorCondition),
      targets:
        rule.forwardTargets.length > 0
          ? rule.forwardTargets.map(createEditorTarget)
          : [createEditorTarget("")],
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
        matchMode: editor.matchMode,
        conditions: editor.conditions.map(({ field, operator, value }) => ({
          field,
          operator,
          value: value.trim(),
        })),
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
          onClick={() => setEditor(createEmptyEditor())}
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
            <Loading text={t("mail.rules.loading")} layout="vertical" />
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
            <button
              type="button"
              onClick={() => setEditor(createEmptyEditor())}
            >
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
                  onClick={() => setPendingDelete(rule)}
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
                  <select
                    aria-label={t("mail.rules.matchMode")}
                    value={editor.matchMode}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        matchMode: event.target.value as "all" | "any",
                      })
                    }
                  >
                    <option value="all">{t("mail.rules.matchAll")}</option>
                    <option value="any">{t("mail.rules.matchAny")}</option>
                  </select>
                  <button
                    type="button"
                    disabled={editor.conditions.length >= maxConditions}
                    onClick={() => {
                      const next = conditionFields.find(
                        (field) =>
                          !editor.conditions.some(
                            (condition) => condition.field === field
                          )
                      );
                      if (next) {
                        setEditor({
                          ...editor,
                          conditions: [
                            ...editor.conditions,
                            createEditorCondition({
                              field: next,
                              operator: "contains",
                              value: "",
                            }),
                          ],
                        });
                      }
                    }}
                  >
                    <Plus size={14} />
                    {t("mail.rules.addCondition")}
                  </button>
                </header>
                {editor.conditions.map((condition, index) => (
                  <div
                    className="octo-mail-rule-builder__row"
                    key={condition.editorId}
                  >
                    <select
                      aria-label={`${t("mail.rules.conditionType")} ${
                        index + 1
                      }`}
                      value={condition.field}
                      onChange={(event) => {
                        const field = event.target
                          .value as MailRuleConditionField;
                        const nextConditions = [...editor.conditions];
                        nextConditions[index] = {
                          ...condition,
                          field,
                          operator:
                            condition.operator === "equals" && field !== "from"
                              ? "contains"
                              : condition.operator,
                        };
                        setEditor({
                          ...editor,
                          conditions: nextConditions,
                        });
                      }}
                    >
                      <optgroup label={t("mail.rules.conditionGroupContent")}>
                        {(["subject", "body", "subject_or_body"] as const).map(
                          (field) => (
                            <option value={field} key={field}>
                              {t(`mail.rules.${field}`)}
                            </option>
                          )
                        )}
                      </optgroup>
                      <optgroup label={t("mail.rules.conditionGroupPeople")}>
                        {(["from", "to"] as const).map((field) => (
                          <option value={field} key={field}>
                            {t(`mail.rules.${field}`)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <select
                      aria-label={`${t("mail.rules.conditionOperator")} ${
                        index + 1
                      }`}
                      value={condition.operator}
                      onChange={(event) => {
                        const nextConditions = [...editor.conditions];
                        nextConditions[index] = {
                          ...condition,
                          operator: event.target
                            .value as MailRuleConditionOperator,
                        };
                        setEditor({ ...editor, conditions: nextConditions });
                      }}
                    >
                      {condition.operator === "equals" ? (
                        <option value="equals" hidden>
                          {t("mail.rules.equals")}
                        </option>
                      ) : null}
                      <option value="contains">
                        {t("mail.rules.contains")}
                      </option>
                      <option value="not_contains">
                        {t("mail.rules.not_contains")}
                      </option>
                    </select>
                    <input
                      aria-label={`${t(`mail.rules.${condition.field}`)} ${
                        index + 1
                      }`}
                      value={condition.value}
                      maxLength={500}
                      placeholder={t(
                        `mail.rules.${condition.field}Placeholder`
                      )}
                      onChange={(event) => {
                        const nextConditions = [...editor.conditions];
                        nextConditions[index] = {
                          ...condition,
                          value: event.target.value,
                        };
                        setEditor({
                          ...editor,
                          conditions: nextConditions,
                        });
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`${t("mail.rules.deleteCondition")} ${
                        index + 1
                      }`}
                      onClick={() =>
                        setEditor({
                          ...editor,
                          conditions: editor.conditions.filter(
                            (_, itemIndex) => itemIndex !== index
                          ),
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <p>
                  {t("mail.rules.conditionsHint", {
                    values: {
                      count: editor.conditions.length,
                      limit: maxConditions,
                    },
                  })}
                </p>
              </section>

              <section className="octo-mail-rule-builder is-action">
                <header>
                  <strong>{t("mail.rules.actionsTitle")}</strong>
                  <button
                    type="button"
                    disabled={editor.targets.length >= 5}
                    onClick={() =>
                      setEditor({
                        ...editor,
                        targets: [...editor.targets, createEditorTarget("")],
                      })
                    }
                  >
                    <Plus size={14} />
                    {t("mail.rules.addAction")}
                  </button>
                </header>
                {editor.targets.map((target, index) => (
                  <div
                    className="octo-mail-rule-builder__row is-action"
                    key={target.editorId}
                  >
                    <span>{t("mail.rules.forwardTo")}</span>
                    <input
                      aria-label={`${t("mail.rules.forwardTo")} ${index + 1}`}
                      value={target.value}
                      placeholder={t("mail.rules.targetPlaceholder")}
                      onChange={(event) => {
                        const nextTargets = [...editor.targets];
                        nextTargets[index] = {
                          ...target,
                          value: event.target.value,
                        };
                        setEditor({ ...editor, targets: nextTargets });
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`${t("mail.rules.deleteAction")} ${
                        index + 1
                      }`}
                      onClick={() =>
                        setEditor({
                          ...editor,
                          targets: editor.targets.filter(
                            (_, itemIndex) => itemIndex !== index
                          ),
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <p
                  className={
                    targets.length > 5 || !targetRowsValid
                      ? "is-invalid"
                      : undefined
                  }
                >
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

      {pendingDelete ? (
        <div
          className="octo-mail-rule-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="octo-mail-rule-confirm-title"
          aria-describedby="octo-mail-rule-confirm-description"
        >
          <button
            className="octo-mail-rule-confirm__backdrop"
            type="button"
            aria-label={t("mail.actions.cancel")}
            onClick={() => setPendingDelete(null)}
          />
          <section className="octo-mail-rule-confirm__panel">
            <span className="octo-mail-rule-confirm__icon">
              <Trash2 size={21} />
            </span>
            <div className="octo-mail-rule-confirm__content">
              <h2 id="octo-mail-rule-confirm-title">
                {t("mail.rules.deleteTitle")}
              </h2>
              <p id="octo-mail-rule-confirm-description">
                {t("mail.rules.deleteConfirm", {
                  values: { name: pendingDelete.name },
                })}
              </p>
            </div>
            <footer>
              <button
                type="button"
                autoFocus
                onClick={() => setPendingDelete(null)}
              >
                {t("mail.actions.cancel")}
              </button>
              <button
                className="is-danger"
                type="button"
                onClick={() => {
                  props.onDelete(pendingDelete);
                  setPendingDelete(null);
                }}
              >
                {t("mail.actions.delete")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

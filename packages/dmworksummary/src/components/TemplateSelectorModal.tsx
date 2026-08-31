import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Empty, Modal, Spin } from "@douyinfe/semi-ui";
import { Plus } from "lucide-react";
import * as summaryApi from "../api/summaryApi";
import type { SummaryWorkbenchTemplateScope } from "../bridge/summaryWorkbench/protocol";
import {
  TEMPLATE_CONTENT_MAX_LENGTH,
  TEMPLATE_NAME_MAX_LENGTH,
} from "../constants/limits";
import type {
  CustomTopicTemplatePayload,
  TopicTemplate,
  TopicTemplatesResponse,
} from "../types/summary";
import { getTemplateEditableFields } from "../utils/templateResolver";
import TemplateCard from "./TemplateCard";
import "./TemplateSelectorModal.css";

type VersionedTopicTemplate = TopicTemplate & { version?: number };

export interface TemplateSelectorDataSource {
  load: () => Promise<TopicTemplatesResponse>;
  create: (payload: CustomTopicTemplatePayload) => Promise<TopicTemplate>;
  updateBuiltIn: (
    templateId: string,
    payload: CustomTopicTemplatePayload
  ) => Promise<TopicTemplate>;
  updateCustom: (
    templateId: string,
    payload: CustomTopicTemplatePayload
  ) => Promise<TopicTemplate>;
  resetBuiltIn: (templateId: string) => Promise<TopicTemplate>;
  deleteCustom: (templateId: string) => Promise<void>;
}

export interface TemplateSelectorLabels {
  title: string;
  builtInTitle: string;
  customTitle: (count: number, limit: number) => string;
  customSectionTitle?: string;
  customCountLabel?: (count: number, limit: number) => string;
  create: string;
  edit: string;
  delete: string;
  reset: string;
  cancel: string;
  save: string;
  clear: string;
  loading: string;
  empty: string;
  loadFailed: string;
  retry: string;
  limitReached: string;
  createTitle: string;
  editTitle: string;
  nameLabel: string;
  descriptionLabel: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  editHint: string;
  deleteConfirmTitle: string;
  deleteConfirmContent: (name: string) => string;
  createFailed: string;
  updateFailed: string;
  resetFailed: string;
  deleteFailed: string;
}

export interface TemplateSelectorModalProps {
  visible: boolean;
  inline?: boolean;
  value: SummaryWorkbenchTemplateScope | null;
  labels: TemplateSelectorLabels;
  onChange: (value: SummaryWorkbenchTemplateScope | null) => void;
  onCancel: () => void;
  dataSource?: TemplateSelectorDataSource;
  fallbackTemplates?: TopicTemplate[];
}

const DEFAULT_CUSTOM_TEMPLATE_LIMIT = 30;
const EMPTY_FALLBACK_TEMPLATES: TopicTemplate[] = [];

const defaultDataSource: TemplateSelectorDataSource = {
  load: summaryApi.getTopicTemplatesConfig,
  create: summaryApi.createCustomTopicTemplate,
  updateBuiltIn: summaryApi.updateMyTopicTemplate,
  updateCustom: summaryApi.updateCustomTopicTemplate,
  resetBuiltIn: summaryApi.resetMyTopicTemplate,
  deleteCustom: summaryApi.deleteCustomTopicTemplate,
};

export function topicTemplateToWorkbenchScope(
  template: TopicTemplate
): SummaryWorkbenchTemplateScope {
  const version = (template as VersionedTopicTemplate).version;
  return {
    templateId: template.id,
    label: template.label,
    requirement: template.pattern.trim() || template.description.trim(),
    ...(typeof version === "number" ? { version } : {}),
  };
}

export default function TemplateSelectorModal({
  visible,
  inline = false,
  value,
  labels,
  onChange,
  onCancel,
  dataSource = defaultDataSource,
  fallbackTemplates = EMPTY_FALLBACK_TEMPLATES,
}: TemplateSelectorModalProps) {
  const [templates, setTemplates] =
    useState<TopicTemplate[]>(fallbackTemplates);
  const [customTemplateLimit, setCustomTemplateLimit] = useState(
    DEFAULT_CUSTOM_TEMPLATE_LIMIT
  );
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TopicTemplate | null>(
    null
  );
  const [creatingCustomTemplate, setCreatingCustomTemplate] = useState(false);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TopicTemplate | null>(
    null
  );
  const requestSequence = useRef(0);

  const loadTemplates = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await dataSource.load();
      if (sequence !== requestSequence.current) return;
      setCustomTemplateLimit(response.custom_template_limit);
      setTemplates(
        response.templates.length > 0 ? response.templates : fallbackTemplates
      );
    } catch {
      if (sequence !== requestSequence.current) return;
      setTemplates(fallbackTemplates);
      setLoadFailed(fallbackTemplates.length === 0);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [dataSource, fallbackTemplates]);

  useEffect(() => {
    if (!visible) {
      requestSequence.current += 1;
      return;
    }
    setEditingTemplate(null);
    setCreatingCustomTemplate(false);
    setPendingDelete(null);
    setMutationError("");
    void loadTemplates();
  }, [loadTemplates, visible]);

  const builtInTemplates = useMemo(
    () => templates.filter((template: TopicTemplate) => !template.is_custom),
    [templates]
  );
  const customTemplates = useMemo(
    () => templates.filter((template: TopicTemplate) => template.is_custom),
    [templates]
  );
  const canCreateCustomTemplate = customTemplates.length < customTemplateLimit;
  const editorVisible = creatingCustomTemplate || editingTemplate !== null;

  const replaceTemplate = useCallback((updated: TopicTemplate) => {
    setTemplates((current: TopicTemplate[]) =>
      current.map((template: TopicTemplate) =>
        template.id === updated.id ? updated : template
      )
    );
  }, []);

  const propagateSelectedTemplateUpdate = useCallback(
    (updated: TopicTemplate) => {
      if (value?.templateId === updated.id) {
        onChange(topicTemplateToWorkbenchScope(updated));
      }
    },
    [onChange, value?.templateId]
  );

  const startCreating = () => {
    if (!canCreateCustomTemplate) return;
    setEditingTemplate(null);
    setCreatingCustomTemplate(true);
    setEditingLabel("");
    setEditingDescription("");
    setMutationError("");
  };

  const startEditing = (template: TopicTemplate) => {
    const editable = getTemplateEditableFields(template);
    setEditingTemplate(template);
    setCreatingCustomTemplate(false);
    setEditingLabel(editable.label);
    setEditingDescription(editable.description);
    setMutationError("");
  };

  const closeEditor = () => {
    if (mutationBusy) return;
    setEditingTemplate(null);
    setCreatingCustomTemplate(false);
    setMutationError("");
  };

  const saveEditor = async () => {
    const label = editingLabel.trim();
    const description = editingDescription.trim();
    if (!label || !description || mutationBusy) return;

    setMutationBusy(true);
    setMutationError("");
    try {
      if (creatingCustomTemplate) {
        const created = await dataSource.create({ label, description });
        setTemplates((current: TopicTemplate[]) => [...current, created]);
      } else if (editingTemplate?.is_custom) {
        const updated = await dataSource.updateCustom(editingTemplate.id, {
          label,
          description,
        });
        replaceTemplate(updated);
        propagateSelectedTemplateUpdate(updated);
      } else if (editingTemplate) {
        const updated = await dataSource.updateBuiltIn(editingTemplate.id, {
          label,
          description,
        });
        replaceTemplate(updated);
        propagateSelectedTemplateUpdate(updated);
      }
      setEditingTemplate(null);
      setCreatingCustomTemplate(false);
    } catch {
      setMutationError(
        creatingCustomTemplate ? labels.createFailed : labels.updateFailed
      );
    } finally {
      setMutationBusy(false);
    }
  };

  const resetBuiltIn = async () => {
    if (!editingTemplate || editingTemplate.is_custom || mutationBusy) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      const updated = await dataSource.resetBuiltIn(editingTemplate.id);
      replaceTemplate(updated);
      propagateSelectedTemplateUpdate(updated);
      setEditingTemplate(null);
    } catch {
      setMutationError(labels.resetFailed);
    } finally {
      setMutationBusy(false);
    }
  };

  const requestCustomDelete = (template: TopicTemplate) => {
    setMutationError("");
    setPendingDelete(template);
  };

  const deleteCustom = async () => {
    if (!pendingDelete?.is_custom || mutationBusy) return;
    const target = pendingDelete;
    setMutationBusy(true);
    setMutationError("");
    try {
      await dataSource.deleteCustom(target.id);
      setTemplates((current: TopicTemplate[]) =>
        current.filter((template: TopicTemplate) => template.id !== target.id)
      );
      if (editingTemplate?.id === target.id) {
        setEditingTemplate(null);
      }
      setPendingDelete(null);
      if (value?.templateId === target.id) onChange(null);
    } catch {
      setMutationError(labels.deleteFailed);
    } finally {
      setMutationBusy(false);
    }
  };

  const renderTemplate = (template: TopicTemplate) => (
    <div
      key={template.id}
      className={`wk-template-selector__option${
        value?.templateId === template.id
          ? " wk-template-selector__option--selected"
          : ""
      }`}
      role="listitem"
    >
      <TemplateCard
        template={template}
        selected={value?.templateId === template.id}
        onClick={(selected: TopicTemplate) =>
          onChange(topicTemplateToWorkbenchScope(selected))
        }
        onEdit={startEditing}
        onDelete={template.is_custom ? requestCustomDelete : undefined}
        editLabel={labels.edit}
        deleteLabel={labels.delete}
      />
    </div>
  );

  const modalFooter = (
    <div className="wk-template-selector__footer">
      <button
        type="button"
        className="wk-template-selector__button wk-template-selector__button--secondary"
        onClick={() => onChange(null)}
        disabled={value === null}
      >
        {labels.clear}
      </button>
      <button
        type="button"
        className="wk-template-selector__button wk-template-selector__button--secondary"
        onClick={onCancel}
      >
        {labels.cancel}
      </button>
    </div>
  );

  const selectorContent = loading ? (
    <div className="wk-template-selector__state" role="status">
      <Spin />
      <span>{labels.loading}</span>
    </div>
  ) : loadFailed ? (
    <div className="wk-template-selector__state" role="alert">
      <span>{labels.loadFailed}</span>
      <button
        type="button"
        className="wk-template-selector__button wk-template-selector__button--secondary"
        onClick={() => void loadTemplates()}
      >
        {labels.retry}
      </button>
    </div>
  ) : (
    <div className="wk-template-selector__body">
      {builtInTemplates.length > 0 ? (
        <section className="wk-template-selector__section">
          <h3>{labels.builtInTitle}</h3>
          <div className="wk-template-selector__grid" role="list">
            {builtInTemplates.map(renderTemplate)}
          </div>
        </section>
      ) : (
        <Empty description={labels.empty} />
      )}

      <section className="wk-template-selector__section">
        <div className="wk-template-selector__section-header">
          <h3>
            {labels.customSectionTitle ??
              labels.customTitle(customTemplates.length, customTemplateLimit)}
          </h3>
          <div className="wk-template-selector__section-actions">
            {labels.customCountLabel && (
              <span className="wk-template-selector__count">
                {labels.customCountLabel(
                  customTemplates.length,
                  customTemplateLimit
                )}
              </span>
            )}
            {customTemplates.length > 0 && (
              <button
                type="button"
                className="wk-template-selector__create"
                disabled={!canCreateCustomTemplate}
                onClick={startCreating}
              >
                <Plus aria-hidden="true" size={16} />
                <span>{labels.create}</span>
              </button>
            )}
          </div>
        </div>
        {!canCreateCustomTemplate && (
          <p className="wk-template-selector__hint">{labels.limitReached}</p>
        )}
        {customTemplates.length > 0 ? (
          <div className="wk-template-selector__grid" role="list">
            {customTemplates.map(renderTemplate)}
          </div>
        ) : (
          <div
            className="wk-template-selector__grid wk-template-selector__grid--empty"
            role="list"
          >
            <div role="listitem">
              <button
                type="button"
                className="wk-template-selector__empty-custom"
                disabled={!canCreateCustomTemplate}
                onClick={startCreating}
              >
                <Plus aria-hidden="true" size={18} />
                <span>{labels.create}</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  return (
    <>
      {inline ? (
        visible && (
          <section
            className="wk-template-selector wk-template-selector--inline"
            aria-label={labels.title}
          >
            {selectorContent}
          </section>
        )
      ) : (
        <Modal
          visible={visible}
          title={labels.title}
          width={640}
          footer={modalFooter}
          onCancel={onCancel}
          className="wk-template-selector"
        >
          {selectorContent}
        </Modal>
      )}

      <Modal
        visible={editorVisible}
        title={creatingCustomTemplate ? labels.createTitle : labels.editTitle}
        width={560}
        footer={null}
        maskClosable={!mutationBusy}
        onCancel={closeEditor}
        className="wk-template-selector-editor"
      >
        <div className="wk-template-selector-editor__field">
          <label htmlFor="wk-template-selector-name">{labels.nameLabel}</label>
          <input
            id="wk-template-selector-name"
            value={editingLabel}
            maxLength={TEMPLATE_NAME_MAX_LENGTH}
            disabled={mutationBusy}
            placeholder={labels.namePlaceholder}
            onChange={(event) =>
              setEditingLabel(
                event.target.value.slice(0, TEMPLATE_NAME_MAX_LENGTH)
              )
            }
          />
        </div>
        <div className="wk-template-selector-editor__field">
          <label htmlFor="wk-template-selector-description">
            {labels.descriptionLabel}
          </label>
          <textarea
            id="wk-template-selector-description"
            value={editingDescription}
            maxLength={TEMPLATE_CONTENT_MAX_LENGTH}
            disabled={mutationBusy}
            placeholder={labels.descriptionPlaceholder}
            onChange={(event) =>
              setEditingDescription(
                event.target.value.slice(0, TEMPLATE_CONTENT_MAX_LENGTH)
              )
            }
          />
        </div>
        <p className="wk-template-selector-editor__hint">{labels.editHint}</p>
        {mutationError && (
          <p className="wk-template-selector-editor__error" role="alert">
            {mutationError}
          </p>
        )}
        <div className="wk-template-selector-editor__actions">
          {editingTemplate?.is_custom && (
            <button
              type="button"
              className="wk-template-selector__button wk-template-selector__button--danger"
              disabled={mutationBusy}
              onClick={() => requestCustomDelete(editingTemplate)}
            >
              {labels.delete}
            </button>
          )}
          {editingTemplate && !editingTemplate.is_custom && (
            <button
              type="button"
              className="wk-template-selector__button wk-template-selector__button--secondary"
              disabled={mutationBusy}
              onClick={() => void resetBuiltIn()}
            >
              {labels.reset}
            </button>
          )}
          <span className="wk-template-selector-editor__spacer" />
          <button
            type="button"
            className="wk-template-selector__button wk-template-selector__button--secondary"
            disabled={mutationBusy}
            onClick={closeEditor}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="wk-template-selector__button wk-template-selector__button--primary"
            disabled={
              mutationBusy || !editingLabel.trim() || !editingDescription.trim()
            }
            onClick={() => void saveEditor()}
          >
            {labels.save}
          </button>
        </div>
      </Modal>

      <Modal
        visible={pendingDelete !== null}
        title={labels.deleteConfirmTitle}
        width={440}
        footer={null}
        maskClosable={!mutationBusy}
        onCancel={() => {
          if (!mutationBusy) {
            setPendingDelete(null);
            setMutationError("");
          }
        }}
        className="wk-template-selector-delete"
      >
        <p>
          {pendingDelete
            ? labels.deleteConfirmContent(pendingDelete.label)
            : ""}
        </p>
        {mutationError && (
          <p className="wk-template-selector-editor__error" role="alert">
            {mutationError}
          </p>
        )}
        <div className="wk-template-selector-editor__actions">
          <span className="wk-template-selector-editor__spacer" />
          <button
            type="button"
            className="wk-template-selector__button wk-template-selector__button--secondary"
            disabled={mutationBusy}
            onClick={() => {
              setPendingDelete(null);
              setMutationError("");
            }}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="wk-template-selector__button wk-template-selector__button--danger"
            disabled={mutationBusy}
            onClick={() => void deleteCustom()}
          >
            {labels.delete}
          </button>
        </div>
      </Modal>
    </>
  );
}

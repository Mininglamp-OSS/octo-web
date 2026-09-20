import React from "react";
import { Button, Checkbox, Input, Modal, Spin } from "@douyinfe/semi-ui";
import { FileText, RotateCw, Search } from "lucide-react";
import { useI18n } from "@octo/base";
import { summaryTestIds } from "../../utils/testIds";
import type { DocumentSelectorProps } from "./types";
import "./index.css";

const DocumentSelector: React.FC<DocumentSelectorProps> = ({
  visible,
  state,
  actions,
}) => {
  const { t, locale } = useI18n();
  const selectedIds = new Set(state.selected.map((item) => item.docId));
  const pickerId = React.useId();
  const resultsId = `${pickerId}-results`;
  const activeTabId = `${pickerId}-tab-${state.source}`;

  const formatUpdatedAt = (updatedAt: number | null) => {
    if (!updatedAt) return "";
    try {
      return new Date(updatedAt).toLocaleDateString(locale);
    } catch {
      return "";
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("summary.documentPicker.title")}
      width={560}
      footer={null}
      onCancel={actions.onCancel}
      data-testid={summaryTestIds.documentSelectorModal}
    >
      <div className="summary-document-picker">
        <Input
          data-testid={summaryTestIds.documentSelectorSearchInput}
          value={state.keyword}
          prefix={<Search size={16} />}
          placeholder={t("summary.documentPicker.searchPlaceholder")}
          onChange={actions.onKeywordChange}
          autoFocus
        />

        <div className="summary-document-picker__tabs" role="tablist">
          {(["recent", "mine"] as const).map((source) => (
            <button
              key={source}
              id={`${pickerId}-tab-${source}`}
              type="button"
              role="tab"
              aria-selected={state.source === source}
              aria-controls={resultsId}
              className={`summary-document-picker__tab${
                state.source === source
                  ? " summary-document-picker__tab--active"
                  : ""
              }`}
              onClick={() => actions.onSourceChange(source)}
            >
              {t(`summary.documentPicker.source.${source}`)}
            </button>
          ))}
        </div>

        <div className="summary-document-picker__count">
          {t("summary.documentPicker.selectedCount", {
            values: { count: state.selected.length, max: state.maxSelect },
          })}
          <span className="summary-document-picker__count-hint">
            {t("summary.documentPicker.supportedTypesHint")}
          </span>
        </div>

        <div
          id={resultsId}
          className="summary-document-picker__results"
          key={`${state.source}:${state.keyword}`}
          role="tabpanel"
          aria-labelledby={activeTabId}
        >
          {state.isLoading ? (
            <div className="summary-document-picker__state" role="status">
              <Spin />
              <span>{t("summary.documentPicker.loading")}</span>
            </div>
          ) : state.error ? (
            <div className="summary-document-picker__state" role="alert">
              <span>{state.error}</span>
              <Button
                data-testid={summaryTestIds.documentSelectorRetryBtn}
                theme="borderless"
                icon={<RotateCw size={14} />}
                onClick={actions.onRetry}
              >
                {t("summary.common.retry")}
              </Button>
            </div>
          ) : state.items.length === 0 ? (
            <div className="summary-document-picker__state">
              {state.keyword.trim()
                ? t("summary.documentPicker.noResults")
                : t(`summary.documentPicker.empty.${state.source}`)}
            </div>
          ) : (
            state.items.map((item) => {
              const checked = selectedIds.has(item.docId);
              const disabled =
                !checked && state.selected.length >= state.maxSelect;
              return (
                <div
                  key={item.docId}
                  className={`summary-document-picker__item${
                    disabled ? " summary-document-picker__item--disabled" : ""
                  }`}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  onClick={() => !disabled && actions.onToggle(item)}
                  onKeyDown={(event) => {
                    if (
                      disabled ||
                      (event.key !== "Enter" && event.key !== " ")
                    )
                      return;
                    event.preventDefault();
                    actions.onToggle(item);
                  }}
                >
                  <Checkbox checked={checked} disabled={disabled} />
                  <span
                    className="summary-document-picker__icon"
                    aria-hidden="true"
                  >
                    <FileText size={18} />
                  </span>
                  <span className="summary-document-picker__meta">
                    <span className="summary-document-picker__name">
                      {item.title || item.docId}
                    </span>
                    <span className="summary-document-picker__detail">
                      {formatUpdatedAt(item.updatedAt)}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>

        {!state.isLoading && !state.error && state.hasMore && (
          <div className="summary-document-picker__pagination">
            {state.loadMoreError && (
              <span role="alert">{state.loadMoreError}</span>
            )}
            <button
              type="button"
              className="summary-document-picker__load-more"
              disabled={state.isLoadingMore}
              aria-busy={state.isLoadingMore}
              onClick={actions.onLoadMore}
            >
              {state.isLoadingMore
                ? t("summary.documentPicker.loading")
                : state.loadMoreError
                ? t("summary.common.retry")
                : t("summary.documentPicker.loadMore")}
            </button>
          </div>
        )}

        <div className="summary-document-picker__footer">
          <Button onClick={actions.onCancel}>
            {t("summary.common.cancel")}
          </Button>
          <Button
            data-testid={summaryTestIds.documentSelectorConfirmBtn}
            theme="solid"
            onClick={actions.onConfirm}
          >
            {t("summary.common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DocumentSelector;
export { DocumentSelector };

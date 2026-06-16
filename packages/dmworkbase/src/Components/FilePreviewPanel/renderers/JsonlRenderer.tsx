import React, { useState, useMemo, useCallback } from "react";
import { TableVirtuoso } from "react-virtuoso";
import SyntaxHighlighter from "react-syntax-highlighter";
import { BaseRendererProps } from "../types";
import { useCodeRenderer } from "./useCodeRenderer";
import { TooltipCell } from "./TooltipCell";
import {
  ViewMode,
  ColumnConfig,
  parseJsonl,
  formatJsonl,
  extractColumns,
  countJsonlLines,
} from "./json-utils";
import { formatFileSize } from "../config";
import CodeRendererBase from "./CodeRendererBase";
import { useI18n } from "../../../i18n";
import "./JsonlRenderer.css";
import "./code-highlight.css";

export interface JsonlRendererProps extends BaseRendererProps {}

/**
 * JSONL 渲染器
 * 支持代码视图（格式化 JSONL）和表格视图
 * JSONL 格式：每行是一个独立的 JSON 对象
 * 使用虚拟滚动高效渲染大数据量
 *
 * 文件大小分级处理（复用 config.ts 统一阈值）：
 * - < 100KB: 语法高亮渲染
 * - 100KB ~ 1MB: 纯文本渲染
 * - > 20MB: 不渲染，提示下载
 */
const JsonlRenderer: React.FC<JsonlRendererProps> = ({ file, onError }) => {
  const { t } = useI18n();
  const { loading, error, reload, renderMode, content, fileSize, contentSize } =
    useCodeRenderer(file, {
      language: "json",
      enableHighlight: true,
      formatter: (rawContent: string) => formatJsonl(rawContent),
    });

  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // 解析 JSONL 数据
  const tableData = useMemo(() => {
    if (!content) return [];
    return parseJsonl(content);
  }, [content]);

  // 格式化的 JSONL 字符串
  const formattedJsonl = useMemo(() => {
    if (!content) return "";
    return formatJsonl(content);
  }, [content]);

  // 获取表格列配置
  const columns: ColumnConfig[] = useMemo(() => {
    return extractColumns(tableData);
  }, [tableData]);

  // 统计信息
  const lineCount = useMemo(() => {
    return countJsonlLines(content || "");
  }, [content]);

  // 切换视图
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  // 判断是否可以显示表格视图
  // 如果只有一个 "value" 列，说明是简单类型数组，不适合表格展示
  const canShowTable =
    tableData.length > 0 &&
    columns.length > 0 &&
    !(columns.length === 1 && columns[0].key === "value");

  // 渲染单元格内容
  const renderCellContent = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "object") return JSON.stringify(value);
    const str = String(value);
    return str.trim() === "" ? "-" : str;
  };

  // 复用 CodeRendererBase 处理边界状态（too-large / loading / error）
  const baseProps = {
    file,
    renderMode,
    formattedContent: formattedJsonl,
    language: "json",
    loading,
    error,
    onReload: reload,
    fileSize,
    contentSize,
  };

  // loading / error / too-large 状态复用 CodeRendererBase
  if (loading || error || renderMode === "too-large") {
    return <CodeRendererBase {...baseProps} />;
  }

  // 内容为空
  if (content === null || tableData.length === 0) {
    return (
      <div className="wk-file-preview-jsonl-renderer wk-file-preview-jsonl-renderer--empty">
        <span>{t("base.filePreview.jsonl.emptyOrInvalid")}</span>
      </div>
    );
  }

  // 正常渲染：工具栏 + 表格/代码视图
  return (
    <div className="wk-file-preview-jsonl-renderer">
      {/* 工具栏 */}
      <div className="wk-file-preview-jsonl-renderer__toolbar">
        <div className="wk-file-preview-jsonl-renderer__info">
          <span className="wk-file-preview-jsonl-renderer__badge">JSONL</span>
          <span className="wk-file-preview-jsonl-renderer__stats">
            {t("base.filePreview.jsonl.stats", {
              values: { lines: lineCount, records: tableData.length },
            })}
          </span>
        </div>
        <div className="wk-file-preview-jsonl-renderer__view-switcher">
          <button
            className={`wk-file-preview-jsonl-renderer__view-btn ${
              viewMode === "table"
                ? "wk-file-preview-jsonl-renderer__view-btn--active"
                : ""
            }`}
            onClick={() => handleViewModeChange("table")}
            disabled={!canShowTable}
            title={canShowTable
              ? t("base.filePreview.jsonl.tableView")
              : t("base.filePreview.jsonl.cannotExtractTable")}
          >
            <svg
              className="wk-file-preview-jsonl-renderer__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
            <span>{t("base.filePreview.jsonl.table")}</span>
          </button>
          <button
            className={`wk-file-preview-jsonl-renderer__view-btn ${
              viewMode === "code"
                ? "wk-file-preview-jsonl-renderer__view-btn--active"
                : ""
            }`}
            onClick={() => handleViewModeChange("code")}
            title={t("base.filePreview.jsonl.codeView")}
          >
            <svg
              className="wk-file-preview-jsonl-renderer__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span>{t("base.filePreview.jsonl.code")}</span>
          </button>
        </div>
      </div>

      {/* 表格视图 - 使用虚拟滚动 */}
      {viewMode === "table" && canShowTable && (
        <div className="wk-file-preview-jsonl-renderer__content">
          <TableVirtuoso
            data={tableData}
            className="wk-file-preview-jsonl-renderer__virtual-table"
            fixedHeaderContent={() => (
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="wk-file-preview-jsonl-renderer__th"
                  >
                    <TooltipCell content={col.title} />
                  </th>
                ))}
              </tr>
            )}
            itemContent={(_index, row) => (
              <>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="wk-file-preview-jsonl-renderer__td"
                  >
                    <TooltipCell content={renderCellContent(row[col.key])} />
                  </td>
                ))}
              </>
            )}
          />
          {/* 底部信息栏 */}
          <div className="wk-file-preview-jsonl-renderer__footer">
            <span className="wk-file-preview-jsonl-renderer__row-count">
              {t("base.filePreview.rowsCount", {
                values: { count: tableData.length },
              })}
            </span>
          </div>
        </div>
      )}

      {/* 代码视图 */}
      {viewMode === "code" && (
        <div className="wk-file-preview-jsonl-renderer__code-container wk-code-highlight-container">
          {renderMode === "highlight" ? (
            <SyntaxHighlighter
              language="json"
              useInlineStyles={false}
              showLineNumbers
            >
              {formattedJsonl}
            </SyntaxHighlighter>
          ) : (
            <>
              <div className="wk-file-preview-jsonl-renderer__plain-hint">
                {t("base.filePreview.largeFilePlainHint", {
                  values: { size: formatFileSize(contentSize) },
                })}
              </div>
              <pre className="wk-file-preview-jsonl-renderer__pre">
                <code className="wk-file-preview-jsonl-renderer__code">
                  {formattedJsonl}
                </code>
              </pre>
            </>
          )}
        </div>
      )}

      {/* 表格视图不可用时的提示 */}
      {viewMode === "table" && !canShowTable && (
        <div className="wk-file-preview-jsonl-renderer__empty-content">
          <span>{t("base.filePreview.jsonl.cannotExtractStructure")}</span>
          <button
            className="wk-file-preview-jsonl-renderer__switch-btn"
            onClick={() => handleViewModeChange("code")}
          >
            {t("base.filePreview.jsonl.switchToCode")}
          </button>
        </div>
      )}
    </div>
  );
};

export default JsonlRenderer;
export { JsonlRenderer };

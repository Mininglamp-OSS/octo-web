import React from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { BaseRendererProps } from "../types";
import { RenderMode, formatFileSize } from "../config";
import "./CodeRenderer.css";
import "./code-highlight.css";

export interface CodeRendererBaseProps extends BaseRendererProps {
  /** 渲染模式 */
  renderMode: RenderMode;
  /** 格式化后的内容 */
  formattedContent: string;
  /** 语言类型 */
  language: string;
  /** 是否加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 重新加载函数 */
  onReload: () => void;
  /** 文件大小 */
  fileSize: number;
  /** 内容实际大小 */
  contentSize: number;
}

/**
 * 代码渲染器基础组件
 * 处理 loading / error / too-large 等共享状态
 */
const CodeRendererBase: React.FC<CodeRendererBaseProps> = ({
  file,
  renderMode,
  formattedContent,
  language,
  loading,
  error,
  onReload,
  fileSize,
  contentSize,
}) => {
  // 文件太大，不渲染
  if (renderMode === "too-large") {
    return (
      <div className="wk-file-preview-code-renderer wk-file-preview-code-renderer--too-large">
        <div className="wk-file-preview-code-renderer__large-file-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </div>
        <span className="wk-file-preview-code-renderer__large-file-text">
          文件太大（{formatFileSize(fileSize)}），无法预览
        </span>
        <a
          href={file.url}
          download={file.name}
          className="wk-file-preview-code-renderer__download-btn"
        >
          下载文件
        </a>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="wk-file-preview-code-renderer wk-file-preview-code-renderer--loading">
        <div className="wk-file-preview-code-renderer__spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wk-file-preview-code-renderer wk-file-preview-code-renderer--error">
        <span>{error}</span>
        <button className="wk-file-preview-code-renderer__retry" onClick={onReload}>
          重试
        </button>
      </div>
    );
  }

  if (formattedContent === null || formattedContent === "") {
    return (
      <div className="wk-file-preview-code-renderer wk-file-preview-code-renderer--error">
        <span>暂无内容</span>
      </div>
    );
  }

  const code = formattedContent;

  if (renderMode === "highlight") {
    return (
      <div className="wk-file-preview-code-renderer wk-code-highlight-container">
        <SyntaxHighlighter
          language={language}
          useInlineStyles={false}
          showLineNumbers
        >
          {code}
        </SyntaxHighlighter>
      </div>
    );
  }

  // renderMode === 'plain'
  return (
    <div className="wk-file-preview-code-renderer">
      <div className="wk-file-preview-code-renderer__plain-hint">
        文件较大（{formatFileSize(contentSize)}），已禁用语法高亮
      </div>
      <pre className="wk-file-preview-code-renderer__pre">
        <code className="wk-file-preview-code-renderer__code">{code}</code>
      </pre>
    </div>
  );
};

export default CodeRendererBase;
export { CodeRendererBase };

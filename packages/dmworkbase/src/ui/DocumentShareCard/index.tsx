import React from "react";
import "./index.css";

export type DocShareKind = "doc" | "board" | "sheet";

/** viewer 视角的权限态（由 Cell 依据实时 ACL 取数结果给出）。 */
export type DocSharePermissionState = "reader" | "writer" | "no_access" | "unavailable" | "checking";

/** 首屏预览取数状态。 */
export type DocSharePreviewStatus = "loading" | "ready" | "denied" | "unavailable" | "error";

/** ACL 校验后的首屏预览数据，按 kind 区分。 */
export type DocSharePreview =
  | { type: "doc"; heading?: string; paragraphs: string[] }
  | { type: "board"; nodes: string[] }
  | { type: "sheet"; headers: string[]; rows: string[][] };

/** 预览不可用时的占位（无权限/失效/检查中/空）。图标 + 标题 + 描述由 Cell 本地化后注入。 */
export interface DocSharePlaceholder {
  icon: "lock" | "warning" | "info";
  title: string;
  desc?: string;
}

/** 本地化文案，由 Cell 注入，保持 ui 层与 i18n 解耦（便于 Story 直接喂静态值）。 */
export interface DocumentShareCardStrings {
  /** 副标题，如 "Sophie 创建"（空则不显示）。 */
  subtitle?: string;
  /** 权限角标文案，如 "可查看" / "需申请" / "不可用" / "检查中"。 */
  permissionLabel: string;
  /** 复制链接按钮的无障碍label。 */
  copyLabel: string;
  /** 预览区（可点开文档）的无障碍label。 */
  openLabel: string;
}

export interface DocumentShareCardProps {
  kind: DocShareKind;
  title: string;
  state: DocSharePermissionState;
  strings: DocumentShareCardStrings;
  /** 有内容且有权限时的首屏预览；否则给 placeholder。二者由 Cell 决定，只传其一。 */
  preview?: DocSharePreview;
  placeholder?: DocSharePlaceholder;
  onOpen?: () => void;
  onCopy?: () => void;
}

/** 权限态 → 角标/卡片色调。 */
function toneOf(state: DocSharePermissionState): "success" | "warning" | "error" | "neutral" {
  if (state === "reader" || state === "writer") return "success";
  if (state === "no_access") return "warning";
  if (state === "unavailable") return "error";
  return "neutral";
}

/** 资源类型内联图标（自包含，不耦合图标系统）。 */
function KindIcon({ kind }: { kind: DocShareKind }): JSX.Element {
  if (kind === "board") {
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M7 9h4M7 13h7" />
      </svg>
    );
  }
  if (kind === "sheet") {
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 10h16M4 15h16M10 4v16" />
      </svg>
    );
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M9 12h6M9 16h6M9 8h3" />
    </svg>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function PlaceholderIcon({ icon }: { icon: DocSharePlaceholder["icon"] }): JSX.Element {
  if (icon === "warning") {
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 2 20h20z" />
        <path d="M12 10v4M12 17h.01" />
      </svg>
    );
  }
  if (icon === "info") {
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    );
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** 首屏预览内容（page/sheet/board）——markup 与 octo 原型 document-preview-* 对齐。 */
function PreviewContent({ title, preview }: { title: string; preview: DocSharePreview }): JSX.Element {
  if (preview.type === "board") {
    return (
      <span className="document-preview-board" aria-hidden="true">
        {preview.nodes.slice(0, 4).map((n, i) => (
          <span className={`document-preview-node node-${i + 1}`} key={i}>
            {n}
          </span>
        ))}
      </span>
    );
  }
  if (preview.type === "sheet") {
    return (
      <span className="document-preview-sheet" aria-hidden="true">
        <span className="document-preview-sheet__title">{title}</span>
        <span className="document-preview-table">
          {preview.headers.length > 0 && (
            <span className="document-preview-table__row is-header">
              {preview.headers.map((h, i) => (
                <span key={i}>{h}</span>
              ))}
            </span>
          )}
          {preview.rows.slice(0, 3).map((row, ri) => (
            <span className="document-preview-table__row" key={ri}>
              {row.map((c, ci) => (
                <span key={ci}>{c}</span>
              ))}
            </span>
          ))}
        </span>
      </span>
    );
  }
  return (
    <span className="document-preview-page" aria-hidden="true">
      <span className="document-preview-page__label">{title}</span>
      {preview.heading ? <strong>{preview.heading}</strong> : null}
      {preview.paragraphs.slice(0, 3).map((p, i) => (
        <span key={i}>{p}</span>
      ))}
      <span className="document-preview-lines">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/**
 * 文档转发卡片纯展示组件（1:1 复刻 octo 原型 document-forward-card）：
 * 头部（类型图标 · 标题+副标题 · 权限角标 · 复制按钮）+ 一整块可点击的首屏预览（点击打开文档）。
 * 无 footer；预览区有内容显内容、无权限/失效/检查中显占位。仅 unavailable 禁用点击。
 */
export function DocumentShareCard(props: DocumentShareCardProps): JSX.Element {
  const { kind, title, state, strings, preview, placeholder, onOpen, onCopy } = props;
  const tone = toneOf(state);
  const disabled = state === "unavailable";

  return (
    <article className={`document-forward-card is-${tone}${disabled ? " is-unavailable" : ""}`}>
      <header className="document-forward-card__header">
        <span className="document-forward-type-icon" aria-hidden="true">
          <KindIcon kind={kind} />
        </span>
        <div className="document-forward-heading">
          <h3 title={title}>{title}</h3>
          {strings.subtitle ? <p>{strings.subtitle}</p> : null}
        </div>
        <span className={`document-permission is-${tone}`}>{strings.permissionLabel}</span>
        <button
          type="button"
          className="document-forward-copy"
          aria-label={strings.copyLabel}
          onClick={onCopy}
        >
          <CopyIcon />
        </button>
      </header>
      <button
        type="button"
        className="document-forward-preview"
        aria-label={strings.openLabel}
        disabled={disabled}
        onClick={disabled ? undefined : onOpen}
      >
        {preview ? (
          <PreviewContent title={title} preview={preview} />
        ) : (
          <span className={`document-preview-placeholder${placeholder?.icon === "warning" ? " is-error" : ""}`}>
            <span className="document-preview-placeholder__icon" aria-hidden="true">
              <PlaceholderIcon icon={placeholder?.icon ?? "info"} />
            </span>
            <strong>{placeholder?.title}</strong>
            {placeholder?.desc ? <span>{placeholder.desc}</span> : null}
          </span>
        )}
      </button>
    </article>
  );
}

export default DocumentShareCard;

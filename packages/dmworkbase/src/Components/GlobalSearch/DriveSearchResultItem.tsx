import React from "react";
import { useI18n } from "../../i18n";
import type { DriveSearchHit } from "../../Service/SearchTypes";
import { formatFileSize } from "../../Utils/fileIcon";
import { driveIconSrc } from "./searchFileIcon";

const HIGHLIGHT_MAX_LEN = 2000;
const BODY_SNIPPET_MAX = 2;

// Highlight fragments come from the backend. Keep markup inert by rebuilding
// only its <mark> tags as React nodes instead of inserting HTML.
function renderHighlight(rawFragment: string): React.ReactNode {
  const fragment =
    rawFragment.length > HIGHLIGHT_MAX_LEN
      ? rawFragment.slice(0, HIGHLIGHT_MAX_LEN)
      : rawFragment;
  const pattern = /<mark>([\s\S]*?)<\/mark>/gi;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(fragment))) {
    if (match.index > cursor) nodes.push(fragment.slice(cursor, match.index));
    nodes.push(<mark key={key++}>{match[1]}</mark>);
    cursor = pattern.lastIndex;
  }
  if (cursor < fragment.length) nodes.push(fragment.slice(cursor));
  return nodes.length > 0 ? nodes : fragment;
}

function formatUpdatedAt(iso: string, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale);
  } catch {
    return "";
  }
}

function breadcrumb(hit: DriveSearchHit): string {
  return [hit.space_name, ...(hit.path ?? [])].filter(Boolean).join(" / ");
}

interface Props {
  hit: DriveSearchHit;
  onOpen?: (hit: DriveSearchHit) => void;
}

/** Shared result row for the aggregate and dedicated drive search views. */
export default function DriveSearchResultItem({ hit, onOpen }: Props) {
  const { locale } = useI18n();
  const bodySnippets = (hit.highlights?.body ?? []).slice(0, BODY_SNIPPET_MAX);
  const crumb = breadcrumb(hit);

  return (
    <button
      type="button"
      className="wk-drive-search__item"
      onClick={() => onOpen?.(hit)}
    >
      <span className="wk-drive-search__icon">
        <img
          className="wk-drive-search__icon-img"
          src={driveIconSrc(hit.type, hit.name, hit.doc_type)}
          width={48}
          height={48}
          alt=""
        />
      </span>
      <span className="wk-drive-search__meta">
        <span className="wk-drive-search__title">
          {hit.highlights?.name?.[0]
            ? renderHighlight(hit.highlights.name[0])
            : hit.name}
        </span>
        {crumb && <span className="wk-drive-search__crumb">{crumb}</span>}
        {bodySnippets.length > 0 ? (
          bodySnippets.map((fragment, index) => (
            <span key={index} className="wk-drive-search__snippet">
              {renderHighlight(fragment)}
            </span>
          ))
        ) : (
          <span className="wk-drive-search__sub">
            {[
              hit.owner_name,
              formatUpdatedAt(hit.updated_at, locale),
              typeof hit.size === "number" ? formatFileSize(hit.size) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
    </button>
  );
}

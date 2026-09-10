import React, { useEffect, useState } from "react";
import { History, X, ChevronRight } from "lucide-react";
import { WKButton, useI18n } from "@octo/base";
import type { SummaryFormalContent, SummaryFormalVersion } from "../../Service/SummaryContentContract";

export interface NativeFormalVersionPanelProps {
  content: SummaryFormalContent;
  versions: SummaryFormalVersion[];
  selected: SummaryFormalVersion | null;
  pending: boolean;
  hasMore: boolean;
  actions: {
    onClose: () => void;
    onSelect: (version: SummaryFormalVersion) => void;
    onMore: () => void;
    onRestore: (version: string) => Promise<boolean>;
    onApply: (generation: string) => Promise<boolean>;
  };
}

/** Same sidebar/card structure as Octo's existing SummaryVersionPanel.
 * Opaque formal identities stay separate from legacy numeric result IDs. */
export function NativeFormalVersionPanel({ content, versions, selected, pending, hasMore, actions }: NativeFormalVersionPanelProps) {
  const { t, format } = useI18n();
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [selected?.version_id, content.content_revision]);
  const canApply = !pending && !content.active_generation && content.capabilities.can_edit;
  return <aside className="version-panel" aria-label={t("summary.detail.versionRecords")}>
    <header className="version-panel__header">
      <span className="version-panel__icon" aria-hidden><History size={16} /></span>
      <div className="version-panel__heading"><h2>{t("summary.detail.versionRecords")}</h2></div>
      <WKButton aria-label={t("summary.detail.versionPanelClose")} onClick={actions.onClose}><X size={16} /></WKButton>
    </header>
    <div className="version-panel__list">
      {!versions.length && <p role="status">{t(pending ? "summary.formal.loading" : "summary.formal.empty")}</p>}
      {versions.map((version) => <button type="button" key={version.version_id}
        className={`version-card${version.is_current ? " is-current" : ""}${selected?.version_id === version.version_id ? " is-selected" : ""}`}
        aria-pressed={selected?.version_id === version.version_id} onClick={() => actions.onSelect(version)}>
        <span className="version-card__marker" aria-hidden>V{version.version}</span>
        <span className="version-card__copy">
          <span className="version-card__title">
            <strong>{t(version.pending_application ? "summary.formal.candidate" : version.is_current ? "summary.detail.currentVersion" : `summary.detail.versionOperation.${version.operation_type}`)}</strong>
          </span>
          <span className="version-card__time">{format.dateTime(version.generated_at)}</span>
          <span className="version-card__note">{version.operation_note}</span>
        </span>
        <ChevronRight size={16} aria-hidden />
      </button>)}
      {hasMore && <WKButton disabled={pending} onClick={actions.onMore}>{t("summary.formal.more")}</WKButton>}
    </div>
    {selected && !selected.is_current && <footer className="version-panel__footer">
      {selected.pending_application && selected.generation_id
        ? <WKButton disabled={!canApply} onClick={() => void actions.onApply(selected.generation_id!)}>{t("summary.formal.applyCandidate")}</WKButton>
        : <>
          <p>{t("summary.formal.overwriteWarning")}</p>
          <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t("summary.formal.confirmOverwrite")}</label>
          <WKButton disabled={!canApply || !confirmed} onClick={() => void actions.onRestore(selected.version_id)}>{t("summary.detail.restoreVersion")}</WKButton>
        </>}
    </footer>}
  </aside>;
}
export default NativeFormalVersionPanel;

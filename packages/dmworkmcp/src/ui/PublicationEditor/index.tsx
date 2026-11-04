import React from "react";
import { getMcpAvatarColor, getMcpAvatarText } from "../../utils/mcpAvatar";
import { Select } from "@douyinfe/semi-ui";
import { dependencyIssueReasonKey } from "@dmwork/skillmarket/src/components/dependencyIssueReason";
import { Bot, ChevronRight } from "lucide-react";
import { visibilityLabel } from "@dmwork/skillmarket/src/utils/labels";
import { t, useI18n, WKButton, WKInput } from "@octo/base";
import type { PluginDetailWire } from "@dmwork/skillmarket/src/api/pluginWire";
import type { PublicationFields } from "@dmwork/skillmarket/src/features/publications/publicationDraft";
import type {
  PublicationDependency,
  DependencyUpdate,
} from "@dmwork/skillmarket/src/Service/PublicationService";
export interface PublicationEditorFieldsProps {
  item?: { id?: string; name: string; kind: string } | null;
  dependencyIssues?: Array<{ targetName?: string; reason?: string }>;
  dependencySuspended?: boolean;
  draft: PluginDetailWire | null;
  fields: PublicationFields;
  deps: PublicationDependency[];
  alerts: DependencyUpdate[];
  busy: boolean;
  blocked: boolean;
  error: string;
  canSave: boolean;
  versionError: string | null;
  publishError: string | null;
  initialVisibility: "private" | "space";
  onFieldChange: <K extends keyof PublicationFields>(
    key: K,
    value: PublicationFields[K]
  ) => void;
  onRetry: () => void;
  onBotUpdate: () => void;
  onShowUpdates: () => void;
  onInitialVisibilityChange: (value: "private" | "space") => void;
}
export function PublicationEditorFields({
  item,
  dependencyIssues = [],
  dependencySuspended,
  draft,
  fields,
  deps,
  alerts,
  busy,
  blocked,
  error,
  canSave,
  versionError,
  publishError,
  initialVisibility,
  onFieldChange: set,
  onRetry,
  onBotUpdate,
  onShowUpdates,
  onInitialVisibilityChange,
}: PublicationEditorFieldsProps) {
  useI18n();
  const issues = dependencyIssues.length ? dependencyIssues : deps.filter(dep => dep.unavailable).map(dep => ({ targetName: dep.name, reason: "unknown" }));
  return (
    <div className="skill-market-form skill-market-form--workflow">
      {error && (
        <p role="alert" className="skill-market-form__error">
          {error}
          {!draft && (
            <WKButton onClick={onRetry}>{t("skillMarket.list.retry")}</WKButton>
          )}
        </p>
      )}
      {!draft && !error && <p>{t("skillMarket.common.loading")}</p>}
      {draft && (
        <>
          <div className="publication-editor-identity">
            <span className="publication-editor-identity__icon" style={{ background: getMcpAvatarColor(item?.id || item?.name || "") }} aria-hidden="true">{getMcpAvatarText(item?.name || "")}</span>
            <div>
              <strong>{item?.name}</strong>
              <span>{t(item?.kind === "squad" ? "mcp.expert.typeSquad" : "mcp.expert.typeAgent")} · {visibilityLabel(draft.plugin.published_version_id ? draft.plugin.visibility : initialVisibility)}</span>
            </div>
          <WKButton
            variant="secondary"
            className="publication-editor-bot-action"
            icon={<Bot size={16} />}
            onClick={onBotUpdate}
            disabled={!canSave}
          >
            {t(
              item?.kind === "squad"
                ? "mcp.expert.botUpdateTitle"
                : "mcp.expert.botUpdateTitleAgent"
            )}
            <ChevronRight size={14} aria-hidden="true" />
          </WKButton>
          </div>
          <label>
            <span>{t("skillMarket.form.displayName")}</span>
            <WKInput
              value={fields.name}
              onChange={(v) => set("name", v)}
              disabled={busy || blocked}
            />
          </label>
          <label>
            <span>{t("skillMarket.publication.description")}</span>
            <textarea
              value={fields.description}
              onChange={(e) => set("description", e.target.value)}
              disabled={busy || blocked}
            />
          </label>
          <label>
            <span>
              {t(
                item?.kind === "squad"
                  ? "skillMarket.publication.teamGuidance"
                  : "skillMarket.publication.instruction"
              )}
            </span>
            <textarea
              rows={8}
              value={fields.instruction}
              onChange={(e) => set("instruction", e.target.value)}
              disabled={busy || blocked}
            />
          </label>
          {!!issues.length && <section className="publication-editor-warning" role="status">
            <strong>{t("skillMarket.publication.invalidDependencies")}</strong>
            {issues.map((issue, index) => <p key={index}>
              {issue.targetName || t("skillMarket.publication.unavailableDependency")} · {t(`skillMarket.plugin.dependencyIssue.${dependencyIssueReasonKey(issue.reason)}`)}
            </p>)}
            <span>{t("skillMarket.publication.repairWithBot")}</span>
          </section>}
          {!issues.length && dependencySuspended && <p className="skill-market-form__hint">{t("skillMarket.publication.dependencyRecovered")}</p>}
          {!draft.plugin.published_version_id &&
            draft.plugin.listing_state === "draft" && (
              <div className="skill-market-scope-options">
                <h3 className="skill-market-form__section-title">{t("skillMarket.plugin.columnVisibility")}</h3>
                {(["private", "space"] as const).map((scope) => (
                  <label key={scope} className={initialVisibility === scope ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="initial-publication-visibility"
                      value={scope}
                      checked={initialVisibility === scope}
                      disabled={busy || blocked}
                      onChange={() => onInitialVisibilityChange(scope)}
                    />
                    <span>
                      {t(
                        scope === "private"
                          ? "skillMarket.plugin.visibilityPrivate"
                          : "skillMarket.plugin.visibilitySpace"
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          {deps.map((dep) => (
            <div key={dep.id} className="publication-editor-dependency">
              <span>
                <span id={`publication-dependency-${draft.plugin.plugin_id}-${dep.id}`}>
                  {dep.name || t("skillMarket.publication.unavailableDependency")}
                </span>
                {alerts.some((u) => u.plugin_id === dep.id) && (
                  <button type="button" className="wk-mine-table__dependency-update" onClick={onShowUpdates} disabled={busy}>
                    {t("skillMarket.publication.hasUpdates")}
                  </button>
                )}
              </span>
              {dep.type === "connector" ? (
                <span>{t("skillMarket.publication.connectorCurrent")}</span>
              ) : (
                <Select
                  className="publication-editor-version-select"
                  aria-labelledby={`publication-dependency-${draft.plugin.plugin_id}-${dep.id}`}
                  value={fields.versions[dep.id] ?? dep.current ?? ""}
                  position="bottomLeft"
                  autoAdjustOverflow
                  maxHeight={240}
                  onChange={(value) => typeof value === "string" && set("versions", { ...fields.versions, [dep.id]: value })}
                  disabled={busy || blocked || dep.unavailable}
                  optionList={[
                    ...(!dep.versions.some(v => v.id === (fields.versions[dep.id] ?? dep.current)) ? [{ value: fields.versions[dep.id] ?? dep.current ?? "", label: t("skillMarket.publication.boundVersion") }] : []),
                    ...dep.versions.map(v => ({ value: v.id, label: `v${v.label}` })),
                  ]}
                />
              )}
            </div>
          ))}
          {draft.plugin.listing_state === "published" && <WKButton variant="ghost" onClick={onShowUpdates} disabled={busy}>
            {t("skillMarket.publication.viewUpdates")}
          </WKButton>}
          <h3 className="skill-market-form__section-title">{t("skillMarket.form.versionSection")}</h3>
          <div className="skill-market-form__row">
            <label>
              <span>{t("skillMarket.form.versionLabel")}</span>
              <WKInput
                value={fields.version}
                onChange={(v) => set("version", v)}
                disabled={busy || blocked}
              />
              {versionError && <span role="alert">{t(versionError)}</span>}
            </label>
            <label>
              <span>{t("skillMarket.form.changelogLabel")}</span>
              <WKInput
                value={fields.changelog}
                onChange={(v) => set("changelog", v)}
                disabled={busy || blocked}
              />
            </label>
          </div>
          {publishError && (
            <p className="skill-market-form__hint">{t(publishError)}</p>
          )}
        </>
      )}
    </div>
  );
}
export default PublicationEditorFields;

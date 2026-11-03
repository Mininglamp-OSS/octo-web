import React from "react";
import { Bot, Users } from "lucide-react";
import { visibilityLabel } from "@dmwork/skillmarket/src/utils/labels";
import { t, useI18n, WKButton, WKInput } from "@octo/base";
import type { PluginDetailWire } from "@dmwork/skillmarket/src/api/pluginWire";
import type { PublicationFields } from "@dmwork/skillmarket/src/features/publications/publicationDraft";
import type {
  PublicationDependency,
  DependencyUpdate,
} from "@dmwork/skillmarket/src/Service/PublicationService";
export interface PublicationEditorFieldsProps {
  item?: { name: string; kind: string } | null;
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
            <span className="publication-editor-identity__icon" aria-hidden="true">{item?.kind === "squad" ? <Users size={22} /> : <Bot size={22} />}</span>
            <div>
              <strong>{item?.name}</strong>
              <span>{t(item?.kind === "squad" ? "mcp.expert.typeSquad" : "mcp.expert.typeAgent")} · {visibilityLabel(draft.plugin.published_version_id ? draft.plugin.visibility : initialVisibility)}</span>
            </div>
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
          <WKButton
            variant="secondary"
            onClick={onBotUpdate}
            disabled={!canSave}
          >
            {t(
              item?.kind === "squad"
                ? "mcp.expert.botUpdateTitle"
                : "mcp.expert.botUpdateTitleAgent"
            )}
          </WKButton>
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
            <label key={dep.id} className="publication-editor-dependency">
              <span>
                {dep.name || t("skillMarket.publication.unavailableDependency")}
                {alerts.some((u) => u.plugin_id === dep.id) && (
                  <span className="wk-mine-table__dependency-update">
                    {t("skillMarket.publication.hasUpdates")}
                  </span>
                )}
              </span>
              {dep.type === "connector" ? (
                <span>{t("skillMarket.publication.connectorCurrent")}</span>
              ) : (
                <select
                  aria-label={
                    dep.name ||
                    t("skillMarket.publication.unavailableDependency")
                  }
                  value={fields.versions[dep.id] ?? dep.current ?? ""}
                  onChange={(e) =>
                    set("versions", {
                      ...fields.versions,
                      [dep.id]: e.target.value,
                    })
                  }
                  disabled={busy || blocked || dep.unavailable}
                >
                  {!dep.versions.some(
                    (v) => v.id === (fields.versions[dep.id] ?? dep.current)
                  ) && (
                    <option value={fields.versions[dep.id] ?? dep.current}>
                      {t("skillMarket.publication.boundVersion")}
                    </option>
                  )}
                  {dep.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
          <WKButton variant="ghost" onClick={onShowUpdates} disabled={busy}>
            {t("skillMarket.publication.viewUpdates")}
          </WKButton>
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

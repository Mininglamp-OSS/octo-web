import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Bot, UserRound, Users } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKInput, WKModal } from "@octo/base";
import { versionErrorKey } from "@dmwork/skillmarket";
import type { ExpertItem } from "../mock/expertMock";
import { getExpertEditMetadata, updateExpertVisibility } from "../api/expertService";
import type { ExpertVisibility } from "../api/expertService";
import { publishPluginListing } from "../api/pluginReview";

/** Edit marketplace metadata while preserving Bot-authored content and pins. */
interface ExpertEditModalProps {
  /** null = closed. A list projection is enough: every field read here
   *  (visibility / listingState / version / name / kind) is on the row. */
  item: ExpertItem | null;
  onClose: () => void;
  /**
   * A save (and any publish that followed it) succeeded. The message is
   * ready to show; the page also has to reload, because the row's visibility,
   * listing state and available actions all just changed.
   */
  onSaved: (message: string) => void;
  /** Hand this record off to the Bot update prompt for CONTENT changes. */
  onEditContent: (item: ExpertItem) => void;
}

/**
 * The stored audience, narrowed to what a tenant may declare.
 *
 * `undefined` means the record sits outside that set — `system` / `public`, i.e.
 * a platform-published (全平台) row. Those are not tenant-owned: writing either
 * radio value onto one would quietly demote an official listing into a single
 * Space, so the control is withheld rather than defaulted.
 */
function tenantVisibility(raw: string | undefined): ExpertVisibility | undefined {
  if (raw === "private") return "private";
  if (raw === "space") return "space";
  return undefined;
}

export default function ExpertEditModal({
  item,
  onClose,
  onSaved,
  onEditContent,
}: ExpertEditModalProps) {
  useI18n();
  const stored = tenantVisibility(item?.visibility);
  // The DECLARED audience, as edited. Seeded from the stored value; when the
  // record is platform-published there is nothing a tenant may declare, so the
  // section renders read-only and this state is never reached.
  const [visibility, setVisibility] = useState<ExpertVisibility>("private");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [saving, setSaving] = useState(false);
  // Which footer action is in flight, so only that button spins.
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spaceGenerationRef = useRef(0);
  const savedDraft = useRef<{ name: string; version: string; changelog: string; visibility: ExpertVisibility; draftRevision?: string } | null>(null);

  useEffect(() => {
    const handleSpaceChanged = () => {
      spaceGenerationRef.current += 1;
      setSaving(false);
      setPublishing(false);
      setError(null);
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => {
      spaceGenerationRef.current += 1;
      WKApp.mittBus.off("space-changed", handleSpaceChanged);
    };
  }, []);

  // Reseed on every open / target switch so a previous session's selection or
  // error never leaks into the next record.
  useEffect(() => {
    spaceGenerationRef.current += 1;
    savedDraft.current = null;
    if (!item) return;
    setVisibility(tenantVisibility(item.visibility) ?? "private");
    setName(item.name);
    setVersion(item.version || "1.0.0");
    setChangelog(item.draftChangelog ?? "");
    setSaving(false);
    setPublishing(false);
    setError(null);
  }, [item]);

  const isSquad = item?.kind === "squad";
  const visibilityChanged = stored !== undefined && visibility !== stored;
  const metadataChanged = name.trim() !== item?.name || version.trim() !== (item?.version || "1.0.0");
  const baseline = savedDraft.current;
  const dirty = stored !== undefined && (baseline
    ? name.trim() !== baseline.name || version.trim() !== baseline.version || changelog !== baseline.changelog || visibility !== baseline.visibility
    : visibilityChanged || metadataChanged || changelog !== (item?.draftChangelog ?? ""));
  const versionError = versionErrorKey(item?.version, version, item?.version);
  const canSave = Boolean(name.trim() && version.trim() && !versionError);
  const willBeUnlisted = item?.listingState !== "published" || visibilityChanged;
  const canPublish = canSave && (visibility !== "space" || Boolean(changelog.trim()));

  /**
   * `publish=false` saves and stops; `publish=true` saves and then hands the
   * record to the backend's one publish door, which routes on the STORED
   * visibility — so the save has to land first, or 发布 would route on the old
   * audience. The response says which branch fired; the toast follows it rather
   * than guessing from the local radio.
   */
  async function submit(publish: boolean) {
    if (!item || !canSave || (publish && !canPublish)) return;
    const actionGeneration = spaceGenerationRef.current;
    const isCurrentSpace = () => actionGeneration === spaceGenerationRef.current;
    setSaving(true);
    setPublishing(publish);
    setError(null);
    try {
      if (dirty) {
        const draftRevision = await updateExpertVisibility(item.id, visibility, { name: name.trim(), version: version.trim(), changelog, draftRevision: savedDraft.current?.draftRevision ?? item.draftRevision });
        if (!isCurrentSpace()) return;
        // Save has committed even if the following publication fails.
        savedDraft.current = { name: name.trim(), version: version.trim(), changelog, visibility, draftRevision: draftRevision ?? savedDraft.current?.draftRevision ?? item.draftRevision };
      } else if (publish) {
        const current = await getExpertEditMetadata(item.id);
        if (!isCurrentSpace()) return;
        const expected = savedDraft.current?.draftRevision ?? item.draftRevision;
        if (!expected || current.draftRevision !== expected) {
          throw new Error(t("skillMarket.errors.stateConflict"));
        }
      }
      if (publish) {
        const outcome = await publishPluginListing(item.id, {
          version: version.trim(),
          ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
        });
        if (!isCurrentSpace()) return;
        onSaved(
          outcome.displayStatus === "pending_review"
            ? t("skillMarket.review.submittedToast")
            : t("skillMarket.plugin.publishedToast")
        );
      } else {
        onSaved(
          willBeUnlisted
            ? t("skillMarket.plugin.draftSavedToast")
            : t("skillMarket.list.saved")
        );
      }
      onClose();
    } catch (err) {
      if (!isCurrentSpace()) return;
      // A 409 lands here too (the record was listed or a review opened while
      // this modal was open). Show the server's reason and keep the modal up —
      // the page reloads only on success, so the stale row stays visible with an
      // explanation rather than silently reverting.
      setError(err instanceof Error ? err.message : t("skillMarket.form.saveFailed"));
    } finally {
      if (isCurrentSpace()) {
        setSaving(false);
        setPublishing(false);
      }
    }
  }

  return (
    <WKModal
      visible={Boolean(item)}
      onCancel={onClose}
      title={t("skillMarket.form.editTitle", { values: { name: item?.name ?? "" } })}
      footer={
        <>
          <WKButton variant="secondary" onClick={onClose} disabled={saving}>
            {t("skillMarket.common.cancel")}
          </WKButton>
          <WKButton
            variant="secondary"
            onClick={() => void submit(false)}
            loading={saving && !publishing}
            disabled={!dirty || !canSave || (saving && publishing)}
          >
            {t(
              willBeUnlisted
                ? "skillMarket.plugin.actionSaveDraft"
                : "skillMarket.common.save"
            )}
          </WKButton>
          {(willBeUnlisted || metadataChanged) && (
            <WKButton
              variant="primary"
              onClick={() => void submit(true)}
              loading={saving && publishing}
              disabled={!canPublish || (saving && !publishing)}
            >
              {t("skillMarket.plugin.actionPublish")}
            </WKButton>
          )}
        </>
      }
    >
      <div className="skill-market-form skill-market-form--workflow">
        {error && (
          <div className="skill-market-form__error">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className="skill-market-upload-file skill-market-upload-file--identity">
          <span className="skill-market-upload-file__identity-icon" aria-hidden="true">
            {isSquad ? <Users size={16} /> : <UserRound size={16} />}
          </span>
          <div className="skill-market-upload-file__identity">
            <span>
              {t(isSquad ? "mcp.expert.typeSquad" : "mcp.expert.typeAgent")}
            </span>
            <strong title={item?.name}>{item?.name}</strong>
          </div>
          {/* CONTENT still belongs to the Bot: these records are authored
              through octo-cli and there is no client-side form for the
              instruction / MCP config / skills. This reopens the same update
              prompt 编辑 used to open directly — the flow did not move, it just
              stopped being the ONLY thing 编辑 could do. */}
          <button
            type="button"
            onClick={() => {
              if (item) onEditContent(item);
            }}
            disabled={saving}
          >
            <Bot size={14} aria-hidden="true" />
            {t(
              isSquad
                ? "mcp.expert.botUpdateTitle"
                : "mcp.expert.botUpdateTitleAgent"
            )}
          </button>
        </div>

        {stored !== undefined && (
          <>
            <label>
              <span>{t("skillMarket.form.displayName")}<i className="skill-market-required">*</i></span>
              <WKInput value={name} onChange={setName} disabled={saving} maxLength={128} />
            </label>
            <div className="skill-market-form__row">
              <label>
                <span>{t("skillMarket.form.versionLabel")}<i className="skill-market-required">*</i></span>
                <WKInput value={version} onChange={setVersion} disabled={saving} />
                {versionError && <p className="skill-market-field-error">{t(versionError)}</p>}
              </label>
              <label>
                <span>{t("skillMarket.form.changelogLabel")}{visibility === "space" && <i className="skill-market-required">*</i>}</span>
                <WKInput value={changelog} onChange={setChangelog} disabled={saving} placeholder={t("skillMarket.form.changelogPlaceholder")} />
              </label>
            </div>
          </>
        )}

        <h3 className="skill-market-form__section-title">
          {t("skillMarket.plugin.columnVisibility")}
        </h3>
        {item?.listingState === "published" && stored !== undefined ? <p className="skill-market-form__hint">{t("skillMarket.visibility.useAction")}</p> : stored === undefined ? (
          // Platform-published (全平台). Shown, not offered: see tenantVisibility.
          <p className="skill-market-form__hint">
            {t("skillMarket.plugin.visibilitySystem")}
          </p>
        ) : (
          <div className="skill-market-scope-options">
            {(["private", "space"] as const).map((option) => (
              <label key={option} className={visibility === option ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="expert-edit-visibility"
                  value={option}
                  checked={visibility === option}
                  onChange={() => setVisibility(option)}
                  disabled={saving}
                />
                <div>
                  <strong>
                    {t(
                      option === "private"
                        ? "skillMarket.plugin.visibilityPrivate"
                        : "skillMarket.plugin.visibilitySpace"
                    )}
                  </strong>
                  <span>
                    {t(
                      option === "private"
                        ? "skillMarket.plugin.visibilityPrivateHint"
                        : "skillMarket.plugin.visibilitySpaceHint"
                    )}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}

      </div>
    </WKModal>
  );
}

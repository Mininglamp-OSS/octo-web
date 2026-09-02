import React, { useEffect, useState } from "react";
import { AlertCircle, Bot, UserRound, Users } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
import type { ExpertItem } from "../mock/expertMock";
import { updateExpertVisibility } from "../api/expertService";
import type { ExpertVisibility } from "../api/expertService";
import { publishPluginListing } from "../api/pluginReview";

/**
 * 编辑 for the 专家 / 专家团 markets.
 *
 * WHY THIS EXISTS AT ALL, given these records have no client-side content form:
 *
 * `visibility` is marketplace METADATA — the audience the author declares, which
 * the backend then reads to decide whether 发布 lists the record on the spot or
 * opens an organization review. It is not authored content, so it must not be
 * routed through the Bot prompt: an author would otherwise have to hand a
 * sentence to an agent and wait for octo-cli to round-trip, just to flip a radio
 * that only ever writes one column.
 *
 * It lives behind the row's 编辑 action rather than a dedicated one because the
 * backend's gate on WRITING visibility is exactly the gate on editing: the write
 * is refused with 409 while the record is listed to the org
 * (`listed_requires_review`) or has a review pending, which is precisely
 * `resolveReviewRowState().canEdit`. Reusing that affordance means the button
 * and the rule cannot drift apart. (MineTable also has no visibility action slot,
 * and it is shared by all four markets — a fifth row icon for one of them would
 * be the wrong place to introduce one.)
 *
 * Content authoring stays exactly where it was: the Bot handoff below reopens
 * the same `ExpertBotPublishModal` update prompt that 编辑 used to open directly.
 *
 * Structure mirrors dmworkskillmarket's EditSkillModal — same visibility radio,
 * same state-adaptive 保存草稿 / 保存 + 发布 footer, same warn-before-the-save on a
 * widening change — so an author meets one contract across the four markets.
 */
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
  const [saving, setSaving] = useState(false);
  // Which footer action is in flight, so only that button spins.
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reseed on every open / target switch so a previous session's selection or
  // error never leaks into the next record.
  useEffect(() => {
    if (!item) return;
    setVisibility(tenantVisibility(item.visibility) ?? "private");
    setSaving(false);
    setPublishing(false);
    setError(null);
  }, [item]);

  const isSquad = item?.kind === "squad";
  // Nothing to write when the audience is unchanged. Saving anyway would cost a
  // server-side version snapshot recording no change — and unlike the skill
  // market's edit form, visibility is the ONLY field this modal can write, so
  // "unchanged" really does mean "nothing to save".
  const dirty = stored !== undefined && visibility !== stored;
  // Whether this record will be UNLISTED once the save lands: either it already
  // is, or widening the audience is about to un-list it server-side. That is
  // exactly when 保存草稿 is the honest label and 发布 has something to do; on a
  // listed record whose audience is unchanged the primary action is not rendered
  // rather than sitting there disabled.
  const willBeUnlisted = item?.listingState !== "published" || dirty;

  /**
   * `publish=false` saves and stops; `publish=true` saves and then hands the
   * record to the backend's one publish door, which routes on the STORED
   * visibility — so the save has to land first, or 发布 would route on the old
   * audience. The response says which branch fired; the toast follows it rather
   * than guessing from the local radio.
   */
  async function submit(publish: boolean) {
    if (!item) return;
    setSaving(true);
    setPublishing(publish);
    setError(null);
    try {
      if (dirty) {
        await updateExpertVisibility(item.id, visibility);
      }
      if (publish) {
        const outcome = await publishPluginListing(item.id, {
          // Empty on a bot-authored record that never carried a label; the
          // backend then reuses the draft's current version.
          ...(item.version ? { version: item.version } : {}),
        });
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
      // A 409 lands here too (the record was listed or a review opened while
      // this modal was open). Show the server's reason and keep the modal up —
      // the page reloads only on success, so the stale row stays visible with an
      // explanation rather than silently reverting.
      setError(err instanceof Error ? err.message : t("skillMarket.form.saveFailed"));
    } finally {
      setSaving(false);
      setPublishing(false);
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
          {/* Same shape as the skill market's edit modal. The secondary action
              is only called 保存草稿 when the save actually leaves a draft
              behind; it is disabled when the audience is unchanged, because
              visibility is the only thing here to save. 发布 is not rendered at
              all on a listed record with nothing to publish, rather than sitting
              there permanently disabled. */}
          <WKButton
            variant="secondary"
            onClick={() => void submit(false)}
            loading={saving && !publishing}
            disabled={!dirty || (saving && publishing)}
          >
            {t(
              willBeUnlisted
                ? "skillMarket.plugin.actionSaveDraft"
                : "skillMarket.common.save"
            )}
          </WKButton>
          {willBeUnlisted && (
            <WKButton
              variant="primary"
              onClick={() => void submit(true)}
              loading={saving && publishing}
              disabled={saving && !publishing}
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

        <h3 className="skill-market-form__section-title">
          {t("skillMarket.plugin.columnVisibility")}
        </h3>
        {stored === undefined ? (
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
        {/* Said BEFORE the save, not after: a listed record whose audience
            changes stops being listed until it goes through 发布 again, and an
            author who is not told will read that as their expert disappearing. */}
        {item?.listingState === "published" && dirty && (
          <p className="skill-market-form__hint">
            {t("skillMarket.plugin.visibilityChangeUnlists")}
          </p>
        )}
      </div>
    </WKModal>
  );
}

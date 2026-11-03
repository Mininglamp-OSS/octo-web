import React, { useEffect, useRef, useState } from "react";
import {
  extractErrorMsg,
  t,
  useI18n,
  WKApp,
  WKButton,
  WKInput,
  WKModal,
} from "@octo/base";
import { nextPatch, upgradeVersionErrorKey } from "@dmwork/skillmarket";
import {
  PublicationService,
  type DependencyUpdates,
  type DependencyUpdate,
} from "@dmwork/skillmarket/src/Service/PublicationService";
import { resolveSkillMarketApiBaseURL } from "@dmwork/skillmarket/src/api/constants";
import {
  editPublicationDraft,
  type PublicationWrite,
} from "@dmwork/skillmarket/src/features/publications/publicationDraft";
import { notifyReviewsChanged } from "@dmwork/skillmarket/src/api/reviewSignal";

interface Props {
  pluginId: string;
  pending?: boolean;
  draft?: PublicationWrite;
  onClose: () => void;
  onSaved: (message: string) => void;
  onSkipped?: () => void;
}
export function DependencyUpdateFlow({
  pluginId,
  pending = false,
  draft: edited,
  onClose,
  onSaved,
  onSkipped,
}: Props) {
  useI18n();
  const [source, setSource] = useState<DependencyUpdates | null>(null);
  const [draft, setDraft] = useState<PublicationWrite | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const close = () => {
      generation.current++;
      closeRef.current();
    };
    WKApp.mittBus.on("space-changed", close);
    return () => {
      generation.current++;
      WKApp.mittBus.off("space-changed", close);
    };
  }, []);
  useEffect(() => {
    const token = ++generation.current;
    setError("");
    setSource(null);
    const base = resolveSkillMarketApiBaseURL();
    void Promise.all([
      PublicationService.getUpdates(base, pluginId),
      edited
        ? Promise.resolve(null)
        : PublicationService.getDraft(base, pluginId),
    ])
      .then(async ([updates, value]) => {
        let payload = edited;
        if (!payload && value) {
          const instruction = await PublicationService.getInstruction(
            base,
            value
          );
          payload = editPublicationDraft(value, {
            name: value.plugin.plugin_name,
            description: value.plugin.manifest_json.description ?? "",
            instruction,
            version:
              value.plugin.current_version === value.plugin.published_version
                ? nextPatch(value.plugin.published_version)
                : value.plugin.current_version ?? "1.0.0",
            changelog: value.draft_changelog ?? "",
            versions: {},
          });
        }
        if (token !== generation.current) return;
        setSource(updates);
        setDraft(payload ?? null);
        setVersion(payload?.plugin.version ?? "1.0.0");
        setNotes(
          payload?.changelog || t("skillMarket.publication.updateNotes")
        );
        setSelected(
          Object.fromEntries(
            updates.updates.map((u) => [u.plugin_id, !u.is_skipped])
          )
        );
      })
      .catch((err) => {
        if (token === generation.current)
          setError(
            err instanceof Error
              ? err.message
              : extractErrorMsg(err) || t("skillMarket.common.loadFailed")
          );
      });
    return () => {
      generation.current++;
    };
  }, [pluginId, edited]);
  const changes = source?.updates.filter((u) => selected[u.plugin_id]) ?? [];
  async function run(skip: boolean) {
    if (!source || busy) return;
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const base = resolveSkillMarketApiBaseURL();
      if (skip) {
        const reminders = source.updates.filter((u) => !u.is_skipped);
        if (!reminders.length) return;
        await PublicationService.skipUpdates(base, pluginId, reminders);
        if (token !== generation.current) return;
        notifyReviewsChanged();
        if (onSkipped) onSkipped();
        else onSaved(t("skillMarket.publication.skipped"));
        onClose();
        return;
      }
      if (!draft || pending || !changes.length || !notes.trim()) return;
      const versionProblem = upgradeVersionErrorKey(undefined, version);
      if (versionProblem) {
        setError(t(versionProblem));
        return;
      }
      const chosen = new Map(
        changes.map((u) => [u.plugin_id, u.target_version_id])
      );
      const payload: PublicationWrite = {
        ...draft,
        changelog: notes,
        plugin: { ...draft.plugin, version },
        relations: draft.relations.map((r) => ({
          ...r,
          ...(r.relation_type !== "expert_connector" &&
          chosen.has(r.target_plugin_id)
            ? { target_version_id: chosen.get(r.target_plugin_id) }
            : {}),
        })),
      };
      const result = await PublicationService.adoptUpdates(
        base,
        pluginId,
        source,
        payload,
        changes
      );
      if (token !== generation.current) return;
      notifyReviewsChanged();
      onSaved(
        t(
          result.display_status === "pending_review"
            ? "skillMarket.review.submittedToast"
            : "skillMarket.plugin.publishedToast"
        )
      );
      onClose();
    } catch (err) {
      if (token === generation.current)
        setError(
          err instanceof Error
            ? err.message
            : extractErrorMsg(err) || t("skillMarket.form.saveFailed")
        );
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  return (
    <WKModal
      visible
      title={t("skillMarket.publication.viewUpdates")}
      onCancel={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <WKButton
            variant="ghost"
            disabled={busy || !source?.updates.some((u) => !u.is_skipped)}
            onClick={() => void run(true)}
          >
            {t("skillMarket.publication.skip")}
          </WKButton>
          <WKButton variant="secondary" onClick={onClose} disabled={busy}>
            {t("skillMarket.common.cancel")}
          </WKButton>
          {!pending && (
            <WKButton
              variant="primary"
              disabled={
                busy ||
                !draft ||
                !changes.length ||
                !version.trim() ||
                !notes.trim()
              }
              loading={busy}
              onClick={() => void run(false)}
            >
              {t("skillMarket.publication.confirmUpdate")}
            </WKButton>
          )}
        </>
      }
    >
      <div className="skill-market-form">
        {error && (
          <p role="alert" className="skill-market-form__error">
            {error}
          </p>
        )}
        {!source && !error && <p>{t("skillMarket.common.loading")}</p>}
        {source && (
          <>
            {pending && <p>{t("skillMarket.review.pendingBlocksEdit")}</p>}
            {source.updates.length === 0 && (
              <p>{t("skillMarket.publication.noUpdates")}</p>
            )}
            {source.updates.map((u: DependencyUpdate) => (
              <label key={u.plugin_id}>
                <input
                  type="checkbox"
                  checked={!!selected[u.plugin_id]}
                  onChange={(e) =>
                    setSelected((old) => ({
                      ...old,
                      [u.plugin_id]: e.target.checked,
                    }))
                  }
                  disabled={busy || pending}
                />
                <span>
                  {u.name} · v{u.from_version} → v{u.target_version}
                </span>
              </label>
            ))}
            {!pending && (
              <>
                <p className="skill-market-form__hint">
                  {t("skillMarket.publication.includesDraft")}
                </p>
                <label>
                  <span>{t("skillMarket.form.versionLabel")}</span>
                  <WKInput
                    value={version}
                    onChange={setVersion}
                    disabled={busy}
                  />
                </label>
                <label>
                  <span>{t("skillMarket.form.changelogLabel")}</span>
                  <WKInput value={notes} onChange={setNotes} disabled={busy} />
                </label>
              </>
            )}
          </>
        )}
      </div>
    </WKModal>
  );
}

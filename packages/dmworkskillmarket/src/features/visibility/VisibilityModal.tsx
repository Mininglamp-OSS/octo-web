import React, { useEffect, useRef, useState } from "react";
import {
  extractErrorMsg,
  t,
  useI18n,
  WKApp,
  WKButton,
  WKModal,
} from "@octo/base";
import {
  getPublishedAudience,
  type PublishedAudience,
} from "../../api/skillApi";

import {
  PublicationService,
  type VisibilityPlan,
} from "../../Service/PublicationService";
import { resolveSkillMarketApiBaseURL } from "../../api/constants";

interface Props {
  target?: "private" | "space";
  pluginId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Audience management is separate from editing or upgrading released content. */
export default function VisibilityModal({
  pluginId,
  target,
  onClose,
  onSaved,
}: Props) {
  useI18n();
  const [plan, setPlan] = useState<VisibilityPlan | null>(null);
  const planGeneration = useRef(0);
  const [source, setSource] = useState<PublishedAudience | null>(null);
  const [visibility, setVisibility] = useState<"private" | "space">("private");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    if (!pluginId) return;
    const close = () => {
      generation.current++;
      onClose();
    };
    WKApp.mittBus.on("space-changed", close);
    return () => WKApp.mittBus.off("space-changed", close);
  }, [onClose, pluginId]);
  useEffect(() => {
    const current = ++generation.current;
    setSource(null);
    setError(null);
    setBusy(false);
    if (pluginId)
      void getPublishedAudience(pluginId)
        .then((value) => {
          if (current !== generation.current) return;
          setSource(value);
          setVisibility(target ?? value.visibility);
        })
        .catch((err) => {
          if (current === generation.current)
            setError(
              err instanceof Error
                ? err.message
                : extractErrorMsg(err) || t("skillMarket.common.loadFailed")
            );
        });
    return () => {
      generation.current++;
    };
  }, [pluginId, target, attempt]);
  useEffect(() => {
    const token = ++planGeneration.current;
    setPlan(null);
    if (!pluginId || !source || visibility === source.visibility) return;
    void PublicationService.getVisibilityPlan(
      resolveSkillMarketApiBaseURL(),
      pluginId,
      visibility
    )
      .then((value) => {
        if (token === planGeneration.current) setPlan(value);
      })
      .catch((err) => {
        if (token === planGeneration.current)
          setError(
            err instanceof Error
              ? err.message
              : extractErrorMsg(err) || t("skillMarket.common.loadFailed")
          );
      });
    return () => {
      planGeneration.current++;
    };
  }, [pluginId, source, visibility]);
  const save = async () => {
    if (
      !pluginId ||
      !source ||
      !plan ||
      plan.blockers.length > 0 ||
      busy ||
      visibility === source.visibility
    )
      return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await PublicationService.changeVisibility(
        resolveSkillMarketApiBaseURL(),
        pluginId,
        visibility,
        plan.plan_revision
      );
      if (current !== generation.current) return;
      onSaved(
        t(
          result.display_status === "pending_review"
            ? "skillMarket.visibility.submitted"
            : "skillMarket.visibility.saved"
        )
      );
      onClose();
    } catch (err) {
      if (current === generation.current)
        setError(
          err instanceof Error
            ? err.message
            : extractErrorMsg(err) || t("skillMarket.form.saveFailed")
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  return (
    <WKModal
      visible={Boolean(pluginId)}
      title={t("skillMarket.visibility.title")}
      onCancel={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <WKButton variant="secondary" disabled={busy} onClick={onClose}>
            {t("skillMarket.common.cancel")}
          </WKButton>
          <WKButton
            variant="primary"
            loading={busy}
            disabled={
              !source ||
              !plan ||
              plan.blockers.length > 0 ||
              busy ||
              visibility === source.visibility
            }
            onClick={() => void save()}
          >
            {t(
              visibility === "space"
                ? "skillMarket.publication.submitScope"
                : "skillMarket.publication.confirmScope"
            )}
          </WKButton>
        </>
      }
    >
      <div className="skill-market-form">
        {error && (
          <p className="skill-market-form__error" role="alert">
            {error}
            {!source && (
              <WKButton onClick={() => setAttempt((n) => n + 1)}>
                {t("skillMarket.list.retry")}
              </WKButton>
            )}
          </p>
        )}
        {!source && !error && <p>{t("skillMarket.common.loading")}</p>}
        {source && (
          <>
            <strong>{source.name}</strong>
            <p className="skill-market-form__hint">
              {t("skillMarket.publication.scopeNotice")}
            </p>
            <p>
              {t(
                source.visibility === "private"
                  ? "skillMarket.plugin.visibilityPrivate"
                  : "skillMarket.plugin.visibilitySpace"
              )}{" "}
              →{" "}
              {t(
                visibility === "private"
                  ? "skillMarket.plugin.visibilityPrivate"
                  : "skillMarket.plugin.visibilitySpace"
              )}
            </p>
            {plan && (
              <>
                {plan.changes.some((c) => c.plugin_id !== pluginId) && (
                  <section>
                    <p>{t("skillMarket.publication.scopeLinked")}</p>
                    <ul>
                      {plan.changes
                        .filter((c) => c.plugin_id !== pluginId)
                        .map((c) => (
                          <li key={c.plugin_id}>
                            {c.name ||
                              t("skillMarket.publication.privateAffected")}
                          </li>
                        ))}
                    </ul>
                  </section>
                )}
                {plan.affected.length > 0 && (
                  <section>
                    <p>{t("skillMarket.publication.scopeAffected")}</p>
                    <ul>
                      {plan.affected.map((c) => (
                        <li key={c.plugin_id}>
                          {c.name ||
                            t("skillMarket.publication.privateAffected")}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {plan.blockers.map((b, i) => (
                  <p role="alert" key={`${b.plugin_id}-${i}`}>
                    {b.name} · {t("skillMarket.visibility.unavailable")}
                  </p>
                ))}
              </>
            )}
            <div className="skill-market-scope-options">
              {(["private", "space"] as const).map((option) => (
                <label
                  key={option}
                  className={visibility === option ? "is-selected" : ""}
                >
                  <input
                    type="radio"
                    name="published-visibility"
                    value={option}
                    checked={visibility === option}
                    disabled={busy}
                    onChange={() => setVisibility(option)}
                  />
                  <div>
                    <strong>
                      {t(
                        option === "private"
                          ? "skillMarket.plugin.visibilityPrivate"
                          : "skillMarket.plugin.visibilitySpace"
                      )}
                    </strong>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </WKModal>
  );
}

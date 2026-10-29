import React, { useEffect, useRef, useState } from "react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import {
  getPublishedAudience,
  changePublishedAudience,
  type PublishedAudience,
} from "../../api/skillApi";

interface Props {
  pluginId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Audience management is separate from editing or upgrading released content. */
export default function VisibilityModal({ pluginId, onClose, onSaved }: Props) {
  useI18n();
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
          setVisibility(value.visibility);
        })
        .catch((err) => {
          if (current === generation.current)
            setError(
              err instanceof Error
                ? err.message
                : t("skillMarket.common.loadFailed")
            );
        });
    return () => {
      generation.current++;
    };
  }, [pluginId, attempt]);
  const save = async () => {
    if (!pluginId || !source || busy || visibility === source.visibility)
      return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await changePublishedAudience(
        pluginId,
        source.publishedVersionId,
        visibility
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
          err instanceof Error ? err.message : t("skillMarket.form.saveFailed")
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
            disabled={!source || busy || visibility === source.visibility}
            onClick={() => void save()}
          >
            {t("skillMarket.common.save")}
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
              {t("skillMarket.visibility.hint")}
            </p>
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

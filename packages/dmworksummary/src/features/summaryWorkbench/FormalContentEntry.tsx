import React, { Suspense, lazy, useEffect, useState } from "react";
import { WKButton, useI18n } from "@octo/base";
import summaryWorkbenchService from "../../Service/SummaryWorkbenchService";
import type { SummaryFormalContent } from "../../Service/SummaryContentContract";
import { formalErrorKey } from "../../bridge/summaryWorkbench/useFormalContent";
import useCurrentSummarySpaceId from "./useCurrentSummarySpaceId";

const FormalContentFeature = lazy(() => import("./FormalContentFeature"));
interface EntryProps {
  taskId: number; title: string; managed: boolean; renderLegacy: () => React.ReactNode;
}

/** A managed task never falls back to legacy mutation controls on read errors. */
export function FormalContentEntry(props: EntryProps) {
  const spaceId = useCurrentSummarySpaceId();
  const { t } = useI18n();
  if (!spaceId) return props.managed ? <p role="alert">{t("summary.formal.errors.unavailable")}</p> : <>{props.renderLegacy()}</>;
  return <ScopedFormalContentEntry key={`${spaceId}:${props.taskId}`} {...props} spaceId={spaceId} />;
}

function ScopedFormalContentEntry({ spaceId, taskId, title, managed, renderLegacy }: EntryProps & { spaceId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ kind: "loading" | "legacy" | "error"; error?: string } | { kind: "formal"; content: SummaryFormalContent }>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setState({ kind: "loading" });
    void summaryWorkbenchService.formalContents.loadContents(taskId, { spaceId, signal: abort.signal })
      .then((catalog) => {
        if (abort.signal.aborted) return;
        const main = catalog.contents.find((content) => content.is_main);
        if (!main) { setState({ kind: "error", error: "summary.formal.errors.unavailable" }); return; }
        setState(managed || main.capabilities.can_configure_schedule || main.capabilities.can_refine
          ? { kind: "formal", content: main } : { kind: "legacy" });
      }).catch((error: unknown) => {
        if (abort.signal.aborted) return;
        const fields = error && typeof error === "object" ? Object.fromEntries(Object.entries(error)) : {};
        const status = fields.http_status ?? fields.status;
        if (!managed && status === 404) setState({ kind: "legacy" });
        else setState({ kind: "error", error: formalErrorKey(error) });
      });
    return () => abort.abort();
  }, [spaceId, taskId, managed, retry]);
  if (state.kind === "legacy") return <>{renderLegacy()}</>;
  const loading = <p role="status">{t("summary.formal.loading")}</p>;
  if (state.kind === "formal") return <Suspense fallback={loading}>
    <FormalContentFeature taskId={taskId} title={title} spaceId={spaceId} initial={state.content} />
  </Suspense>;
  return <section className="wk-summary-formal" aria-label={title}>
    <h2>{title}</h2>
    <p role={state.kind === "error" ? "alert" : "status"}>{t(state.kind === "error" ? state.error ?? "summary.formal.errors.request" : "summary.formal.loading")}</p>
    {state.kind === "error" && <WKButton onClick={() => setRetry((value: number) => value + 1)}>{t("summary.common.retry")}</WKButton>}
  </section>;
}

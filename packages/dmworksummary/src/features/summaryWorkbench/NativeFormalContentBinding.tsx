import React, { useEffect, useMemo, useRef, useState } from "react";
import summaryWorkbenchService from "../../Service/SummaryWorkbenchService";
import type { SummaryFormalContent } from "../../Service/SummaryContentContract";
import useFormalContent, { formalErrorKey } from "../../bridge/summaryWorkbench/useFormalContent";
import useCurrentSummarySpaceId from "./useCurrentSummarySpaceId";

export type FormalController = ReturnType<typeof useFormalContent>;
export interface NativeFormalBinding {
  taskId: number;
  status: "loading" | "legacy" | "error" | "ready";
  controller?: FormalController;
  errorKey?: string;
  retry: () => void;
}
interface Props {
  taskId: number;
  managed: boolean;
  onChange: (binding: NativeFormalBinding) => void;
}

/** Headless integration: the existing Octo detail remains mounted in every state. */
export function NativeFormalContentBinding(props: Props) {
  const spaceId = useCurrentSummarySpaceId();
  return <ScopedBinding key={`${spaceId}:${props.taskId}`} {...props} spaceId={spaceId || ""} />;
}

function ScopedBinding({ taskId, managed, spaceId, onChange }: Props & { spaceId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [initial, setInitial] = useState<SummaryFormalContent | null>(null);
  const retry = useMemo(() => () => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    setInitial(null);
    onChange({ taskId, status: "loading", retry });
    if (!spaceId) {
      onChange({ taskId, status: managed ? "error" : "legacy", errorKey: "summary.formal.errors.unavailable", retry });
      return () => abort.abort();
    }
    void summaryWorkbenchService.formalContents.loadContents(taskId, { spaceId, signal: abort.signal })
      .then((catalog) => {
        if (abort.signal.aborted) return;
        const main = catalog.contents.find((item) => item.is_main);
        if (!main) throw new Error("missing_main_content");
        if (managed || main.capabilities.can_configure_schedule || main.capabilities.can_refine) setInitial(main);
        else onChange({ taskId, status: "legacy", retry });
      }).catch((error: unknown) => {
        if (abort.signal.aborted) return;
        const fields = error && typeof error === "object" ? Object.fromEntries(Object.entries(error)) : {};
        onChange({ taskId, retry,
          status: !managed && (fields.http_status ?? fields.status) === 404 ? "legacy" : "error",
          errorKey: formalErrorKey(error) });
      });
    return () => abort.abort();
  }, [taskId, managed, spaceId, attempt, onChange, retry]);
  return initial ? <PublishController taskId={taskId} spaceId={spaceId} initial={initial} onChange={onChange} retry={retry} /> : null;
}

function PublishController({ taskId, spaceId, initial, onChange, retry }: {
  taskId: number; spaceId: string; initial: SummaryFormalContent;
  onChange: Props["onChange"]; retry: () => void;
}) {
  const controller = useFormalContent(spaceId, taskId, initial);
  const latest = useRef(controller);
  latest.current = controller;
  // Stable action delegates prevent parent/child update loops, while every
  // invocation still uses the latest scope, revision and pending fence.
  const actions = useMemo(() => ({
    reload: () => latest.current.reload(),
    loadConfiguration: () => latest.current.loadConfiguration(),
    saveConfiguration: (...args: Parameters<FormalController["saveConfiguration"]>) => latest.current.saveConfiguration(...args),
    refine: (...args: Parameters<FormalController["refine"]>) => latest.current.refine(...args),
    regenerate: () => latest.current.regenerate(),
    edit: (...args: Parameters<FormalController["edit"]>) => latest.current.edit(...args),
    restore: (...args: Parameters<FormalController["restore"]>) => latest.current.restore(...args),
    loadVersions: (...args: Parameters<FormalController["loadVersions"]>) => latest.current.loadVersions(...args),
    cancel: () => latest.current.cancel(),
    apply: (...args: Parameters<FormalController["apply"]>) => latest.current.apply(...args),
  }), []);
  const { content, configuration, versions, cursor, pending, errorKey, noticeKey, accessLost } = controller;
  useEffect(() => {
    onChange({ taskId, retry, status: accessLost ? "error" : "ready", errorKey,
      controller: accessLost ? undefined : {
        content, configuration, versions, cursor, pending, errorKey, noticeKey, accessLost, ...actions,
      } });
  }, [taskId, retry, onChange, content, configuration, versions, cursor, pending, errorKey, noticeKey, accessLost, actions]);
  return null;
}

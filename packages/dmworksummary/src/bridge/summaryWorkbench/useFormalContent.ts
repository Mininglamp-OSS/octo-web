import { useCallback, useEffect, useRef, useState } from "react";
import summaryWorkbenchService from "../../Service/SummaryWorkbenchService";
import type { SummaryContentService } from "../../Service/SummaryContentService";
import type {
  SummaryFormalContent, SummaryFormalVersion, SummaryGenerationConfiguration, SummaryContentGeneration,
  SummarySaveConfigurationRequest,
  SummaryContentBaseline,
} from "../../Service/SummaryContentContract";
import { formalContentBaseline } from "./formalContent";

export function formalErrorKey(error: unknown): string {
  if (error && typeof error === "object") {
    const e = Object.fromEntries(Object.entries(error));
    const status = e.http_status ?? e.status;
    if (status === 403 || status === 404) return "summary.formal.errors.unavailable";
    if (status === 409) return "summary.formal.errors.conflict";
  }
  return "summary.formal.errors.request";
}

export default function useFormalContent(
  spaceId: string, taskId: number, initial: SummaryFormalContent,
  service: SummaryContentService = summaryWorkbenchService.formalContents
) {
  const [content, setContent] = useState(initial);
  const [configuration, setConfiguration] = useState<SummaryGenerationConfiguration | null>(null);
  const [versions, setVersions] = useState<SummaryFormalVersion[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState("");
  const [noticeKey, setNoticeKey] = useState("");
  const [pending, setPending] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const scope = `${spaceId}:${taskId}:${initial.content_id}`;
  const scopeRef = useRef(scope);
  const controller = useRef(new AbortController());
  const pendingRef = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  scopeRef.current = scope;

  useEffect(() => {
    controller.current = new AbortController();
    retryKeys.current.clear();
    pendingRef.current = false;
    setContent(initial); setConfiguration(null); setVersions([]); setCursor(null);
    setErrorKey(""); setNoticeKey(""); setPending(false);
    setAccessLost(false);
    return () => { controller.current.abort(); };
  }, [scope]);

  const options = () => ({ spaceId, signal: controller.current.signal });
  const currentScope = (signal: AbortSignal) => scopeRef.current === scope && !signal.aborted;
  const refresh = useCallback(async () => {
    const signal = controller.current.signal;
    const catalog = await service.loadContents(taskId, { spaceId, signal });
    if (!currentScope(signal)) return;
    const next = catalog.contents.find((item) => item.content_id === initial.content_id);
    if (!next) throw { http_status: 404, code: "content_unavailable" };
    setContent(next);
    return next;
  }, [spaceId, taskId, initial.content_id, service]);

  const activeId = content.active_generation?.generation_id;
  useEffect(() => {
    if (!activeId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch (error) {
        if (!disposed) {
          const key = formalErrorKey(error);
          setErrorKey(key);
          if (key === "summary.formal.errors.unavailable") { setAccessLost(true); return; }
        }
      }
      if (!disposed) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1500);
    return () => { disposed = true; clearTimeout(timer); };
  }, [activeId, refresh]);

  const perform = async (operation: () => Promise<void>) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true); setErrorKey(""); setNoticeKey("");
    const signal = controller.current.signal;
    try {
      await operation();
      return currentScope(signal);
    } catch (error) {
      if (currentScope(signal)) {
        const key = formalErrorKey(error);
        setErrorKey(key);
        if (key === "summary.formal.errors.unavailable") setAccessLost(true);
      }
      return false;
    } finally {
      if (currentScope(signal)) { pendingRef.current = false; setPending(false); }
    }
  };
  const baseline = () => {
    const value = formalContentBaseline(content);
    if (!value) throw new Error("content_baseline_required");
    return value;
  };
  const keyFor = (request: unknown) => {
    const digest = JSON.stringify(request);
    const previous = retryKeys.current.get(digest);
    if (previous) return previous;
    const key = crypto.randomUUID();
    retryKeys.current.set(digest, key);
    return key;
  };
  const acceptGeneration = (run: SummaryContentGeneration, request: unknown, signal: AbortSignal) => {
    if (!currentScope(signal)) return;
    // The command has been acknowledged. Retain the run before reloading so
    // a failed GET cannot lose polling or expose stale write capabilities.
    retryKeys.current.delete(JSON.stringify(request));
    const active = run.status === "pending" || run.status === "running";
    setContent((value: SummaryFormalContent) => ({
      ...value, active_generation: active ? run : null, latest_generation: run,
      capabilities: active ? { ...value.capabilities, can_edit: false, can_refine: false, can_regenerate_direct: false } : value.capabilities,
    }));
  };
  const reload = () => perform(async () => { await refresh(); });
  const loadConfiguration = () => perform(async () => {
    const opts = options();
    const config = await service.loadConfiguration(taskId, initial.content_id, opts);
    if (currentScope(opts.signal)) setConfiguration(config);
  });
  const saveConfiguration = (request: SummarySaveConfigurationRequest, generate = false) => perform(async () => {
    const opts = options();
    const identity = generate ? ["configure", request, baseline()] : null;
    const value = {
      ...request,
      ...(generate ? { generate: {
        ...baseline(), expected_config_revision: request.expected_config_revision,
        idempotency_key: keyFor(identity),
      } } : {}),
    };
    const saved = await service.saveConfiguration(taskId, initial.content_id, value, opts);
    if (!currentScope(opts.signal)) return;
    setConfiguration(saved.configuration);
    if (saved.generation) acceptGeneration(saved.generation, identity, opts.signal);
    // Surface a successful save even if the follow-up read temporarily fails.
    setNoticeKey(content.active_generation ? "summary.formal.savedNextRun" : "summary.formal.saved");
    await refresh();
  });
  const refine = (feedback: string) => perform(async () => {
    const base = baseline(), opts = options(), identity = ["refine", base, feedback];
    const run = await service.refineCurrent(taskId, { ...base, feedback, idempotency_key: keyFor(identity) }, opts);
    if (!currentScope(opts.signal)) return;
    acceptGeneration(run, identity, opts.signal);
    await refresh();
  });
  const regenerate = (requirementOverride?: string) => perform(async () => {
    const base = baseline(), opts = options();
    const override = requirementOverride?.trim() || undefined;
    // The override folds into the idempotency identity so a retry with a new
    // topic is a distinct run, while a repeat with the same topic is idempotent.
    const identity = ["regenerate", base, content.generation_config.revision, override ?? null];
    const run = await service.regenerateCurrent(taskId, {
      ...base, expected_config_revision: content.generation_config.revision,
      idempotency_key: keyFor(identity),
      ...(override ? { requirement_override: override } : {}),
    }, opts);
    if (!currentScope(opts.signal)) return;
    acceptGeneration(run, identity, opts.signal);
    await refresh();
  });
  const edit = (body: string, expected?: SummaryContentBaseline) => perform(async () => {
    await service.editCurrent(taskId, expected ?? baseline(), body, options()); await refresh();
  });
  const restore = (id: string) => perform(async () => {
    const opts = options();
    await service.restoreCurrent(taskId, baseline(), id, opts); await refresh();
    if (currentScope(opts.signal)) { setVersions([]); setCursor(null); }
  });
  const loadVersions = (more = false) => perform(async () => {
    const opts = options();
    const result = await service.loadVersions(taskId, initial.content_id, opts, { cursor: more ? cursor ?? "" : "" });
    if (!currentScope(opts.signal)) return;
    setVersions((items: SummaryFormalVersion[]) => more ? [...items, ...result.items.filter((v) => !items.some((old: SummaryFormalVersion) => old.version_id === v.version_id))] : result.items);
    setCursor(result.next_cursor);
  });
  const cancel = () => perform(async () => {
    if (!content.active_generation) return;
    await service.cancelGeneration(taskId, initial.content_id, content.active_generation.generation_id, options());
    await refresh();
  });
  const apply = (generationId: string) => perform(async () => {
    const opts = options();
    await service.applyCandidate(taskId, baseline(), generationId, opts); await refresh();
    if (currentScope(opts.signal)) { setVersions([]); setCursor(null); }
  });
  return {
    content, configuration, versions, cursor, pending, errorKey, noticeKey, accessLost,
    reload, loadConfiguration, saveConfiguration, refine, regenerate, edit, restore, loadVersions, cancel, apply,
  };
}

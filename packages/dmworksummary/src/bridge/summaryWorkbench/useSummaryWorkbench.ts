import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@octo/base";
import type {
  AgentProgressEvent,
  CreateAgentSummaryResult,
} from "../../types/summary";
import summaryWorkbenchService, {
  type SummaryWorkbenchMessageInput,
  type SummaryWorkbenchService,
} from "../../Service/SummaryWorkbenchService";
import { genRequestId, genSessionId } from "../../utils/summaryHelpers";
import { contextItemsFromScope } from "./adapter";
import type { SummaryWorkbenchHistoryHydration } from "./adapter";
import {
  applySummaryResponse,
  attachSummaryMessageProcess,
  canSaveCurrentPreview,
  createInitialSummaryWorkbenchModel,
  deriveSummaryWorkbenchView,
  isTeamProposalConfirmable,
  markCurrentSummaryPreviewSaved,
  updateSummaryComposer,
  updateSummaryScope,
  type SummaryWorkbenchMessage,
  type SummaryWorkbenchModel,
  type SummaryWorkbenchResponse,
} from "./model";
import {
  SummaryWorkspaceApiError,
  serializeSummaryWorkbenchScope,
  type SummaryWorkbenchScope,
  type SummaryWorkspaceChatAction,
  type SummaryWorkspaceInputOrigin,
} from "./protocol";

export type SummaryWorkbenchControllerService = Pick<
  SummaryWorkbenchService,
  | "sendMessage"
  | "streamMessage"
  | "loadSession"
  | "confirmWorkflow"
  | "savePreview"
>;

export interface UseSummaryWorkbenchOptions {
  initialSessionId?: string;
  initialScope?: SummaryWorkbenchScope;
  layout?: SummaryWorkbenchModel["layout"];
  autoHydrate?: boolean;
  preferStreaming?: boolean;
  service?: SummaryWorkbenchControllerService;
  createSessionId?: () => string;
  createRequestId?: () => string;
  createIdempotencyKey?: () => string;
  onSessionIdChange?: (sessionId: string) => void;
  workflowPollIntervalMs?: number;
}

export interface SummaryWorkbenchResetOptions {
  sessionId?: string;
  scope?: SummaryWorkbenchScope;
}

export type SummaryWorkbenchScopeInput =
  | SummaryWorkbenchScope
  | ((current: SummaryWorkbenchScope) => SummaryWorkbenchScope);

export interface SummaryWorkbenchController {
  sessionId: string;
  scope: SummaryWorkbenchScope;
  model: SummaryWorkbenchModel;
  viewState: ReturnType<typeof deriveSummaryWorkbenchView>;
  progressEvents: AgentProgressEvent[];
  latestProgress: AgentProgressEvent | null;
  isHydrating: boolean;
  isConfirming: boolean;
  isSaving: boolean;
  error: SummaryWorkspaceApiError | null;
  savedSummary: CreateAgentSummaryResult | null;
  setComposerValue: (value: string) => void;
  restoreComposerValue: (value: string) => void;
  updateScope: (scope: SummaryWorkbenchScopeInput) => boolean;
  send: (
    message?: string,
    inputOrigin?: SummaryWorkspaceInputOrigin,
    action?: SummaryWorkspaceChatAction
  ) => Promise<SummaryWorkbenchResponse | undefined>;
  confirmWorkflow: () => Promise<SummaryWorkbenchResponse | undefined>;
  savePreview: (
    title?: string
  ) => Promise<CreateAgentSummaryResult | undefined>;
  hydrateSession: (sessionId?: string) => Promise<boolean>;
  resetSession: (options?: SummaryWorkbenchResetOptions) => string;
  cancelActiveRequest: () => void;
  clearError: () => void;
}

interface RuntimeState {
  sessionId: string;
  scope: SummaryWorkbenchScope;
  model: SummaryWorkbenchModel;
  progressEvents: AgentProgressEvent[];
  isHydrating: boolean;
  isConfirming: boolean;
  isSaving: boolean;
  error: SummaryWorkspaceApiError | null;
  savedSummary: CreateAgentSummaryResult | null;
  previewRequest:
    | {
        messageId: string;
        requestId: string;
      }
    | undefined;
}

interface GenerationFlight {
  epoch: number;
  input: SummaryWorkbenchMessageInput;
  message: string;
  restoreComposer: boolean;
  fallbackStarted: boolean;
  stream?: { close: () => void };
  fallbackController?: AbortController;
  promise: Promise<SummaryWorkbenchResponse | undefined>;
  resolve: (response: SummaryWorkbenchResponse | undefined) => void;
}

interface RetryableGeneration {
  identity: string;
  requestId: string;
}

interface MutationFlight<T> {
  epoch: number;
  identity: string;
  controller: AbortController;
  promise: Promise<T | undefined>;
}

interface HydrationFlight {
  epoch: number;
  sessionId: string;
  controller: AbortController;
  promise: Promise<boolean>;
}

const EMPTY_SCOPE: SummaryWorkbenchScope = {
  selectedChannels: [],
  participants: [],
  template: null,
  timeRange: null,
  referencedTaskIds: [],
};

export const DEFAULT_SUMMARY_WORKFLOW_POLL_INTERVAL_MS = 3_000;
const MAX_SUMMARY_WORKFLOW_POLL_FAILURES = 5;
const MAX_SUMMARY_WORKFLOW_POLL_BACKOFF_MS = 30_000;

export default function useSummaryWorkbench(
  options: UseSummaryWorkbenchOptions = {}
): SummaryWorkbenchController {
  const serviceRef = useRef<SummaryWorkbenchControllerService>(
    options.service ?? summaryWorkbenchService
  );
  const createSessionIdRef = useRef(options.createSessionId ?? genSessionId);
  const createRequestIdRef = useRef(options.createRequestId ?? genRequestId);
  const createIdempotencyKeyRef = useRef(
    options.createIdempotencyKey ?? genRequestId
  );
  const onSessionIdChangeRef = useRef(options.onSessionIdChange);
  const preferStreamingRef = useRef(options.preferStreaming ?? true);
  const workflowPollIntervalMsRef = useRef(
    options.workflowPollIntervalMs ?? DEFAULT_SUMMARY_WORKFLOW_POLL_INTERVAL_MS
  );
  const initialScopeRef = useRef(
    cloneScope(options.initialScope ?? EMPTY_SCOPE)
  );
  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const operationVersionRef = useRef(0);
  const generationRef = useRef<GenerationFlight | null>(null);
  const retryableGenerationRef = useRef<RetryableGeneration | null>(null);
  const confirmationRef =
    useRef<MutationFlight<SummaryWorkbenchResponse> | null>(null);
  const saveRef = useRef<MutationFlight<CreateAgentSummaryResult> | null>(null);
  const hydrationRef = useRef<HydrationFlight | null>(null);
  const idempotencyKeysRef = useRef(new Map<string, string>());
  const initializedRef = useRef<RuntimeState | null>(null);

  serviceRef.current = options.service ?? summaryWorkbenchService;
  onSessionIdChangeRef.current = options.onSessionIdChange;
  preferStreamingRef.current = options.preferStreaming ?? true;
  workflowPollIntervalMsRef.current = Math.max(
    1,
    options.workflowPollIntervalMs ?? DEFAULT_SUMMARY_WORKFLOW_POLL_INTERVAL_MS
  );

  if (!initializedRef.current) {
    const scope = cloneScope(initialScopeRef.current);
    initializedRef.current = createRuntimeState(
      normalizeSessionId(options.initialSessionId) ||
        createSessionIdRef.current(),
      scope,
      createInitialSummaryWorkbenchModel({
        layout: options.layout,
        contextItems: contextItemsFromScope(scope),
      })
    );
  }

  const [runtime, setRuntime] = useState<RuntimeState>(initializedRef.current);
  const runtimeRef = useRef(runtime);

  const commit = useCallback(
    (update: (current: RuntimeState) => RuntimeState): RuntimeState => {
      const next = update(runtimeRef.current);
      runtimeRef.current = next;
      if (mountedRef.current) setRuntime(next);
      return next;
    },
    []
  );

  const notifySessionId = useCallback((sessionId: string) => {
    onSessionIdChangeRef.current?.(sessionId);
  }, []);

  const cancelOperations = useCallback(
    (restoreGenerationMessage: boolean) => {
      epochRef.current += 1;
      operationVersionRef.current += 1;

      const hydration = hydrationRef.current;
      hydrationRef.current = null;
      hydration?.controller.abort();

      const generation = generationRef.current;
      generationRef.current = null;
      generation?.stream?.close();
      generation?.fallbackController?.abort();
      generation?.resolve(undefined);

      const confirmation = confirmationRef.current;
      confirmationRef.current = null;
      confirmation?.controller.abort();

      const save = saveRef.current;
      saveRef.current = null;
      save?.controller.abort();

      commit((current: RuntimeState) => ({
        ...current,
        isHydrating: false,
        isConfirming: false,
        isSaving: false,
        model: updateSummaryComposer(current.model, {
          isSending: false,
          ...(restoreGenerationMessage &&
          generation?.restoreComposer &&
          current.model.composer.value.trim() === ""
            ? { value: generation.message }
            : {}),
        }),
      }));
    },
    [commit]
  );

  const clearError = useCallback(() => {
    commit(clearRuntimeError);
  }, [commit]);

  const setComposerValue = useCallback(
    (value: string) => {
      if (value !== runtimeRef.current.model.composer.value) {
        retryableGenerationRef.current = null;
      }
      commit((current: RuntimeState) => ({
        ...clearRuntimeError(current),
        model: updateSummaryComposer(current.model, {
          value,
          errorMessage: undefined,
        }),
      }));
    },
    [commit]
  );

  const restoreComposerValue = useCallback(
    (value: string) => {
      commit((current: RuntimeState) => ({
        ...clearRuntimeError(current),
        model: updateSummaryComposer(current.model, {
          value,
          errorMessage: undefined,
        }),
      }));
    },
    [commit]
  );

  const updateScope = useCallback(
    (input: SummaryWorkbenchScopeInput): boolean => {
      const current = runtimeRef.current;
      const candidate = cloneScope(
        typeof input === "function" ? input(cloneScope(current.scope)) : input
      );
      if (sameSummaryWorkbenchScope(current.scope, candidate)) return false;

      retryableGenerationRef.current = null;
      cancelOperations(true);
      commit((latest: RuntimeState) => {
        const scopeVersion = latest.model.scopeVersion + 1;
        return {
          ...clearRuntimeError(latest),
          scope: candidate,
          savedSummary: null,
          model: updateSummaryComposer(
            updateSummaryScope(latest.model, {
              contextItems: contextItemsFromScope(candidate),
              scopeVersion,
            }),
            { errorMessage: undefined }
          ),
        };
      });
      return true;
    },
    [cancelOperations, commit]
  );

  const send = useCallback(
    (
      messageOverride?: string,
      inputOrigin: SummaryWorkspaceInputOrigin = messageOverride === undefined
        ? "user"
        : "system_intent",
      action: SummaryWorkspaceChatAction = "chat"
    ): Promise<SummaryWorkbenchResponse | undefined> => {
      const existing = generationRef.current;
      if (existing) return existing.promise;
      if (hydrationRef.current || confirmationRef.current || saveRef.current) {
        return Promise.resolve(undefined);
      }

      const current = runtimeRef.current;
      const message = (
        messageOverride === undefined
          ? current.model.composer.value
          : messageOverride
      ).trim();
      if (!message) return Promise.resolve(undefined);

      operationVersionRef.current += 1;
      const retryIdentity = generationRetryIdentity(
        current.sessionId,
        current.scope,
        message,
        inputOrigin,
        action
      );
      const previousAttempt = retryableGenerationRef.current;
      const requestId =
        previousAttempt?.identity === retryIdentity
          ? previousAttempt.requestId
          : createRequestIdRef.current();
      retryableGenerationRef.current = { identity: retryIdentity, requestId };
      const input: SummaryWorkbenchMessageInput = {
        sessionId: current.sessionId,
        message,
        inputOrigin,
        ...(action === "chat" ? {} : { action }),
        requestId,
        scopeVersion: current.model.scopeVersion,
        scope: cloneScope(current.scope),
      };
      const epoch = epochRef.current;
      let resolveFlight!: (
        response: SummaryWorkbenchResponse | undefined
      ) => void;
      const promise = new Promise<SummaryWorkbenchResponse | undefined>(
        (resolve) => {
          resolveFlight = resolve;
        }
      );
      const flight: GenerationFlight = {
        epoch,
        input,
        message,
        restoreComposer: messageOverride === undefined,
        fallbackStarted: false,
        promise,
        resolve: resolveFlight,
      };
      generationRef.current = flight;

      const localMessage: SummaryWorkbenchMessage = {
        id: `local-user:${requestId}`,
        role: "user",
        content: message,
        scopeVersion: input.scopeVersion,
        availableActions: [],
      };
      commit((latest: RuntimeState) => {
        const alreadyRendered = latest.model.messages.some(
          (candidate) => candidate.id === localMessage.id
        );
        return {
          ...latest,
          error: null,
          savedSummary: null,
          progressEvents: [],
          model: {
            ...latest.model,
            messages: alreadyRendered
              ? latest.model.messages
              : [...latest.model.messages, localMessage],
            composer: {
              ...latest.model.composer,
              value:
                messageOverride === undefined
                  ? ""
                  : latest.model.composer.value,
              isSending: true,
              errorMessage: undefined,
            },
          },
        };
      });

      const isCurrent = () =>
        generationRef.current === flight && epochRef.current === flight.epoch;

      const finish = (response: SummaryWorkbenchResponse) => {
        if (!isCurrent()) return;
        generationRef.current = null;
        if (retryableGenerationRef.current?.identity === retryIdentity) {
          retryableGenerationRef.current = null;
        }
        flight.stream?.close();
        const next = commit((latest: RuntimeState) => {
          const completed = applyControllerResponse(
            latest,
            response,
            requestId
          );
          const progressSteps = latest.progressEvents.map((event) => ({
            phase: event.phase,
            ...(event.count === undefined ? {} : { count: event.count }),
          }));
          if (progressSteps.length === 0) return completed;
          return {
            ...completed,
            model: attachSummaryMessageProcess(
              completed.model,
              response.messageId,
              {
                status:
                  response.resultType === "error" ? "failed" : "completed",
                steps: progressSteps,
              }
            ),
          };
        });
        notifySessionId(next.sessionId);
        flight.resolve(response);
      };

      const fail = (reason: unknown) => {
        if (!isCurrent()) return;
        const error = normalizeControllerError(reason);
        generationRef.current = null;
        if (
          !(error.kind === "transport" && error.retryable) &&
          retryableGenerationRef.current?.identity === retryIdentity
        ) {
          retryableGenerationRef.current = null;
        }
        flight.stream?.close();
        flight.fallbackController?.abort();
        if (error.kind !== "abort") {
          commit((latest: RuntimeState) => {
            const failed = updateSummaryComposer(latest.model, {
              isSending: false,
              errorMessage: error.message,
              ...(flight.restoreComposer &&
              latest.model.composer.value.trim() === ""
                ? { value: flight.message }
                : {}),
            });
            const progressSteps = latest.progressEvents.map((event) => ({
              phase: event.phase,
              ...(event.count === undefined ? {} : { count: event.count }),
            }));
            return {
              ...latest,
              error,
              model:
                progressSteps.length === 0
                  ? failed
                  : attachSummaryMessageProcess(failed, localMessage.id, {
                      status: "failed",
                      steps: progressSteps,
                    }),
            };
          });
        } else {
          commit((latest: RuntimeState) => ({
            ...latest,
            model: updateSummaryComposer(latest.model, {
              isSending: false,
            }),
          }));
        }
        flight.resolve(undefined);
      };

      const startJsonRequest = () => {
        if (!isCurrent() || flight.fallbackStarted) return;
        flight.fallbackStarted = true;
        flight.stream?.close();
        const controller = new AbortController();
        flight.fallbackController = controller;
        void serviceRef.current
          .sendMessage(input, { signal: controller.signal })
          .then(finish)
          .catch(fail);
      };

      const handleStreamError = (reason: unknown) => {
        if (!isCurrent() || flight.fallbackStarted) return;
        const error = normalizeControllerError(reason);
        if (
          error.kind === "transport" &&
          error.retryable &&
          !flight.fallbackStarted
        ) {
          startJsonRequest();
          return;
        }
        fail(error);
      };

      if (!preferStreamingRef.current) {
        startJsonRequest();
        return promise;
      }

      try {
        const stream = serviceRef.current.streamMessage(input, {
          onProgress: (event: AgentProgressEvent) => {
            if (!isCurrent() || flight.fallbackStarted) return;
            commit((latest: RuntimeState) => ({
              ...latest,
              progressEvents: [...latest.progressEvents.slice(-49), event],
            }));
          },
          onDone: (response: SummaryWorkbenchResponse) => {
            if (flight.fallbackStarted) return;
            finish(response);
          },
          onError: handleStreamError,
        });
        if (isCurrent() && !flight.fallbackStarted) {
          flight.stream = stream;
        } else {
          stream.close();
        }
      } catch (error) {
        handleStreamError(error);
      }

      return promise;
    },
    [commit, notifySessionId]
  );

  const confirmWorkflow = useCallback((): Promise<
    SummaryWorkbenchResponse | undefined
  > => {
    const existing = confirmationRef.current;
    if (existing) return existing.promise;
    if (generationRef.current || hydrationRef.current || saveRef.current) {
      return Promise.resolve(undefined);
    }

    const current = runtimeRef.current;
    const proposal = current.model.pendingProposal;
    if (!proposal || !isTeamProposalConfirmable(current.model)) {
      return Promise.resolve(undefined);
    }

    operationVersionRef.current += 1;
    const identity = [
      current.sessionId,
      proposal.messageId,
      proposal.proposalVersion,
      proposal.proposalToken,
      proposal.scopeVersion,
    ].join(":");
    const key = idempotencyKeyFor(`confirm:${identity}`);
    const controller = new AbortController();
    const epoch = epochRef.current;
    commit((latest: RuntimeState) => ({
      ...clearRuntimeError(latest),
      isConfirming: true,
    }));

    let flight!: MutationFlight<SummaryWorkbenchResponse>;
    const promise = serviceRef.current
      .confirmWorkflow(
        {
          sessionId: current.sessionId,
          proposalVersion: proposal.proposalVersion,
          proposalToken: proposal.proposalToken,
          scopeVersion: current.model.scopeVersion,
          scope: cloneScope(current.scope),
          idempotencyKey: key,
        },
        { signal: controller.signal }
      )
      .then((response: SummaryWorkbenchResponse) => {
        if (confirmationRef.current !== flight || epochRef.current !== epoch) {
          return undefined;
        }
        const next = commit((latest: RuntimeState) => ({
          ...applyControllerResponse(latest, response),
          isConfirming: false,
        }));
        notifySessionId(next.sessionId);
        return response;
      })
      .catch((reason: unknown) => {
        if (confirmationRef.current !== flight || epochRef.current !== epoch) {
          return undefined;
        }
        const error = normalizeControllerError(reason);
        if (error.kind !== "abort") {
          commit((latest: RuntimeState) => ({
            ...withRuntimeError(latest, error),
            isConfirming: false,
          }));
        }
        return undefined;
      })
      .finally(() => {
        if (confirmationRef.current === flight) {
          confirmationRef.current = null;
          commit((latest: RuntimeState) => ({
            ...latest,
            isConfirming: false,
          }));
        }
      });

    flight = { epoch, identity, controller, promise };
    confirmationRef.current = flight;
    return promise;
  }, [commit, notifySessionId]);

  const savePreview = useCallback(
    (title?: string): Promise<CreateAgentSummaryResult | undefined> => {
      const existing = saveRef.current;
      if (existing) return existing.promise;
      if (
        generationRef.current ||
        hydrationRef.current ||
        confirmationRef.current
      ) {
        return Promise.resolve(undefined);
      }

      const current = runtimeRef.current;
      const preview = current.model.currentPreview;
      if (!preview || !canSaveCurrentPreview(current.model)) {
        return Promise.resolve(undefined);
      }

      operationVersionRef.current += 1;
      const normalizedTitle = title?.trim() || undefined;
      const identity = [
        current.sessionId,
        preview.messageId,
        preview.snapshotVersion,
        preview.scopeVersion,
        preview.version,
        normalizedTitle ?? "",
      ].join(":");
      const key = idempotencyKeyFor(`save:${identity}`);
      const controller = new AbortController();
      const epoch = epochRef.current;
      const generationRequestId =
        current.previewRequest?.messageId === preview.messageId
          ? current.previewRequest.requestId
          : undefined;
      commit((latest: RuntimeState) => ({
        ...clearRuntimeError(latest),
        isSaving: true,
      }));

      let flight!: MutationFlight<CreateAgentSummaryResult>;
      const promise = serviceRef.current
        .savePreview(
          {
            sessionId: current.sessionId,
            messageId: preview.messageId,
            snapshotVersion: preview.snapshotVersion,
            scopeVersion: current.model.scopeVersion,
            artifactVersion: preview.version,
            idempotencyKey: key,
            ...(normalizedTitle ? { title: normalizedTitle } : {}),
            ...(generationRequestId ? { generationRequestId } : {}),
          },
          { signal: controller.signal }
        )
        .then((result: CreateAgentSummaryResult) => {
          if (saveRef.current !== flight || epochRef.current !== epoch) {
            return undefined;
          }
          commit((latest: RuntimeState) => ({
            ...latest,
            isSaving: false,
            savedSummary: result,
            error: null,
            model: markCurrentSummaryPreviewSaved(latest.model),
          }));
          return result;
        })
        .catch((reason: unknown) => {
          if (saveRef.current !== flight || epochRef.current !== epoch) {
            return undefined;
          }
          const error = normalizeControllerError(reason);
          if (error.kind !== "abort") {
            commit((latest: RuntimeState) => ({
              ...withRuntimeError(latest, error),
              isSaving: false,
            }));
          }
          return undefined;
        })
        .finally(() => {
          if (saveRef.current === flight) {
            saveRef.current = null;
            commit((latest: RuntimeState) => ({
              ...latest,
              isSaving: false,
            }));
          }
        });

      flight = { epoch, identity, controller, promise };
      saveRef.current = flight;
      return promise;
    },
    [commit]
  );

  const hydrateSession = useCallback(
    (requestedSessionId?: string): Promise<boolean> => {
      const sessionId =
        normalizeSessionId(requestedSessionId) || runtimeRef.current.sessionId;
      const existing = hydrationRef.current;
      if (existing?.sessionId === sessionId) return existing.promise;

      retryableGenerationRef.current = null;
      cancelOperations(false);
      const controller = new AbortController();
      const epoch = epochRef.current;
      commit((current: RuntimeState) => ({
        ...clearRuntimeError(current),
        sessionId,
        isHydrating: true,
        model: updateSummaryComposer(current.model, {
          isSending: false,
          errorMessage: undefined,
        }),
      }));

      let flight!: HydrationFlight;
      const promise = serviceRef.current
        .loadSession(sessionId, { signal: controller.signal })
        .then((hydration: SummaryWorkbenchHistoryHydration) => {
          if (hydrationRef.current !== flight || epochRef.current !== epoch) {
            return false;
          }
          if (hydration.empty) {
            const nextSessionId = createSessionIdRef.current();
            commit((current: RuntimeState) =>
              createRuntimeState(
                nextSessionId,
                current.scope,
                createInitialSummaryWorkbenchModel({
                  layout: current.model.layout,
                  contextItems: contextItemsFromScope(current.scope),
                })
              )
            );
            notifySessionId("");
            return true;
          }
          const nextSessionId = hydration.sessionId;
          commit((current: RuntimeState) =>
            createRuntimeState(
              nextSessionId,
              cloneScope(hydration.scope),
              createInitialSummaryWorkbenchModel({
                ...hydration.modelOptions,
                layout: current.model.layout,
              })
            )
          );
          notifySessionId(nextSessionId);
          return true;
        })
        .catch((reason: unknown) => {
          if (hydrationRef.current !== flight || epochRef.current !== epoch) {
            return false;
          }
          const error = normalizeControllerError(reason);
          if (error.kind !== "abort") {
            commit((current: RuntimeState) => ({
              ...withRuntimeError(current, error),
              isHydrating: false,
            }));
          }
          return false;
        })
        .finally(() => {
          if (hydrationRef.current === flight) {
            hydrationRef.current = null;
            commit((current: RuntimeState) => ({
              ...current,
              isHydrating: false,
            }));
          }
        });

      flight = { epoch, sessionId, controller, promise };
      hydrationRef.current = flight;
      return promise;
    },
    [cancelOperations, commit, notifySessionId]
  );

  const resetSession = useCallback(
    (resetOptions: SummaryWorkbenchResetOptions = {}): string => {
      cancelOperations(false);
      retryableGenerationRef.current = null;
      idempotencyKeysRef.current.clear();
      const sessionId =
        normalizeSessionId(resetOptions.sessionId) ||
        createSessionIdRef.current();
      const scope = cloneScope(resetOptions.scope ?? initialScopeRef.current);
      commit((current: RuntimeState) =>
        createRuntimeState(
          sessionId,
          scope,
          createInitialSummaryWorkbenchModel({
            layout: current.model.layout,
            contextItems: contextItemsFromScope(scope),
          })
        )
      );
      return sessionId;
    },
    [cancelOperations, commit]
  );

  const cancelActiveRequest = useCallback(() => {
    cancelOperations(true);
  }, [cancelOperations]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelOperations(false);
    };
  }, [cancelOperations]);

  const initialHydrationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const initialSessionId = normalizeSessionId(options.initialSessionId);
    if (
      options.autoHydrate === false ||
      !initialSessionId ||
      initialHydrationRef.current === initialSessionId
    ) {
      return;
    }
    initialHydrationRef.current = initialSessionId;
    void hydrateSession(initialSessionId);
    return () => {
      if (initialHydrationRef.current === initialSessionId) {
        initialHydrationRef.current = undefined;
      }
    };
  }, [hydrateSession, options.autoHydrate, options.initialSessionId]);

  const activeWorkflow = runtime.model.workflow;
  const activeWorkflowTaskId = activeWorkflow?.taskId;
  const activeWorkflowResultType = activeWorkflow?.resultType;
  const shouldPollWorkflow = activeWorkflowResultType === "workflow_started";

  useEffect(() => {
    if (!shouldPollWorkflow || activeWorkflowTaskId === undefined) return;

    const sessionId = runtime.sessionId;
    const taskId = activeWorkflowTaskId;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;

    const scheduleNext = (delay = workflowPollIntervalMsRef.current) => {
      if (!active) return;
      timer = setTimeout(pollAuthoritativeHistory, delay);
    };

    const isSameRunningWorkflow = (current: RuntimeState) => {
      const workflow = current.model.workflow;
      if (!workflow) return false;
      return (
        current.sessionId === sessionId &&
        workflow.taskId === taskId &&
        workflow.resultType === "workflow_started"
      );
    };

    async function pollAuthoritativeHistory() {
      if (!active || controller.signal.aborted) return;
      if (!isSameRunningWorkflow(runtimeRef.current)) return;
      if (
        generationRef.current ||
        hydrationRef.current ||
        confirmationRef.current ||
        saveRef.current
      ) {
        scheduleNext();
        return;
      }

      const operationVersion = operationVersionRef.current;
      try {
        const hydration = await serviceRef.current.loadSession(sessionId, {
          signal: controller.signal,
        });
        consecutiveFailures = 0;
        if (!active || controller.signal.aborted) return;
        if (hydration.empty) {
          const expiredError = new SummaryWorkspaceApiError({
            message: t("summary.workbench.errors.sessionExpired"),
            kind: "business",
            retryable: false,
          });
          const nextSessionId = createSessionIdRef.current();
          commit((current: RuntimeState) => {
            if (!isSameRunningWorkflow(current)) return current;
            const scope = cloneScope(current.scope);
            return withRuntimeError(
              createRuntimeState(
                nextSessionId,
                scope,
                createInitialSummaryWorkbenchModel({
                  layout: current.model.layout,
                  contextItems: contextItemsFromScope(scope),
                })
              ),
              expiredError
            );
          });
          notifySessionId("");
          return;
        }
        if (operationVersionRef.current !== operationVersion) {
          if (isSameRunningWorkflow(runtimeRef.current)) scheduleNext();
          return;
        }

        let continuePolling = false;
        commit((current: RuntimeState) => {
          if (!isSameRunningWorkflow(current)) return current;

          const hydratedModel = createInitialSummaryWorkbenchModel({
            ...hydration.modelOptions,
            layout: current.model.layout,
            // History is authoritative for server state, but a
            // background status refresh must not erase text that
            // the user typed while the request was in flight.
            composer: current.model.composer,
            scopeVersion: current.model.scopeVersion,
            contextItems: current.model.contextItems,
          });
          const hydratedWorkflow = hydratedModel.workflow;
          const latestHydratedMessage =
            hydratedModel.messages[hydratedModel.messages.length - 1];
          const hasTerminalWorkflowError =
            !hydratedWorkflow && latestHydratedMessage?.resultType === "error";
          if (!hydratedWorkflow && !hasTerminalWorkflowError) {
            continuePolling = true;
            return current;
          }
          if (hydratedWorkflow && hydratedWorkflow.taskId !== taskId) {
            continuePolling = true;
            return current;
          }

          continuePolling = Boolean(
            hydratedWorkflow &&
              hydratedWorkflow.resultType === "workflow_started"
          );
          return {
            ...current,
            sessionId: hydration.sessionId,
            model: hydratedModel,
            error: null,
            previewRequest: undefined,
          };
        });

        if (continuePolling) scheduleNext();
      } catch (reason) {
        if (!active || controller.signal.aborted) return;
        const error = normalizeControllerError(reason);
        consecutiveFailures += 1;
        if (
          !error.retryable ||
          consecutiveFailures >= MAX_SUMMARY_WORKFLOW_POLL_FAILURES
        ) {
          commit((current: RuntimeState) =>
            isSameRunningWorkflow(current)
              ? withRuntimeError(current, error)
              : current
          );
          return;
        }
        scheduleNext(
          Math.min(
            workflowPollIntervalMsRef.current * 2 ** consecutiveFailures,
            MAX_SUMMARY_WORKFLOW_POLL_BACKOFF_MS
          )
        );
      }
    }

    scheduleNext();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeWorkflowResultType,
    activeWorkflowTaskId,
    commit,
    notifySessionId,
    runtime.sessionId,
    shouldPollWorkflow,
  ]);

  useEffect(() => {
    commit((current: RuntimeState) => {
      const layout = options.layout ?? "full";
      if (current.model.layout === layout) return current;
      return { ...current, model: { ...current.model, layout } };
    });
  }, [commit, options.layout]);

  const viewState = useMemo(
    () => ({
      ...deriveSummaryWorkbenchView(runtime.model),
      isHydrating: runtime.isHydrating,
      progressSteps: runtime.progressEvents.map(
        (event: AgentProgressEvent) => ({
          phase: event.phase,
          ...(event.count === undefined ? {} : { count: event.count }),
        })
      ),
    }),
    [runtime.isHydrating, runtime.model, runtime.progressEvents]
  );

  function idempotencyKeyFor(identity: string): string {
    const existing = idempotencyKeysRef.current.get(identity);
    if (existing) return existing;
    const key = createIdempotencyKeyRef.current();
    idempotencyKeysRef.current.set(identity, key);
    return key;
  }

  return {
    sessionId: runtime.sessionId,
    scope: runtime.scope,
    model: runtime.model,
    viewState,
    progressEvents: runtime.progressEvents,
    latestProgress:
      runtime.progressEvents[runtime.progressEvents.length - 1] ?? null,
    isHydrating: runtime.isHydrating,
    isConfirming: runtime.isConfirming,
    isSaving: runtime.isSaving,
    error: runtime.error,
    savedSummary: runtime.savedSummary,
    setComposerValue,
    restoreComposerValue,
    updateScope,
    send,
    confirmWorkflow,
    savePreview,
    hydrateSession,
    resetSession,
    cancelActiveRequest,
    clearError,
  };
}

function applyControllerResponse(
  current: RuntimeState,
  response: SummaryWorkbenchResponse,
  requestId?: string
): RuntimeState {
  const model = applySummaryResponse(current.model, response);
  const scope = response.authoritativeState
    ? cloneScope(response.authoritativeState.scope)
    : current.scope;
  let previewRequest = current.previewRequest;
  if (
    response.resultType === "agent_preview" ||
    response.resultType === "agent_revision"
  ) {
    previewRequest = requestId
      ? { messageId: response.messageId, requestId }
      : undefined;
  } else if (
    !model.currentPreview ||
    model.currentPreview.messageId !== previewRequest?.messageId
  ) {
    previewRequest = undefined;
  }

  return {
    ...current,
    sessionId: normalizeSessionId(response.sessionId) || current.sessionId,
    scope,
    model,
    error: null,
    previewRequest,
  };
}

function createRuntimeState(
  sessionId: string,
  scope: SummaryWorkbenchScope,
  model: SummaryWorkbenchModel
): RuntimeState {
  return {
    sessionId,
    scope,
    model,
    progressEvents: [],
    isHydrating: false,
    isConfirming: false,
    isSaving: false,
    error: null,
    savedSummary: null,
    previewRequest: undefined,
  };
}

function clearRuntimeError(current: RuntimeState): RuntimeState {
  return {
    ...current,
    error: null,
    model: updateSummaryComposer(current.model, { errorMessage: undefined }),
  };
}

function withRuntimeError(
  current: RuntimeState,
  error: SummaryWorkspaceApiError
): RuntimeState {
  return {
    ...current,
    error,
    model: updateSummaryComposer(current.model, {
      errorMessage: error.message,
    }),
  };
}

function cloneScope(scope: SummaryWorkbenchScope): SummaryWorkbenchScope {
  return {
    selectedChannels: scope.selectedChannels.map((channel) => ({
      ...channel,
    })),
    participants: scope.participants.map((participant) => ({
      ...participant,
    })),
    template: scope.template ? { ...scope.template } : null,
    timeRange: scope.timeRange ? { ...scope.timeRange } : null,
    referencedTaskIds: [...scope.referencedTaskIds],
  };
}

export function sameSummaryWorkbenchScope(
  left: SummaryWorkbenchScope,
  right: SummaryWorkbenchScope
): boolean {
  return scopeFingerprint(left) === scopeFingerprint(right);
}

function scopeFingerprint(scope: SummaryWorkbenchScope): string {
  const context = serializeSummaryWorkbenchScope(scope);
  context.selected_channels.sort((left, right) =>
    `${left.chat_type}\u0000${left.chat_id}`.localeCompare(
      `${right.chat_type}\u0000${right.chat_id}`
    )
  );
  context.participants.sort((left, right) =>
    left.user_id.localeCompare(right.user_id)
  );
  context.referenced_task_ids.sort((left, right) => left - right);
  return JSON.stringify(context);
}

function generationRetryIdentity(
  sessionId: string,
  scope: SummaryWorkbenchScope,
  message: string,
  inputOrigin: SummaryWorkspaceInputOrigin,
  action: SummaryWorkspaceChatAction
): string {
  return JSON.stringify([
    sessionId,
    scopeFingerprint(scope),
    message,
    inputOrigin,
    action,
  ]);
}

function normalizeSessionId(sessionId: string | undefined): string {
  return sessionId?.trim() ?? "";
}

function normalizeControllerError(error: unknown): SummaryWorkspaceApiError {
  if (error instanceof SummaryWorkspaceApiError) return error;
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "CanceledError")
  ) {
    return new SummaryWorkspaceApiError({
      message: "Summary workspace request was cancelled",
      kind: "abort",
      retryable: false,
    });
  }
  return new SummaryWorkspaceApiError({
    message:
      error instanceof Error
        ? error.message
        : "Summary workspace request failed",
    kind: "transport",
    retryable: true,
  });
}

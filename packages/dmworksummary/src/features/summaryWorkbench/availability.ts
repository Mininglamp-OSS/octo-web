import { useEffect, useState } from "react";
import summaryWorkbenchService from "../../Service/SummaryWorkbenchService";
import {
  SUMMARY_WORKSPACE_CONTRACT_VERSION,
  SummaryWorkspaceApiError,
  type SummaryWorkspaceCapabilitiesDTO,
} from "../../bridge/summaryWorkbench/protocol";

export const DEFAULT_SUMMARY_WORKBENCH_CAPABILITY_TIMEOUT_MS = 5_000;
export const DEFAULT_SUMMARY_WORKBENCH_CAPABILITY_CACHE_TTL_MS = 30_000;

export type SummaryWorkbenchAvailabilityReason =
  | "supported"
  | "missing_space"
  | "server_disabled"
  | "unsupported_contract"
  | "not_found"
  | "timeout"
  | "invalid_response"
  | "unavailable"
  | "aborted";

export interface SummaryWorkbenchEnabledAvailability {
  status: "enabled";
  enabled: true;
  spaceId: string;
  reason: "supported";
  contractVersion: typeof SUMMARY_WORKSPACE_CONTRACT_VERSION;
  maxTimeRangeDays: number;
  checkedAt: number;
}

export interface SummaryWorkbenchDisabledAvailability {
  status: "disabled";
  enabled: false;
  spaceId: string;
  reason: Exclude<SummaryWorkbenchAvailabilityReason, "supported">;
  contractVersion?: string;
  checkedAt: number;
}

export type SummaryWorkbenchAvailabilityDecision =
  | SummaryWorkbenchEnabledAvailability
  | SummaryWorkbenchDisabledAvailability;

export interface SummaryWorkbenchLoadingAvailability {
  status: "loading";
  enabled: false;
  spaceId: string;
}

export type SummaryWorkbenchAvailabilityState =
  | SummaryWorkbenchLoadingAvailability
  | SummaryWorkbenchAvailabilityDecision;

export interface SummaryWorkbenchCapabilitySource {
  getCapabilities(options?: { signal?: AbortSignal; spaceId?: string }): Promise<unknown>;
}

export interface SummaryWorkbenchAvailabilityOptions {
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface ResolveSummaryWorkbenchAvailabilityOptions {
  signal?: AbortSignal;
}

interface PendingAvailability {
  promise: Promise<SummaryWorkbenchAvailabilityDecision>;
  cancel: () => void;
  consumers: number;
}

const TIMEOUT = Symbol("summary-workbench-capability-timeout");
const CANCELLED = Symbol("summary-workbench-capability-cancelled");

export class SummaryWorkbenchAvailability {
  private readonly cache = new Map<string, SummaryWorkbenchAvailabilityDecision>();

  private readonly pending = new Map<string, PendingAvailability>();

  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;

  private readonly now: () => number;

  constructor(
    private readonly source: SummaryWorkbenchCapabilitySource = summaryWorkbenchService,
    options: SummaryWorkbenchAvailabilityOptions = {}
  ) {
    this.timeoutMs = Math.max(
      1,
      options.timeoutMs ?? DEFAULT_SUMMARY_WORKBENCH_CAPABILITY_TIMEOUT_MS
    );
    this.cacheTtlMs = Math.max(
      0,
      options.cacheTtlMs ?? DEFAULT_SUMMARY_WORKBENCH_CAPABILITY_CACHE_TTL_MS
    );
    this.now = options.now ?? Date.now;
  }

  peek(spaceId: string | null | undefined): SummaryWorkbenchAvailabilityDecision | undefined {
    const normalizedSpaceId = normalizeSummaryWorkbenchSpaceId(spaceId);
    if (!normalizedSpaceId) return this.missingSpaceDecision();
    const cached = this.cache.get(normalizedSpaceId);
    if (!cached) return undefined;
    if (this.now() - cached.checkedAt >= this.cacheTtlMs) {
      this.cache.delete(normalizedSpaceId);
      return undefined;
    }
    return cached;
  }

  resolve(
    spaceId: string | null | undefined,
    options: ResolveSummaryWorkbenchAvailabilityOptions = {}
  ): Promise<SummaryWorkbenchAvailabilityDecision> {
    const normalizedSpaceId = normalizeSummaryWorkbenchSpaceId(spaceId);
    if (!normalizedSpaceId) {
      return Promise.resolve(this.missingSpaceDecision());
    }

    const cached = this.peek(normalizedSpaceId);
    if (cached) return Promise.resolve(cached);
    if (options.signal?.aborted) {
      return Promise.resolve(this.disabledDecision(normalizedSpaceId, "aborted"));
    }

    let pending = this.pending.get(normalizedSpaceId);
    if (!pending) {
      pending = this.createPending(normalizedSpaceId);
      this.pending.set(normalizedSpaceId, pending);
    }
    return this.subscribe(pending, normalizedSpaceId, options.signal);
  }

  invalidate(spaceId?: string | null): void {
    if (spaceId !== undefined && spaceId !== null) {
      const normalizedSpaceId = normalizeSummaryWorkbenchSpaceId(spaceId);
      if (!normalizedSpaceId) return;
      this.cache.delete(normalizedSpaceId);
      this.cancelPending(normalizedSpaceId);
      return;
    }

    this.cache.clear();
    for (const pendingSpaceId of [...this.pending.keys()]) {
      this.cancelPending(pendingSpaceId);
    }
  }

  private createPending(spaceId: string): PendingAvailability {
    const controller = new AbortController();
    let rejectTimeout: (reason: typeof TIMEOUT | typeof CANCELLED) => void = () => undefined;
    let timer: ReturnType<typeof setTimeout>;
    const pending: PendingAvailability = {
      consumers: 0,
      cancel: () => {
        clearTimeout(timer);
        controller.abort();
        rejectTimeout(CANCELLED);
      },
      promise: Promise.resolve(this.disabledDecision(spaceId, "unavailable")),
    };

    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
      timer = setTimeout(() => {
        controller.abort();
        reject(TIMEOUT);
      }, this.timeoutMs);
    });
    pending.promise = Promise.race([
      Promise.resolve().then(() =>
        this.source.getCapabilities({
          signal: controller.signal,
          spaceId,
        })
      ),
      timeoutPromise,
    ])
      .then((value) => this.evaluate(spaceId, value))
      .catch((error: unknown) => this.fromFailure(spaceId, error))
      .then((decision) => {
        if (this.pending.get(spaceId) === pending) {
          this.cache.set(spaceId, decision);
        }
        return decision;
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.pending.get(spaceId) === pending) {
          this.pending.delete(spaceId);
        }
      });

    return pending;
  }

  private subscribe(
    pending: PendingAvailability,
    spaceId: string,
    signal?: AbortSignal
  ): Promise<SummaryWorkbenchAvailabilityDecision> {
    pending.consumers += 1;
    let completed = false;

    const release = () => {
      pending.consumers = Math.max(0, pending.consumers - 1);
      if (pending.consumers === 0 && this.pending.get(spaceId) === pending) {
        this.pending.delete(spaceId);
        pending.cancel();
      }
    };

    return new Promise((resolve) => {
      const finish = (decision: SummaryWorkbenchAvailabilityDecision) => {
        if (completed) return;
        completed = true;
        signal?.removeEventListener("abort", onAbort);
        release();
        resolve(decision);
      };
      const onAbort = () => finish(this.disabledDecision(spaceId, "aborted"));

      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      void pending.promise.then(finish);
    });
  }

  private cancelPending(spaceId: string): void {
    const pending = this.pending.get(spaceId);
    if (!pending) return;
    this.pending.delete(spaceId);
    pending.cancel();
  }

  private evaluate(spaceId: string, value: unknown): SummaryWorkbenchAvailabilityDecision {
    if (!isCapabilities(value)) {
      return this.disabledDecision(spaceId, "invalid_response");
    }
    if (value.contract_version !== SUMMARY_WORKSPACE_CONTRACT_VERSION) {
      return this.disabledDecision(spaceId, "unsupported_contract", value.contract_version);
    }
    if (value.enabled !== true) {
      return this.disabledDecision(spaceId, "server_disabled", value.contract_version);
    }
    return {
      status: "enabled",
      enabled: true,
      spaceId,
      reason: "supported",
      contractVersion: SUMMARY_WORKSPACE_CONTRACT_VERSION,
      maxTimeRangeDays: value.max_time_range_days,
      checkedAt: this.now(),
    };
  }

  private fromFailure(spaceId: string, error: unknown): SummaryWorkbenchDisabledAvailability {
    if (error === TIMEOUT) return this.disabledDecision(spaceId, "timeout");
    if (error === CANCELLED) return this.disabledDecision(spaceId, "aborted");
    if (error instanceof SummaryWorkspaceApiError) {
      if (error.httpStatus === 404) {
        return this.disabledDecision(spaceId, "not_found");
      }
      if (error.kind === "protocol") {
        return this.disabledDecision(spaceId, "invalid_response");
      }
      if (error.kind === "abort") {
        return this.disabledDecision(spaceId, "aborted");
      }
    }
    return this.disabledDecision(spaceId, "unavailable");
  }

  private missingSpaceDecision(): SummaryWorkbenchDisabledAvailability {
    return this.disabledDecision("", "missing_space");
  }

  private disabledDecision(
    spaceId: string,
    reason: SummaryWorkbenchDisabledAvailability["reason"],
    contractVersion?: string
  ): SummaryWorkbenchDisabledAvailability {
    return {
      status: "disabled",
      enabled: false,
      spaceId,
      reason,
      ...(contractVersion ? { contractVersion } : {}),
      checkedAt: this.now(),
    };
  }
}

export const summaryWorkbenchAvailability = new SummaryWorkbenchAvailability();

export function useSummaryWorkbenchAvailability(
  spaceId: string | null | undefined,
  availability: SummaryWorkbenchAvailability = summaryWorkbenchAvailability
): SummaryWorkbenchAvailabilityState {
  const normalizedSpaceId = normalizeSummaryWorkbenchSpaceId(spaceId);
  const [snapshot, setSnapshot] = useState<{
    availability: SummaryWorkbenchAvailability;
    state: SummaryWorkbenchAvailabilityState;
  }>(() => ({
    availability,
    state: availability.peek(normalizedSpaceId) ?? loadingState(normalizedSpaceId),
  }));

  const visibleState =
    snapshot.availability === availability && snapshot.state.spaceId === normalizedSpaceId
      ? snapshot.state
      : availability.peek(normalizedSpaceId) ?? loadingState(normalizedSpaceId);

  useEffect(() => {
    const cached = availability.peek(normalizedSpaceId);
    if (cached) {
      setSnapshot({ availability, state: cached });
      return;
    }

    const controller = new AbortController();
    let active = true;
    setSnapshot({
      availability,
      state: loadingState(normalizedSpaceId),
    });
    void availability.resolve(normalizedSpaceId, { signal: controller.signal }).then((decision) => {
      if (active) setSnapshot({ availability, state: decision });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [availability, normalizedSpaceId]);

  return visibleState;
}

export function normalizeSummaryWorkbenchSpaceId(spaceId: string | null | undefined): string {
  return typeof spaceId === "string" ? spaceId.trim() : "";
}

function loadingState(spaceId: string): SummaryWorkbenchLoadingAvailability {
  return { status: "loading", enabled: false, spaceId };
}

function isCapabilities(value: unknown): value is SummaryWorkspaceCapabilitiesDTO {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === "boolean" &&
    typeof record.contract_version === "string" &&
    typeof record.max_time_range_days === "number" &&
    Number.isInteger(record.max_time_range_days) &&
    record.max_time_range_days > 0
  );
}

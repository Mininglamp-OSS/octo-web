import APIClient from "../../Service/APIClient";

export type QuickMuteDuration = "30m" | "1h" | "manual" | "custom";
export type QuickMuteScope = "sound" | "sound-and-popup";
export type QuickMuteMode = "timed" | "manual";
export interface QuickMuteState {
  active: boolean;
  mode?: QuickMuteMode;
  endAt?: number;
  scope: QuickMuteScope;
  revision?: number;
  serverTime?: string;
  serverOffset?: number;
}
export interface QuickMuteService {
  getState(): Promise<QuickMuteState>;
  setMute(input: { duration: QuickMuteDuration; endAt?: number }): Promise<QuickMuteState>;
  resume(): Promise<QuickMuteState>;
  subscribe?(listener: (state: QuickMuteState) => void): () => void;
}

interface NotificationPauseResponse {
  paused?: boolean;
  paused_until?: string | null;
  mode?: QuickMuteMode | null;
  revision?: number;
  server_time?: string;
}

const QUICK_MUTE_SCOPE_KEY = "octo.quickMute.scope";
let quickMuteUserId = "";

function scopeStorageKey(userId = quickMuteUserId) {
  return userId ? `${QUICK_MUTE_SCOPE_KEY}.${encodeURIComponent(userId)}` : QUICK_MUTE_SCOPE_KEY;
}

function getStoredScope(userId = quickMuteUserId): QuickMuteState["scope"] {
  try {
    return window.localStorage.getItem(scopeStorageKey(userId)) === "sound"
      ? "sound"
      : "sound-and-popup";
  } catch {
    return "sound-and-popup";
  }
}

function storeScope(scope: QuickMuteState["scope"], userId = quickMuteUserId) {
  try {
    window.localStorage.setItem(scopeStorageKey(userId), scope);
  } catch {
    // Local storage can be unavailable in private browsing or test runtimes.
  }
}

export function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultQuickMuteTime(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return formatLocalDateTime(date);
}

function toState(response: NotificationPauseResponse, serverOffset?: number): QuickMuteState {
  const effectiveServerOffset = serverOffset ?? 0;
  const endAt = response.paused_until ? Date.parse(response.paused_until) : undefined;
  const serverNow = response.server_time ? Date.parse(response.server_time) : NaN;
  const mode = response.mode ?? (response.paused === true && !Number.isFinite(endAt) ? "manual" : endAt ? "timed" : undefined);
  return {
    active: response.paused === true && (mode === "manual" || (endAt !== undefined && Number.isFinite(endAt) && endAt > Date.now() + effectiveServerOffset)),
    mode,
    endAt,
    scope: getStoredScope(),
    revision: response.revision ?? 0,
    serverTime: response.server_time,
    serverOffset,
  };
}

export function parseQuickMuteCMD(param: unknown): QuickMuteState | null {
  if (!param || typeof param !== "object") return null;
  const value = param as NotificationPauseResponse;
  if (typeof value.revision !== "number" || typeof value.paused !== "boolean") return null;
  return toState(value);
}

/** Account-level notification pause API. The server is authoritative. */
export class QuickMuteApiService implements QuickMuteService {
  private static readonly PATH = "/user/notification-pause";

  async getState(): Promise<QuickMuteState> {
    const startedAt = Date.now();
    const response = await APIClient.shared.get<NotificationPauseResponse>(QuickMuteApiService.PATH);
    const referenceTime = startedAt + (Date.now() - startedAt) / 2;
    const serverTime = response.server_time ? Date.parse(response.server_time) : NaN;
    return toState(response, Number.isFinite(serverTime) ? serverTime - referenceTime : 0);
  }

  async setMute(input: { duration: QuickMuteDuration; endAt?: number }): Promise<QuickMuteState> {
    const body = input.duration === "custom"
      ? (() => {
          if (!input.endAt || !Number.isFinite(input.endAt) || input.endAt <= Date.now()) throw new Error("A future notification pause time is required");
          return { paused_until: new Date(input.endAt).toISOString() };
        })()
      : input.duration === "manual" ? { mode: "manual" } : { duration: input.duration };
    const startedAt = Date.now();
    const response = await APIClient.shared.put(QuickMuteApiService.PATH, body);
    const referenceTime = startedAt + (Date.now() - startedAt) / 2;
    const serverTime = response.server_time ? Date.parse(response.server_time) : NaN;
    return toState(response, Number.isFinite(serverTime) ? serverTime - referenceTime : 0);
  }

  async resume(): Promise<QuickMuteState> {
    const startedAt = Date.now();
    const response = await APIClient.shared.delete<NotificationPauseResponse>(QuickMuteApiService.PATH);
    const referenceTime = startedAt + (Date.now() - startedAt) / 2;
    const serverTime = response.server_time ? Date.parse(response.server_time) : NaN;
    return toState(response, Number.isFinite(serverTime) ? serverTime - referenceTime : 0);
  }
}

/** One account-scoped store shared by the settings page and sidebar. */
export class QuickMuteStore implements QuickMuteService {
  private readonly service: QuickMuteService;
  private state: QuickMuteState = { active: false, scope: getStoredScope(), revision: 0 };
  private listeners = new Set<(state: QuickMuteState) => void>();
  private refreshVersion = 0;
  private mutationVersion = 0;
  private loaded = false;
  private loadAttempted = false;
  private inFlight?: Promise<QuickMuteState>;
  private serverOffset = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor(service: QuickMuteService = new QuickMuteApiService()) {
    this.service = service;
  }

  subscribe(listener: (state: QuickMuteState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(next: QuickMuteState) {
    const currentRevision = this.state.revision ?? 0;
    const nextRevision = next.revision ?? 0;
    if (nextRevision < currentRevision) return this.state;
    if (typeof next.serverOffset === "number" && Number.isFinite(next.serverOffset)) this.serverOffset = next.serverOffset;
    else if (next.serverTime) {
      const serverTime = Date.parse(next.serverTime);
      if (Number.isFinite(serverTime)) this.serverOffset = serverTime - Date.now();
    }
    const endAt = next.endAt;
    this.state = { ...next, active: Boolean(next.active && (next.mode === "manual" || (endAt && endAt > Date.now() + this.serverOffset))), scope: next.scope ?? getStoredScope() };
    this.loaded = true;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.scheduleExpiry(endAt);
    this.listeners.forEach((listener) => listener(this.state));
    return this.state;
  }

  async getState() {
    // A failed lazy read must not turn every attention check into another
    // request. Explicit lifecycle refreshes (foreground/online/reconnect)
    // reset this gate by calling refresh() directly.
    if (!this.loaded && this.inFlight) await this.inFlight;
    else if (!this.loaded && !this.loadAttempted) await this.refresh();
    else {
      const active = Boolean(this.state.active && (this.state.mode === "manual" || (this.state.endAt && this.state.endAt > Date.now() + this.serverOffset)));
      if (active !== this.state.active) {
        this.state = { ...this.state, active };
        this.listeners.forEach((listener) => listener(this.state));
      }
    }
    return this.state;
  }

  private scheduleExpiry(endAt?: number) {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (!this.state.active || this.state.mode === "manual" || !endAt) return;
    const remaining = endAt - (Date.now() + this.serverOffset);
    this.expiryTimer = setTimeout(() => {
      if (this.state.endAt !== endAt || !this.state.active) return;
      if (endAt > Date.now() + this.serverOffset) this.scheduleExpiry(endAt);
      else void this.refresh().then(() => {
        if (this.state.endAt !== endAt || !this.state.active) return;
        this.state = { ...this.state, active: false, endAt: undefined };
        this.listeners.forEach((listener) => listener(this.state));
        this.expiryTimer = setTimeout(() => { void this.refresh(); }, 5_000);
      });
    }, Math.min(Math.max(remaining, 0), 60 * 60_000));
  }

  async refresh() {
    if (this.inFlight) return this.inFlight;
    this.loadAttempted = true;
    const version = ++this.refreshVersion;
    const mutationVersion = this.mutationVersion;
    const request = this.service.getState().then((next) => {
      if (version === this.refreshVersion && mutationVersion === this.mutationVersion) this.apply(next);
      return this.state;
    });
    const safeRequest = request.catch(() => this.state).finally(() => {
      if (this.inFlight === safeRequest) this.inFlight = undefined;
    });
    this.inFlight = safeRequest;
    return safeRequest;
  }

  reset() {
    this.refreshVersion += 1;
    this.mutationVersion += 1;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.inFlight = undefined;
    this.loaded = false;
    this.loadAttempted = false;
    this.state = { active: false, scope: getStoredScope(this.userId), revision: 0 };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private userId = "";

  setUserId(userId: string) {
    this.userId = userId;
    quickMuteUserId = userId;
    this.reset();
    return this.state;
  }

  applyRemoteCMD(param: unknown) {
    const next = parseQuickMuteCMD(param);
    if (!next) {
      void this.refresh().catch(() => undefined);
      return false;
    }
    const revision = next.revision ?? 0;
    const currentRevision = this.state.revision ?? 0;
    if (revision <= currentRevision) return false;
    if (revision > currentRevision + 1 && currentRevision > 0) void this.refresh().catch(() => undefined);
    this.apply(next);
    return true;
  }

  async setMute(input: { duration: QuickMuteDuration; endAt?: number }) {
    const version = ++this.mutationVersion;
    const next = await this.service.setMute(input);
    if (version === this.mutationVersion) return this.apply(next);
    return this.state;
  }

  setScope(scope: QuickMuteState["scope"]) {
    storeScope(scope, this.userId);
    this.state = { ...this.state, scope };
    this.listeners.forEach((listener) => listener(this.state));
    return this.state;
  }

  async resume() {
    const version = ++this.mutationVersion;
    const next = await this.service.resume();
    if (version === this.mutationVersion) return this.apply(next);
    return this.state;
  }
}

export const quickMuteStore = new QuickMuteStore();

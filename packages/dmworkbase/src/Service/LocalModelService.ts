import type { TranscribeResult, VoiceMode } from "./VoiceService";

export interface LocalModelConfig {
  endpoint: string;
  probeUrl: string;
  transcribeUrl: string;
  probeTimeoutMs: number;
  requestTimeoutMs: number;
  enabled: boolean;
  preferLocal: boolean;
}

export type LocalModelStatus = "unknown" | "available" | "unavailable";

const STORAGE_KEY = "dmwork_local_model_config";

export function normalizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    let pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/v1")) {
      pathname = pathname.slice(0, -3);
    }
    return url.origin + pathname;
  } catch {
    return endpoint.replace(/\/+$/, "");
  }
}

export default class LocalModelService {
  private constructor() {}
  public static shared = new LocalModelService();

  private _status: LocalModelStatus = "unknown";
  private _transcriptionCapable: boolean | null = null;
  private _transcriptionCapableExpiry = 0;
  private _config: LocalModelConfig = {
    endpoint: "http://localhost:8787",
    probeUrl: "http://localhost:8787/",
    transcribeUrl: "http://localhost:8787/v1/voice/transcribe",
    probeTimeoutMs: 2000,
    requestTimeoutMs: 30000,
    enabled: false,
    preferLocal: true,
  };
  private _probePromise: Promise<boolean> | null = null;
  private _lastProbeTime = 0;
  private _consecutiveFailures = 0;
  private _probeEpoch = 0;

  get status(): LocalModelStatus {
    return this._status;
  }
  get config(): Readonly<LocalModelConfig> {
    return { ...this._config };
  }

  private get _probeCacheTTL(): number {
    if (this._consecutiveFailures === 0) return 30_000;
    const ttl = Math.min(
      5000 * Math.pow(2, this._consecutiveFailures - 1),
      60_000
    );
    return ttl;
  }

  loadConfig(storageService: { getItem(key: string): string | null }): void {
    try {
      const saved = storageService.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this._config = { ...this._config, ...parsed };
        this._config.endpoint = normalizeEndpoint(this._config.endpoint);
        // Backward compat: derive URLs from endpoint if not present in stored config
        if (!parsed.probeUrl) {
          const base = this._config.endpoint.replace(/\/+$/, "");
          this._config.probeUrl = base + "/";
        }
        if (!parsed.transcribeUrl) {
          const base = this._config.endpoint.replace(/\/+$/, "");
          this._config.transcribeUrl = base + "/v1/voice/transcribe";
        }
      }
    } catch {
      // storage unavailable or data corrupted, use defaults
    }
  }

  updateConfig(
    partial: Partial<LocalModelConfig>,
    storageService: { setItem(key: string, value: string): void }
  ): void {
    if (partial.endpoint) {
      partial.endpoint = normalizeEndpoint(partial.endpoint);
    }
    const merged = { ...this._config, ...partial };
    // If endpoint changed but URLs weren't explicitly provided, derive them
    if (partial.endpoint && !partial.probeUrl) {
      const base = merged.endpoint.replace(/\/+$/, "");
      merged.probeUrl = base + "/";
    }
    if (partial.endpoint && !partial.transcribeUrl) {
      const base = merged.endpoint.replace(/\/+$/, "");
      merged.transcribeUrl = base + "/v1/voice/transcribe";
    }
    this._config = merged;
    this._status = "unknown";
    this._lastProbeTime = 0;
    this._consecutiveFailures = 0;
    this._transcriptionCapable = null;
    this._probePromise = null;
    this._probeEpoch++;
    try {
      storageService.setItem(STORAGE_KEY, JSON.stringify(this._config));
    } catch {
      // storage write failure, silent
    }
  }

  async probe(): Promise<boolean> {
    if (!this._config.enabled || !this._config.preferLocal) {
      this._status = "unavailable";
      return false;
    }

    const now = Date.now();
    if (
      this._status !== "unknown" &&
      now - this._lastProbeTime < this._probeCacheTTL
    ) {
      if (
        this._status === "available" &&
        this._transcriptionCapable === false &&
        now < this._transcriptionCapableExpiry
      ) {
        return false;
      }
      return this._status === "available";
    }

    if (this._probePromise) return this._probePromise;

    this._probePromise = this._doProbe().finally(() => {
      this._probePromise = null;
    });
    return this._probePromise;
  }

  async forceProbe(): Promise<boolean> {
    this._status = "unknown";
    this._lastProbeTime = 0;
    this._probePromise = null;
    this._probeEpoch++;
    return this.probe();
  }

  private async _doProbe(): Promise<boolean> {
    const epoch = this._probeEpoch;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this._config.probeTimeoutMs
    );

    try {
      await fetch(this._config.probeUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
      });

      if (epoch !== this._probeEpoch) return this._status === "available";

      // Any HTTP response (including 3xx, 4xx, 5xx) means service is alive
      this._status = "available";
      this._lastProbeTime = Date.now();
      this._consecutiveFailures = 0;
      return true;
    } catch {
      // network unreachable, timeout, CORS, etc.
    } finally {
      clearTimeout(timer);
    }

    if (epoch !== this._probeEpoch) return this._status === "available";

    this._status = "unavailable";
    this._lastProbeTime = Date.now();
    this._consecutiveFailures++;
    return false;
  }

  async transcribe(
    audio: Blob,
    contextText?: string,
    chatContext?: string,
    personalContext?: string,
    memberContext?: string,
    mode?: VoiceMode,
    selfName?: string,
  ): Promise<TranscribeResult | null> {
    const available = await this.probe();
    if (!available) return null;

    if (
      this._transcriptionCapable === false &&
      Date.now() < this._transcriptionCapableExpiry
    ) {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this._config.requestTimeoutMs
    );

    try {
      const formData = new FormData();
      const ext = audio.type.includes("mp4") ? "mp4" : "webm";
      formData.append("audio", audio, `recording.${ext}`);
      if (contextText) formData.append("context_text", contextText);
      if (chatContext) formData.append("chat_context", chatContext);
      if (personalContext) formData.append("personal_context", personalContext);
      if (memberContext) formData.append("member_context", memberContext);
      if (mode) formData.append("mode", mode);
      if (selfName) formData.append("self_name", selfName);

      const resp = await fetch(
        this._config.transcribeUrl,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        this._transcriptionCapable = true;
        if (data.status === 200 && data.text) {
          return { text: data.text, m: data.m ?? "local" };
        }
      } else if (
        resp.status === 404 ||
        resp.status === 405 ||
        resp.status === 501
      ) {
        this._transcriptionCapable = false;
        this._transcriptionCapableExpiry = Date.now() + 5 * 60 * 1000;
      } else {
        this._status = "unknown";
        this._lastProbeTime = 0;
      }
    } catch {
      this._status = "unknown";
      this._lastProbeTime = 0;
    } finally {
      clearTimeout(timer);
    }
    return null;
  }


}

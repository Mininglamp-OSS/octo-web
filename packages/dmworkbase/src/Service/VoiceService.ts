import APIClient from "./APIClient";
import LocalModelService from "./LocalModelService";

export type VoiceMode = "smart" | "append_only" | "edit_only";

export interface VoiceConfig {
  enabled: boolean;
  max_duration?: number;
  max_file_size: number;
  local_enabled?: boolean;
  local_timeout_ms?: number;
  local_probe_url?: string;
  local_transcribe_url?: string;
  feedback_url?: string;
  feedback_privacy_url?: string;
  feedback_user_agreement_url?: string;
  engine?: string;
  edit_mode?: string;
}

export interface TranscribeResult {
  text: string;
  m: string; // shortened model name from backend
  request_id?: string;
}

export interface VoiceContextResponse {
  status: number;
  has_context: boolean;
  context: string;
  updated_at: string;
}

const VOICE_CONTEXT_CACHE_TTL = 5 * 60 * 1000;

const VOICE_CONTEXT_TIMEOUT = 3000;

interface VoiceContextCacheEntry {
  data: VoiceContextResponse;
  timestamp: number;
}

export default class VoiceService {
  private constructor() {}
  public static shared = new VoiceService();

  private _voiceContextCache = new Map<string, VoiceContextCacheEntry>();
  private _voiceContextInflight = new Map<
    string,
    Promise<VoiceContextResponse>
  >();
  private _voiceContextEpoch = new Map<string, number>();

  async getConfig(): Promise<VoiceConfig> {
    return APIClient.shared.get<VoiceConfig>("/voice/config");
  }

  async transcribe(
    audio: Blob,
    contextText?: string,
    chatContext?: string,
    personalContext?: string,
    memberContext?: string,
    mode?: VoiceMode,
    skipLocal?: boolean,
    channelType?: number,
    allowFeedback?: boolean,
    selfName?: string,
  ): Promise<TranscribeResult> {
    if (!skipLocal) {
      const localResult = await LocalModelService.shared.transcribe(audio, contextText, chatContext, personalContext, memberContext, mode, selfName);
      if (localResult) {
        return localResult;
      }
    }

    const formData = new FormData();
    const ext = audio.type.includes("mp4") ? "mp4" : "webm";
    formData.append("audio", audio, `recording.${ext}`);
    if (contextText) {
      formData.append("context_text", contextText);
    }
    if (chatContext) {
      formData.append("chat_context", chatContext);
    }
    if (personalContext) {
      formData.append("personal_context", personalContext);
    }
    if (memberContext) {
      formData.append("member_context", memberContext);
    }
    if (mode) {
      formData.append("mode", mode);
    }
    if (channelType !== undefined) {
      formData.append("channel_type", String(channelType));
    }
    if (allowFeedback !== undefined) {
      formData.append("allow_feedback", String(allowFeedback));
    }
    if (selfName) {
      formData.append("self_name", selfName);
    }
    return APIClient.shared.post("/voice/transcribe", formData);
  }

  async getVoiceContext(spaceId: string): Promise<VoiceContextResponse> {
    const cached = this._voiceContextCache.get(spaceId);
    if (cached && Date.now() - cached.timestamp < VOICE_CONTEXT_CACHE_TTL) {
      return cached.data;
    }
    if (cached) {
      this._voiceContextCache.delete(spaceId);
    }

    const inflight = this._voiceContextInflight.get(spaceId);
    if (inflight) return inflight;

    const currentEpoch = this._voiceContextEpoch.get(spaceId) ?? 0;

    const request = Promise.race([
      APIClient.shared.get<VoiceContextResponse>("/voice/context", {
        param: { space_id: spaceId },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("voice context request timeout")),
          VOICE_CONTEXT_TIMEOUT
        )
      ),
    ])
      .then((resp: VoiceContextResponse) => {
        if ((this._voiceContextEpoch.get(spaceId) ?? 0) === currentEpoch) {
          this._voiceContextCache.set(spaceId, {
            data: resp,
            timestamp: Date.now(),
          });
        }
        this._voiceContextInflight.delete(spaceId);
        return resp;
      })
      .catch((err: unknown) => {
        this._voiceContextInflight.delete(spaceId);
        throw err;
      });

    this._voiceContextInflight.set(spaceId, request);
    return request;
  }

  async putLocalConfig(config: {
    enabled: boolean;
    timeout_ms?: number;
    probe_url?: string;
    transcribe_url?: string;
  }): Promise<void> {
    await APIClient.shared.put("/voice/local-config", config);
  }

  async getLocalConfig(): Promise<{
    status: number;
    enabled: boolean;
    timeout_ms: number | null;
    probe_url: string | null;
    transcribe_url: string | null;
  }> {
    return APIClient.shared.get("/voice/local-config");
  }

  async deleteLocalConfig(): Promise<void> {
    await APIClient.shared.delete("/voice/local-config");
  }

  async resetLocalConfig(config: { enabled: boolean }): Promise<void> {
    await APIClient.shared.post("/voice/local-config/reset", config);
  }

  clearVoiceContextCache(spaceId?: string): void {
    if (spaceId) {
      this._voiceContextEpoch.set(
        spaceId,
        (this._voiceContextEpoch.get(spaceId) ?? 0) + 1
      );
      this._voiceContextCache.delete(spaceId);
      this._voiceContextInflight.delete(spaceId);
    } else {
      for (const key of this._voiceContextInflight.keys()) {
        this._voiceContextEpoch.set(
          key,
          (this._voiceContextEpoch.get(key) ?? 0) + 1
        );
      }
      this._voiceContextCache.clear();
      this._voiceContextInflight.clear();
    }
  }
}

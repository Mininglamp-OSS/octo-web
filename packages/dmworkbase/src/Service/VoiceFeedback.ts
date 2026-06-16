export interface AsrParams {
  contextText?: string;
  chatContext?: string;
  personalContext?: string;
  memberContext?: string;
  selfName?: string;
  mode?: string;
  channelType?: number;
  model?: string;
  allowFeedback?: boolean;
}

interface PendingUtterance {
  utteranceId: string;
  modelText: string;
  source: "local" | "remote";
  requestId?: string;
  scene?: string;
  audioBlob?: Blob;
  timestamp: number;
  asrParams?: AsrParams;
}

export default class VoiceFeedback {
  private static instance: VoiceFeedback | null = null;
  private feedbackUrl: string;
  private pending = new Map<string, PendingUtterance>();
  private readonly EXPIRE_MS = 120_000;
  private disabled = false;
  private abortControllers = new Set<AbortController>();

  private constructor(feedbackUrl: string) {
    this.feedbackUrl = feedbackUrl;
  }

  static init(feedbackUrl?: string): void {
    if (!feedbackUrl) {
      VoiceFeedback.instance = null;
      return;
    }
    VoiceFeedback.instance = new VoiceFeedback(feedbackUrl.replace(/\/+$/, ""));
  }

  static shared(): VoiceFeedback | null {
    return VoiceFeedback.instance;
  }

  disable(): void {
    this.disabled = true;
    this.pending.clear();
    for (const controller of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  enable(url?: string): void {
    if (!VoiceFeedback.instance) {
      if (url) {
        VoiceFeedback.init(url);
      }
      return;
    }
    if (url) {
      VoiceFeedback.instance.feedbackUrl = url.replace(/\/+$/, "");
    }
    VoiceFeedback.instance.disabled = false;
  }

  static destroy(): void {
    if (VoiceFeedback.instance) {
      VoiceFeedback.instance.disable();
      VoiceFeedback.instance = null;
    }
  }

  onTranscribeResult(params: {
    utteranceId: string;
    modelText: string;
    source: "local" | "remote";
    requestId?: string;
    scene?: string;
    audioBlob?: Blob;
    asrParams?: AsrParams;
  }): void {
    if (this.disabled) return;

    this.pending.set(params.utteranceId, {
      ...params,
      timestamp: Date.now(),
    });

    if (params.source === "local" && params.audioBlob) {
      this.uploadLocal(this.pending.get(params.utteranceId)!).catch(() => {});
    }

    this.cleanExpired();
  }

  submitAll(userText: string): void {
    for (const entry of this.pending.values()) {
      this.uploadFinal(entry, userText).catch(() => {});
    }
    this.pending.clear();
  }

  private async uploadLocal(u: PendingUtterance): Promise<void> {
    if (!u.audioBlob) return;
    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      const form = new FormData();
      form.append("audio", u.audioBlob, `${u.utteranceId}.webm`);
      form.append(
        "metadata",
        JSON.stringify({
          utterance_id: u.utteranceId,
          text: u.modelText,
          source: u.source,
          scene: u.scene || "",
          context_text: u.asrParams?.contextText || "",
          chat_context: u.asrParams?.chatContext || "",
          personal_context: u.asrParams?.personalContext || "",
          member_context: u.asrParams?.memberContext || "",
          self_name: u.asrParams?.selfName || "",
          mode: u.asrParams?.mode || "",
          channel_type: u.asrParams?.channelType ?? 0,
          model: u.asrParams?.model || "",
          allow_feedback: u.asrParams?.allowFeedback ?? false,
        }),
      );
      await fetch(`${this.feedbackUrl}/local`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  private async uploadFinal(
    u: PendingUtterance,
    userText: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      await fetch(`${this.feedbackUrl}/final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utterance_id: u.utteranceId,
          model_text: u.modelText,
          user_text: userText,
          source: u.source,
          request_id: u.requestId || "",
          scene: u.scene || "",
          ts: Date.now(),
        }),
        signal: controller.signal,
      });
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.pending) {
      if (now - entry.timestamp > this.EXPIRE_MS) {
        this.pending.delete(id);
      }
    }
  }
}

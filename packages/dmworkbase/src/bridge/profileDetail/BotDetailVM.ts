import AgentCardService from "../../Service/AgentCardService";
import BotProfileService from "../../Service/BotProfileService";
import { ProviderListener } from "../../Service/Provider";

export interface BotDetailState {
  loading: boolean;
  name: string;
  remark: string;
  username: string;
  description: string;
  creatorName: string;
  creatorUid: string;
  botCommands: string;
  isFriend: boolean;
  applying: boolean;
  showApplyInput: boolean;
  applyRemark: string;
  uploadingAvatar: boolean;
  editingDescription: boolean;
  descriptionDraft: string;
  savingDescription: boolean;
  editingRemark: boolean;
  remarkDraft: string;
  savingRemark: boolean;
  reported: boolean | null;
  reportStatusLoading: boolean;
  showClawInfo: boolean;
  showBotManage: boolean;
  avatarCropFile: File | null;
  avatarPreviewFile: File | null;
}

export interface BotDetailChannelInfo {
  title?: string;
  orgData?: {
    remark?: string;
    bot_description?: string;
    bot_creator_name?: string;
    bot_creator_uid?: string;
    bot_commands?: string;
    follow?: number;
    [key: string]: any;
  };
}

export interface BotDetailRuntime {
  getLoginUid: () => string | undefined;
  getToken: () => string | undefined;
  getSpaceId: () => string | undefined;
  fetchChannelInfo: (uid: string) => Promise<BotDetailChannelInfo | undefined>;
  refreshChannelInfo: (uid: string) => Promise<unknown>;
  onAvatarChanged: (uid: string) => void;
}

export type BotDetailActionResult = "ok" | "stale" | "failed";

export function createInitialBotDetailState(): BotDetailState {
  return {
    loading: true,
    name: "",
    remark: "",
    username: "",
    description: "",
    creatorName: "",
    creatorUid: "",
    botCommands: "",
    isFriend: false,
    applying: false,
    showApplyInput: false,
    applyRemark: "",
    uploadingAvatar: false,
    editingDescription: false,
    descriptionDraft: "",
    savingDescription: false,
    editingRemark: false,
    remarkDraft: "",
    savingRemark: false,
    reported: null,
    reportStatusLoading: false,
    showClawInfo: false,
    showBotManage: false,
    avatarCropFile: null,
    avatarPreviewFile: null,
  };
}

export function stripBotDetailDisplayName(value: string) {
  return value.replace(/\*\*/g, "");
}

export function parseBotCommands(value: string): { cmd: string; remark: string }[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default class BotDetailVM extends ProviderListener {
  state: BotDetailState = createInitialBotDetailState();
  private uid: string;
  private mounted = false;
  private generation = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(uid: string, private runtime: BotDetailRuntime) {
    super();
    this.uid = uid;
  }

  mount() {
    this.mounted = true;
  }

  unmount() {
    this.mounted = false;
    this.clearRefreshTimer();
  }

  setUid(uid: string) {
    if (this.uid === uid) return;
    this.uid = uid;
    this.clearRefreshTimer();
    this.patchState({ showBotManage: false });
    if (!uid) return;
    return this.loadBotInfo();
  }

  currentUid() {
    return this.uid;
  }

  isCurrentUid(uid: string) {
    return this.mounted && this.uid === uid;
  }

  isOwner() {
    const { creatorUid } = this.state;
    const loginUid = this.runtime.getLoginUid();
    return !!creatorUid && !!loginUid && creatorUid === loginUid;
  }

  resetTransientState() {
    this.patchState({
      avatarCropFile: null,
      avatarPreviewFile: null,
      showBotManage: false,
      showClawInfo: false,
    });
  }

  async loadReportStatus() {
    const requestedUid = this.uid;
    if (!requestedUid) return;
    const gen = this.generation;

    this.patchState({ reported: null, reportStatusLoading: true });
    try {
      const result = await AgentCardService.getReportStatus(requestedUid);
      if (this.isStale(requestedUid, gen)) return;
      this.patchState({ reported: result });
    } catch (error) {
      if (this.isStale(requestedUid, gen)) return;
      console.error("[BotDetailModal] loadReportStatus failed:", error);
    } finally {
      if (!this.isStale(requestedUid, gen)) {
        this.patchState({ reportStatusLoading: false });
      }
    }
  }

  async loadBotInfo() {
    const requestedUid = this.uid;
    if (!requestedUid) return;
    const gen = ++this.generation;
    this.clearRefreshTimer();
    this.state = createInitialBotDetailState();
    this.notifyListener();

    try {
      const data = await BotProfileService.getBotProfile(requestedUid);
      if (this.isStale(requestedUid, gen)) return;
      this.patchState({
        loading: false,
        name: data.name || requestedUid,
        remark: data.remark || "",
        username: data.username || requestedUid,
        description: data.bot_description || "",
        creatorName: data.bot_creator_name || "",
        creatorUid: data.bot_creator_uid || "",
        botCommands: data.bot_commands || "",
        isFriend: data.follow === 1,
        editingDescription: false,
      });
      if (this.isOwner()) {
        void this.loadReportStatus();
      }
    } catch {
      await this.loadFromChannelInfo(requestedUid, gen);
    }
  }

  async uploadAvatar(file: File): Promise<BotDetailActionResult> {
    const requestedUid = this.uid;
    this.patchState({ uploadingAvatar: true });
    try {
      await BotProfileService.uploadAvatar(
        requestedUid,
        file,
        this.runtime.getToken() || "",
      );
      if (!this.isCurrentUid(requestedUid)) return "stale";
      this.runtime.onAvatarChanged(requestedUid);
      return "ok";
    } catch {
      return this.isCurrentUid(requestedUid) ? "failed" : "stale";
    } finally {
      if (this.isCurrentUid(requestedUid)) {
        this.patchState({ uploadingAvatar: false });
      }
    }
  }

  setAvatarCropFile(file: File | null) {
    this.patchState({ avatarCropFile: file });
  }

  setAvatarPreviewFile(file: File | null) {
    this.patchState({ avatarPreviewFile: file });
  }

  startEditDescription() {
    if (!this.isOwner()) return;
    this.patchState({
      editingDescription: true,
      descriptionDraft: stripBotDetailDisplayName(this.state.description),
    });
  }

  cancelEditDescription() {
    this.patchState({ editingDescription: false, descriptionDraft: "" });
  }

  setDescriptionDraft(value: string) {
    this.patchState({ descriptionDraft: value.slice(0, 200) });
  }

  updateDescriptionDraftWithTranscription(
    text: string,
    mode: "all" | "selection" | "cursor",
    savedRange?: { from: number; to: number },
  ) {
    const current = this.state.descriptionDraft;
    if (mode === "all") {
      this.setDescriptionDraft(text);
      return;
    }
    if (mode === "selection" && savedRange) {
      const before = current.slice(0, savedRange.from);
      const after = current.slice(savedRange.to);
      const budget = Math.max(0, 200 - before.length - after.length);
      this.patchState({ descriptionDraft: before + text.slice(0, budget) + after });
      return;
    }
    const pos = savedRange?.from ?? current.length;
    const before = current.slice(0, pos);
    const after = current.slice(pos);
    const budget = Math.max(0, 200 - before.length - after.length);
    this.patchState({ descriptionDraft: before + text.slice(0, budget) + after });
  }

  async saveDescription(): Promise<BotDetailActionResult> {
    const requestedUid = this.uid;
    const { descriptionDraft } = this.state;
    this.patchState({ savingDescription: true });
    try {
      await BotProfileService.updateDescription(requestedUid, descriptionDraft);
      if (!this.isCurrentUid(requestedUid)) return "stale";
      this.patchState({
        description: descriptionDraft,
        editingDescription: false,
        descriptionDraft: "",
      });
      return "ok";
    } catch {
      return this.isCurrentUid(requestedUid) ? "failed" : "stale";
    } finally {
      if (this.isCurrentUid(requestedUid)) {
        this.patchState({ savingDescription: false });
      }
    }
  }

  startEditRemark() {
    this.patchState({
      editingRemark: true,
      remarkDraft: stripBotDetailDisplayName(this.state.remark),
    });
  }

  cancelEditRemark() {
    this.patchState({ editingRemark: false, remarkDraft: "" });
  }

  setRemarkDraft(value: string) {
    this.patchState({ remarkDraft: value });
  }

  async saveRemark(): Promise<BotDetailActionResult> {
    const requestedUid = this.uid;
    const remark = this.state.remarkDraft.trim();
    this.patchState({ savingRemark: true });
    try {
      await BotProfileService.updateRemark(requestedUid, remark);
      if (!this.isCurrentUid(requestedUid)) return "stale";
      this.patchState({
        remark,
        editingRemark: false,
        remarkDraft: "",
      });
      Promise.resolve(this.runtime.refreshChannelInfo(requestedUid)).catch((error: unknown) => {
        console.warn("[BotDetailModal] refresh channel after remark failed:", error);
      });
      return "ok";
    } catch {
      return this.isCurrentUid(requestedUid) ? "failed" : "stale";
    } finally {
      if (this.isCurrentUid(requestedUid)) {
        this.patchState({ savingRemark: false });
      }
    }
  }

  showApplyInput(defaultMessage: string) {
    this.patchState({
      showApplyInput: true,
      applyRemark: defaultMessage,
    });
  }

  setApplyRemark(value: string) {
    this.patchState({ applyRemark: value });
  }

  async submitApply(): Promise<BotDetailActionResult> {
    const requestedUid = this.uid;
    const { applyRemark } = this.state;
    this.patchState({ applying: true });
    try {
      await BotProfileService.applyFriend({
        uid: requestedUid,
        remark: applyRemark,
        spaceId: this.runtime.getSpaceId(),
      });
      if (!this.isCurrentUid(requestedUid)) return "stale";
      this.patchState({ showApplyInput: false });
      this.clearRefreshTimer();
      this.refreshTimer = setTimeout(() => {
        if (this.isCurrentUid(requestedUid)) {
          void this.loadBotInfo();
        }
      }, 500);
      return "ok";
    } catch {
      return this.isCurrentUid(requestedUid) ? "failed" : "stale";
    } finally {
      if (this.isCurrentUid(requestedUid)) {
        this.patchState({ applying: false });
      }
    }
  }

  openClawInfo() {
    this.patchState({ showClawInfo: true });
  }

  closeClawInfo() {
    this.patchState({ showClawInfo: false });
  }

  openBotManage() {
    this.patchState({ showBotManage: true });
  }

  closeBotManage() {
    this.patchState({ showBotManage: false });
  }

  private async loadFromChannelInfo(requestedUid: string, gen: number) {
    try {
      const channelInfo = await this.runtime.fetchChannelInfo(requestedUid);
      if (this.isStale(requestedUid, gen)) return;
      this.patchState({
        loading: false,
        name: channelInfo?.title || requestedUid,
        remark: channelInfo?.orgData?.remark || "",
        username: requestedUid,
        description: channelInfo?.orgData?.bot_description || "",
        creatorName: channelInfo?.orgData?.bot_creator_name || "",
        creatorUid: channelInfo?.orgData?.bot_creator_uid || "",
        botCommands: channelInfo?.orgData?.bot_commands || "",
        isFriend: channelInfo?.orgData?.follow === 1,
        editingDescription: false,
      });
      if (this.isOwner()) {
        void this.loadReportStatus();
      }
    } catch {
      if (this.isStale(requestedUid, gen)) return;
      this.patchState({
        loading: false,
        name: requestedUid,
        remark: "",
        username: requestedUid,
        description: "",
        creatorName: "",
        creatorUid: "",
        botCommands: "",
        isFriend: false,
        editingDescription: false,
      });
    }
  }

  private isStale(uid: string, gen: number) {
    return !this.isCurrentUid(uid) || this.generation !== gen;
  }

  private patchState(patch: Partial<BotDetailState>) {
    this.state = {
      ...this.state,
      ...patch,
    };
    this.notifyListener();
  }

  private clearRefreshTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

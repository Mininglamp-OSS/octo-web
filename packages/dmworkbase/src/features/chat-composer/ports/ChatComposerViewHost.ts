export interface ChatComposerChannelSnapshot {
  id: string;
  type: number;
  key: string;
  isDirect: boolean;
}

export interface ChatComposerMember {
  uid: string;
  name: string;
  remark?: string;
  orgData?: {
    real_name?: string | null;
    realname_verified?: boolean | number | string | null;
    robot?: number;
    home_space_id?: string;
    home_space_name?: string;
    is_external?: number | boolean | null;
    source_space_name?: string;
  } | null;
}

export interface ChatComposerVoiceContext {
  memberContext?: string;
  chatContext?: string;
  channelType?: number;
  selfName?: string;
}

/** App-owned space lifecycle needed by voice input. */
export interface ChatComposerVoiceHost {
  getSpaceId(): string;
  subscribeSpaceChange(listener: () => void): () => void;
}

export const noopChatComposerVoiceHost: ChatComposerVoiceHost = {
  getSpaceId: () => "",
  subscribeSpaceChange: () => () => {},
};

/** Host-owned view services consumed by the reusable composer UI. */
export interface ChatComposerViewHost {
  track(event: string): void;
  getChannel(): ChatComposerChannelSnapshot;
  getChannelTitle(): string | undefined;
  subscribeChannelTitle(listener: (title: string) => void): () => void;
  resolveMemberAvatar(uid: string): string;
  resolveMemberExternal(member: ChatComposerMember): {
    isExternal: boolean;
    sourceSpaceName: string;
  };
  resolveImageUrl(
    url: string,
    opts?: { width: number; height: number }
  ): string;
  openSecretCreate(value: string): void;
  voice?: ChatComposerVoiceHost;
}

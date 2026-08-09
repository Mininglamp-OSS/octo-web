import WKSDK, { Channel, ChannelInfo, ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { parseThreadChannelId } from "../../Service/Thread";
import { getImChannelInfo } from "../../im-runtime/channelRuntime";
import {
  type PageTitleContext,
  titleContextStore,
} from "../../features/documentTitle";

interface ChatTitleContextStore {
  set(menuId: string, context: PageTitleContext, owner?: symbol): void;
  clear(menuId: string, owner?: symbol): void;
}

interface ChatPageTitleControllerRuntime {
  getChannelInfo(channel: Channel): ChannelInfo | undefined;
  titleContextStore: ChatTitleContextStore;
}

function channelsEqual(a?: Channel, b?: Channel): boolean {
  return (
    !!a && !!b && a.channelID === b.channelID && a.channelType === b.channelType
  );
}

/**
 * Owns the title context of the complete conversation page.
 *
 * Navigation sources such as Contacts, search and notifications can open a
 * conversation without selecting an item in the recent-conversation sidebar.
 * The rendered page is therefore the source of truth for the browser title.
 */
export class ChatPageTitleController {
  private readonly titleContextOwner = Symbol("chat-page-title-context");
  private activePageOwner?: symbol;
  private channel?: Channel;
  private parentGroupChannel?: Channel;

  constructor(
    private readonly runtime: ChatPageTitleControllerRuntime = {
      getChannelInfo: (channel) => getImChannelInfo(WKSDK.shared(), channel),
      titleContextStore,
    }
  ) {}

  activate(channel: Channel, pageOwner: symbol): void {
    this.activePageOwner = pageOwner;
    this.channel = channel;
    this.parentGroupChannel = undefined;
    this.sync();
  }

  deactivate(pageOwner: symbol): void {
    if (this.activePageOwner !== pageOwner) return;
    this.clear();
  }

  clear(): void {
    this.activePageOwner = undefined;
    this.channel = undefined;
    this.parentGroupChannel = undefined;
    this.runtime.titleContextStore.clear("chat", this.titleContextOwner);
  }

  handleChannelInfoChanged(channelInfo: ChannelInfo): boolean {
    if (!this.activePageOwner || !this.channel) return false;
    if (
      !channelsEqual(channelInfo.channel, this.channel) &&
      !channelsEqual(channelInfo.channel, this.parentGroupChannel)
    ) {
      return false;
    }
    this.sync();
    return true;
  }

  private sync(): void {
    const channel = this.channel;
    if (!channel) return;

    const channelInfo = this.runtime.getChannelInfo(channel);
    const parentGroupNo =
      channel.channelType === ChannelTypeCommunityTopic
        ? (channelInfo?.orgData?.parentGroupNo as string | undefined) ||
          parseThreadChannelId(channel.channelID)?.groupNo
        : undefined;
    this.parentGroupChannel = parentGroupNo
      ? new Channel(parentGroupNo, ChannelTypeGroup)
      : undefined;

    const primaryTitle = channelInfo?.title?.trim();
    if (!primaryTitle) {
      this.runtime.titleContextStore.clear("chat", this.titleContextOwner);
      return;
    }

    const parentTitle = this.parentGroupChannel
      ? this.runtime.getChannelInfo(this.parentGroupChannel)?.title?.trim()
      : undefined;
    this.runtime.titleContextStore.set(
      "chat",
      { primaryTitle, parentTitle },
      this.titleContextOwner
    );
  }
}

export const chatPageTitleController = new ChatPageTitleController();

import { Channel, WKSDK, Message } from "wukongimjssdk";
import WKApp from "./App";
import React, { Component, ReactNode } from "react";
import { ChatContentPage } from "./Pages/Chat";
import { EndpointCategory, EndpointID } from "./Service/Const";
import { EndpointManager } from "./Service/Module";
import ConversationContext from "./Components/Conversation/context";
import { isChannelSearchEnabled } from "./Components/ChannelSearch/feature";

export class MessageContextMenus {
  title!: string;
  onClick?: () => void;
}

export class ShowConversationOptions {
  // 聊天消息定位的messageSeq
  initLocateMessageSeq?: number;
  /** 打开会话后同时展开右侧聊天记录搜索面板 */
  openChannelSearch?: boolean;
  /**
   * sidebar 列表内点击会话时传 true，避免被强制切到 recent。外部入口
   * （联系人/全局搜索/通知/bot store 等）不传，让 EndpointCommon 默认
   * 把 sidebar 切到 recent —— recent 是 filter='all'，能展示并高亮目标
   * 会话；不切的话用户在 follow tab 上打开未关注会话会"消失"。
   */
  fromSidebarList?: boolean;
}

/**
 * Layout 层渲染审批结果页使用的状态枚举（snake_case），
 * 对应 SpaceService.JoinSpaceStatus（SCREAMING_SNAKE_CASE，来自后端）：
 *   "NEED_APPROVAL" → "need_approval"
 *   "PENDING"       → "pending"
 */
export type JoinApprovalStatus = "need_approval" | "pending"

/** 将后端返回的 JoinSpaceStatus 映射为 JoinApprovalStatus */
export function toJoinApprovalStatus(status: "NEED_APPROVAL" | "PENDING"): JoinApprovalStatus {
    return status === "NEED_APPROVAL" ? "need_approval" : "pending"
}

export class EndpointCommon {
  private _onLogins: VoidFunction[] = []; // 登录成功
  private _onNeedJoinSpaces: VoidFunction[] = []; // 需要加入 Space 引导
  private _onJoinApprovals: Array<(status: JoinApprovalStatus, inviteCode: string) => void> = []; // 加入审批状态

  constructor() {
    this.registerShowConversation();
  }

  addOnLogin(v: VoidFunction) {
    this._onLogins?.push(v);
  }

  removeOnLogin(v: VoidFunction) {
    const len = this._onLogins.length;
    for (let i = 0; i < len; i++) {
      if (v === this._onLogins[i]) {
        this._onLogins.splice(i, 1);
        return;
      }
    }
  }

  /** 注册"无 Space 时需要引导加入"回调 */
  addOnNeedJoinSpace(v: VoidFunction) {
    this._onNeedJoinSpaces.push(v);
  }

  removeOnNeedJoinSpace(v: VoidFunction) {
    const len = this._onNeedJoinSpaces.length;
    for (let i = 0; i < len; i++) {
      if (v === this._onNeedJoinSpaces[i]) {
        this._onNeedJoinSpaces.splice(i, 1);
        return;
      }
    }
  }

  showConversation(channel: Channel, opts?: ShowConversationOptions) {
    WKApp.shared.openChannel = channel;

    const dispatch = () => {
      EndpointManager.shared.invoke(EndpointID.showConversation, {
        channel: channel,
        opts: opts,
      });
      WKApp.shared.notifyListener();
    };

    // If not already on the chat tab, switch to it first and wait one tick
    // for the chat subtree to mount before dispatching the conversation
    // event. Without this delay the UI can end up in a broken state when
    // the user later switches back to another tab.
    if (WKApp.switchToMenuById && WKApp.currentMenuId !== "chat") {
      WKApp.switchToMenuById("chat");
      setTimeout(dispatch, 50);
      return;
    }

    dispatch();
  }

  registerContactsHeader(
    id: string,
    callback: (param: any) => JSX.Element,
    sort?: number
  ) {
    EndpointManager.shared.setMethod(
      id,
      (param) => {
        return callback(param);
      },
      {
        sort: sort,
        category: EndpointCategory.contactsHeader,
      }
    );
  }
  contactsHeaders(): JSX.Element[] {
    return EndpointManager.shared.invokes(EndpointCategory.contactsHeader);
  }

  private registerShowConversation() {
    EndpointManager.shared.setMethod(
      EndpointID.showConversation,
      (param: any) => {
        const channel = param.channel as Channel;
        let opts: ShowConversationOptions = {}
        if (param.opts) {
          opts = param.opts
        }

        // 外部入口（联系人/全局搜索/通知/bot store）打开会话时把 sidebar 切到
        // recent —— recent tab filter='all'，不论目标是否关注都能展示并高亮；留在
        // follow tab 时未关注的会话不会出现在列表里也无法激活。sidebar 列表内
        // 点击则带 fromSidebarList=true，保持当前 tab，避免点 follow 列表里的
        // 会话被强切到 recent。followedKeys 检查放在 sidebar 列表点击侧（已在
        // follow tab 里的项必然 followed），这里不做 React-tree-外的同步读。
        if (!opts.fromSidebarList) {
          WKApp.mittBus.emit("wk:switch-sidebar-tab", "recent");
        }
        let initLocateMessageSeq = 0;
        if (opts && opts.initLocateMessageSeq && opts.initLocateMessageSeq > 0) {
          initLocateMessageSeq = opts.initLocateMessageSeq;
        }

        if (initLocateMessageSeq <= 0) {
          const conversation =
            WKSDK.shared().conversationManager.findConversation(channel);
          if (
            conversation &&
            conversation.lastMessage &&
            conversation.unread > 0 &&
            conversation.lastMessage.messageSeq > conversation.unread
          ) {
            initLocateMessageSeq =
              conversation.lastMessage.messageSeq - conversation.unread;
          }
        }

        let key = channel.getChannelKey()
        if (initLocateMessageSeq > 0) {
          key = `${key}-${initLocateMessageSeq}`
        }

        WKApp.routeRight.replaceToRoot(
          <ChatContentPage
            key={key}
            channel={channel}
            initLocateMessageSeq={initLocateMessageSeq}
            initialShowChannelSearch={
              !!opts.openChannelSearch && isChannelSearchEnabled(channel)
            }
          ></ChatContentPage>
        );
      },
      {}
    );
  }

  registerMessageContextMenus(
    sid: string,
    handle: (
      message: Message,
      context: ConversationContext
    ) => MessageContextMenus | null,
    sort?: number
  ) {
    EndpointManager.shared.setMethod(
      sid,
      (param: any) => {
        return handle(param.message, param.context);
      },
      {
        category: EndpointCategory.messageContextMenus,
        sort: sort,
      }
    );
  }

  messageContextMenus(
    message: Message,
    ctx: ConversationContext
  ): MessageContextMenus[] {
    return EndpointManager.shared.invokes(
      EndpointCategory.messageContextMenus,
      { message: message, context: ctx }
    );
  }

  registerChatToolbar(
    sid: string,
    handle: (ctx: ConversationContext) => React.ReactNode | undefined
  ) {
    EndpointManager.shared.setMethod(
      sid,
      (param) => {
        return handle(param);
      },
      {
        category: EndpointCategory.chatToolbars,
      }
    );
  }

  chatToolbars(ctx: ConversationContext): React.ReactNode[] {
    return EndpointManager.shared.invokes(EndpointCategory.chatToolbars, ctx);
  }

  chatToolbarsWithKey(ctx: ConversationContext): { sid: string; node: React.ReactNode }[] {
    const endpoints = EndpointManager.shared.getWithCategory(EndpointCategory.chatToolbars);
    const results: { sid: string; node: React.ReactNode }[] = [];
    if (endpoints && endpoints.length > 0) {
      for (const endpoint of endpoints) {
        const result = endpoint.handler!(ctx);
        if (result) {
          results.push({ sid: endpoint.sid, node: result });
        }
      }
    }
    return results;
  }

  registerChannelHeaderRightItem(
    id: string,
    callback: (param: any) => JSX.Element | undefined,
    sort?: number
  ) {
    EndpointManager.shared.setMethod(
      id,
      (param) => {
        return callback(param);
      },
      {
        category: EndpointCategory.channelHeaderRightItems,
        sort: sort,
      }
    );
  }

  channelHeaderRightItems(channel: Channel): JSX.Element[] {
    return EndpointManager.shared.invokes(
      EndpointCategory.channelHeaderRightItems,
      { channel: channel }
    );
  }

  organizationalTool(channel: Channel, render?: JSX.Element): JSX.Element {
    return EndpointManager.shared.invoke(EndpointCategory.organizational, {
      channel: channel,
      render: render,
    });
  }

  registerOrganizationalTool(
    sid: string,
    callback: (param: any) => JSX.Element | undefined
  ) {
    EndpointManager.shared.setMethod(
      EndpointCategory.organizational,
      (param) => {
        return callback(param);
      },
      {
        category: EndpointCategory.organizational,
      }
    );
  }

  organizationalLayer(channel: Channel | null, options?: { defaultCategoryId?: string; onSuccess?: () => void; keepSidebarTab?: boolean }): void {
    return EndpointManager.shared.invoke(EndpointCategory.organizationalLayer, {
      channel: channel,
      defaultCategoryId: options?.defaultCategoryId,
      onSuccess: options?.onSuccess,
      keepSidebarTab: options?.keepSidebarTab,
    });
  }

  registerOrganizationalLayer(sid: string, callback: (param: any) => void) {
    EndpointManager.shared.setMethod(
      EndpointCategory.organizationalLayer,
      (param) => {
        return callback(param);
      },
      {
        category: EndpointCategory.organizational,
      }
    );
  }

  chatMatterPanel(channel: Channel, onClose: () => void): JSX.Element | undefined {
    return EndpointManager.shared.invoke(EndpointCategory.chatMatterPanel, {
      channel,
      onClose,
    });
  }

  registerChatMatterPanel(
    sid: string,
    callback: (param: any) => JSX.Element | undefined
  ) {
    EndpointManager.shared.setMethod(
      EndpointCategory.chatMatterPanel,
      (param) => {
        return callback(param);
      },
      {
        category: EndpointCategory.chatMatterPanel,
      }
    );
  }

  /** v0.7 Matter 详情面板（跟子区/文件预览/事项列表可并存） */
  chatMatterDetailPanel(channel: Channel, onClose: () => void): JSX.Element | undefined {
    return EndpointManager.shared.invoke(EndpointCategory.chatMatterDetailPanel, {
      channel,
      onClose,
    });
  }

  registerChatMatterDetailPanel(
    sid: string,
    callback: (param: any) => JSX.Element | undefined
  ) {
    EndpointManager.shared.setMethod(
      EndpointCategory.chatMatterDetailPanel,
      (param) => {
        return callback(param);
      },
      {
        category: EndpointCategory.chatMatterDetailPanel,
      }
    );
  }

  chatSummaryPanel(
    channel: Channel,
    onClose: () => void,
  ): JSX.Element | undefined {
    return EndpointManager.shared.invoke(EndpointCategory.chatSummaryPanel, {
      channel,
      onClose,
    });
  }

  registerChatSummaryPanel(
    sid: string,
    callback: (param: any) => JSX.Element | undefined
  ) {
    EndpointManager.shared.setMethod(
      EndpointCategory.chatSummaryPanel,
      (param) => {
        return callback(param);
      },
      {
        category: EndpointCategory.chatSummaryPanel,
      }
    );
  }

  callOnLogin() {
    [...this._onLogins].forEach(fn => fn());
  }

  /** 触发"需要加入 Space"引导，Wave 2 注册路由回调后生效 */
  onNeedJoinSpace() {
    [...this._onNeedJoinSpaces].forEach(fn => fn());
  }

  /** 注册加入 Space 审批回调（Layout 监听，统一渲染审批结果页） */
  addOnJoinApproval(v: (status: JoinApprovalStatus, inviteCode: string) => void) {
    this._onJoinApprovals.push(v);
  }

  removeOnJoinApproval(v: (status: JoinApprovalStatus, inviteCode: string) => void) {
    const len = this._onJoinApprovals.length;
    for (let i = 0; i < len; i++) {
      if (v === this._onJoinApprovals[i]) {
        this._onJoinApprovals.splice(i, 1);
        return;
      }
    }
  }

  /** 触发加入 Space 审批状态，统一由 Layout state 渲染审批结果页 */
  onJoinApproval(status: JoinApprovalStatus, inviteCode: string) {
    [...this._onJoinApprovals].forEach(fn => fn(status, inviteCode));
  }
}

export class ChatToolbar {
  icon!: string;
  onClick?: () => void;
}

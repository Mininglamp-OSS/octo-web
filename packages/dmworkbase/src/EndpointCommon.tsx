import { Channel, WKSDK, Message } from "wukongimjssdk";
import WKApp from "./App";
import React, { Component, ReactNode } from "react";
import { ChatContentPage } from "./Pages/Chat";
import { EndpointCategory, EndpointID } from "./Service/Const";
import { EndpointManager } from "./Service/Module";
import ConversationContext from "./Components/Conversation/context";

export class MessageContextMenus {
  title!: string;
  onClick?: () => void;
}

export class ShowConversationOptions {
  // 聊天消息定位的messageSeq
  initLocateMessageSeq?: number;
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
    EndpointManager.shared.invoke(EndpointID.showConversation, {
      channel: channel,
      opts: opts,
    });
    WKApp.shared.notifyListener();
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

  organizationalLayer(channel: Channel, options?: { defaultCategoryId?: string; onSuccess?: () => void }): void {
    return EndpointManager.shared.invoke(EndpointCategory.organizationalLayer, {
      channel: channel,
      defaultCategoryId: options?.defaultCategoryId,
      onSuccess: options?.onSuccess,
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

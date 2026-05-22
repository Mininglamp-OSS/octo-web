import { Modal } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import WKSDK, { Channel, ChannelTypePerson } from "wukongimjssdk";
import React, { Component, HTMLProps, ReactNode } from "react";
import ConversationSelect from "../ConversationSelect";
import UserInfo from "../UserInfo";
import BotDetailModal from "../BotDetailModal";
import WKApp from "../../App";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import {
  ChannelInfoLike,
  ChannelInfoOrgDataLike,
  createUserInfoRouter,
  ExternalViewerGate,
  UserInfoRouter,
} from "./userInfoRouter";
import "./index.css";

/**
 * Default production ExternalViewerGate wired into WKBase.
 *
 * Mirrors UserInfoVM.isExternalToViewer() so a bot avatar click in an external
 * (cross-space) group is demoted to the UserInfo path, where
 * UserInfo.getBottomPanel applies the existing "仅可在群内交流" hint.
 * Without this gate, `dispatchUserInfo(..., isBot=true)` would open
 * BotDetailModal, which renders 发送消息 / 添加好友 purely from follow state
 * and bypasses the UI guard (reviewer lml2468, round-3 blocker).
 *
 * Data precedence is identical to UserInfoVM.isExternalToViewer:
 *   1) fromChannel subscriber orgData (highest-fidelity — group-scoped
 *      home_space fields) — only consulted for non-Person fromChannel since
 *      Person channels have no subscribers list;
 *   2) user-level channelInfo orgData (fallback for direct opens / 1v1);
 *   3) missing data → false (fail open, same as UserInfoVM) so cached-miss
 *      bots are never silently blocked.
 *
 * Exported for tests (see WKBaseExternalViewerGate.test.tsx) so the data-
 * precedence can be asserted without standing up the full WKBase tree.
 */
export function createDefaultExternalViewerGate(): ExternalViewerGate {
  return {
    isExternal: (uid, fromChannel, channelInfo) => {
      // 1) Group subscriber orgData (primary source, matches UserInfoVM step 1).
      if (fromChannel && fromChannel.channelType !== ChannelTypePerson) {
        const subscribers =
          (WKSDK.shared().channelManager.getSubscribes(fromChannel) as
            | { uid?: string; orgData?: ChannelInfoOrgDataLike }[]
            | null
            | undefined) ?? [];
        const sub = subscribers.find((s) => s && s.uid === uid);
        const org = sub?.orgData;
        if (org) {
          const { isExternal } = resolveExternalForViewer({
            homeSpaceId: org.home_space_id ?? null,
            homeSpaceName: org.home_space_name ?? null,
            isExternalLegacy: org.is_external ?? null,
            sourceSpaceNameLegacy: org.source_space_name ?? null,
            viewerSpaceId: WKApp.shared.currentSpaceId ?? null,
          });
          if (isExternal) return true;
        }
      }
      // 2) User-level channelInfo orgData (fallback, matches UserInfoVM step 2).
      const channelOrg = (channelInfo as ChannelInfoLike | null | undefined)
        ?.orgData;
      if (channelOrg) {
        const { isExternal } = resolveExternalForViewer({
          homeSpaceId: channelOrg.home_space_id ?? null,
          homeSpaceName: channelOrg.home_space_name ?? null,
          isExternalLegacy: channelOrg.is_external ?? null,
          sourceSpaceNameLegacy: channelOrg.source_space_name ?? null,
          viewerSpaceId: WKApp.shared.currentSpaceId ?? null,
        });
        if (isExternal) return true;
      }
      return false;
    },
  };
}

export interface WKBaseState {
  showUserInfo?: boolean;
  userUID?: string;
  vercode?: string; // 加好友的验证码
  fromChannel?: Channel;
  // GH#1112: Bot 资料弹窗共用同一个 uid 状态，但走独立 visible 标志，
  // 以便在命中 bot 时渲染可编辑的 BotDetailModal 而不是只读 UserInfo。
  showBotDetail?: boolean;
  showConversationSelect?: boolean;
  conversationSelectTitle?: string;
  conversationSelectKey?: number;
  showAlert?: boolean;
  alertContent?: string;
  alertTitle?: string;
  onAlertOk?: () => void;
  conversationSelectFinished?: (channel: Channel[]) => void;

  showGlobalModal?: boolean; // 显示全局弹窗
  globalModalOptions?: GlobalModalOptions;

  showJoinOrgInfo?: boolean;
  orgId?: string;
  orgCode?: string;
  orgUid?: string;
}

export class GlobalModalOptions {
  width?: string;
  height?: string;
  body?: ReactNode;
  footer?: ReactNode;
  className?: string;
  closable?: boolean;
  onCancel?: () => void;
}

export interface WKBaseProps {
  children: React.ReactNode;
  onContext?: (context: WKBaseContext) => void;
}

export interface WKBaseContext {
  // 显示最近会话选择
  showConversationSelect(
    onFinished?: (channels: Channel[]) => void,
    title?: string
  ): void;

  // 显示用户信息
  showUserInfo(uid: string, fromChannel?: Channel, vercode?: string): void;
  // 隐藏用户信息
  hideUserInfo(): void;
  // 弹出提示框
  showAlert(conf: { content: string; title?: string; onOk?: () => void }): void;

  showGlobalModal(options: GlobalModalOptions): void;

  // 显示加入组织
  showJoinOrgInfo(org_id: string, uid: string, code: string): void;

  hideGlobalModal(): void;
}

export default class WKBase
  extends Component<WKBaseProps, WKBaseState>
  implements WKBaseContext
{
  // PR#1113 review: bot-vs-human routing + stale-request guard are
  // delegated to a React-free production helper (UserInfoRouter). The helper
  // tracks a monotonically-increasing token so that a late-resolving async
  // fetchChannelInfo from an earlier click cannot overwrite the modal state
  // produced by a subsequent click / hideUserInfo / unmount.
  //
  // Round-4 blocker: the router now also receives an
  // ExternalViewerGate that mirrors UserInfoVM.isExternalToViewer. Bots in
  // cross-space external groups are demoted to the UserInfo path so the
  // existing "仅可在群内交流" hint fires — without it,
  // dispatchUserInfo(..., isBot=true) routes straight to BotDetailModal and
  // bypasses the UI guard (BotDetailModal renders 发送消息 / 添加好友 from
  // follow state alone).
  private userInfoRouter: UserInfoRouter = createUserInfoRouter(
    ({ uid, fromChannel, vercode, isBot }) => {
      this.dispatchUserInfo(uid, fromChannel, vercode, isBot);
    },
    createDefaultExternalViewerGate(),
  );

  constructor(props: any) {
    super(props);
    this.state = {};
  }
  showUserInfo(uid: string, fromChannel?: Channel, vercode?: string): void {
    // GH#1112: 统一的 "查看用户资料" 入口。机器人（robot === 1）必须走
    // BotDetailModal，这样 bot owner 才能继续编辑头像/简介，与通讯录 bot 卡片一致。
    // 此前只有 Contacts / Subscribers / GlobalSearch 等少数调用方手动区分 isBot，
    // 会话内点击 bot 头像 → 上下文菜单"查看用户信息"，以及私聊头像等入口落回到
    // 只读 UserInfo。将判定集中到这里，使所有 showUserInfo 调用自动获益。
    this.userInfoRouter.showUserInfo(uid, fromChannel, vercode);
  }

  private dispatchUserInfo(
    uid: string,
    fromChannel: Channel | undefined,
    vercode: string | undefined,
    isBot: boolean
  ): void {
    if (isBot) {
      this.setState({
        showBotDetail: true,
        showUserInfo: false,
        userUID: uid,
        fromChannel: undefined,
        vercode: undefined,
      });
      return;
    }
    this.setState({
      showUserInfo: true,
      showBotDetail: false,
      userUID: uid,
      fromChannel: fromChannel,
      vercode: vercode,
    });
  }

  showAlert(conf: {
    content: string;
    title?: string;
    onOk?: () => void;
  }): void {
    this.setState({
      alertContent: conf.content,
      alertTitle: conf.title,
      onAlertOk: conf.onOk,
      showAlert: true,
    });
  }

  showConversationSelect(
    onFinished?: (channels: Channel[]) => void,
    title?: string
  ) {
    this.setState((prev) => ({
      showConversationSelect: true,
      conversationSelectFinished: onFinished,
      conversationSelectTitle: title,
      // 每次打开递增 key，强制 ConversationSelect 重新挂载，
      // 让 useForwardModal 用当前 spaceId 重新拉数据，避免切 Space 后列表陈旧。
      conversationSelectKey: (prev.conversationSelectKey ?? 0) + 1,
    }));
  }

  hideUserInfo() {
    // 与 showUserInfo 对称：主动关闭时也视为一次状态变更，让 router 递增 token
    // 使任何在飞的 fetchChannelInfo 结果都被丢弃，避免关闭后又被晚到的 resolve
    // 重新打开 modal。
    this.userInfoRouter.invalidate();
    this.setState({
      showUserInfo: false,
      showBotDetail: false,
      userUID: undefined,
      vercode: undefined,
    });
  }

  showGlobalModal(options: GlobalModalOptions) {
    this.setState({
      showGlobalModal: true,
      globalModalOptions: options,
    });
  }
  hideGlobalModal() {
    this.setState({
      showGlobalModal: false,
    });
  }

  componentDidMount() {
    const { onContext } = this.props;
    if (onContext) {
      onContext(this);
    }
  }

  componentWillUnmount() {
    // Stale-guard: router.dispose() marks the router disposed and invalidates
    // the token so any unresolved fetchChannelInfo returning post-unmount is a
    // no-op (no setState-on-unmounted React warning).
    this.userInfoRouter.dispose();
  }

  cancelAlert() {
    this.setState({
      showAlert: false,
      alertContent: undefined,
      alertTitle: undefined,
      onAlertOk: undefined,
    });
  }

  showJoinOrgInfo(org_id: string, uid: string, code: string) {
    this.setState({
      showJoinOrgInfo: true,
      orgId: org_id,
      orgCode: code,
      orgUid: uid,
    });
  }

  render(): ReactNode {
    const {
      showUserInfo,
      showBotDetail,
      userUID,
      fromChannel,
      vercode,
      showConversationSelect,
      conversationSelectTitle,
      conversationSelectKey,
      conversationSelectFinished,
      onAlertOk,
      alertContent,
      alertTitle,
      showJoinOrgInfo,
      orgId,
      orgCode,
      orgUid,
    } = this.state;
    // join_org.html 由后端提供，需要通过 API 路径加载
    // Web 环境：apiURL = "/api/v1/"，replace 后得到 "/api/"，由 Nginx 代理到后端
    // Tauri/Electron 环境：apiURL = "https://host/v1/"，replace 后得到 "https://host/"
    const baseURL = WKApp.apiClient.config.apiURL.replace("v1/", "");
    return (
      <div className="wk-base">
        {this.props.children}
        <WKModal
          className="wk-base-modal-userinfo wk-base-modal"
          visible={showUserInfo}
          options={{ mask: false, closable: false }}
          onCancel={() => {
            this.setState({
              showUserInfo: false,
              userUID: undefined,
            });
          }}
        >
          {userUID && userUID !== "" ? (
            <UserInfo
              fromChannel={fromChannel}
              vercode={vercode}
              uid={userUID}
              onClose={() => {
                this.setState({
                  showUserInfo: false,
                  userUID: undefined,
                });
              }}
            ></UserInfo>
          ) : undefined}
        </WKModal>

        {/* GH#1112: Bot 资料弹窗，统一替代会话/消息场景下的只读 UserInfo，
            使 bot owner 在任何入口（通讯录 / 群聊 / 私聊 / 全局搜索 / 订阅者列表）
            都能看到可编辑的头像与简介。BotDetailModal 自带 WKModal，不再外层包裹。 */}
        <BotDetailModal
          uid={showBotDetail && userUID ? userUID : ""}
          visible={!!showBotDetail && !!userUID}
          onClose={() => {
            this.setState({
              showBotDetail: false,
              userUID: undefined,
            });
          }}
          onChat={(channel) => {
            this.setState({
              showBotDetail: false,
              userUID: undefined,
            });
            WKApp.endpoints.showConversation(channel);
          }}
        />

        <WKModal
          className="wk-base-modal wk-base-modal-forward"
          visible={showConversationSelect}
          options={{ mask: false, width: 625 }}
          onCancel={() => {
            this.setState({
              showConversationSelect: false,
            });
          }}
        >
          <ConversationSelect
            key={conversationSelectKey}
            onFinished={(channels: Channel[]) => {
              this.setState({
                showConversationSelect: false,
              });
              if (conversationSelectFinished) {
                conversationSelectFinished(channels);
              }
            }}
            onCancel={() => {
              this.setState({
                showConversationSelect: false,
              });
            }}
            title={conversationSelectTitle}
          ></ConversationSelect>
        </WKModal>

        <WKModal
          title={alertTitle}
          visible={this.state.showAlert}
          onCancel={() => { this.cancelAlert(); }}
          options={{ maskClosable: false }}
          footerConfig={{
            onOk: () => {
              if (onAlertOk) { onAlertOk(); }
              this.cancelAlert();
            },
          }}
        >
          {alertContent}
        </WKModal>
        <Modal
          closable={this.state.globalModalOptions?.closable}
          className={this.state.globalModalOptions?.className}
          visible={this.state.showGlobalModal}
          width={this.state.globalModalOptions?.width}
          footer={this.state.globalModalOptions?.footer}
          onCancel={this.state.globalModalOptions?.onCancel}
        >
          {this.state.globalModalOptions?.body}
        </Modal>
        {/* 加入组织 */}
        <WKModal
          visible={showJoinOrgInfo}
          title="加入组织"
          className="wk-base-modal-join-org"
          options={{ mask: false }}
          onCancel={() => {
            this.setState({
              showJoinOrgInfo: false,
              orgId: undefined,
              orgUid: undefined,
              orgCode: undefined,
            });
          }}
        >
          {orgId && orgUid && orgCode && (
            <iframe
              src={`${baseURL}web/join_org.html?org_id=${encodeURIComponent(orgId)}&uid=${encodeURIComponent(orgUid)}&code=${encodeURIComponent(orgCode)}`}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: "100%", height: "100%", border: "none" }}
            ></iframe>
          )}
        </WKModal>
      </div>
    );
  }
}

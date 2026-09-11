import { Modal, Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import { Channel, ChannelTypePerson, MessageText, WKSDK } from "wukongimjssdk";
import React, { Component, HTMLProps, ReactNode } from "react";
import ConversationSelect from "../ConversationSelect";
import type { ConversationSelectGrant } from "../ConversationSelect";
import type { DocForwardOpen, ForwardGrant } from "../ForwardModal/grant";
import { buildForwardMessageText } from "../ForwardModal/forwardMessageText";
import { DocumentShareCardContent } from "../../Messages/DocumentShareCard/DocumentShareCardContent";
import { isConversationDisbanded } from "../../Utils/groupDisband";
import { ForwardService, type ForwardResult, type ForwardSender } from "../../Service/ForwardService";
import { interpretForwardResult, shouldEmitDocForwarded } from "../../Service/forwardResultToast";
import { Dap } from "../../Service/Dap";
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
import { I18nContext } from "../../i18n";
import { isIncomingWebhookSender } from "../../Service/IncomingWebhook";
import { stripSpacePrefix } from "../../Service/SpacePrefix";
import {
  getCurrentImChannelSubscribers,
  syncCurrentImChannelSubscribers,
} from "../../im-runtime/currentChannelRuntime";
import {
  forwardChannelKey,
  partitionForwardSubscribers,
  type ForwardSubscriberLike,
} from "../ForwardModal/logic";
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
        const subscribers = getCurrentImChannelSubscribers(fromChannel) as {
          uid?: string;
          orgData?: ChannelInfoOrgDataLike;
        }[];
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
  conversationSelectGrant?: ConversationSelectGrant;
  showAlert?: boolean;
  alertContent?: string;
  alertTitle?: string;
  onAlertOk?: () => void;
  conversationSelectFinished?: (channel: Channel[]) => void;
  conversationSelectCancelled?: () => void;

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

/** A picker and its asynchronous send share one identity until cancellation or completion. */
interface ForwardOp {
  settled: boolean
  confirmed: boolean
  forward?: DocForwardOpen
  onCancel?: () => void
}

export interface WKBaseProps {
  children: React.ReactNode;
  onContext?: (context: WKBaseContext) => void;
}

export interface WKBaseContext {
  // 显示最近会话选择
  //
  // feature #511：新增可选第 3 参 `forward`。传入时渲染授权区，并由 host 侧编排
  // 「先授权后发」：展开目标频道成员 uid 快照 → await 授权 → 发普通 Text 消息 → 部分失败 Toast。
  // 既有调用方只传 (onFinished, title)，第 3 参缺省 → 行为完全不变。
  showConversationSelect(
    onFinished?: (channels: Channel[]) => void,
    title?: string,
    forward?: DocForwardOpen,
    onCancel?: () => void
  ): (() => void) | void;

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
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

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
    createDefaultExternalViewerGate()
  );

  constructor(props: any) {
    super(props);
    this.state = {};
  }
  showUserInfo(uid: string, fromChannel?: Channel, vercode?: string): void {
    // 群入站 Webhook 发送者（uid = iwh_*）不是真实用户，没有个人资料页：
    // 强制不打开资料卡（否则会出现「设置备注 / 发送消息」等无效操作）。
    // 集中在此入口拦截，覆盖头像点击 / 名字点击 / 上下文菜单等所有调用方。
    if (isIncomingWebhookSender(uid)) {
      return;
    }
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
    title?: string,
    forward?: DocForwardOpen,
    onCancel?: () => void
  ): (() => void) | void {
    if (this.currentForwardOp) this.cancelForward(this.currentForwardOp);
    const op: ForwardOp = { settled: false, confirmed: false, forward, onCancel };
    this.forwardOps.add(op);
    this.currentForwardOp = op;
    this.setState((prev) => ({
      showConversationSelect: true,
      conversationSelectFinished: onFinished,
      conversationSelectCancelled: onCancel,
      conversationSelectTitle: title,
      conversationSelectGrant: forward
        ? {
            canGrant: forward.canGrant,
            disabledReason: forward.disabledReason,
            defaultRole: forward.defaultRole ?? "reader",
            spaceId: forward.spaceId,
          }
        : undefined,
      conversationSelectKey: (prev.conversationSelectKey ?? 0) + 1,
    }));
    return () => this.cancelForward(op);
  }

  private currentForwardOp?: ForwardOp;
  private readonly forwardOps = new Set<ForwardOp>();
  private forwardUnmounted = false;

  private hideForwardPicker(op: ForwardOp): void {
    if (this.currentForwardOp !== op) return;
    this.currentForwardOp = undefined;
    if (!this.forwardUnmounted) this.setState({
      showConversationSelect: false,
      conversationSelectGrant: undefined,
      conversationSelectFinished: undefined,
      conversationSelectCancelled: undefined,
    });
  }

  private cancelForward(op: ForwardOp): void {
    if (op.settled) return;
    op.settled = true;
    this.forwardOps.delete(op);
    this.hideForwardPicker(op);
    if (op.confirmed) op.forward?.onError?.(new Error("Document forwarding cancelled"));
    else op.onCancel?.();
  }

  /**
   * Legacy fallback: expand selected targets into a de-duplicated uid snapshot
   * (contract 2): a group → its current subscriber uids (syncSubscribes → getSubscribes),
   * a person channel → the peer uid (channelID). Failures on one channel are skipped, never fatal.
   * Normal document forwards carry an already-reviewed, target-scoped principal snapshot and do
   * not call this method. For older role-only callers, explicitly identified Bots are excluded
   * while unknown legacy rows retain their historical human treatment.
   */
  private async collectForwardUids(channels: Channel[]): Promise<string[]> {
    const uids = new Set<string>();
    for (const ch of channels) {
      if (ch.channelType === ChannelTypePerson) {
        if (ch.channelID) uids.add(stripSpacePrefix(ch.channelID));
        continue;
      }
      try {
        await syncCurrentImChannelSubscribers(ch);
      } catch {
        // best-effort: fall back to whatever is already cached
      }
      const subs = getCurrentImChannelSubscribers(
        ch
      ) as ForwardSubscriberLike[];
      const { humans, unknown } = partitionForwardSubscribers(subs);
      for (const s of [...humans, ...unknown]) {
        if (s?.uid) uids.add(s.uid);
      }
    }
    return [...uids];
  }

  /** feature #511: host-side "先授权后发" — grant (opt-in) then send `**title**\n[title](link)`. */
  private async runDocForward(
    channels: Channel[],
    grant: ForwardGrant | undefined,
    forward: DocForwardOpen,
    op?: ForwardOp
  ): Promise<void> {
    const { t } = this.context;

    // Capture source space BEFORE any async grant/load, so no send proceeds
    // under a different currentSpaceId.
    const sourceSpaceId = WKApp.shared.currentSpaceId;

    let grantFailures: string[] | undefined;
    let grantRejections: string[] | undefined;
    let interrupted = false;
    const isDead = (): boolean => interrupted || this.forwardUnmounted || op?.settled === true ||
      WKApp.shared.currentSpaceId !== sourceSpaceId || forward.isActive?.() === false;
    const reportError = (error: unknown): void => {
      if (interrupted) return;
      interrupted = true;
      if (op?.settled) return;
      if (op) { op.settled = true; this.forwardOps.delete(op); }
      forward.onError?.(error);
    };
    if (isDead()) {
      reportError(new Error("Forward source is no longer active"));
      return;
    }

    // 0) disband guard 提前一次，仅为 grant 阶段决定是否有可授权目标。真正的 send 阶段
    // disband 计入交给 ForwardService（它同样过滤 disband 并计入 failedTargets）。
    const sendable = channels.filter((ch) => !isConversationDisbanded(ch));
    if (sendable.length === 0) {
      Toast.error(t("base.forwardModal.grant.sendFailed"));
      if (op) { op.settled = true; this.forwardOps.delete(op); }
      forward.onResult?.({
        sent: 0,
        failed: channels.length,
        grantFailures: undefined,
        grantRejections: undefined,
      });
      return;
    }

    // 1) grant first (先授权后发). Only when the switch is on AND docs injected an executor.
    if (grant && forward.grantAccess) {
      try {
        let uids: string[];
        if (grant.principalsByTarget !== undefined) {
          const sendableKeys = new Set(
            sendable.map((channel) => forwardChannelKey(channel))
          );
          uids = [
            ...new Set(
              grant.principalsByTarget
                .filter((target) => sendableKeys.has(forwardChannelKey(target)))
                .flatMap((target) => target.uids)
                .filter(Boolean)
            ),
          ];
        } else {
          // Compatibility for role-only / pre-provenance callers. Humans are expanded only from
          // current sendable targets. Aggregate legacy botUids have no target attribution, so when
          // any target is no longer sendable they are omitted rather than risking an access leak.
          const humanUids = await this.collectForwardUids(sendable);
          const legacyBotUids = sendable.length === channels.length ? grant.botUids ?? [] : [];
          uids = [...new Set([...humanUids, ...legacyBotUids])];
        }
        if (uids.length > 0) {
          // Liveness check before granting: cancelled or inactive source must not grant.
          if (isDead()) {
            reportError(new Error("Forward source invalidated before grant execution"));
            return;
          }
          const res = await forward.grantAccess(uids, grant.role);
          if (res.failed > 0) grantFailures = res.failures;
          if (res.rejected && res.rejected.length > 0)
            grantRejections = res.rejected;
        }
      } catch (error) {
        if (isDead()) { reportError(error); return; }
        // A grant failure must not block sending the message — the receiver can still
        // request access (screen 4c). Surface it as a non-fatal warning.
        Toast.warning(t("base.forwardModal.grant.grantFailed"));
      }
    }

    if (isDead()) {
      reportError(new Error("Forward source invalidated after grant"));
      return;
    }

    // 2) build the content factory.
    //
    // 只有**文档分享转发**（startDocForward，显式 shareAsCard=true）才发文档卡片
    // （DocumentShareCardContent=18）。其它复用同一转发通道但语义不同的流程——尤其
    // html-doc「让 AI 处理」的**指令转发**（带 docId + 专属锚点链接）——绝不能因带 docId
    // 被误转成卡片而丢失指令链接/锚点，一律回退纯文本 markdown（Jerry-Xin blocker）。
    const contentFactory = forward.shareAsCard
      ? () => {
          const card = new DocumentShareCardContent();
          card.docId = forward.docId ?? "";
          // 严格用文档自身 space：绝不回退到发送者当前 space（文档可能不在该 space），
          // 否则接收端预览会带错 X-Space-Id 触发 ACL/403。缺失时留空，让后端按 docId 解析。
          card.spaceId = forward.spaceId ?? "";
          card.kind = forward.kind ?? "doc";
          card.title = forward.messageTitle;
          card.ownerName = forward.ownerName ?? "";
          card.updatedAt = forward.updatedAt ?? "";
          card.url = forward.link;
          card.permission = grant?.role ?? forward.defaultRole ?? "reader";
          return card;
        }
      : () =>
          new MessageText(
            buildForwardMessageText(forward.messageTitle, forward.link)
          );

    if (isDead()) {
      reportError(new Error("Forward source invalidated before send"));
      return;
    }

    // ForwardService still owns filtering and accounting. Guard at the actual SDK boundary,
    // including ordinary Web callers; a Client can additionally revalidate its source in main.
    const sender: ForwardSender = async (content, channel, setting) => {
      try {
        if (isDead()) throw new Error("Forward source is no longer active");
        if (forward.beforeSend) await forward.beforeSend();
        if (isDead()) throw new Error("Forward source is no longer active");
      } catch (error) {
        reportError(error);
        throw error;
      }
      return WKSDK.shared().chatManager.send(content, channel, setting);
    };

    const result: ForwardResult = await ForwardService.send(
      channels, contentFactory,
      {
        spaceId: sourceSpaceId,
        sender,
      },
    );

    if (isDead()) {
      reportError(new Error("Forward invalidated during send"));
      return;
    }

    // 3) partial-failure Toast (reuse the dmworksummary范式). 分母维度用 targets，
    // 保留旧的用户可见语义（原代码 total=channels.length，即 result.targets）。
    const state = interpretForwardResult(result, "targets");
    // Octo-Q head 258e876e P1 / head 86c932a5 🔴: document_forwarded fires here on the real
    // forward-send success path (>=1 target sent), NOT on the opt-in grant batch endpoint
    // (default-off switch → default forward produced zero events). Gated on shareAsCard===true:
    // runDocForward is shared by (1) doc-card share (shareAsCard true → count) and (2) the
    // html-doc "让 AI 处理" AI-instruction forward (shareAsCard unset → do NOT count; it is an
    // AI-workflow gesture, not the doc-forward-btn that emits document_forward_panel_opened).
    // Contract: ForwardModal/grant.ts DocForwardOpen.shareAsCard (only share sets it true) and
    // the contentFactory branch three lines above. Once per share-forward gesture; {} props.
    if (shouldEmitDocForwarded(forward.shareAsCard, state.kind)) {
        Dap.shared.track("document_forwarded", {});
    }
    if (state.kind === "all-failed") {
      Toast.error(t("base.forwardModal.grant.sendFailed"));
    } else if (state.kind === "partial") {
      Toast.error(
        t("base.forwardModal.grant.partialSendFailed", {
          values: { failed: state.failed, total: state.total },
        })
      );
    } else if (grantRejections && grantRejections.length > 0) {
      Toast.warning(
        t("base.forwardModal.grant.grantRejected", {
          values: { failed: grantRejections.length },
        })
      );
    } else if (grantFailures && grantFailures.length > 0) {
      Toast.warning(
        t("base.forwardModal.grant.partialGrantFailed", {
          values: { failed: grantFailures.length },
        })
      );
    } else {
      Toast.success(t("base.forwardModal.grant.forwarded"));
    }

    const sent = state.total - state.failed;
    if (op) { op.settled = true; this.forwardOps.delete(op); }
    forward.onResult?.({
      sent,
      failed: state.failed,
      grantFailures,
      grantRejections,
    });
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
    this.forwardUnmounted = false;
    const { onContext } = this.props;
    if (onContext) {
      onContext(this);
    }
  }

  componentWillUnmount() {
    this.forwardUnmounted = true;
    for (const op of [...this.forwardOps]) this.cancelForward(op);
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
      conversationSelectGrant,
      conversationSelectFinished,
      onAlertOk,
      alertContent,
      alertTitle,
      showJoinOrgInfo,
      orgId,
      orgCode,
      orgUid,
    } = this.state;
    const renderForwardOp = this.currentForwardOp;
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
          width={625}
          options={{ mask: false }}
          onCancel={() => {
            if (renderForwardOp) this.cancelForward(renderForwardOp);
          }}
        >
          <ConversationSelect
            key={conversationSelectKey}
            grant={conversationSelectGrant}
            onFinished={(channels: Channel[], grant) => {
              if (!renderForwardOp || renderForwardOp !== this.currentForwardOp ||
                  renderForwardOp.settled || renderForwardOp.confirmed) return;
              renderForwardOp.confirmed = true;
              const forward = renderForwardOp.forward;
              this.hideForwardPicker(renderForwardOp);
              if (forward) {
                // feature #511: host owns "先授权后发" + send + partial-failure Toast.
                void this.runDocForward(channels, grant, forward, renderForwardOp).catch((error) => {
                  if (renderForwardOp.settled) return;
                  renderForwardOp.settled = true;
                  this.forwardOps.delete(renderForwardOp);
                  forward.onError?.(error);
                });
                return;
              }
              renderForwardOp.settled = true;
              this.forwardOps.delete(renderForwardOp);
              conversationSelectFinished?.(channels);
            }}
            onCancel={() => {
              if (renderForwardOp) this.cancelForward(renderForwardOp);
            }}
            title={conversationSelectTitle}
          ></ConversationSelect>
        </WKModal>

        <WKModal
          title={alertTitle}
          visible={this.state.showAlert}
          onCancel={() => {
            this.cancelAlert();
          }}
          options={{ maskClosable: false }}
          footerConfig={{
            onOk: () => {
              if (onAlertOk) {
                onAlertOk();
              }
              this.cancelAlert();
            },
          }}
        >
          <p className="wk-modal-confirm-text">{alertContent}</p>
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
          title={this.context.t("base.wkBase.joinOrganization")}
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
              src={`${baseURL}web/join_org.html?org_id=${encodeURIComponent(
                orgId
              )}&uid=${encodeURIComponent(orgUid)}&code=${encodeURIComponent(
                orgCode
              )}`}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: "100%", height: "100%", border: "none" }}
            ></iframe>
          )}
        </WKModal>
      </div>
    );
  }
}

import React from "react";
import { type Action, type AdaptiveCard } from "adaptivecards";
import { Toast } from "@douyinfe/semi-ui";
import WKApp from "../../App";
import { getMessageRow } from "../../bridge/message/useMessageRow";
import { isMessageSelectable } from "../../Service/messageSelection";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import MessageRow from "../../ui/message/MessageRow";
import ReplyBlock from "../../ui/message/ReplyBlock";
import { MessageCell } from "../MessageCell";
import { t } from "../../i18n";
import {
  isRetryableCardActionError,
  resolveCardActionChannelId,
  submitCardAction,
} from "./cardAction";
import { isAgentProgressCard } from "./cardLayout";
import { InteractiveCardContent } from "./InteractiveCardContent";
import { decideCardBody, type CardDecision } from "./renderDecision";
import { resolveEffectiveCardContent } from "./resolveContent";
import { copyText, openUrl } from "./renderer/actions";
import {
  DOCS_DENY_REASON_INPUT_ID,
  isDocsDenyAction,
  openDocsDenyReasonDialog,
} from "./denyReasonDialog";
import { collectCardInputs, validateCardInputs } from "./sdk/cardInputs";
import {
  enhanceRenderedOctoCard,
  renderOctoCard,
} from "./sdk/renderOctoCard";
import { classifyCardSender, fetchSenderChannelInfo } from "./senderTrust";
import "./index.css";

export { InteractiveCardContent } from "./InteractiveCardContent";

/** 提交动作后的 loading 超时（契约：10s 无响应恢复可点）。 */
const SUBMIT_TIMEOUT_MS = 10000;

/**
 * 根据当前查看 Space 解析被引用消息发送者的「外部来源 Space 名」。
 * 与 TextCell / RichTextCell 保持同一套 resolve 规则。
 */
function resolveReplySourceSpaceName(reply: any): string {
  if (!reply) return "";
  const { isExternal, sourceSpaceName } = resolveExternalForViewer({
    homeSpaceId: reply.from_home_space_id as string | undefined,
    homeSpaceName: reply.from_home_space_name as string | undefined,
    isExternalLegacy:
      reply.from_is_external === 1 || reply.from_is_external === true ? 1 : 0,
    sourceSpaceNameLegacy: reply.from_source_space_name as string | undefined,
    viewerSpaceId: WKApp.shared.currentSpaceId,
  });
  return isExternal && sourceSpaceName ? sourceSpaceName : "";
}

/**
 * 纯文本渲染（保留换行）。**不走 markdown/HTML** —— 这是 fallback / 不可信发送者
 * 展示面的安全前提，避免 `[x](javascript:)` 之类被解析成活链接。
 */
function renderPlainText(text: string, keyPrefix: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={`${keyPrefix}-line-${i}`}>
      {line}
      {i !== lines.length - 1 ? <br /> : null}
    </span>
  ));
}

/**
 * InteractiveCard(=17) 互动卡片消息 Cell。
 *
 * 渲染形态：**官方 AdaptiveCards SDK + octo 策略层**。
 *   - sender trust gate / profile 协商 / octo 预校验（decideCardBody）先行；
 *   - 通过后用 SDK 命令式挂载到 ref 节点（render 走 React，卡片 DOM 走 SDK）；
 *   - 未知/损坏/越界 / 非可信 → plain（整卡降级，契约要求，非 per-element）。
 *
 * 交互闭环（仅 bot 卡）：Action.Submit → 收集 Input 值（客户端预校验）→ POST message/card/action
 *   （no-data，D11）→ loading + 10s 超时；bot 重写卡后新帧经 extra-sync 到达重挂载、重置交互态。
 *   webhook 卡展示-only（输入置灰、不提交）。Action.OpenUrl 始终可用（isSafeUrl 守卫）。
 */
export class InteractiveCardCell extends MessageCell {
  /** 避免对同一 pending 发送者重复 fetch。 */
  private _fetchedSenderInfo = false;
  /** SDK 卡片挂载点。 */
  private cardMountRef = React.createRef<HTMLDivElement>();
  /** 已挂载卡片的内容指纹；内容不变则不重挂载（保护后续输入交互态）。 */
  private renderedKey: string | null = null;
  /** 组件是否仍挂载（异步回调卸载守卫）。 */
  private mounted = false;
  /**
   * 提交代次。每次提交/新帧重置/卸载递增；异步回调只在自己的代次仍是当前代次时才生效，
   * 从而忽略「已被新提交、新帧或卸载取代」的过期响应/超时，避免竞态覆盖 UI 态。
   */
  private submitGen = 0;
  /** 提交进行中（loading）。 */
  private submitting = false;
  /** 提交错误提示（i18n 文案）。 */
  private submitError: string | null = null;
  /** 10s 超时句柄。 */
  private submitTimer: ReturnType<typeof setTimeout> | null = null;

  componentDidMount() {
    super.componentDidMount?.();
    this.mounted = true;
    this.ensureSenderTrustResolvable();
    this.syncSdkCard();
  }

  componentDidUpdate() {
    this.ensureSenderTrustResolvable();
    this.syncSdkCard();
  }

  componentWillUnmount() {
    (super.componentWillUnmount as (() => void) | undefined)?.call(this);
    this.mounted = false;
    this.submitGen++; // 使在飞提交的响应/超时作废，不再 forceUpdate 已卸载实例。
    this.clearSubmitTimer();
  }

  /**
   * trust 判定为 pending（非 webhook 且发送者 channelInfo 未命中）时主动拉取，
   * 到达后由基类 channelInfo listener 触发重渲，重新分类。fail-closed 期间渲 plain。
   */
  private ensureSenderTrustResolvable() {
    if (this._fetchedSenderInfo) return;
    const { message } = this.props;
    const content = message.content as InteractiveCardContent;
    const effective = resolveEffectiveCardContent(content, message.remoteExtra);
    const uid =
      classifyCardSender(message.fromUID) === "pending"
        ? message.fromUID
        : effective.forwardedFromUID;
    if (classifyCardSender(uid) === "pending" && uid) {
      this._fetchedSenderInfo = true;
      fetchSenderChannelInfo(uid);
    }
  }

  /**
   * 计算当前有效帧的 plain 文案与渲染决策（render 与 syncSdkCard 共用，保持一致）。
   *
   * 编辑更新：bot 改卡后新帧存于 remoteExtra.contentEdit（SDK 已按 type=17 解码），
   * 择优渲染编辑帧；CMD 增量重渲链路由 ConversationVM 提供，本 Cell 只读最新帧。
   */
  private computeState(): { plain: string; decision: CardDecision } {
    const { message } = this.props;
    const content = message.content as InteractiveCardContent;
    const effective = resolveEffectiveCardContent(content, message.remoteExtra);
    const plain = effective.plain?.trim()
      ? effective.plain
      : effective.conversationDigest;
    const decision = decideCardBody({
      fromUID: message.fromUID,
      forwardedFromUID: effective.forwardedFromUID,
      profile: effective.profile,
      cardVersion: effective.cardVersion,
      card: effective.card,
    });
    return { plain, decision };
  }

  /**
   * 决策为 card 时用 SDK 挂载到 ref。按内容指纹去重：内容不变不重挂载，避免重置用户输入态；
   * 新帧（编辑收敛）指纹变化则重挂载并**重置交互态**（契约：新帧重置 loading/错误）。
   * SDK 渲染异常 → fail-safe 退 plain。
   */
  private syncSdkCard() {
    const target = this.cardMountRef.current;
    if (!target) {
      this.renderedKey = null;
      return;
    }
    const { plain, decision } = this.computeState();
    if (decision.kind !== "card") {
      this.renderedKey = null;
      return;
    }
    const key = `${decision.allowInteractive ? "v2" : "v1"}:${JSON.stringify(
      decision.card
    )}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    // 新帧到达：作废在飞提交（响应/超时不再生效）并重置交互态（loading/错误/超时）。
    const wasBusy = this.submitting || this.submitError !== null;
    this.submitGen++;
    this.clearSubmitTimer();
    this.submitting = false;
    this.submitError = null;
    try {
      renderOctoCard({
        card: decision.card,
        target,
        onAction: (action, card) => this.handleCardAction(action, card),
        tableCopyLabel: t("base.message.interactiveCard.copyTable"),
        onTableCopy: (text) => this.handleTableCopy(text),
      });
    } catch {
      // 已过 octo 预校验仍渲染失败属极端边角 → fail-safe 渲纯文本（不走 markdown/HTML）。
      target.textContent = plain;
    }
    if (wasBusy) this.forceUpdate(); // 清除 loading/错误的外层态（不会重挂载：key 已一致）。
  }

  private handleTableCopy(text: string) {
    void copyText(text)
      .then(() => {
        Toast.success(t("base.message.interactiveCard.copySuccess"));
      })
      .catch(() => {
        Toast.warning(t("base.message.interactiveCard.copyFailed"));
      });
  }

  private enhanceMountedCard() {
    const target = this.cardMountRef.current;
    if (!target) return;
    const { decision } = this.computeState();
    if (decision.kind !== "card") return;
    enhanceRenderedOctoCard({
      card: decision.card,
      target,
      onAction: (action, card) => this.handleCardAction(action, card),
      tableCopyLabel: t("base.message.interactiveCard.copyTable"),
      onTableCopy: (text) => this.handleTableCopy(text),
    });
  }

  private scheduleEnhanceMountedCard() {
    const run = () => this.enhanceMountedCard();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
      return;
    }
    setTimeout(run, 0);
  }

  /**
   * SDK 动作回调。
   *   - Action.OpenUrl：新标签打开（openUrl 内部 isSafeUrl 二次校验）；始终可用；
   *   - Action.ToggleVisibility：SDK 已原生翻转目标 isVisible，这里不做业务副作用；
   *   - Action.CopyToClipboard：本地复制显式声明的 text；
   *   - Action.Submit：仅 bot 卡（decision.interactive）提交，走 no-data 闭环。
   */
  private handleCardAction(action: Action, card: AdaptiveCard) {
    const type = action.getJsonTypeName();
    if (type === "Action.OpenUrl") {
      const url = (action as unknown as { url?: unknown }).url;
      if (typeof url === "string") openUrl(url);
      return;
    }
    if (type === "Action.ToggleVisibility") {
      this.scheduleEnhanceMountedCard();
      return;
    }
    if (type === "Action.CopyToClipboard") {
      const text = (action as unknown as { text?: unknown }).text;
      if (typeof text !== "string") return;
      void copyText(text)
        .then(() => {
          Toast.success(t("base.message.interactiveCard.copySuccess"));
        })
        .catch(() => {
          Toast.warning(t("base.message.interactiveCard.copyFailed"));
        });
      return;
    }
    if (type === "Action.Submit") {
      this.handleSubmit(action, card);
    }
  }

  private handleSubmit(action: Action, card: AdaptiveCard) {
    const { decision } = this.computeState();
    // P3：仅 bot 卡可交互；webhook 展示-only（UI 已置灰，此处双保险）。
    if (decision.kind !== "card" || !decision.interactive) return;
    if (this.submitting) return; // 防重复点击（幂等仍由服务端保证）。

    const actionId = (action as unknown as { id?: unknown }).id;
    if (typeof actionId !== "string" || actionId.trim() === "") return;

    // 文档访问申请「拒绝」需先弹窗采集必填原因，原因随 inputs[deny_reason] 提交
    // （服务端在卡片里声明了该隐藏输入 id）。其余动作直接提交。
    // 前后兼容：仅当命中 docs 拒绝动作、且当前帧确实声明了 deny_reason 输入时才走弹窗。
    // 改动前投递的老审批卡没有该隐藏输入，若仍提交 inputs[deny_reason] 会被服务端「未声明
    // 的 input」拒（400），故老卡点拒绝回退到原逻辑（直接提交、无原因）。getAllInputs 仅在
    // 命中拒绝动作时才需要，短路在 isDocsDenyAction 之后，避免每次提交都遍历输入树。
    const data = (action as unknown as { data?: Record<string, unknown> }).data;
    if (
      isDocsDenyAction(data) &&
      card.getAllInputs().some((input) => input.id === DOCS_DENY_REASON_INPUT_ID)
    ) {
      // isDocsDenyAction is a type guard → data is narrowed to non-null here.
      const asString = (v: unknown) => (typeof v === "string" ? v : undefined);
      void openDocsDenyReasonDialog({
        docTitle: asString(data.doc_title),
        actorName: asString(data.actor),
        requestNo: asString(data.request_id),
      }).then((reason) => {
        if (reason == null) return; // 取消 → 不提交。
        // 弹窗期间可能已卸载 / 被新帧取代 / 已在提交——重新确认可提交再走。
        if (!this.mounted || this.submitting) return;
        const current = this.computeState().decision;
        if (current.kind !== "card" || !current.interactive) return;
        this.performSubmit(card, actionId, { [DOCS_DENY_REASON_INPUT_ID]: reason });
      });
      return;
    }

    this.performSubmit(card, actionId, null);
  }

  /**
   * 实际提交一次卡片动作。extraInputs（如拒绝原因）合并进声明输入后一并上行；
   * 提交态/超时/代次判活与原逻辑一致。
   */
  private performSubmit(
    card: AdaptiveCard,
    actionId: string,
    extraInputs: Record<string, string> | null
  ) {
    const inputs = collectCardInputs(card);
    if (extraInputs) Object.assign(inputs, extraInputs);
    const invalid = validateCardInputs(inputs);
    if (invalid) {
      this.submitError = t(
        invalid === "field-too-long"
          ? "base.message.interactiveCard.inputTooLong"
          : "base.message.interactiveCard.inputTooLarge"
      );
      this.forceUpdate();
      return;
    }

    // 先取 channel（缺失则无法提交，早退，避免卡在 loading）。
    const { message } = this.props;
    const channel = message.channel;
    if (!channel) return;

    // person DM 与系统 bot（notification 等）的 recv 包 channelID 可能塌缩为接收人
    // 自身 uid，直接回传会让服务端 fakeChannel(self,self) miss → 400。回退到权威对端
    // message.fromUID，确保 channel_id 与服务端存储键一致（群/普通 DM 为 no-op）。
    const channelId = resolveCardActionChannelId({
      channelType: channel.channelType,
      channelID: channel.channelID,
      fromUID: message.fromUID,
      selfUID: WKApp.loginInfo.uid,
    });

    // 本次提交代次：使此前提交/超时/新帧作废，且异步回调据此判活。
    const gen = ++this.submitGen;
    this.submitError = null;
    this.submitting = true;
    this.forceUpdate();
    this.armSubmitTimer(gen);

    submitCardAction({
      messageId: message.messageID,
      channelId,
      channelType: channel.channelType,
      actionId,
      inputs,
    })
      .then(() => {
        // 受理成功（含 replay）：保持 loading 等 bot 重写的新帧到达（syncSdkCard 重置）；
        // 若 bot 迟迟不重写，10s 超时兜底恢复可点。无需在此变更状态。
      })
      .catch((err) => {
        // 已卸载 / 被新提交或新帧取代 → 忽略过期响应，不覆盖当前 UI 态。
        if (!this.mounted || gen !== this.submitGen) return;
        this.clearSubmitTimer();
        this.submitting = false;
        this.submitError = t(
          isRetryableCardActionError(err)
            ? "base.message.interactiveCard.submitRetry"
            : "base.message.interactiveCard.submitFailed"
        );
        this.forceUpdate();
      });
  }

  private armSubmitTimer(gen: number) {
    this.clearSubmitTimer();
    this.submitTimer = setTimeout(() => {
      this.submitTimer = null;
      // 仅当仍是本次提交、且组件在挂载时恢复可点。
      if (!this.mounted || gen !== this.submitGen) return;
      this.submitting = false;
      this.forceUpdate(); // 10s 超时恢复可点。
    }, SUBMIT_TIMEOUT_MS);
  }

  private clearSubmitTimer() {
    if (this.submitTimer) {
      clearTimeout(this.submitTimer);
      this.submitTimer = null;
    }
  }

  render() {
    const { message, context } = this.props;

    const selectionMode = context.editOn();
    const selectable = isMessageSelectable(message);
    const rowProps = getMessageRow(
      message,
      {
        selectionMode,
        showCheckbox: selectionMode && selectable,
        isSelected: selectable && !!message.checked,
        onSelect: selectable
          ? (selected) => context.checkeMessage(message.message, selected)
          : undefined,
      },
      {
        onAvatarClick: (uid, e) => context.onTapAvatar(uid, e),
        onSenderNameClick: (uid) => context.showUser(uid),
      }
    );

    const reply = (message.content as any).reply;
    const { plain, decision } = this.computeState();
    const agentProgress =
      decision.kind === "card" && isAgentProgressCard(decision.card);

    return (
      <MessageRow
        {...rowProps}
        onContextMenu={(event) => context.showContextMenus(message, event)}
        isActive={context.isContextMenuOpen(message.message)}
        onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
        onSenderNameClick={() => context.showUser(message.fromUID)}
      >
        <div
          className={
            "wk-interactive-card" +
            (agentProgress ? " wk-interactive-card--agent-progress" : "")
          }
        >
          {reply && (
            <ReplyBlock
              fromName={reply.fromName || ""}
              digest={reply.content?.conversationDigest || ""}
              sourceSpaceName={resolveReplySourceSpaceName(reply)}
              onClick={() => context.locateMessage(reply.messageSeq)}
            />
          )}
          {this.renderBody(decision, plain, message.clientMsgNo, agentProgress)}
        </div>
      </MessageRow>
    );
  }

  /**
   * 把决策映射成 JSX。card → SDK 挂载点（DOM 由 syncSdkCard 注入）+ loading/只读/错误覆盖；
   * hint/plain → 纯文本。集中兜底，对齐服务端「无 per-element fallback」契约。
   */
  private renderBody(
    decision: CardDecision,
    plain: string,
    keyPrefix: string,
    agentProgress: boolean
  ): React.ReactNode {
    switch (decision.kind) {
      case "card": {
        const cls =
          "wk-interactive-card-sdk" +
          (agentProgress ? " wk-interactive-card-sdk--agent-progress" : "") +
          (this.submitting ? " wk-interactive-card-sdk--submitting" : "") +
          // webhook 卡展示-only：输入置灰不可交互（提交侧另有 handleSubmit 双保险）。
          (decision.interactive ? "" : " wk-interactive-card-sdk--readonly");
        return (
          <>
            <div className={cls} ref={this.cardMountRef} />
            {this.submitError && (
              <div className="wk-interactive-card-error" role="alert">
                {this.submitError}
              </div>
            )}
          </>
        );
      }
      case "hint":
        return (
          <div className="wk-interactive-card-plain">
            {renderPlainText(plain, keyPrefix)}
            <div className="wk-interactive-card-hint">
              {t("base.message.interactiveCard.needUpdate")}
            </div>
          </div>
        );
      case "plain":
      default:
        return (
          <div className="wk-interactive-card-plain">
            {renderPlainText(plain, keyPrefix)}
          </div>
        );
    }
  }
}

export default InteractiveCardCell;

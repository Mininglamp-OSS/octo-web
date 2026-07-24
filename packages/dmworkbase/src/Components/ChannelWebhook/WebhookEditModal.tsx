import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Channel } from "wukongimjssdk";
import { Switch, Toast } from "@douyinfe/semi-ui";
import { IconAlertTriangle } from "@douyinfe/semi-icons";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import AiBadge from "../AiBadge";
import { useI18n } from "../../i18n";
import { extractErrorMsg } from "../../Service/APIClient";
import {
  IncomingWebhook,
  IncomingWebhookCreateResp,
  MENTION_UID_MAX_LENGTH,
  MENTION_UIDS_MAX,
} from "../../Service/IncomingWebhook";
import { useChannelWebhookEditor } from "../../bridge/channelWebhook/useChannelWebhookEditor";
import { useChannelWebhookMembers } from "../../bridge/channelWebhook/useChannelWebhookMembers";
import type { ChannelWebhookMemberOption } from "../../bridge/channelWebhook/types";
import "./index.css";

export interface WebhookEditModalProps {
  channel: Channel;
  /** 管理员才渲染头像输入（普通成员传 avatar 服务端直接 400） */
  isManager: boolean;
  /** 编辑模式传入现有项；新增模式不传 */
  webhook?: IncomingWebhook;
  /** 子区作用域：传入即把创建/更新打到该子区面（#451）；群面不传。channel 始终为父群。 */
  threadShortId?: string;
  onClose: () => void;
  /** 保存成功回调；创建成功时携带含一次性 token/URL 的响应 */
  onSaved: (created?: IncomingWebhookCreateResp) => void;
}

// API 契约里的字段长度上限（OpenAPI schema 常量，非动态配额）
const NAME_MAX_LENGTH = 64;
const AVATAR_MAX_LENGTH = 255;

/**
 * 新建 / 编辑 webhook 弹窗。
 *
 * - 名称可留空：服务端自动命名 `Webhook-<id 后缀>`；成员/管理员均可自定义任意名称。
 * - 头像仅管理员可设（URL 形式）；空值不随请求发送。
 */
export default function WebhookEditModal({
  channel,
  isManager,
  webhook,
  threadShortId,
  onClose,
  onSaved,
}: WebhookEditModalProps) {
  const { t } = useI18n();
  const {
    isEdit,
    name,
    setName,
    avatar,
    setAvatar,
    mentionAll,
    setMentionAll,
    mentionBots,
    setMentionBots,
    mentionUids,
    saving,
    toggleMentionUid,
    submit,
  } = useChannelWebhookEditor({
    channel,
    isManager,
    webhook,
    threadShortId,
  });
  const { memberOptionsForSelect, aiOptionCount, optionByUid } =
    useChannelWebhookMembers({
      channel,
      mentionUids,
      selfFallback: t("base.channelWebhook.meta.me"),
    });
  const [memberSearch, setMemberSearch] = useState("");
  // 本组件由父级条件挂载（{editTarget && <WebhookEditModal/>}），且处于
  // WKViewQueue 路由栈的滑入动画里。若一挂载就 visible=true，Semi Modal 的
  // 首次显示会与路由动画/portal 时序竞争，表现为「要点两次才弹出」。
  // 这里挂载时先 false、effect 翻 true，强制走一次正常的 false→true 过渡，
  // 与 BotManage 等常驻 + 受控 visible 的可用写法对齐。
  const [visible, setVisible] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVisible(true);
    nameInputRef.current?.focus();
  }, []);

  const visibleMemberOptions = useMemo(() => {
    const keyword = memberSearch.trim().toLocaleLowerCase();
    if (!keyword) return memberOptionsForSelect;
    return memberOptionsForSelect.filter((member: ChannelWebhookMemberOption) =>
      member.name.toLocaleLowerCase().includes(keyword)
    );
  }, [memberOptionsForSelect, memberSearch]);

  const handleSubmit = useCallback(async () => {
    try {
      const result = await submit();
      if (!result.ok) {
        const isTooMany = result.reason === "tooMany";
        Toast.error(
          t(
            isTooMany
              ? "base.channelWebhook.form.mentionUidsTooMany"
              : "base.channelWebhook.form.mentionUidsTooLong",
            {
              values: {
                max: isTooMany ? MENTION_UIDS_MAX : MENTION_UID_MAX_LENGTH,
              },
            }
          )
        );
        return;
      }
      if (
        result.status === "busy" ||
        result.status === "stale" ||
        (result.status === "created" && result.stale)
      ) {
        return;
      }
      if (result.status === "noop") {
        onClose();
        return;
      }
      if (result.status === "updated") {
        Toast.success(t("base.channelWebhook.toast.updated"));
        onSaved();
        return;
      }
      Toast.success(t("base.channelWebhook.toast.created"));
      onSaved(result.created);
    } catch (e) {
      // 配额超限（409，上限由服务端动态配置）等错误的文案已由服务端本地化，
      // 直接展示，不在前端写死任何数值
      Toast.error(
        extractErrorMsg(e) ||
          t(
            isEdit
              ? "base.channelWebhook.error.updateFailed"
              : "base.channelWebhook.error.createFailed"
          )
      );
    }
  }, [isEdit, onClose, onSaved, submit, t]);

  return (
    <WKModal
      visible={visible}
      size="lg"
      title={
        isEdit
          ? t("base.channelWebhook.form.editTitle")
          : t("base.channelWebhook.form.createTitle")
      }
      onCancel={onClose}
      options={{ closeOnEsc: true, maskClosable: false }}
      footer={
        <>
          <WKButton variant="ghost" onClick={onClose} disabled={saving}>
            {t("base.common.cancel")}
          </WKButton>
          <WKButton
            variant="primary"
            onClick={() => void handleSubmit()}
            loading={saving}
          >
            {t("base.common.save")}
          </WKButton>
        </>
      }
      className="wk-webhook-modal"
    >
      <div className="wk-webhook-form">
        <div className="wk-webhook-form__field">
          <label className="wk-webhook-form__label">
            {t("base.channelWebhook.form.name")}
          </label>
          <input
            ref={nameInputRef}
            className="wk-webhook-form__input"
            type="text"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            placeholder={t("base.channelWebhook.form.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // 排除输入法组字回车（中文拼音等选词/上屏），仅非组字状态
              // 的回车才提交，避免误触发创建（#500）。
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                void handleSubmit();
              }
            }}
          />
        </div>
        {isManager && (
          <div className="wk-webhook-form__field">
            <label className="wk-webhook-form__label">
              {t("base.channelWebhook.form.avatar")}
              <span className="wk-webhook-form__optional">
                {t("base.channelWebhook.form.optional")}
              </span>
            </label>
            <input
              className="wk-webhook-form__input"
              type="text"
              value={avatar}
              maxLength={AVATAR_MAX_LENGTH}
              placeholder={t("base.channelWebhook.form.avatarPlaceholder")}
              onChange={(e) => setAvatar(e.target.value)}
            />
            <div className="wk-webhook-form__hint">
              {t("base.channelWebhook.form.avatarHint")}
            </div>
          </div>
        )}
        {/* 1️⃣ 自动 @ 成员（定向、噪声小）：#465 每次推送自动 @ 的成员/bot。
                    候选限本群当前成员；回显 mention_uids，提交前做数量上限校验，服务端 400 兜底。 */}
        <div className="wk-webhook-form__field">
          <div className="wk-webhook-form__label-row">
            <label className="wk-webhook-form__label">
              {t("base.channelWebhook.form.mentionUids")}
              <span className="wk-webhook-form__optional">
                {t("base.channelWebhook.form.optional")}
              </span>
            </label>
            <span className="wk-webhook-form__member-count">
              {t("base.channelWebhook.form.mentionUidsCount", {
                values: {
                  total: memberOptionsForSelect.length,
                  ai: aiOptionCount,
                },
              })}
            </span>
          </div>
          <div className="wk-webhook-form__member-picker" data-testid="select">
            <input
              className="wk-webhook-form__member-search"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder={t("base.channelWebhook.form.mentionUidsPlaceholder")}
              aria-label={t("base.channelWebhook.form.mentionUidsPlaceholder")}
            />
            {mentionUids.length > 0 && (
              <div className="wk-webhook-form__selected-members">
                {mentionUids.map((uid: string) => {
                  const member = optionByUid.get(uid);
                  return (
                    <button
                      key={uid}
                      type="button"
                      className="wk-webhook-form__selected-member"
                      onClick={() => toggleMentionUid(uid)}
                    >
                      {member?.name || uid}
                      {member?.isBot && <AiBadge size="small" />}
                      <span aria-hidden="true">×</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="wk-webhook-form__member-list">
              {visibleMemberOptions.map(
                (member: ChannelWebhookMemberOption) => {
                  const selected = mentionUids.includes(member.uid);
                  return (
                    <button
                      key={member.uid}
                      type="button"
                      data-testid={`opt-${member.uid}`}
                      className="wk-webhook-form__member-option"
                      onClick={() => toggleMentionUid(member.uid)}
                    >
                      <span
                        className={`wk-webhook-form__member-check${
                          selected
                            ? " wk-webhook-form__member-check--selected"
                            : ""
                        }`}
                      >
                        {selected ? "✓" : ""}
                      </span>
                      <span className="wk-webhook-form__member-name">
                        {member.name}
                      </span>
                      {member.isBot && <AiBadge size="small" />}
                    </button>
                  );
                }
              )}
            </div>
          </div>
          <div className="wk-webhook-form__hint">
            {t("base.channelWebhook.form.mentionUidsHint", {
              values: { max: MENTION_UIDS_MAX },
            })}
          </div>
        </div>
        {/* 2️⃣3️⃣ 广播开关（@所有AI / @所有人）：每条推送都会提醒对应全部成员，
                    易造成消息噪声，单独包进警示块着重标记。能进入本表单即可开关，不受 isManager 门控。 */}
        <div className="wk-webhook-form__broadcast">
          <div className="wk-webhook-form__broadcast-note">
            <IconAlertTriangle className="wk-webhook-form__broadcast-icon" />
            <span>{t("base.channelWebhook.form.broadcastNoiseHint")}</span>
          </div>
          <div className="wk-webhook-form__switch-row">
            <div className="wk-webhook-form__switch-text">
              <label className="wk-webhook-form__label">
                {t("base.channelWebhook.form.mentionBots")}
              </label>
              <div className="wk-webhook-form__hint">
                {t("base.channelWebhook.form.mentionBotsHint")}
              </div>
            </div>
            <Switch
              checked={mentionBots}
              onChange={(v: boolean) => setMentionBots(v)}
              aria-label={t("base.channelWebhook.form.mentionBots")}
            />
          </div>
          <div className="wk-webhook-form__switch-row">
            <div className="wk-webhook-form__switch-text">
              <label className="wk-webhook-form__label">
                {t("base.channelWebhook.form.mentionAll")}
              </label>
              <div className="wk-webhook-form__hint">
                {t("base.channelWebhook.form.mentionAllHint")}
              </div>
            </div>
            <Switch
              checked={mentionAll}
              onChange={(v: boolean) => setMentionAll(v)}
              aria-label={t("base.channelWebhook.form.mentionAll")}
            />
          </div>
        </div>
      </div>
    </WKModal>
  );
}

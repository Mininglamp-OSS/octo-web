import React, { useCallback, useEffect, useState } from "react";
import { Channel } from "wukongimjssdk";
import { Spin, Toast } from "@douyinfe/semi-ui";
import { IconPlus, IconLink } from "@douyinfe/semi-icons";
import WKButton from "../WKButton";
import { wkConfirm } from "../WKModal";
import { useI18n } from "../../i18n";
import { extractErrorMsg } from "../../Service/APIClient";
import {
  IncomingWebhook,
  IncomingWebhookCreateResp,
  canManageIncomingWebhook,
} from "../../Service/IncomingWebhook";
import WebhookEditModal from "./WebhookEditModal";
import WebhookUrlModal from "./WebhookUrlModal";
import ChannelWebhookCard from "./ChannelWebhookCard";
import { useChannelWebhookList } from "../../bridge/channelWebhook/useChannelWebhookList";
import { useChannelWebhookActions } from "../../bridge/channelWebhook/useChannelWebhookActions";
import "./index.css";

export interface ChannelWebhookPanelProps {
  channel: Channel;
  /** 当前用户是否群主/管理员：决定可管理范围与是否可设置头像 */
  isManager: boolean;
  /**
   * 子区作用域 short_id（#451）。传入即整个面板切到子区面：list / 创建 / 管理 / 测试全部打到
   * groups/{group}/threads/{short}/incoming-webhooks，后端按 (group_no, short_id) 作用域隔离。
   * channel 仍为【父群】channel。群面不传（历史语义不变）。
   */
  threadShortId?: string;
}

type EditTarget =
  | { mode: "create" }
  | { mode: "edit"; webhook: IncomingWebhook }
  | null;

/**
 * 群设置 →「群 Webhook」子页面。
 *
 * 列表对全员只读可见；操作按钮按权限矩阵显隐（管理员管全部，
 * 成员只管自己创建的）。配额（每群/每人上限）由服务端动态配置，
 * 前端不做本地判断，超限时直接展示服务端 409 的本地化文案。
 */
export default function ChannelWebhookPanel({
  channel,
  isManager,
  threadShortId,
}: ChannelWebhookPanelProps) {
  const { t, format } = useI18n();
  const handleLoadError = useCallback(
    (loadError: unknown) => {
      Toast.error(
        extractErrorMsg(loadError) || t("base.channelWebhook.error.loadFailed")
      );
    },
    [t]
  );
  const {
    items,
    loading,
    error,
    myUid,
    creatorNames,
    reload: load,
  } = useChannelWebhookList({
    channel,
    threadShortId,
    selfFallback: t("base.channelWebhook.meta.me"),
    onLoadError: handleLoadError,
  });
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  // 创建 / 重置 token 后的一次性 URL 展示（token 仅此一次返回）
  const [urlResult, setUrlResult] = useState<IncomingWebhookCreateResp | null>(
    null
  );
  const scopeKey = `${channel.channelID}:${threadShortId || "group"}`;
  const {
    testingId,
    togglingId,
    coolingTestId,
    toggleWebhook,
    testWebhook,
    regenerateWebhook,
    deleteWebhook,
  } = useChannelWebhookActions({
    channel,
    threadShortId,
    reload: load,
  });

  // 群/子区切换时立即清掉旧对象的 UI overlay，避免旧弹窗串台。
  useEffect(() => {
    setEditTarget(null);
    setUrlResult(null);
  }, [scopeKey]);

  const handleToggle = async (item: IncomingWebhook, next: boolean) => {
    try {
      await toggleWebhook(item, next);
    } catch (e) {
      // 409 mgmt_creator_left（创建者已退群无法启用）等服务端文案已本地化，直接展示
      Toast.error(
        extractErrorMsg(e) || t("base.channelWebhook.error.updateFailed")
      );
    }
  };

  const handleTest = async (item: IncomingWebhook) => {
    try {
      const sent = await testWebhook(item);
      if (sent) Toast.success(t("base.channelWebhook.toast.testSent"));
    } catch (e) {
      Toast.error(
        extractErrorMsg(e) || t("base.channelWebhook.error.testFailed")
      );
    }
  };

  const handleRegenerate = (item: IncomingWebhook) => {
    wkConfirm({
      title: t("base.channelWebhook.regenerate.title"),
      content: t("base.channelWebhook.regenerate.content", {
        values: { name: item.name },
      }),
      okText: t("base.channelWebhook.regenerate.confirm"),
      okType: "danger",
      onOk: async () => {
        try {
          const result = await regenerateWebhook(item);
          if (result.ok && !result.stale) {
            setUrlResult(result.response);
          }
        } catch (e) {
          Toast.error(
            extractErrorMsg(e) ||
              t("base.channelWebhook.error.regenerateFailed")
          );
          // 重新抛出：wkConfirm 的 onOk 捕获 reject 后保持弹窗打开、按钮复位
          // 供用户重试（见 WKModal/confirm.tsx 的 .catch(updatePending(null))）。
          throw e;
        }
      },
    });
  };

  const handleDelete = (item: IncomingWebhook) => {
    wkConfirm({
      title: t("base.channelWebhook.delete.title"),
      content: t("base.channelWebhook.delete.content", {
        values: { name: item.name },
      }),
      okText: t("base.channelWebhook.delete.confirm"),
      okType: "danger",
      onOk: async () => {
        let deleted = false;
        try {
          const result = await deleteWebhook(item);
          deleted = result.ok && !result.stale;
        } catch (e) {
          Toast.error(
            extractErrorMsg(e) || t("base.channelWebhook.error.deleteFailed")
          );
          // 重新抛出：wkConfirm 捕获 reject 后保持弹窗打开供重试（同 handleRegenerate）。
          throw e;
        }
        if (deleted) {
          Toast.success(t("base.channelWebhook.toast.deleted"));
        }
      },
    });
  };

  const renderMeta = (item: IncomingWebhook) => {
    const name = creatorNames.get(item.creator_uid) || "";
    const created = format.date(item.created_at * 1000);
    const createdLine = name
      ? t("base.channelWebhook.meta.createdBy", {
          values: { name, time: created },
        })
      : t("base.channelWebhook.meta.created", { values: { time: created } });
    // 从未使用时不展示用法行（去掉「从未使用」描述）；仅在有过推送时显示统计。
    const usage =
      item.call_count > 0
        ? t("base.channelWebhook.meta.usage", {
            values: {
              count: item.call_count,
              time: item.last_used_at
                ? format.dateTime(item.last_used_at * 1000)
                : "",
            },
          })
        : null;
    return (
      <>
        <div className="wk-webhook-card__meta">{createdLine}</div>
        {usage && <div className="wk-webhook-card__meta">{usage}</div>}
      </>
    );
  };

  return (
    <div className="wk-webhook">
      <div className="wk-webhook__header">
        <p className="wk-webhook__desc">
          {threadShortId
            ? t("base.channelWebhook.threadScopeHint")
            : t("base.channelWebhook.description")}
        </p>
        {/* 列表非空时才显示 header 的新建按钮；空态有自己的醒目 CTA，
                    避免出现两个「新建」。加载中也不显示。 */}
        {!loading && items.length > 0 && (
          <WKButton
            variant="primary"
            size="sm"
            icon={<IconPlus />}
            onClick={() => setEditTarget({ mode: "create" })}
          >
            {t("base.channelWebhook.add")}
          </WKButton>
        )}
      </div>

      {loading ? (
        <div className="wk-webhook__state">
          <Spin size="large" />
        </div>
      ) : error ? (
        <div className="wk-webhook__state">
          <p className="wk-webhook__state-text">
            {t("base.channelWebhook.error.loadFailed")}
          </p>
          <WKButton
            variant="secondary"
            onClick={() => {
              void load(true);
            }}
          >
            {t("base.channelWebhook.retry")}
          </WKButton>
        </div>
      ) : items.length === 0 ? (
        <div className="wk-webhook__empty">
          <div className="wk-webhook__empty-icon">
            <IconLink size="extra-large" />
          </div>
          <p className="wk-webhook__empty-text">
            {t("base.channelWebhook.empty")}
          </p>
          <WKButton
            variant="primary"
            icon={<IconPlus />}
            onClick={() => setEditTarget({ mode: "create" })}
          >
            {t("base.channelWebhook.add")}
          </WKButton>
        </div>
      ) : (
        <ul className="wk-webhook__list">
          {items.map((item: IncomingWebhook) => (
            <ChannelWebhookCard
              key={item.webhook_id}
              item={item}
              manageable={canManageIncomingWebhook(item, { isManager, myUid })}
              meta={renderMeta(item)}
              toggling={togglingId === item.webhook_id}
              testingBlocked={!!testingId}
              cooling={coolingTestId === item.webhook_id}
              labels={{
                disabled: t("base.channelWebhook.status.disabled"),
                toggle: t("base.channelWebhook.action.toggle"),
                edit: t("base.channelWebhook.action.edit"),
                regenerate: t("base.channelWebhook.action.regenerate"),
                test: t("base.channelWebhook.action.test"),
                testDisabledHint: t(
                  "base.channelWebhook.action.testDisabledHint"
                ),
                delete: t("base.channelWebhook.action.delete"),
              }}
              onToggle={(enabled) => void handleToggle(item, enabled)}
              onEdit={() => setEditTarget({ mode: "edit", webhook: item })}
              onRegenerate={() => handleRegenerate(item)}
              onTest={() => void handleTest(item)}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </ul>
      )}

      {editTarget && (
        <WebhookEditModal
          channel={channel}
          isManager={isManager}
          threadShortId={threadShortId}
          webhook={editTarget.mode === "edit" ? editTarget.webhook : undefined}
          onClose={() => setEditTarget(null)}
          onSaved={(created) => {
            setEditTarget(null);
            if (created) {
              setUrlResult(created);
            }
            void load();
          }}
        />
      )}
      {urlResult && (
        <WebhookUrlModal resp={urlResult} onClose={() => setUrlResult(null)} />
      )}
    </div>
  );
}

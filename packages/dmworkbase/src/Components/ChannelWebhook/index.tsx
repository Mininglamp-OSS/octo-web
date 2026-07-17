import React, { useCallback, useEffect, useRef, useState } from "react";
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
    IncomingWebhookStatus,
    IncomingWebhookService,
    canManageIncomingWebhook,
    canTestWebhook,
} from "../../Service/IncomingWebhook";
import WebhookEditModal from "./WebhookEditModal";
import WebhookUrlModal from "./WebhookUrlModal";
import ChannelWebhookCard from "./ChannelWebhookCard";
import { useChannelWebhookList } from "../../bridge/channelWebhook/useChannelWebhookList";
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

/** 测试推送冷却窗口（毫秒）：防止连点刷屏（每次测试都会向群内发真实消息）。 */
const TEST_COOLDOWN_MS = 3000;

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
    const handleLoadError = useCallback((loadError: unknown) => {
        Toast.error(extractErrorMsg(loadError) || t("base.channelWebhook.error.loadFailed"));
    }, [t]);
    const { items, loading, error, myUid, creatorNames, reload: load } =
        useChannelWebhookList({
            channel,
            threadShortId,
            selfFallback: t("base.channelWebhook.meta.me"),
            onLoadError: handleLoadError,
        });
    const [editTarget, setEditTarget] = useState<EditTarget>(null);
    // 创建 / 重置 token 后的一次性 URL 展示（token 仅此一次返回）
    const [urlResult, setUrlResult] = useState<IncomingWebhookCreateResp | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    // 测试推送会向群内发真实消息，连点会刷屏。点一次后该 webhook 进入冷却，
    // 冷却期间按钮置灰、忽略再次点击。
    const [coolingTestId, setCoolingTestId] = useState<string | null>(null);
    const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scopeKey = `${channel.channelID}:${threadShortId || "group"}`;

    useEffect(() => () => {
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    }, []);

    // 群/子区切换时立即清掉旧对象的 UI 状态，避免旧列表、弹窗或 pending 状态串台。
    useEffect(() => {
        setEditTarget(null);
        setUrlResult(null);
        setTestingId(null);
        setTogglingId(null);
        setCoolingTestId(null);
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    }, [scopeKey]);

    const handleToggle = async (item: IncomingWebhook, next: boolean) => {
        // in-flight 守卫：Semi 的 Switch loading 不保证拦截 onChange，
        // 疯狂拨动会连发请求，这里与 handleTest 同款，请求未回前直接忽略。
        if (togglingId) return;
        setTogglingId(item.webhook_id);
        try {
            await IncomingWebhookService.update(
                channel.channelID,
                item.webhook_id,
                { status: next ? IncomingWebhookStatus.enabled : IncomingWebhookStatus.disabled },
                threadShortId
            );
            void load();
        } catch (e) {
            // 409 mgmt_creator_left（创建者已退群无法启用）等服务端文案已本地化，直接展示
            Toast.error(extractErrorMsg(e) || t("base.channelWebhook.error.updateFailed"));
        } finally {
            setTogglingId(null);
        }
    };

    const handleTest = async (item: IncomingWebhook) => {
        // 已禁用的 webhook 不允许测试：test 走管理面、绕开推送面的 enabled 检查，
        // 仍会向群内发真实消息，且「测试成功」会对一个真实推送被 401 挡掉的 webhook
        // 给出假信心。与「禁用=不再发消息」的语义保持一致。
        if (!canTestWebhook(item)) return;
        // 正在切换启停时 item.status 仍是刷新前的旧值，此刻放行会用过期状态发测试，
        // 故该 webhook 切换在飞期间一并拦截（与按钮 disabled 同源）。
        if (togglingId === item.webhook_id) return;
        // 已有测试在飞 / 该 webhook 处于冷却中 → 忽略，避免连点刷屏。
        if (testingId || coolingTestId === item.webhook_id) return;
        setTestingId(item.webhook_id);
        try {
            await IncomingWebhookService.test(channel.channelID, item.webhook_id, threadShortId);
            Toast.success(t("base.channelWebhook.toast.testSent"));
        } catch (e) {
            Toast.error(extractErrorMsg(e) || t("base.channelWebhook.error.testFailed"));
        } finally {
            setTestingId(null);
            // 进入冷却：本 webhook 的测试按钮置灰若干秒后恢复。
            setCoolingTestId(item.webhook_id);
            if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
            cooldownTimerRef.current = setTimeout(
                () => setCoolingTestId(null),
                TEST_COOLDOWN_MS
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
                    const resp = await IncomingWebhookService.regenerate(
                        channel.channelID,
                        item.webhook_id,
                        threadShortId
                    );
                    setUrlResult(resp);
                    void load();
                } catch (e) {
                    Toast.error(extractErrorMsg(e) || t("base.channelWebhook.error.regenerateFailed"));
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
                try {
                    await IncomingWebhookService.delete(
                        channel.channelID,
                        item.webhook_id,
                        threadShortId
                    );
                } catch (e) {
                    Toast.error(extractErrorMsg(e) || t("base.channelWebhook.error.deleteFailed"));
                    // 重新抛出：wkConfirm 捕获 reject 后保持弹窗打开供重试（同 handleRegenerate）。
                    throw e;
                }
                Toast.success(t("base.channelWebhook.toast.deleted"));
                void load();
            },
        });
    };

    const renderMeta = (item: IncomingWebhook) => {
        const name = creatorNames.get(item.creator_uid) || "";
        const created = format.date(item.created_at * 1000);
        const createdLine = name
            ? t("base.channelWebhook.meta.createdBy", { values: { name, time: created } })
            : t("base.channelWebhook.meta.created", { values: { time: created } });
        // 从未使用时不展示用法行（去掉「从未使用」描述）；仅在有过推送时显示统计。
        const usage = item.call_count > 0
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
                    <WKButton variant="secondary" onClick={() => { void load(true); }}>
                        {t("base.channelWebhook.retry")}
                    </WKButton>
                </div>
            ) : items.length === 0 ? (
                <div className="wk-webhook__empty">
                    <div className="wk-webhook__empty-icon">
                        <IconLink size="extra-large" />
                    </div>
                    <p className="wk-webhook__empty-text">{t("base.channelWebhook.empty")}</p>
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
                    {items.map((item) => (
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
                                testDisabledHint: t("base.channelWebhook.action.testDisabledHint"),
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

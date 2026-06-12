import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, WKSDK } from "wukongimjssdk";
import { Spin, Switch, Toast } from "@douyinfe/semi-ui";
import {
    IconPlus,
    IconLink,
    IconEdit,
    IconRefresh,
    IconDelete,
    IconSend,
} from "@douyinfe/semi-icons";
import WKApp from "../../App";
import WKButton from "../WKButton";
import WKAvatar from "../WKAvatar";
import { wkConfirm } from "../WKModal";
import { useI18n } from "../../i18n";
import { extractErrorMsg } from "../../Service/APIClient";
import { subscriberDisplayName, SubscriberLike } from "../../Utils/displayName";
import {
    IncomingWebhook,
    IncomingWebhookCreateResp,
    IncomingWebhookStatus,
    INCOMING_WEBHOOK_DEFAULT_AVATAR,
    canManageIncomingWebhook,
} from "../../Service/IncomingWebhook";
import WebhookEditModal from "./WebhookEditModal";
import WebhookUrlModal from "./WebhookUrlModal";
import "./index.css";

export interface ChannelWebhookPanelProps {
    channel: Channel;
    /** 当前用户是否群主/管理员：决定可管理范围与是否可设置头像 */
    isManager: boolean;
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
}: ChannelWebhookPanelProps) {
    const { t, format } = useI18n();
    const [items, setItems] = useState<IncomingWebhook[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [editTarget, setEditTarget] = useState<EditTarget>(null);
    // 创建 / 重置 token 后的一次性 URL 展示（token 仅此一次返回）
    const [urlResult, setUrlResult] = useState<IncomingWebhookCreateResp | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    // 测试推送会向群内发真实消息，连点会刷屏。点一次后该 webhook 进入冷却，
    // 冷却期间按钮置灰、忽略再次点击。
    const [coolingTestId, setCoolingTestId] = useState<string | null>(null);
    const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    }, []);

    const myUid = WKApp.loginInfo.uid || "";

    const load = useCallback(async () => {
        setError(false);
        try {
            const list = await WKApp.dataSource.channelDataSource.incomingWebhooks(channel);
            setItems(list);
        } catch (e) {
            setError(true);
            Toast.error(extractErrorMsg(e) || t("base.channelWebhook.error.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [channel, t]);

    useEffect(() => {
        void load();
    }, [load]);

    // 创建者展示名映射：单次遍历群成员列表（O(成员数+条目数)），避免每个
    // 卡片每次渲染都对大群成员做全量 .find() 扫描。群成员命中用群内展示名；
    // 自己兜底 loginInfo（订阅列表通常不含 self）；都拿不到（创建者已退群 /
    // 成员列表未同步）则缺省为空串，渲染时降级为只显示创建时间。
    const creatorNames = useMemo(() => {
        const wanted = new Set(items.map((item) => item.creator_uid));
        const map = new Map<string, string>();
        try {
            const subs = WKSDK.shared().channelManager.getSubscribes(channel) as
                | Array<({ uid?: string } & SubscriberLike)>
                | null
                | undefined;
            for (const sub of subs || []) {
                if (sub?.uid && wanted.has(sub.uid) && !map.has(sub.uid)) {
                    const name = subscriberDisplayName(sub);
                    if (name) map.set(sub.uid, name);
                }
            }
        } catch {
            // channelManager 缓存未加载：静默降级
        }
        if (wanted.has(myUid) && !map.has(myUid)) {
            map.set(
                myUid,
                WKApp.loginInfo.selfDisplayName?.() || t("base.channelWebhook.meta.me")
            );
        }
        return map;
    }, [items, channel, myUid, t]);

    const handleToggle = async (item: IncomingWebhook, next: boolean) => {
        // in-flight 守卫：Semi 的 Switch loading 不保证拦截 onChange，
        // 疯狂拨动会连发请求，这里与 handleTest 同款，请求未回前直接忽略。
        if (togglingId) return;
        setTogglingId(item.webhook_id);
        try {
            await WKApp.dataSource.channelDataSource.updateIncomingWebhook(
                channel,
                item.webhook_id,
                { status: next ? IncomingWebhookStatus.enabled : IncomingWebhookStatus.disabled }
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
        // 已有测试在飞 / 该 webhook 处于冷却中 → 忽略，避免连点刷屏。
        if (testingId || coolingTestId === item.webhook_id) return;
        setTestingId(item.webhook_id);
        try {
            await WKApp.dataSource.channelDataSource.testIncomingWebhook(channel, item.webhook_id);
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
                    const resp = await WKApp.dataSource.channelDataSource.regenerateIncomingWebhook(
                        channel,
                        item.webhook_id
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
                    await WKApp.dataSource.channelDataSource.deleteIncomingWebhook(
                        channel,
                        item.webhook_id
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
                <p className="wk-webhook__desc">{t("base.channelWebhook.description")}</p>
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
                    <WKButton variant="secondary" onClick={() => { setLoading(true); void load(); }}>
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
                    {items.map((item) => {
                        const manageable = canManageIncomingWebhook(item, { isManager, myUid });
                        const enabled = item.status === IncomingWebhookStatus.enabled;
                        return (
                            <li key={item.webhook_id} className="wk-webhook-card">
                                <div className="wk-webhook-card__head">
                                    <WKAvatar
                                        src={item.avatar || INCOMING_WEBHOOK_DEFAULT_AVATAR}
                                        style={{
                                            width: "32px",
                                            height: "32px",
                                            borderRadius: "var(--wk-r-sm)",
                                            flexShrink: 0,
                                        }}
                                    />
                                    <div className="wk-webhook-card__titlebox">
                                        <span className="wk-webhook-card__name" title={item.name}>
                                            {item.name}
                                        </span>
                                        {!enabled && (
                                            <span className="wk-webhook-card__chip wk-webhook-card__chip--off">
                                                {t("base.channelWebhook.status.disabled")}
                                            </span>
                                        )}
                                    </div>
                                    {manageable && (
                                        <Switch
                                            size="small"
                                            checked={enabled}
                                            loading={togglingId === item.webhook_id}
                                            onChange={(v: boolean) => void handleToggle(item, v)}
                                            aria-label={t("base.channelWebhook.action.toggle")}
                                        />
                                    )}
                                </div>
                                {renderMeta(item)}
                                {manageable && (
                                    <div className="wk-webhook-card__actions">
                                        <button
                                            type="button"
                                            className="wk-webhook-card__icon-btn"
                                            onClick={() => setEditTarget({ mode: "edit", webhook: item })}
                                            title={t("base.channelWebhook.action.edit")}
                                            aria-label={t("base.channelWebhook.action.edit")}
                                        >
                                            <IconEdit />
                                        </button>
                                        <button
                                            type="button"
                                            className="wk-webhook-card__icon-btn"
                                            onClick={() => handleRegenerate(item)}
                                            title={t("base.channelWebhook.action.regenerate")}
                                            aria-label={t("base.channelWebhook.action.regenerate")}
                                        >
                                            <IconRefresh />
                                        </button>
                                        <button
                                            type="button"
                                            className="wk-webhook-card__icon-btn"
                                            disabled={
                                                // handleTest 全局串行化（任一测试在飞即忽略），
                                                // 故任一在飞时所有测试按钮都置灰，避免点了没反应；
                                                // 叠加本 webhook 的冷却态。
                                                !!testingId ||
                                                coolingTestId === item.webhook_id
                                            }
                                            onClick={() => void handleTest(item)}
                                            title={t("base.channelWebhook.action.test")}
                                            aria-label={t("base.channelWebhook.action.test")}
                                        >
                                            <IconSend />
                                        </button>
                                        <button
                                            type="button"
                                            className="wk-webhook-card__icon-btn wk-webhook-card__icon-btn--danger"
                                            onClick={() => handleDelete(item)}
                                            title={t("base.channelWebhook.action.delete")}
                                            aria-label={t("base.channelWebhook.action.delete")}
                                        >
                                            <IconDelete />
                                        </button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {editTarget && (
                <WebhookEditModal
                    channel={channel}
                    isManager={isManager}
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

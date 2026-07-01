import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import { Select, Switch, Toast } from "@douyinfe/semi-ui";
import { IconAlertTriangle } from "@douyinfe/semi-icons";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import AiBadge from "../AiBadge";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import { extractErrorMsg } from "../../Service/APIClient";
import { subscriberDisplayName } from "../../Utils/displayName";
import {
    buildWebhookUpsertReq,
    IncomingWebhook,
    IncomingWebhookCreateResp,
    isFlagOn,
    MENTION_UID_MAX_LENGTH,
    MENTION_UIDS_MAX,
    normalizeMentionUids,
    validateMentionUids,
} from "../../Service/IncomingWebhook";
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

/** mention_uids 选择器的候选项（群成员 / bot）。 */
interface MentionMemberOption {
    uid: string;
    name: string;
    isBot: boolean;
}

/** WKSDK Subscriber 运行时用到的子集（SDK 未导出精确字段）。 */
type GroupSubscriber = {
    uid?: string;
    name?: string | null;
    remark?: string | null;
    status?: number;
    orgData?: {
        robot?: number;
        real_name?: string | null;
        realname_verified?: boolean | number | string | null;
    } | null;
};

/**
 * 判定群成员是否为 AI/bot。双信号取并集，最大化命中：
 * - `subscriber.orgData.robot`：随订阅数据返回，但不一定被富化（可能缺）；
 * - 该 uid 的 Person `channelInfo.orgData.robot`：WKAvatar / 会话列表等通用判定，
 *   依赖 channelInfo 缓存是否已热。
 * 任一命中即视为 AI；都拿不到则按非 AI（best-effort，与全局头像/徽章判定一致）。
 */
function isBotMember(uid: string, sub: GroupSubscriber): boolean {
    if (isFlagOn(sub.orgData?.robot)) return true;
    try {
        const info = WKSDK.shared().channelManager.getChannelInfo(
            new Channel(uid, ChannelTypePerson)
        ) as { orgData?: { robot?: unknown } } | null | undefined;
        return isFlagOn(info?.orgData?.robot);
    } catch {
        return false;
    }
}

/**
 * 从群成员缓存读取 mention_uids 选择器候选：按 uid 去重，展示名走
 * subscriberDisplayName（实名 > 备注 > 昵称），AI 由 {@link isBotMember} 判定。
 * 不按 status 过滤、也不排除自己（自己同样可被 webhook 自动 @），成员资格由服务端
 * 兜底；同步读缓存，调用方在 syncSubscribes 完成后再读一次以刷新。
 */
function readGroupMemberOptions(channel: Channel): MentionMemberOption[] {
    let subs: GroupSubscriber[] | null | undefined;
    try {
        subs = WKSDK.shared().channelManager.getSubscribes(channel) as
            | GroupSubscriber[]
            | null
            | undefined;
    } catch {
        return [];
    }
    const out: MentionMemberOption[] = [];
    const seen = new Set<string>();
    for (const sub of subs || []) {
        const uid = sub?.uid;
        if (!uid || seen.has(uid)) continue;
        seen.add(uid);
        out.push({
            uid,
            name: subscriberDisplayName(sub) || uid,
            isBot: isBotMember(uid, sub),
        });
    }
    return out;
}

/**
 * 新建 / 编辑 webhook 弹窗。
 *
 * - 名称可留空：服务端自动命名 `Webhook-<id 后缀>`；
 *   普通成员自定义名称时服务端会强制加 `Webhook-` 前缀，表单下方有提示。
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
    const isEdit = !!webhook;

    const [name, setName] = useState<string>(webhook?.name ?? "");
    const [avatar, setAvatar] = useState<string>(webhook?.avatar ?? "");
    // 能力位回显：服务端回 0/1（也可能是 "1"/true，见 isFlagOn），表单用 boolean。
    // 能管理该 webhook 者均可开关（不受 isManager 门控，与头像不同）。
    const [mentionAll, setMentionAll] = useState<boolean>(
        isFlagOn(webhook?.allow_mention_all)
    );
    const [mentionBots, setMentionBots] = useState<boolean>(
        isFlagOn(webhook?.allow_mention_bots)
    );
    // #465：每次推送自动 @ 的成员/bot。回显恒为数组（老后端不返回时按 [] 处理）。
    const [mentionUids, setMentionUids] = useState<string[]>(
        webhook?.mention_uids ?? []
    );
    // 候选成员：先同步读缓存，syncSubscribes 完成后再读一次刷新（弹窗可能在
    // 成员未同步时打开）。
    const [memberOptions, setMemberOptions] = useState<MentionMemberOption[]>(
        () => readGroupMemberOptions(channel)
    );
    const [saving, setSaving] = useState(false);
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

    // 成员可能未同步：拉一次后刷新候选，挂载即触发，channel 变更重拉。
    useEffect(() => {
        let alive = true;
        Promise.resolve(WKSDK.shared().channelManager.syncSubscribes(channel))
            .then(() => {
                if (alive) setMemberOptions(readGroupMemberOptions(channel));
            })
            .catch(() => {
                // 同步失败保持已读缓存，不阻断表单
            });
        return () => {
            alive = false;
        };
    }, [channel]);

    // 选择器候选：群成员 + 当前用户（群订阅缓存通常不含 self，但自己也是合法的
    // 自动 @ 目标，显式补上）+ 「已配置但已不在成员列表（如退群）」的兜底项
    // （避免编辑时把这些已配置 uid 静默丢弃，让用户能看到并主动移除）。
    const memberOptionsForSelect = useMemo<MentionMemberOption[]>(() => {
        const known = new Set(memberOptions.map((m) => m.uid));
        const base = [...memberOptions];
        const selfUid = WKApp.loginInfo?.uid;
        if (selfUid && !known.has(selfUid)) {
            base.push({
                uid: selfUid,
                name:
                    WKApp.loginInfo.selfDisplayName?.() ||
                    t("base.channelWebhook.meta.me"),
                isBot: false,
            });
            known.add(selfUid);
        }
        // 兜底项从规整后的 mentionUids 取，避免脏回显（含空格/重复）渲染幽灵 chip。
        const extras = normalizeMentionUids(mentionUids)
            .filter((uid) => !known.has(uid))
            .map((uid) => ({ uid, name: uid, isBot: false }));
        return [...base, ...extras];
    }, [memberOptions, mentionUids, t]);

    // 下拉顶部人数标识用：总候选数与其中的 AI 数。
    const aiOptionCount = useMemo(
        () => memberOptionsForSelect.filter((m) => m.isBot).length,
        [memberOptionsForSelect]
    );

    // 选中 chip 回显需要按 value(uid) 反查 isBot，给 renderSelectedItem 用。
    const optionByUid = useMemo(
        () => new Map(memberOptionsForSelect.map((m) => [m.uid, m])),
        [memberOptionsForSelect]
    );

    const handleSubmit = useCallback(async () => {
        if (saving) return;

        // mention_uids 即时校验：两种失败态都拦下并给对应文案（服务端 400 兜底）。
        const mentionCheck = validateMentionUids(mentionUids);
        if (!mentionCheck.ok) {
            const isTooMany = mentionCheck.reason === "tooMany";
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

        // 请求体构造逻辑抽到纯函数 buildWebhookUpsertReq（已单测）：
        // 成员不得带 avatar、编辑态仅发变化字段、无变化返回 null。
        const req = buildWebhookUpsertReq({
            isEdit,
            isManager,
            name,
            avatar,
            mentionAll,
            mentionBots,
            mentionUids,
            webhook,
        });
        if (req === null) {
            // 编辑态无任何变化 → 不发请求，直接关闭
            onClose();
            return;
        }

        setSaving(true);
        try {
            if (isEdit && webhook) {
                await WKApp.dataSource.channelDataSource.updateIncomingWebhook(
                    channel,
                    webhook.webhook_id,
                    req,
                    threadShortId
                );
                Toast.success(t("base.channelWebhook.toast.updated"));
                onSaved();
            } else {
                const resp = await WKApp.dataSource.channelDataSource.createIncomingWebhook(
                    channel,
                    req,
                    threadShortId
                );
                Toast.success(t("base.channelWebhook.toast.created"));
                onSaved(resp);
            }
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
        } finally {
            setSaving(false);
        }
    }, [saving, name, avatar, mentionAll, mentionBots, mentionUids, isEdit, webhook, isManager, channel, threadShortId, t, onClose, onSaved]);

    return (
        <WKModal
            visible={visible}
            width={480}
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
                    <WKButton variant="primary" onClick={() => void handleSubmit()} loading={saving}>
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
                    {!isManager && (
                        <div className="wk-webhook-form__hint">
                            {t("base.channelWebhook.form.memberPrefixHint")}
                        </div>
                    )}
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
                    <label className="wk-webhook-form__label">
                        {t("base.channelWebhook.form.mentionUids")}
                        <span className="wk-webhook-form__optional">
                            {t("base.channelWebhook.form.optional")}
                        </span>
                    </label>
                    <Select
                        multiple
                        filter
                        showClear
                        className="wk-webhook-form__select"
                        value={mentionUids}
                        onChange={(v) =>
                            setMentionUids(Array.isArray(v) ? (v as string[]) : [])
                        }
                        placeholder={t("base.channelWebhook.form.mentionUidsPlaceholder")}
                        aria-label={t("base.channelWebhook.form.mentionUids")}
                        outerTopSlot={
                            <div className="wk-webhook-form__select-head">
                                {t("base.channelWebhook.form.mentionUidsCount", {
                                    values: {
                                        total: memberOptionsForSelect.length,
                                        ai: aiOptionCount,
                                    },
                                })}
                            </div>
                        }
                        renderSelectedItem={(optionNode: {
                            value?: string;
                            label?: React.ReactNode;
                        }) => ({
                            isRenderInTag: true,
                            content: (
                                <span className="wk-webhook-form__member-tag">
                                    <span className="wk-webhook-form__member-name">
                                        {optionNode.label}
                                    </span>
                                    {optionByUid.get(optionNode.value ?? "")?.isBot && (
                                        <AiBadge size="small" />
                                    )}
                                </span>
                            ),
                        })}
                        renderOptionItem={(rp: {
                            value?: string;
                            label?: React.ReactNode;
                            selected?: boolean;
                            focused?: boolean;
                            style?: React.CSSProperties;
                            onClick?: (e: React.MouseEvent) => void;
                            onMouseEnter?: (e: React.MouseEvent) => void;
                        }) => {
                            // Semi 下拉项渲染：Option 同时传 label(字符串) 时下拉默认只渲染
                            // label、吞掉 children 里的徽章，故改用 renderOptionItem 完全
                            // 接管（名字 + AI 徽章 + 选中态），自行接回点击/悬停/选中样式。
                            const isBot = optionByUid.get(String(rp.value ?? ""))?.isBot;
                            const cls = [
                                "wk-webhook-form__option",
                                rp.selected ? "wk-webhook-form__option--selected" : "",
                                rp.focused ? "wk-webhook-form__option--focused" : "",
                            ]
                                .filter(Boolean)
                                .join(" ");
                            return (
                                <div
                                    className={cls}
                                    style={rp.style}
                                    onClick={rp.onClick}
                                    onMouseEnter={rp.onMouseEnter}
                                >
                                    <span className="wk-webhook-form__member-name">
                                        {rp.label}
                                    </span>
                                    {isBot && <AiBadge size="small" />}
                                    {rp.selected && (
                                        <span className="wk-webhook-form__option-tick">✓</span>
                                    )}
                                </div>
                            );
                        }}
                    >
                        {memberOptionsForSelect.map((m) => (
                            <Select.Option key={m.uid} value={m.uid} label={m.name}>
                                {m.name}
                            </Select.Option>
                        ))}
                    </Select>
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

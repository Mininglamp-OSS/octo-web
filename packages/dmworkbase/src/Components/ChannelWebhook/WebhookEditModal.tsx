import React, { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import { extractErrorMsg } from "../../Service/APIClient";
import {
    buildWebhookUpsertReq,
    IncomingWebhook,
    IncomingWebhookCreateResp,
} from "../../Service/IncomingWebhook";
import "./index.css";

export interface WebhookEditModalProps {
    channel: Channel;
    /** 管理员才渲染头像输入（普通成员传 avatar 服务端直接 400） */
    isManager: boolean;
    /** 编辑模式传入现有项；新增模式不传 */
    webhook?: IncomingWebhook;
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
 * - 名称可留空：服务端自动命名 `Webhook-<id 后缀>`；
 *   普通成员自定义名称时服务端会强制加 `Webhook-` 前缀，表单下方有提示。
 * - 头像仅管理员可设（URL 形式）；空值不随请求发送。
 */
export default function WebhookEditModal({
    channel,
    isManager,
    webhook,
    onClose,
    onSaved,
}: WebhookEditModalProps) {
    const { t } = useI18n();
    const isEdit = !!webhook;

    const [name, setName] = useState<string>(webhook?.name ?? "");
    const [avatar, setAvatar] = useState<string>(webhook?.avatar ?? "");
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

    const handleSubmit = useCallback(async () => {
        if (saving) return;

        // 请求体构造逻辑抽到纯函数 buildWebhookUpsertReq（已单测）：
        // 成员不得带 avatar、编辑态仅发变化字段、无变化返回 null。
        const req = buildWebhookUpsertReq({ isEdit, isManager, name, avatar, webhook });
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
                    req
                );
                Toast.success(t("base.channelWebhook.toast.updated"));
                onSaved();
            } else {
                const resp = await WKApp.dataSource.channelDataSource.createIncomingWebhook(
                    channel,
                    req
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
    }, [saving, name, avatar, isEdit, webhook, isManager, channel, t, onClose, onSaved]);

    return (
        <WKModal
            visible={visible}
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
                            if (e.key === "Enter") void handleSubmit();
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
            </div>
        </WKModal>
    );
}

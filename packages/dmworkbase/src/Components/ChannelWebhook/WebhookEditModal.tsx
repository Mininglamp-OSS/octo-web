import React, { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import { extractErrorMsg } from "../../Service/APIClient";
import {
    IncomingWebhook,
    IncomingWebhookCreateResp,
    IncomingWebhookUpsertReq,
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
    const nameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        nameInputRef.current?.focus();
    }, []);

    const handleSubmit = useCallback(async () => {
        if (saving) return;
        const trimmedName = name.trim();
        const trimmedAvatar = avatar.trim();

        // 只发送有变化 / 有值的字段：成员带 avatar 字段会被服务端 400 拒绝
        const req: IncomingWebhookUpsertReq = {};
        if (isEdit && webhook) {
            if (trimmedName && trimmedName !== webhook.name) req.name = trimmedName;
            if (isManager && trimmedAvatar !== (webhook.avatar || "")) req.avatar = trimmedAvatar;
            if (Object.keys(req).length === 0) {
                onClose();
                return;
            }
        } else {
            if (trimmedName) req.name = trimmedName;
            if (isManager && trimmedAvatar) req.avatar = trimmedAvatar;
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
            visible
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

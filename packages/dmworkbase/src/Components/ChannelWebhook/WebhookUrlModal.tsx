import React, { useCallback } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { IconAlertTriangle, IconCopy } from "@douyinfe/semi-icons";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import { copyToClipboard } from "../../Utils/clipboard";
import {
    IncomingWebhookCreateResp,
    buildIncomingWebhookUrl,
} from "../../Service/IncomingWebhook";
import "./index.css";

export interface WebhookUrlModalProps {
    /** create / regenerate 的响应（token 与 URL 仅此一次出现） */
    resp: IncomingWebhookCreateResp;
    onClose: () => void;
}

/**
 * 一次性推送 URL 展示弹窗 —— 本功能的核心安全交互。
 *
 * token 只在 create / regenerate 响应里出现一次，关闭本弹窗后无法再次查看，
 * 因此：遮罩点击不关闭（防手滑），三种适配器地址各带复制按钮，顶部红字警示。
 */
export default function WebhookUrlModal({ resp, onClose }: WebhookUrlModalProps) {
    const { t } = useI18n();

    const absolute = useCallback((relative?: string): string => {
        if (!relative) return "";
        return buildIncomingWebhookUrl(
            relative,
            WKApp.apiClient.config.apiURL || "/",
            window.location.origin
        );
    }, []);

    const rows: Array<{ key: string; label: string; url: string }> = [
        {
            key: "native",
            label: t("base.channelWebhook.url.native"),
            url: absolute(resp.urls?.native || resp.url),
        },
        {
            key: "github",
            label: t("base.channelWebhook.url.github"),
            url: absolute(resp.urls?.github),
        },
        {
            key: "wecom",
            label: t("base.channelWebhook.url.wecom"),
            url: absolute(resp.urls?.wecom),
        },
    ].filter((r) => !!r.url);

    const handleCopy = async (url: string) => {
        try {
            const ok = await copyToClipboard(url);
            if (ok) {
                Toast.success(t("base.channelWebhook.toast.copied"));
            } else {
                Toast.error(t("base.channelWebhook.toast.copyFailed"));
            }
        } catch {
            Toast.error(t("base.channelWebhook.toast.copyFailed"));
        }
    };

    return (
        <WKModal
            visible
            title={t("base.channelWebhook.url.title")}
            onCancel={onClose}
            size="lg"
            options={{ closeOnEsc: false, maskClosable: false }}
            footer={
                <WKButton variant="primary" onClick={onClose}>
                    {t("base.channelWebhook.url.done")}
                </WKButton>
            }
            className="wk-webhook-modal"
        >
            <div className="wk-webhook-url">
                <div className="wk-webhook-url__warning">
                    <IconAlertTriangle className="wk-webhook-url__warning-icon" />
                    <span>{t("base.channelWebhook.url.onceWarning")}</span>
                </div>
                {rows.map((row) => (
                    <div key={row.key} className="wk-webhook-url__row">
                        <div className="wk-webhook-url__label">{row.label}</div>
                        <div className="wk-webhook-url__value-wrap">
                            <code className="wk-webhook-url__value" title={row.url}>
                                {row.url}
                            </code>
                            <button
                                type="button"
                                className="wk-webhook-card__icon-btn"
                                onClick={() => void handleCopy(row.url)}
                                title={t("base.channelWebhook.url.copy")}
                                aria-label={t("base.channelWebhook.url.copy")}
                            >
                                <IconCopy />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </WKModal>
    );
}

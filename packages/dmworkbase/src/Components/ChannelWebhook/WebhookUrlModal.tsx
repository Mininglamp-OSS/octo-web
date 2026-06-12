import React, { useEffect, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { IconAlertTriangle, IconCopy } from "@douyinfe/semi-icons";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import { copyToClipboard } from "../../Utils/clipboard";
import {
    IncomingWebhookCreateResp,
    buildWebhookUrlRows,
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
    // 同 WebhookEditModal：条件挂载 + 路由滑入动画下，挂载即 visible=true 会让
    // 首次显示与动画竞争（要点两次）。挂载先 false、effect 翻 true 走正常过渡。
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        setVisible(true);
    }, []);

    // 行构造（native 回退 url、按适配器过滤空地址）抽到纯函数 buildWebhookUrlRows，已单测。
    const rows = buildWebhookUrlRows(
        resp,
        WKApp.apiClient.config.apiURL || "/",
        window.location.origin
    );

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
            visible={visible}
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
                {rows.length === 0 ? (
                    // 退化态：服务端契约里 url 非可选，理论不可达；仍兜底提示而非
                    // 展示「立即复制」警示却无可复制项。
                    <div className="wk-webhook-url__warning">
                        <IconAlertTriangle className="wk-webhook-url__warning-icon" />
                        <span>{t("base.channelWebhook.url.empty")}</span>
                    </div>
                ) : (
                    <>
                        <div className="wk-webhook-url__warning">
                            <IconAlertTriangle className="wk-webhook-url__warning-icon" />
                            <span>{t("base.channelWebhook.url.onceWarning")}</span>
                        </div>
                        {rows.map((row) => (
                            <div key={row.key} className="wk-webhook-url__row">
                                <div className="wk-webhook-url__label">{t(`base.${row.labelKey}`)}</div>
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
                    </>
                )}
            </div>
        </WKModal>
    );
}

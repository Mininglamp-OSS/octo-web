import React from "react";
import { Switch } from "@douyinfe/semi-ui";
import { Edit3, RefreshCw, Send, Trash2 } from "lucide-react";
import {
    IncomingWebhook,
    IncomingWebhookStatus,
    INCOMING_WEBHOOK_DEFAULT_AVATAR,
    canTestWebhook,
} from "../../Service/IncomingWebhook";

export interface ChannelWebhookCardLabels {
    disabled: string;
    toggle: string;
    edit: string;
    regenerate: string;
    test: string;
    testDisabledHint: string;
    delete: string;
}

export interface ChannelWebhookCardProps {
    item: IncomingWebhook;
    manageable: boolean;
    meta: React.ReactNode;
    toggling: boolean;
    testingBlocked: boolean;
    cooling: boolean;
    labels: ChannelWebhookCardLabels;
    onToggle: (enabled: boolean) => void;
    onEdit: () => void;
    onRegenerate: () => void;
    onTest: () => void;
    onDelete: () => void;
}

/** Props-only Webhook list item. Runtime data and mutations stay in the panel container. */
export default function ChannelWebhookCard({
    item,
    manageable,
    meta,
    toggling,
    testingBlocked,
    cooling,
    labels,
    onToggle,
    onEdit,
    onRegenerate,
    onTest,
    onDelete,
}: ChannelWebhookCardProps) {
    const enabled = item.status === IncomingWebhookStatus.enabled;
    const testAllowed = canTestWebhook(item);
    const testDisabled = !testAllowed || toggling || testingBlocked || cooling;

    return (
        <li className="wk-webhook-card">
            <div className="wk-webhook-card__head">
                <img
                    src={item.avatar || INCOMING_WEBHOOK_DEFAULT_AVATAR}
                    alt=""
                    className="wk-webhook-card__avatar"
                />
                <div className="wk-webhook-card__content">
                    <div className="wk-webhook-card__titlebox">
                        <span className="wk-webhook-card__name" title={item.name}>{item.name}</span>
                        {!enabled && (
                            <span className="wk-webhook-card__chip wk-webhook-card__chip--off">
                                {labels.disabled}
                            </span>
                        )}
                    </div>
                    <div className="wk-webhook-card__meta-wrap">{meta}</div>
                </div>
                {manageable && (
                    <Switch
                        size="small"
                        checked={enabled}
                        loading={toggling}
                        onChange={onToggle}
                        aria-label={labels.toggle}
                    />
                )}
            </div>
            {manageable && (
                <div className="wk-webhook-card__actions">
                    <button type="button" className="wk-webhook-card__icon-btn" onClick={onEdit} title={labels.edit} aria-label={labels.edit}>
                        <Edit3 aria-hidden="true" />
                    </button>
                    <button type="button" className="wk-webhook-card__icon-btn" onClick={onRegenerate} title={labels.regenerate} aria-label={labels.regenerate}>
                        <RefreshCw aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="wk-webhook-card__icon-btn"
                        disabled={testDisabled}
                        onClick={onTest}
                        title={testAllowed ? labels.test : labels.testDisabledHint}
                        aria-label={labels.test}
                    >
                        <Send aria-hidden="true" />
                    </button>
                    <button type="button" className="wk-webhook-card__icon-btn wk-webhook-card__icon-btn--danger" onClick={onDelete} title={labels.delete} aria-label={labels.delete}>
                        <Trash2 aria-hidden="true" />
                    </button>
                </div>
            )}
        </li>
    );
}

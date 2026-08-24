import { Button, Input } from "@octo/ui";
import React from "react";
import WKModal from "../WKModal";
import { useI18n } from "../../i18n";
import "./index.css";

export interface InviteInfo {
    invite_code: string;
    space_id: string;
    space_name: string;
    member_count: number;
    max_users: number;
}

export type JoinStep = "input" | "confirm";

export interface JoinSpaceModalProps {
    visible: boolean;
    step: JoinStep;
    code: string;
    onCodeChange: (v: string) => void;
    inviteInfo?: InviteInfo;
    verifyLoading?: boolean;
    joinLoading?: boolean;
    onVerify: () => void;
    onJoin: () => void;
    onBack: () => void;
    onCancel: () => void;
}

export default function JoinSpaceModal({
    visible,
    step,
    code,
    onCodeChange,
    inviteInfo,
    verifyLoading = false,
    joinLoading = false,
    onVerify,
    onJoin,
    onBack,
    onCancel,
}: JoinSpaceModalProps) {
    const { t } = useI18n();
    const isFull =
        !!inviteInfo &&
        inviteInfo.max_users > 0 &&
        inviteInfo.member_count >= inviteInfo.max_users;

    return (
        <WKModal
            title={t("base.joinSpace.title")}
            visible={visible}
            onCancel={onCancel}
        >
            {step === "input" && (
                <div className="wk-join-space-modal">
                    <p className="wk-join-space-modal__desc">
                        {t("base.joinSpace.description")}
                    </p>
                    <div className="wk-join-space-modal__field">
                        <label className="wk-join-space-modal__label">{t("base.joinSpace.inviteCode")}</label>
                        <Input
                            size="lg"
                            placeholder={t("base.joinSpace.placeholder")}
                            value={code}
                            onChange={onCodeChange}
                            onEnterPress={onVerify}
                            autoFocus
                        />
                        <span className="wk-join-space-modal__hint">
                            {t("base.joinSpace.hint")}
                        </span>
                    </div>
                    <div className="wk-join-space-modal__footer">
                        <Button variant="secondary" onClick={onCancel}>{t("base.common.cancel")}</Button>
                        <Button variant="solid" loading={verifyLoading} onClick={onVerify}>
                            {t("base.joinSpace.next")}
                        </Button>
                    </div>
                </div>
            )}

            {step === "confirm" && inviteInfo && (
                <div className="wk-join-space-modal wk-join-space-modal--confirm">
                    <div className="wk-join-space-modal__space-preview">
                        <div className="wk-join-space-modal__space-avatar">
                            {inviteInfo.space_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="wk-join-space-modal__space-name">{inviteInfo.space_name}</div>
                        <div className="wk-join-space-modal__space-meta">
                            {inviteInfo.max_users > 0
                                ? t("base.joinSpace.memberCountWithLimit", {
                                    values: { count: inviteInfo.member_count, max: inviteInfo.max_users },
                                })
                                : t("base.joinSpace.memberCount", {
                                    values: { count: inviteInfo.member_count },
                                })}
                        </div>
                        {/* 空间已满：信息去重，按钮已提示，这里不再显示 badge */}
                    </div>
                    <div className="wk-join-space-modal__footer wk-join-space-modal__footer--confirm">
                        <Button
                            variant="solid"
                            loading={joinLoading}
                            disabled={isFull}
                            onClick={onJoin}
                            className="wk-join-space-modal__join-btn"
                        >
                            {isFull ? t("base.joinSpace.full") : t("base.joinSpace.confirm")}
                        </Button>
                        <button
                            type="button"
                            className="wk-join-space-modal__back-link"
                            onClick={onBack}
                        >
                            {t("base.joinSpace.reenter")}
                        </button>
                    </div>
                </div>
            )}
        </WKModal>
    );
}

import React from "react";
import { Button } from "@douyinfe/semi-ui";
import { useI18n, type JoinApprovalStatus } from "@octo/base";
import "./index.css";

interface JoinApprovalResultProps {
    status: JoinApprovalStatus;
    onDismiss: () => void;
}

/**
 * 加入 Space 审批结果页
 * - need_approval：申请已提交，等待管理员审批
 * - pending：已有申请在审批中，无需重复提交
 *
 * 由 Layout state 统一渲染，不依赖各业务入口自己处理。
 */
export default function JoinApprovalResult({ status, onDismiss }: JoinApprovalResultProps) {
    const { t } = useI18n();
    const isPending = status === "pending";

    return (
        <div className="wk-join-approval">
            <div className="wk-join-approval-card">
                <div className="wk-join-approval-icon">
                    {isPending ? "⏳" : "✅"}
                </div>
                <h2 className="wk-join-approval-title">
                    {isPending ? t("app.joinApproval.pendingTitle") : t("app.joinApproval.submittedTitle")}
                </h2>
                <p className="wk-join-approval-desc">
                    {isPending
                        ? t("app.joinApproval.pendingDesc")
                        : t("app.joinApproval.submittedDesc")}
                </p>
                <Button
                    type="primary"
                    size="large"
                    className="wk-join-approval-btn"
                    onClick={onDismiss}
                >
                    {t("app.joinApproval.ok")}
                </Button>
            </div>
        </div>
    );
}

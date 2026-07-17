import React from "react";
import { Button, Tag } from "@douyinfe/semi-ui";
import { IconHistory } from "@douyinfe/semi-icons";
import { useI18n } from "@octo/base";
import type { SummaryVersionItem } from "../types/summary";

interface SummaryVersionHistoryProps {
    versions: SummaryVersionItem[];
    versionsLoading: boolean;
    currentVersion: number;
    restoringVersionId: number | null;
    canRestore: boolean;
    onViewVersion: (version: SummaryVersionItem) => void;
    onRestoreVersion: (version: SummaryVersionItem) => void;
}

/**
 * 总结版本历史 strip 组件。
 *
 * 从 SummaryDetailPage.renderVersionHistory() / renderPersonalVersionHistory()
 * 提取为独立组件，保留原有 strip 布局、CSS 类名和交互行为。
 *
 * 数据获取和 API 调用由父组件（SummaryDetailPage）负责，
 * 本组件只负责渲染和回调。
 */
const SummaryVersionHistory: React.FC<SummaryVersionHistoryProps> = ({
    versions,
    versionsLoading,
    currentVersion,
    restoringVersionId,
    canRestore,
    onViewVersion,
    onRestoreVersion,
}) => {
    const { t } = useI18n();

    if (!versions || versionsLoading || versions.length <= 1) {
        return null;
    }

    const formatVersionOperation = (version: SummaryVersionItem): string => {
        const opType = version.operation_type || "generate";
        if (opType === "generate") {
            return t("summary.detail.versionInitialGenerate");
        }
        const key = `summary.detail.versionOperation.${opType}`;
        const label = t(key);
        return label === key ? t("summary.detail.versionOperation.generate") : label;
    };

    return (
        <div className="summary-version-strip">
            <div className="summary-version-strip-title">
                <IconHistory />
                <span>{t("summary.detail.recentVersions")}</span>
                <span className="summary-version-strip-hint">
                    {t("summary.detail.recentVersionsLimitHint")}
                </span>
            </div>
            <div className="summary-version-list">
                {versions.slice(0, 3).map((version) => {
                    const isCurrent = version.version === currentVersion;
                    const isRestoring = restoringVersionId === version.result_id;
                    return (
                        <div key={version.result_id} className="summary-version-item">
                            <div className="summary-version-body">
                                <div className="summary-version-main">
                                    <span className="summary-version-number">
                                        {t("summary.common.version", {
                                            values: { version: version.version },
                                        })}
                                    </span>
                                    {isCurrent && (
                                        <Tag color="blue" size="small">
                                            {t("summary.detail.currentVersion")}
                                        </Tag>
                                    )}
                                    {version.operation_type === "scheduled_generate" && (
                                        <Tag color="green" size="small">
                                            {t("summary.detail.versionScheduledTaskTag")}
                                        </Tag>
                                    )}
                                    {version.operation_type !== "scheduled_generate" && (
                                        <span className="summary-version-operation">
                                            {formatVersionOperation(version)}
                                        </span>
                                    )}
                                </div>
                                {version.operation_note && (
                                    <div className="summary-version-note">
                                        {version.operation_note}
                                    </div>
                                )}
                            </div>
                            <div className="summary-version-actions">
                                <Button
                                    size="small"
                                    theme="borderless"
                                    onClick={() => onViewVersion(version)}
                                >
                                    {t("summary.detail.viewVersion")}
                                </Button>
                                {!isCurrent && canRestore && (
                                    <Button
                                        size="small"
                                        theme="borderless"
                                        loading={isRestoring}
                                        onClick={() => onRestoreVersion(version)}
                                    >
                                        {t("summary.detail.restoreVersion")}
                                    </Button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SummaryVersionHistory;

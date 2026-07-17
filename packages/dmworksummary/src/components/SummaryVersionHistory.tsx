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

function formatVersionOperation(
    version: SummaryVersionItem,
    t: (key: string, opts?: { values?: Record<string, string | number> }) => string,
): string {
    if ((version.operation_type || "generate") === "generate") {
        return t("summary.detail.versionInitialGenerate");
    }
    const key = `summary.detail.versionOperation.${version.operation_type || "generate"}`;
    const label = t(key);
    return label === key ? t("summary.detail.versionOperation.generate") : label;
}

function formatVersionOperationNote(
    version: SummaryVersionItem,
    t: (key: string, opts?: { values?: Record<string, string | number> }) => string,
): string {
    const note = (version.operation_note || "").trim();
    if (note) return note;
    if ((version.operation_type || "generate") === "generate") {
        return t("summary.detail.versionInitialGenerateDesc");
    }
    if (version.operation_type === "restore" && version.parent_result_id) {
        return t("summary.detail.versionRestoreFromResult", { values: { id: version.parent_result_id } });
    }
    return formatVersionOperation(version, t);
}

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

    if (versionsLoading || !versions || versions.length <= 1) return null;

    return (
        <div className="summary-version-strip">
            <div className="summary-version-strip-title">
                <IconHistory size="small" />
                <span>{t("summary.detail.recentVersions")}</span>
                <span className="summary-version-strip-hint">{t("summary.detail.recentVersionsLimitHint")}</span>
            </div>
            <div className="summary-version-list">
                {versions.slice(0, 3).map((version) => {
                    const isCurrent = version.version === currentVersion;
                    return (
                        <div key={version.result_id} className="summary-version-item">
                            <div className="summary-version-body">
                                <div className="summary-version-main">
                                    <span className="summary-version-number">
                                        {t("summary.common.version", { values: { version: version.version } })}
                                    </span>
                                    {isCurrent && <Tag size="small" color="blue">{t("summary.detail.currentVersion")}</Tag>}
                                    {version.operation_type === "scheduled_generate" && (
                                        <Tag size="small" color="green">{t("summary.detail.versionScheduledTaskTag")}</Tag>
                                    )}
                                    {version.operation_type !== "scheduled_generate" && (
                                        <span className="summary-version-operation">{formatVersionOperation(version, t)}</span>
                                    )}
                                </div>
                                <div className="summary-version-note">{formatVersionOperationNote(version, t)}</div>
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
                                        loading={restoringVersionId === version.result_id}
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

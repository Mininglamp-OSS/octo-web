import React from "react";
import { Timeline, Button, Tag } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { SummaryResult } from "../types/summary";
import { formatDate } from "../utils/summaryHelpers";

interface SummaryVersionHistoryProps {
    versions: SummaryResult[];
    currentVersion: number;
    onSelectVersion: (version: number) => void;
}

const SummaryVersionHistory: React.FC<SummaryVersionHistoryProps> = ({
    versions,
    currentVersion,
    onSelectVersion,
}) => {
    const { t } = useI18n();

    if (!versions || versions.length === 0) {
        return <div className="summary-version-empty">{t("summary.versionHistory.empty")}</div>;
    }

    const sorted = [...versions].sort((a, b) => b.version - a.version);

    return (
        <div className="summary-version-history">
            <Timeline>
                {sorted.map((v) => {
                    const isCurrent = v.version === currentVersion;
                    return (
                        <Timeline.Item key={v.version} color={isCurrent ? "blue" : "grey"}>
                            <div className="summary-version-item">
                                <div className="summary-version-header">
                                    <span>{t("summary.common.version", { values: { version: v.version } })}</span>
                                    {isCurrent && (
                                        <Tag color="blue" size="small" style={{ marginLeft: 8 }}>
                                            {t("summary.common.current")}
                                        </Tag>
                                    )}
                                </div>
                                <div className="summary-version-meta">
                                    {t("summary.versionHistory.meta", {
                                        values: {
                                            time: formatDate(v.generated_at),
                                            count: v.total_msg_count,
                                            model: v.model_version,
                                        },
                                    })}
                                </div>
                                {!isCurrent && (
                                    <Button
                                        size="small"
                                        theme="borderless"
                                        onClick={() => onSelectVersion(v.version)}
                                        style={{ marginTop: 4 }}
                                    >
                                        {t("summary.versionHistory.viewVersion")}
                                    </Button>
                                )}
                            </div>
                        </Timeline.Item>
                    );
                })}
            </Timeline>
        </div>
    );
};

export default SummaryVersionHistory;

import React from "react";
import { useI18n } from "@octo/base";
import { FileText, MessageSquareText, UsersRound } from "lucide-react";
import type { SourceItem } from "../types/summary";
import { SourceType, type SourceTypeValue } from "../types/summary";

interface SelectedSourcesPanelProps {
    sources: SourceItem[];
}

const SelectedSourcesPanel: React.FC<SelectedSourcesPanelProps> = ({ sources = [] }) => {
    const { t } = useI18n();
    const snapshotDocumentCount = sources.filter(
        (source) => source.source_type === SourceType.DOCUMENT && source.source_version != null
    ).length;

    const sourceIcon = (sourceType: SourceTypeValue) => {
        if (sourceType === SourceType.GROUP_CHAT) {
            return <UsersRound size={14} />;
        }
        if (sourceType === SourceType.DOCUMENT) {
            return <FileText size={14} />;
        }
        return <MessageSquareText size={14} />;
    };

    return (
        <section className="selected-sources-panel">
            <div className="selected-sources-header">
                <MessageSquareText size={15} className="selected-sources-header-icon" />
                <h3>{t("summary.source.selectedHeader")}</h3>
            </div>
            {sources.length > 0 ? (
                <div className="selected-sources-list">
                    {sources.map((source) => (
                        <div
                            key={`${source.source_type}-${source.source_id}`}
                            className="selected-sources-item"
                        >
                            <span className="selected-sources-item-icon-wrap">
                                {sourceIcon(source.source_type)}
                            </span>
                            <span className="selected-sources-item-name">
                                {source.source_name || source.source_id}
                            </span>
                        </div>
                    ))}
                    {snapshotDocumentCount > 0 && (
                        <div className="selected-sources-note" role="note">
                            {t("summary.source.documentSnapshotNoticeWithoutTime", {
                                values: { count: snapshotDocumentCount },
                            })}
                        </div>
                    )}
                </div>
            ) : (
                <div className="selected-sources-empty">
                    {t("summary.source.empty")}
                </div>
            )}
        </section>
    );
};

export default SelectedSourcesPanel;

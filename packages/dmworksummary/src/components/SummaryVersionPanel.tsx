import React from "react";
import { Button, Tag } from "@douyinfe/semi-ui";
import { IconHistory, IconClose } from "@douyinfe/semi-icons";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@octo/base";
import type { SummaryVersionItem } from "../types/summary";
import { formatDate } from "../utils/summaryHelpers";

interface SummaryVersionPanelProps {
    open: boolean;
    versions: SummaryVersionItem[];
    currentVersion: number;
    /** result_id of the version currently previewed in the center (null = viewing current). */
    selectedResultId: number | null;
    /** result_id being restored right now (spinner on footer button). */
    restoringResultId: number | null;
    canRestore: boolean;
    /** How many versions the backend retains (for the "保留最近 N 个版本" hint). */
    retention?: number;
    /** Resolve an author uid → display name. */
    resolveAuthor?: (uid?: string) => string;
    onClose: () => void;
    onSelect: (version: SummaryVersionItem) => void;
    onRestore: (version: SummaryVersionItem) => void;
}

/**
 * 版本记录：右侧滑入面板（对齐版本管理原型）。
 *
 * 由详情页页头「版本记录 [N]」按钮触发。列表为 version-card 卡片
 * （V 号圆标 + 操作 + 时间·作者 + 备注 + 箭头，当前版本带「当前」标签）。
 * 选中非当前版本时，底部出现「恢复此版本」主按钮；点卡片则在中部只读预览。
 *
 * 仅传统 workflow（快速总结）有版本记录；agent 总结不渲染（父组件门控）。
 */
const SummaryVersionPanel: React.FC<SummaryVersionPanelProps> = ({
    open,
    versions,
    currentVersion,
    selectedResultId,
    restoringResultId,
    canRestore,
    retention,
    resolveAuthor,
    onClose,
    onSelect,
    onRestore,
}) => {
    const { t } = useI18n();

    if (!open || !versions || versions.length <= 1) {
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

    const formatVersionNote = (version: SummaryVersionItem): string => {
        const note = (version.operation_note || "").trim();
        if (note) return note;
        if ((version.operation_type || "generate") === "generate") {
            return t("summary.detail.versionInitialGenerateDesc");
        }
        if (version.operation_type === "restore" && version.parent_result_id) {
            return t("summary.detail.versionRestoreFromResult", {
                values: { id: version.parent_result_id },
            });
        }
        return formatVersionOperation(version);
    };

    // The selected version drives the footer restore CTA. When nothing is
    // explicitly selected (viewing current), fall back to the current version.
    const selected =
        versions.find((v) => v.result_id === selectedResultId) ||
        versions.find((v) => v.version === currentVersion) ||
        versions[0];
    const selectedIsCurrent = !!selected && selected.version === currentVersion;
    const showRestore = canRestore && !!selected && !selectedIsCurrent;

    return (
        <>
            <button
                type="button"
                className="version-panel-scrim"
                aria-label={t("summary.detail.versionPanelClose")}
                onClick={onClose}
            />
            <aside className="version-panel" aria-label={t("summary.detail.versionRecords")}>
                <header className="version-panel__header">
                    <span className="version-panel__icon" aria-hidden>
                        <IconHistory />
                    </span>
                    <div className="version-panel__heading">
                        <h2>{t("summary.detail.versionRecords")}</h2>
                        <span>
                            {t("summary.detail.versionRetentionHint", {
                                values: { count: retention ?? versions.length },
                            })}
                        </span>
                    </div>
                    <Button
                        className="version-panel__close"
                        theme="borderless"
                        type="tertiary"
                        icon={<IconClose />}
                        aria-label={t("summary.detail.versionPanelClose")}
                        onClick={onClose}
                    />
                </header>
                <div className="version-panel__list">
                    {versions.map((version) => {
                        const isCurrent = version.version === currentVersion;
                        const isSelected = version.result_id === selectedResultId;
                        return (
                            <button
                                key={version.result_id}
                                type="button"
                                className={`version-card${isCurrent ? " is-current" : ""}${isSelected ? " is-selected" : ""}`}
                                aria-pressed={isSelected}
                                onClick={() => onSelect(version)}
                            >
                                <span className="version-card__marker" aria-hidden>
                                    <span>{`V${version.version}`}</span>
                                </span>
                                <span className="version-card__copy">
                                    <span className="version-card__title">
                                        <strong>{formatVersionOperation(version)}</strong>
                                        {isCurrent && (
                                            <Tag color="violet" size="small">
                                                {t("summary.detail.currentVersion")}
                                            </Tag>
                                        )}
                                        {version.operation_type === "scheduled_generate" && !isCurrent && (
                                            <Tag color="green" size="small">
                                                {t("summary.detail.versionScheduledTaskTag")}
                                            </Tag>
                                        )}
                                    </span>
                                    <span className="version-card__time">
                                        {formatDate(version.generated_at)}
                                        {resolveAuthor && version.created_by
                                            ? ` · ${resolveAuthor(version.created_by)}`
                                            : ""}
                                    </span>
                                    <span className="version-card__note">{formatVersionNote(version)}</span>
                                </span>
                                <span className="version-card__arrow" aria-hidden>
                                    <ChevronRight size={16} />
                                </span>
                            </button>
                        );
                    })}
                </div>
                {showRestore && (
                    <footer className="version-panel__footer">
                        <Button
                            className="version-panel__restore"
                            theme="solid"
                            type="primary"
                            block
                            icon={<IconHistory />}
                            loading={restoringResultId === selected!.result_id}
                            onClick={() => onRestore(selected!)}
                        >
                            {t("summary.detail.restoreVersion")}
                        </Button>
                    </footer>
                )}
            </aside>
        </>
    );
};

export default SummaryVersionPanel;

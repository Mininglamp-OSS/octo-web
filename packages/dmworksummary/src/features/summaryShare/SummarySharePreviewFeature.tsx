import React, { useEffect, useState } from "react";
import { Button, Spin } from "@douyinfe/semi-ui";
import { IconClose } from "@douyinfe/semi-icons";
import { useI18n } from "@octo/base";
import { getSummaryShare } from "../../api/summaryApi";
import type { SummaryShareSnapshot } from "../../types/summary";
import SummaryShareContent from "../../ui/SummaryShareContent";
import "./summaryShare.css";

interface Props {
    shareId: string;
    onClose: () => void;
    onOpenDetail: () => void;
}

export default function SummarySharePreviewFeature({ shareId, onClose, onOpenDetail }: Props) {
    const { t, locale } = useI18n();
    const [snapshot, setSnapshot] = useState<SummaryShareSnapshot | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        setSnapshot(null); setError(false);
        void getSummaryShare(shareId).then((response) => {
            if (active) setSnapshot(response.snapshot);
        }).catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [shareId]);

    return (
        <div className="summary-share-preview">
            <header className="summary-share-preview__header">
                <div>
                    <h2>{t("summary.share.fullTitle")}</h2>
                    {snapshot ? <p>{snapshot.title || t("summary.share.defaultTitle")}</p> : null}
                </div>
                <Button theme="borderless" icon={<IconClose />} aria-label={t("summary.share.close")} onClick={onClose} />
            </header>
            <main className="summary-share-preview__body">
                {!snapshot && !error ? <div className="summary-share-preview__state"><Spin />{t("summary.share.loading")}</div> : null}
                {error ? <div className="summary-share-preview__state">{t("summary.share.unavailable")}</div> : null}
                {snapshot ? <SummaryShareContent
                    snapshot={snapshot}
                    locale={locale}
                    metaLabel={t("summary.share.metaLabel")}
                    participantText={snapshot.participant_count > 0
                        ? t("summary.share.participantCount", { values: { count: snapshot.participant_count } })
                        : ""}
                    messageText={snapshot.message_count > 0
                        ? t("summary.share.messageCount", { values: { count: snapshot.message_count } })
                        : ""}
                /> : null}
            </main>
            <footer className="summary-share-preview__footer">
                <Button onClick={onClose}>{t("summary.share.close")}</Button>
                <Button theme="solid" type="primary" disabled={!snapshot} onClick={onOpenDetail}>{t("summary.share.viewDetails")}</Button>
            </footer>
        </div>
    );
}

import React, { useEffect, useState } from "react";
import { Button, Spin } from "@douyinfe/semi-ui";
import { IconArrowLeft } from "@douyinfe/semi-icons";
import { Channel } from "wukongimjssdk";
import { useI18n, WKApp } from "@octo/base";
import { getSummaryShare } from "../api/summaryApi";
import { SourceType, type SummaryShareSnapshot } from "../types/summary";
import SelectedSourcesPanel from "../components/SelectedSourcesPanel";
import SummaryShareContent from "../ui/SummaryShareContent";
import "./SummaryShareDetailPage.css";

interface SummaryShareDetailPageProps {
    shareId?: string;
    originChannel?: { channelId: string; channelType: number };
}

export default function SummaryShareDetailPage({ shareId, originChannel }: SummaryShareDetailPageProps) {
    const { t, locale } = useI18n();
    const [snapshot, setSnapshot] = useState<SummaryShareSnapshot | null>(null);
    const [error, setError] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!shareId) { setError(true); return; }
        let active = true;
        setSnapshot(null); setError(false);
        void getSummaryShare(shareId).then((response) => { if (active) setSnapshot(response.snapshot); })
            .catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [shareId, reload]);

    if (!snapshot) {
        return <div className="summary-share-detail__state">
            {error ? <><p>{t("summary.share.unavailable")}</p><Button onClick={() => setReload((value: number) => value + 1)}>{t("summary.share.retry")}</Button></> : <Spin />}
        </div>;
    }

    const snapshotSources = snapshot.source_name
        ? [{
            source_type: SourceType.DIRECT_MESSAGE,
            source_id: "snapshot-source",
            source_name: snapshot.source_name,
        }]
        : [];

    return <div className="summary-share-detail">
        <header className="summary-share-detail__header">
            {originChannel ? <Button
                className="summary-share-detail__back"
                size="small"
                theme="borderless"
                type="tertiary"
                icon={<IconArrowLeft />}
                onClick={() => WKApp.endpoints.showConversation(
                    new Channel(originChannel.channelId, originChannel.channelType),
                )}
            >
                {t("summary.share.backToChat")}
            </Button> : null}
            <h1 title={snapshot.title || t("summary.share.defaultTitle")}>
                {snapshot.title || t("summary.share.defaultTitle")}
            </h1>
        </header>
        <div className="summary-share-detail__body">
            <main className="summary-share-detail__scroll">
                <div className="summary-share-detail__content">
                    <SummaryShareContent
                        snapshot={snapshot}
                        locale={locale}
                        metaLabel={t("summary.share.metaLabel")}
                        participantText={snapshot.participant_count > 0
                            ? t("summary.share.participantCount", { values: { count: snapshot.participant_count } })
                            : ""}
                        messageText={snapshot.message_count > 0
                            ? t("summary.share.messageCount", { values: { count: snapshot.message_count } })
                            : ""}
                    />
                </div>
            </main>
            <footer className="summary-share-detail__sources">
                <div className="summary-share-detail__sources-inner">
                    <SelectedSourcesPanel sources={snapshotSources} />
                </div>
            </footer>
        </div>
    </div>;
}

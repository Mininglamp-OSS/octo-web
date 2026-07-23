import React from "react";
import { List, Tag } from "@douyinfe/semi-ui";
import { IconTickCircle, IconClock, IconClose } from "@douyinfe/semi-icons";
import { useI18n } from "@octo/base";
import type { Participant } from "../types/summary";
import { ParticipantStatus } from "../types/summary";
import { formatDate, getParticipantStatusLabel } from "../utils/summaryHelpers";
import "./SummarySelectors.css";

interface ConfirmParticipantListProps {
    participants: Participant[];
}

function statusIcon(status: number) {
    switch (status) {
        case ParticipantStatus.CONFIRMED:
            return <span className="summary-confirm-participant-icon summary-confirm-participant-icon--confirmed"><IconTickCircle /></span>;
        case ParticipantStatus.DECLINED:
            return <span className="summary-confirm-participant-icon summary-confirm-participant-icon--declined"><IconClose /></span>;
        default:
            return <span className="summary-confirm-participant-icon summary-confirm-participant-icon--pending"><IconClock /></span>;
    }
}

function statusLabel(status: number): string {
    return getParticipantStatusLabel(status);
}

function statusColor(status: number): string {
    switch (status) {
        case ParticipantStatus.CONFIRMED: return "green";
        case ParticipantStatus.DECLINED: return "red";
        default: return "amber";
    }
}

const ConfirmParticipantList: React.FC<ConfirmParticipantListProps> = ({
    participants,
}) => {
    const { t } = useI18n();

    return (
        <List
            dataSource={participants}
            className="summary-confirm-participant-list"
            renderItem={(p: Participant) => (
                <List.Item
                    key={p.user_id}
                    className="summary-confirm-participant-item"
                    header={statusIcon(p.status ?? 0)}
                    main={
                        <div>
                            <span className="summary-confirm-participant-name">{p.user_name || t("summary.common.userFallback", { values: { id: p.user_id } })}</span>
                            {p.confirmed_at && (
                                <span className="summary-confirm-participant-time">
                                    {formatDate(p.confirmed_at)}
                                </span>
                            )}
                        </div>
                    }
                    extra={
                        <Tag color={statusColor(p.status ?? 0) as any} size="small">
                            {statusLabel(p.status ?? 0)}
                        </Tag>
                    }
                />
            )}
        />
    );
};

export default ConfirmParticipantList;

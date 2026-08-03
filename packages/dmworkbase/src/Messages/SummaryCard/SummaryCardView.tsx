import React from "react";
import { Sparkles } from "lucide-react";
import "./index.css";

export interface SummaryCardViewProps {
  title: string;
  preview: string;
  meta: {
    sourceName: string;
    timeRange: string;
    participantText: string;
    messageText: string;
  };
  labels: {
    generated: string;
    ai: string;
    sourcePrefix: string;
    sourceSuffix: string;
    viewAll: string;
    viewDetail: string;
    footer: string;
  };
  trail?: React.ReactNode;
  onViewAll: () => void;
  onViewDetail: () => void;
}

export function SummaryCardView(props: SummaryCardViewProps) {
  const {
    title, preview, meta, labels, trail, onViewAll, onViewDetail,
  } = props;
  const sourceName = meta.sourceName.trim();
  const facts = [meta.timeRange, meta.participantText, meta.messageText]
    .map((item) => item.trim())
    .filter(Boolean);
  const hasMeta = Boolean(sourceName || facts.length);

  return (
    <article className="wk-message-summary-card" aria-label={title}>
      <header className="wk-message-summary-card__header">
        <div className="wk-message-summary-card__heading">
          <h3 title={title}>{title}</h3>
          <p>{labels.generated}</p>
        </div>
        <span className="wk-message-summary-card__ai-tag">
          <Sparkles size={12} aria-hidden="true" />
          {labels.ai}
        </span>
      </header>

      {hasMeta ? <div className="wk-message-summary-card__meta">
        {sourceName ? <p>{labels.sourcePrefix}<strong>「{sourceName}」</strong>{labels.sourceSuffix}</p> : null}
        {facts.length ? <p className="wk-message-summary-card__facts">
          {facts.map((fact, index) => <span key={`${index}-${fact}`}>{fact}</span>)}
        </p> : null}
      </div> : null}

      {preview ? <div className="wk-message-summary-card__preview">
        <p>{preview}</p>
        <button type="button" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onViewAll();
        }}>
          <Sparkles size={14} aria-hidden="true" />
          {labels.viewAll}
        </button>
      </div> : null}

      <footer className="wk-message-summary-card__footer">
        <button type="button" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onViewDetail();
        }}>{labels.viewDetail}</button>
        <div className="wk-message-summary-card__footer-meta">
          <span>{labels.footer}</span>
          {trail}
        </div>
      </footer>
    </article>
  );
}

export default SummaryCardView;

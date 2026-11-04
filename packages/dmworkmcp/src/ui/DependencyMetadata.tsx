import React from "react";

interface Props {
  authorLabel: string;
  creatorName?: string;
  botName?: string;
  summary?: string;
  unknownAuthor?: string;
  noSummary?: string;
}

/** Presentation only; provenance and version selection belong to the adapter. */
export default function DependencyMetadata({
  authorLabel,
  creatorName,
  botName,
  summary,
  unknownAuthor,
  noSummary,
}: Props) {
  const author = [botName, creatorName].filter(Boolean).join(" · ");
  return (
    <div className="wk-mcp-dependency-metadata">
      <p>
        {authorLabel}：{author || unknownAuthor}
      </p>
      <p>{summary || noSummary}</p>
    </div>
  );
}

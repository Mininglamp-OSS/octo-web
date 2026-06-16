import React from "react";
import { Download } from "lucide-react";
import { MarkdownImage } from "../../../Messages/Text/MarkdownContent";
import type {
  EmojiInfo,
  MentionInfo,
} from "../../../Messages/Text/MarkdownContent";
import TextContent from "../TextContent";
import "./index.css";

export type MixedContentFileTone =
  | "default"
  | "pdf"
  | "doc"
  | "sheet"
  | "slide"
  | "archive"
  | "audio"
  | "video"
  | "image"
  | "text";

export type MixedContentBlock =
  | {
      type: "text";
      id: string;
      content: string;
      mentions?: MentionInfo[];
      emojis?: EmojiInfo[];
    }
  | {
      type: "image";
      id: string;
      src: string;
      alt?: string;
    }
  | {
      type: "file";
      id: string;
      name: string;
      size: string;
      extension: string;
      iconTone?: MixedContentFileTone;
      iconLabel: string;
      url?: string;
      caption?: string;
    };

export interface MixedContentProps {
  blocks: MixedContentBlock[];
  onMentionClick?: (uid: string) => void;
  onFileDownload?: (
    block: Extract<MixedContentBlock, { type: "file" }>
  ) => void;
}

export default function MixedContent({
  blocks,
  onMentionClick,
  onFileDownload,
}: MixedContentProps) {
  return (
    <div className="wk-msg-mixed-content">
      {blocks.map((block) => {
        if (block.type === "image") {
          return (
            <div key={block.id} className="wk-msg-mixed-image">
              <MarkdownImage src={block.src} alt={block.alt} />
            </div>
          );
        }

        if (block.type === "file") {
          const canDownload = !!block.url && !!onFileDownload;
          const iconTone = block.iconTone || "default";
          return (
            <div key={block.id} className="wk-msg-mixed-file">
              <div
                className={`wk-msg-mixed-file-icon wk-msg-mixed-file-icon-${iconTone}`}
                aria-hidden="true"
              >
                {block.iconLabel}
              </div>
              <div className="wk-msg-mixed-file-info">
                <div className="wk-msg-mixed-file-name" title={block.name}>
                  {block.name}
                </div>
                <div className="wk-msg-mixed-file-meta">
                  <span>{block.size}</span>
                  {block.extension && <span>{block.extension}</span>}
                </div>
                {block.caption && (
                  <div className="wk-msg-mixed-file-caption">
                    {block.caption}
                  </div>
                )}
              </div>
              {canDownload && (
                <button
                  type="button"
                  className="wk-msg-mixed-file-download"
                  aria-label={block.name}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFileDownload?.(block);
                  }}
                >
                  <Download size={16} strokeWidth={2} />
                </button>
              )}
            </div>
          );
        }

        if (!block.content) {
          return null;
        }
        return (
          <div key={block.id} className="wk-msg-mixed-text">
            <TextContent
              content={block.content}
              mentions={block.mentions || []}
              emojis={block.emojis || []}
              onMentionClick={onMentionClick}
              enableMarkdown={false}
            />
          </div>
        );
      })}
    </div>
  );
}

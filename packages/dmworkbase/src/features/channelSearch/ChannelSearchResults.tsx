import React, { useCallback, useMemo, useRef } from "react";
import { Toast, Tooltip } from "@douyinfe/semi-ui";
import { Download, MoreHorizontal, Play } from "lucide-react";
import WKAvatar from "../../Components/WKAvatar";
import IconClick from "../../Components/IconClick";
import { downloadFile } from "../../Utils/download";
import { useI18n } from "../../i18n";
import { getRichTextBlocksUI } from "../../bridge/message/useRichTextMessageUI";
import MixedContent from "../../ui/message/MixedContent";
import type { MixedContentBlock } from "../../ui/message/MixedContent";
import { resolveChannelSearchFileIconSrc } from "../../Components/ChannelSearch/fileIcon";
import {
  FORWARD_INNER_MESSAGE_DISPLAY_LIMIT,
  formatForwardInnerMessage,
  getForwardInnerMessageHiddenCount,
} from "../../Components/ChannelSearch/forwardInnerMessage";
import { canLocateChannelSearchItem } from "../../bridge/channelSearch/locate";
import ChannelSearchSnippetContent from "../../Components/ChannelSearch/snippetContent";
import type {
  ChannelSearchDataSource,
  ChannelSearchItem,
  ChannelSearchSender,
} from "../../Service/SearchTypes";
import WKApp from "../../App";
import { useOutsideDismiss } from "./useOutsideDismiss";

const emptySearchImage = new URL(
  "../../Components/ChannelSearch/assets/figma-empty-search.png",
  import.meta.url
).href;

type GetChannelSearchSender = ChannelSearchDataSource["getSender"];

function resolveSender(
  item: ChannelSearchItem,
  getSender: GetChannelSearchSender
): ChannelSearchSender {
  return item.sender || getSender(item.senderUid);
}

function monthLabel(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

function compactFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")}KB`;
  }
  return `${bytes}B`;
}

const SenderAvatar: React.FC<{
  uid: string;
  sender?: ChannelSearchSender;
  getSender: GetChannelSearchSender;
}> = ({ uid, sender, getSender }) => {
  const resolvedSender = sender || getSender(uid);
  return (
    <WKAvatar
      src={resolvedSender.avatarUrl || WKApp.shared.avatarUser(uid)}
      style={{ width: "24px", height: "24px" }}
      lazy
    />
  );
};

type ResultItemProps = {
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewMedia?: (item: ChannelSearchItem) => void;
};

type LocateToChatIconProps = {
  size?: number;
};

const LocateToChatIcon = React.memo(function LocateToChatIcon({
  size = 16,
}: LocateToChatIconProps) {
  return (
    <svg
      aria-hidden="true"
      className="wk-channel-search-locate-icon"
      fill="none"
      focusable="false"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M14.3333 1.66675H3.66658V3.00008H12.9999V13.0001H3.66659V14.3334H14.3333V1.66675Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        d="M6.88572 11.496L5.94291 10.5532L7.82889 8.66726L1.39062 8.66726L1.39062 7.33393L7.82817 7.33393L5.94291 5.44867L6.88572 4.50586L10.3808 8.00095L6.88572 11.496Z"
        fill="currentColor"
      />
    </svg>
  );
});

type LocateIconButtonProps = {
  className: string;
  iconSize?: number;
  onClick: () => void;
};

const LocateIconButton = React.memo(function LocateIconButton({
  className,
  iconSize,
  onClick,
}: LocateIconButtonProps) {
  const { t } = useI18n();
  const label = t("base.channelSearch.locateToChatPosition");

  return (
    <Tooltip content={label} position="top">
      <button
        aria-label={label}
        className={className}
        type="button"
        onClick={onClick}
      >
        <LocateToChatIcon size={iconSize} />
      </button>
    </Tooltip>
  );
});

const RichTextResultContent = React.memo(function RichTextResultContent({
  item,
  keyword,
}: {
  item: ChannelSearchItem;
  keyword: string;
}) {
  const { t } = useI18n();
  const richText = item.richText;
  const blocks = useMemo(() => {
    return getRichTextBlocksUI(richText?.content || [], {
      entities: richText?.mention?.entities || [],
      syntheticMentions: [],
    });
  }, [richText]);
  const showMatchReason =
    !!keyword.trim() &&
    !!item.matchReason &&
    item.matchReason !== richText?.plain;

  const handleFileDownload = useCallback(
    async (block: Extract<MixedContentBlock, { type: "file" }>) => {
      if (!block.url) {
        Toast.warning(t("base.channelSearch.downloadUnavailable"));
        return;
      }
      try {
        await downloadFile(block.url, block.name);
      } catch (_) {
        Toast.error(t("base.channelSearch.downloadFailed"));
      }
    },
    [t]
  );

  if (blocks.length === 0) {
    return (
      <div className="wk-channel-search-result-text">
        <ChannelSearchSnippetContent text={item.text} keyword={keyword} />
      </div>
    );
  }

  return (
    <>
      {showMatchReason && (
        <div className="wk-channel-search-match-reason">
          <ChannelSearchSnippetContent
            text={item.matchReason}
            keyword={keyword}
          />
        </div>
      )}
      <div className="wk-channel-search-richtext-preview">
        <MixedContent blocks={blocks} onFileDownload={handleFileDownload} />
      </div>
    </>
  );
});

const MessageResultItem = React.memo(function MessageResultItem({
  item,
  keyword,
  getSender,
  onLocate,
}: ResultItemProps) {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  const isForward = item.kind === "merge_forward";
  const forwardInnerMessages = item.forward?.innerMessages || [];
  const visibleForwardInnerMessages = forwardInnerMessages.slice(
    0,
    FORWARD_INNER_MESSAGE_DISPLAY_LIMIT
  );
  const hiddenForwardInnerMessageCount = getForwardInnerMessageHiddenCount(
    forwardInnerMessages.length,
    visibleForwardInnerMessages.length,
    item.forward?.childCount
  );
  const forwardMatchReason =
    isForward && keyword.trim()
      ? t("base.channelSearch.forward.matchReason", {
          values: { keyword: keyword.trim() },
        })
      : item.matchReason;

  return (
    <div className="wk-channel-search-result wk-channel-search-message-result">
      <SenderAvatar
        uid={item.senderUid}
        sender={item.sender}
        getSender={getSender}
      />
      <div className="wk-channel-search-result-body">
        <div className="wk-channel-search-result-meta">
          <span>{sender.name}</span>
          <span>
            {format.dateTime(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        {isForward ? (
          <>
            <div className="wk-channel-search-match-reason">
              <ChannelSearchSnippetContent
                text={forwardMatchReason}
                keyword={keyword}
              />
            </div>
            <div className="wk-channel-search-forward-card">
              <div className="wk-channel-search-forward-title">
                <ChannelSearchSnippetContent
                  text={
                    item.forward?.title ||
                    t("base.channelSearch.forward.defaultTitle")
                  }
                  keyword={keyword}
                />
              </div>
              {visibleForwardInnerMessages.map((message, index) => (
                <div
                  key={`${message.messageId || "inner"}-${index}`}
                  className="wk-channel-search-forward-snippet"
                >
                  <ChannelSearchSnippetContent
                    text={formatForwardInnerMessage(message, getSender, t)}
                    keyword={keyword}
                  />
                </div>
              ))}
              {hiddenForwardInnerMessageCount > 0 && (
                <div className="wk-channel-search-forward-snippet">
                  {t("base.channelSearch.forward.more", {
                    values: { count: hiddenForwardInnerMessageCount },
                  })}
                </div>
              )}
              {visibleForwardInnerMessages.length === 0 &&
                item.forward?.snippets.map((snippet) => (
                  <div
                    key={snippet}
                    className="wk-channel-search-forward-snippet"
                  >
                    <ChannelSearchSnippetContent
                      text={snippet}
                      keyword={keyword}
                    />
                  </div>
                ))}
              {visibleForwardInnerMessages.length === 0 &&
                item.forward?.snippets.length === 0 &&
                !!item.forward?.childCount && (
                  <div className="wk-channel-search-forward-snippet">
                    {t("base.channelSearch.forward.childCount", {
                      values: { count: item.forward.childCount },
                    })}
                  </div>
                )}
            </div>
          </>
        ) : (
          <RichTextResultContent item={item} keyword={keyword} />
        )}
      </div>
      {canLocateChannelSearchItem(item) && (
        <button
          className="wk-channel-search-locate-action"
          type="button"
          onClick={() => onLocate(item)}
        >
          {t("base.channelSearch.locateToChat")}
        </button>
      )}
    </div>
  );
});

const MixedResultItem = React.memo(function MixedResultItem({
  item,
  keyword,
  getSender,
  onLocate,
  onPreviewMedia,
}: ResultItemProps) {
  if (item.kind === "file") {
    return (
      <FileInlineResult
        item={item}
        keyword={keyword}
        getSender={getSender}
        onLocate={onLocate}
      />
    );
  }
  if (item.kind === "image" || item.kind === "video") {
    return (
      <MediaInlineResult
        item={item}
        keyword={keyword}
        getSender={getSender}
        onLocate={onLocate}
        onPreviewMedia={onPreviewMedia}
      />
    );
  }
  return (
    <MessageResultItem
      item={item}
      keyword={keyword}
      getSender={getSender}
      onLocate={onLocate}
    />
  );
});

const MediaInlineResult = React.memo(function MediaInlineResult({
  item,
  keyword,
  getSender,
  onLocate,
  onPreviewMedia,
}: ResultItemProps) {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  return (
    <div className="wk-channel-search-result wk-channel-search-media-inline">
      <SenderAvatar
        uid={item.senderUid}
        sender={item.sender}
        getSender={getSender}
      />
      <div className="wk-channel-search-result-body">
        <div className="wk-channel-search-result-meta">
          <span>{sender.name}</span>
          <span>
            {format.dateTime(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="wk-channel-search-match-reason">
          <ChannelSearchSnippetContent
            text={item.matchReason}
            keyword={keyword}
          />
        </div>
        <MediaThumb
          item={item}
          onLocate={onLocate}
          onPreviewMedia={onPreviewMedia}
          compact
        />
      </div>
      {canLocateChannelSearchItem(item) && (
        <button
          className="wk-channel-search-locate-action"
          type="button"
          onClick={() => onLocate(item)}
        >
          {t("base.channelSearch.locateToChat")}
        </button>
      )}
    </div>
  );
});

type MediaThumbProps = {
  item: ChannelSearchItem;
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewMedia?: (item: ChannelSearchItem) => void;
  compact?: boolean;
};

const MediaThumb = React.memo(function MediaThumb({
  item,
  onLocate,
  onPreviewMedia,
  compact = false,
}: MediaThumbProps) {
  const { t } = useI18n();
  const thumbUrl = compact
    ? item.media?.inlineThumbUrl || item.media?.thumbUrl
    : item.media?.thumbUrl;
  const previewLabel = t("base.filePreview.preview");
  const canPreviewMedia =
    !!onPreviewMedia &&
    !!(
      item.media?.previewUrl ||
      item.media?.url ||
      item.media?.downloadUrl ||
      (item.kind === "image" && item.media?.thumbUrl)
    );

  return (
    <div
      className={[
        "wk-channel-search-media-thumb",
        `wk-channel-search-media-thumb--${item.media?.tone || "warm"}`,
        thumbUrl ? "wk-channel-search-media-thumb--image" : "",
        canPreviewMedia ? "wk-channel-search-media-thumb--previewable" : "",
        compact ? "wk-channel-search-media-thumb--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {thumbUrl && (
        <img
          alt=""
          className="wk-channel-search-media-thumb-img"
          draggable={false}
          src={thumbUrl}
        />
      )}
      {canPreviewMedia && (
        <button
          aria-label={previewLabel}
          className="wk-channel-search-media-preview-trigger"
          title={previewLabel}
          type="button"
          onClick={() => onPreviewMedia(item)}
        />
      )}
      {item.kind === "video" && (
        <div className="wk-channel-search-media-play">
          <Play size={18} fill="currentColor" />
        </div>
      )}
      {canLocateChannelSearchItem(item) && (
        <LocateIconButton
          className="wk-channel-search-media-locate"
          iconSize={16}
          onClick={() => onLocate(item)}
        />
      )}
    </div>
  );
});

const FileInlineResult = React.memo(function FileInlineResult({
  item,
  keyword,
  getSender,
  onLocate,
}: ResultItemProps) {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  const fileName = item.file?.name || t("base.conversation.file.unknown");
  const inlineFileName = fileName.replace(/\.[^.]+$/, "");
  const fileIconSrc = resolveChannelSearchFileIconSrc(
    fileName,
    item.file?.extension
  );

  return (
    <div className="wk-channel-search-result wk-channel-search-file-inline">
      <SenderAvatar
        uid={item.senderUid}
        sender={item.sender}
        getSender={getSender}
      />
      <div className="wk-channel-search-result-body">
        <div className="wk-channel-search-result-meta">
          <span>{sender.name}</span>
          <span>
            {format.dateTime(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="wk-channel-search-inline-file-card">
          <div className="wk-channel-search-inline-file-icon">
            <img src={fileIconSrc} alt="" />
          </div>
          <div className="wk-channel-search-inline-file-body">
            <div className="wk-channel-search-inline-file-name">
              <ChannelSearchSnippetContent
                text={inlineFileName}
                keyword={keyword}
              />
            </div>
            <div className="wk-channel-search-inline-file-size">
              {compactFileSize(item.file?.size || 0)}
            </div>
          </div>
        </div>
      </div>
      {canLocateChannelSearchItem(item) && (
        <button
          className="wk-channel-search-locate-action"
          type="button"
          onClick={() => onLocate(item)}
        >
          {t("base.channelSearch.locateToChat")}
        </button>
      )}
    </div>
  );
});

type MediaResultGridProps = {
  items: ChannelSearchItem[];
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewMedia?: (item: ChannelSearchItem) => void;
};

const MediaResultGrid = React.memo(function MediaResultGrid({
  items,
  onLocate,
  onPreviewMedia,
}: MediaResultGridProps) {
  const grouped = useMemo(() => {
    return items.reduce<Record<string, ChannelSearchItem[]>>((acc, item) => {
      const label = item.media?.monthBucket || monthLabel(item.timestamp);
      acc[label] = acc[label] || [];
      acc[label].push(item);
      return acc;
    }, {});
  }, [items]);

  return (
    <div className="wk-channel-search-media-groups">
      {Object.entries(grouped).map(([label, groupItems]) => (
        <section key={label} className="wk-channel-search-media-group">
          <div className="wk-channel-search-media-month">{label}</div>
          <div className="wk-channel-search-media-grid">
            {groupItems.map((item) => (
              <MediaThumb
                key={item.id}
                item={item}
                onLocate={onLocate}
                onPreviewMedia={onPreviewMedia}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
});

type FileResultItemProps = {
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  menuOpen: boolean;
  onMenuOpenChange: (itemId: string, open: boolean) => void;
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewFile?: (item: ChannelSearchItem) => void;
};

const FileResultItem = React.memo(function FileResultItem({
  item,
  keyword,
  getSender,
  menuOpen,
  onMenuOpenChange,
  onLocate,
  onPreviewFile,
}: FileResultItemProps) {
  const { format, t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const sender = resolveSender(item, getSender);
  const fileName = item.file?.name || t("base.conversation.file.unknown");
  const fileIconSrc = resolveChannelSearchFileIconSrc(
    fileName,
    item.file?.extension
  );

  const handleDownload = async () => {
    const url = item.file?.downloadUrl || item.file?.url;
    if (!url) {
      Toast.warning(t("base.channelSearch.downloadUnavailable"));
      return;
    }
    try {
      await downloadFile(url, fileName);
    } catch (_) {
      Toast.error(t("base.channelSearch.downloadFailed"));
    }
  };

  const getFileMenuDismissContainers = useCallback(() => [menuRef.current], []);
  const closeFileMenu = useCallback(() => {
    onMenuOpenChange(item.id, false);
  }, [item.id, onMenuOpenChange]);
  useOutsideDismiss(menuOpen, getFileMenuDismissContainers, closeFileMenu);

  return (
    <div
      className="wk-channel-search-file-result"
      role="button"
      tabIndex={0}
      onClick={() => onPreviewFile?.(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPreviewFile?.(item);
        }
      }}
    >
      <div className="wk-channel-search-file-icon">
        <img src={fileIconSrc} alt="" />
      </div>
      <div className="wk-channel-search-file-body">
        <div className="wk-channel-search-file-name">
          <ChannelSearchSnippetContent text={fileName} keyword={keyword} />
        </div>
        <div className="wk-channel-search-file-meta">
          <span>{sender.name}</span>
          <span>{compactFileSize(item.file?.size || 0)}</span>
          <span>
            {format.date(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
            })}
          </span>
        </div>
      </div>
      <div
        ref={menuRef}
        className={[
          "wk-channel-search-file-menu-wrap",
          menuOpen ? "is-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <IconClick
          size="sm"
          icon={<MoreHorizontal size={16} />}
          title={t("base.channelSearch.fileMore")}
          onClick={() => onMenuOpenChange(item.id, !menuOpen)}
        />
        {menuOpen && (
          <div className="wk-channel-search-file-menu">
            {canLocateChannelSearchItem(item) && (
              <button
                type="button"
                onClick={() => {
                  onMenuOpenChange(item.id, false);
                  onLocate(item);
                }}
              >
                <LocateToChatIcon size={14} />
                {t("base.channelSearch.locateToChatPosition")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onMenuOpenChange(item.id, false);
                void handleDownload();
              }}
            >
              <Download size={14} />
              {t("base.filePreview.downloadFile")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const SearchEmpty: React.FC<{
  queryStarted: boolean;
  emptyHint?: string;
  noResultsHint?: string;
}> = ({ queryStarted, emptyHint, noResultsHint }) => {
  const { t } = useI18n();
  return (
    <div className="wk-channel-search-empty">
      <div className="wk-channel-search-empty-illustration">
        <img src={emptySearchImage} alt="" />
      </div>
      <div>
        {queryStarted
          ? noResultsHint || t("base.channelSearch.noResults")
          : emptyHint || t("base.channelSearch.emptyHint")}
      </div>
    </div>
  );
};

export {
  MixedResultItem,
  FileResultItem,
  MediaResultGrid,
  SearchEmpty as ChannelSearchEmpty,
};

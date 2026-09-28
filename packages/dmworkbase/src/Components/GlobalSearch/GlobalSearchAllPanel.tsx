import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Channel } from "wukongimjssdk";
import { FileResultItem } from "../ChannelSearch";
import ChannelSearchSnippetContent from "../ChannelSearch/snippetContent";
import ItemContacts from "./item-contacts";
import ItemGroup from "./item-group";
import DriveSearchResultItem from "./DriveSearchResultItem";
import WKApp from "../../App";
import { isBot } from "../WKAvatar";
import BotDetailModal from "../BotDetailModal";
import useGlobalChatSearch from "../../bridge/globalChatSearch/useGlobalChatSearch";
import { useGlobalSearchContactSources } from "../../bridge/globalSearch/useGlobalSearchContactSources";
import { hasGlobalSearchCriteria } from "../../bridge/globalSearch/filterState";
import { useI18n } from "../../i18n";
import UserService from "../../Service/UserService";
import type { LegacyGlobalSearchContact } from "../../Service/SearchService";
import type {
  ChannelSearchItem,
  DocSearchItem,
  DriveSearchHit,
  GlobalContentTab,
  GlobalSearchDataSource,
  GlobalSearchFilters,
} from "../../Service/SearchTypes";
import "./global-search-all-panel.css";

const LIMIT = 3;

type TopState<T> = {
  items: T[];
  loading: boolean;
  error: boolean;
  retry: () => void;
};

function useTopResults<T>(
  enabled: boolean,
  request: (signal: AbortSignal) => Promise<T[]>
): TopState<T> {
  const [state, setState] = useState<TopState<T>>({
    items: [],
    loading: false,
    error: false,
    retry: () => undefined,
  });
  const [retryVersion, setRetryVersion] = useState(0);
  const retry = useCallback(
    () => setRetryVersion((version) => version + 1),
    []
  );

  useEffect(() => {
    if (!enabled) {
      setState({ items: [], loading: false, error: false, retry });
      return;
    }
    const controller = new AbortController();
    setState({ items: [], loading: true, error: false, retry });
    void request(controller.signal).then(
      (items) =>
        !controller.signal.aborted &&
        setState({ items, loading: false, error: false, retry }),
      () =>
        !controller.signal.aborted &&
        setState({ items: [], loading: false, error: true, retry })
    );
    return () => controller.abort();
  }, [enabled, request, retry, retryVersion]);

  return state;
}

function useTopContent(
  tab: GlobalContentTab,
  keyword: string,
  filters: GlobalSearchFilters,
  dataSource: GlobalSearchDataSource,
  enabled: boolean
): TopState<ChannelSearchItem> {
  const canSearch = enabled && hasGlobalSearchCriteria(tab, keyword, filters);
  const request = useCallback(
    async (signal: AbortSignal) => {
      const response = await dataSource.searchMessages({
        tab,
        keyword,
        filters,
        limit: LIMIT,
        signal,
      });
      return response.items.slice(0, LIMIT);
    },
    [dataSource, filters, keyword, tab]
  );
  return useTopResults(canSearch, request);
}

function useTopDocs(
  keyword: string,
  dataSource: GlobalSearchDataSource,
  enabled: boolean
): TopState<DocSearchItem> {
  const searchDocs = dataSource.searchDocs;
  const canSearch = enabled && !!keyword.trim() && !!searchDocs;
  const request = useCallback(
    async (signal: AbortSignal) => {
      const response = await searchDocs!({
        keyword: keyword.trim(),
        pageSize: LIMIT,
        signal,
      });
      return response.items.slice(0, LIMIT);
    },
    [keyword, searchDocs]
  );
  return useTopResults(canSearch, request);
}

function useTopDrive(
  keyword: string,
  dataSource: GlobalSearchDataSource,
  enabled: boolean
): TopState<DriveSearchHit> {
  const searchDrive = dataSource.searchDrive;
  const canSearch = enabled && !!keyword.trim() && !!searchDrive;
  const request = useCallback(
    async (signal: AbortSignal) => {
      const response = await searchDrive!(
        {
          q: keyword.trim(),
          scope: "all",
          filters: { types: ["blob", "doc"] },
          page_index: 0,
          page_size: LIMIT,
        },
        signal
      );
      return response.items.slice(0, LIMIT);
    },
    [keyword, searchDrive]
  );
  return useTopResults(canSearch, request);
}

interface Props {
  keyword: string;
  friends?: LegacyGlobalSearchContact[];
  groups?: LegacyGlobalSearchContact[];
  legacyLoading?: boolean;
  /** The legacy contacts/groups request failed, so it cannot prove an empty result. */
  legacyError?: boolean;
  dataSource: GlobalSearchDataSource;
  filters: GlobalSearchFilters;
  isActive: boolean;
  contentSearchEnabled: boolean;
  docsEnabled: boolean;
  driveEnabled: boolean;
  onSelectTab: (tab: string) => void;
  onOpenConversation: (conversationKey: string) => void;
  onClick: (
    type: "contacts" | "group"
  ) => (item: LegacyGlobalSearchContact) => void;
  onLocateMessage: (item: ChannelSearchItem) => void;
  onOpenDoc: (item: DocSearchItem) => void;
  onOpenDriveHit: (item: DriveSearchHit) => void;
  /** Close the enclosing search modal only after Bot card navigation. */
  hideModal?: () => void;
}

function Segment({
  title,
  moreTab,
  children,
  onSelectTab,
  moreLabel,
}: {
  title: string;
  moreTab: string;
  children: React.ReactNode;
  onSelectTab: (tab: string) => void;
  moreLabel: string;
}) {
  return (
    <section className="wk-global-search-all__segment">
      <header>
        <span>{title}</span>
        <button type="button" onClick={() => onSelectTab(moreTab)}>
          {moreLabel}
        </button>
      </header>
      {children}
    </section>
  );
}

function SegmentError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="wk-global-search-all__segment-error" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

export default function GlobalSearchAllPanel(props: Props) {
  const { t } = useI18n();
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [botDetailUid, setBotDetailUid] = useState("");
  const [botDetailVisible, setBotDetailVisible] = useState(false);
  const isActiveRef = useRef(props.isActive);
  const contactRequestRef = useRef(0);
  const hasSearchCriteria =
    hasGlobalSearchCriteria("messages", props.keyword, props.filters) ||
    hasGlobalSearchCriteria("files", props.keyword, props.filters);
  const contacts = useMemo(
    () => (props.friends ?? []).slice(0, LIMIT),
    [props.friends]
  );
  const contactSources = useGlobalSearchContactSources(
    contacts,
    props.isActive && hasSearchCriteria
  );

  useEffect(() => {
    isActiveRef.current = props.isActive;
    if (!props.isActive) {
      // The aggregate panel stays mounted while another tab is visible. Close
      // its portal modal and invalidate a profile request started on this tab.
      contactRequestRef.current += 1;
      setBotDetailVisible(false);
    }
    return () => {
      isActiveRef.current = false;
      contactRequestRef.current += 1;
    };
  }, [props.isActive]);

  const handleContactClick = async (item: LegacyGlobalSearchContact) => {
    const request = ++contactRequestRef.current;
    // Global-search contact hits do not include a robot flag. The local
    // channel cache is often cold on the All tab, so confirm before falling
    // through to the generic router, which closes the search modal.
    let bot = isBot(item.channel_id);
    if (!bot) {
      try {
        const profile = await UserService.getUserProfile(item.channel_id);
        bot = profile.robot === 1 || profile.robot === true;
      } catch {
        // Ordinary-contact routing remains the fallback when lookup fails.
      }
      if (request !== contactRequestRef.current || !isActiveRef.current) {
        return;
      }
    }
    if (bot) {
      setBotDetailUid(item.channel_id);
      setBotDetailVisible(true);
      return;
    }
    props.onClick("contacts")(item);
  };
  const enabled = props.isActive && props.contentSearchEnabled;
  const files = useTopContent(
    "files",
    props.keyword,
    props.filters,
    props.dataSource,
    enabled
  );
  const docs = useTopDocs(
    props.keyword,
    props.dataSource,
    props.isActive && props.docsEnabled
  );
  const drive = useTopDrive(
    props.keyword,
    props.dataSource,
    props.isActive && props.driveEnabled
  );
  const chats = useGlobalChatSearch({
    keyword: props.keyword,
    filters: props.filters,
    dataSource: props.dataSource,
    isActive: enabled,
    loadConversationDetails: false,
  });
  const conversations = useMemo(
    // The chat tab renders the API's group order verbatim. Keep the aggregate
    // preview aligned by taking its first three conversations without a local
    // time- or match-count-based reordering.
    () => chats.overview.conversations.slice(0, LIMIT),
    [chats.overview.conversations]
  );
  const hasAggregateError =
    files.error ||
    docs.error ||
    drive.error ||
    chats.overview.status === "error";
  const moreLabel = t("base.globalSearch.all.more");
  const searchFailedRetryLabel = t("base.globalSearch.searchFailedRetry");
  const retryLabel = t("base.workspaceGroup.retry");

  // This panel remains mounted across tab switches to preserve its request
  // state, but its rows must not remain in the DOM while another tab is
  // active. Apart from avoiding duplicate accessible content, this prevents
  // strict text locators from resolving both the active tab and this hidden
  // aggregate preview.
  if (!props.isActive) return null;

  if (!hasSearchCriteria)
    return (
      <div className="wk-global-search-all">
        <div className="wk-global-search-all__hint">
          {t("base.globalSearch.startHint")}
        </div>
      </div>
    );
  return (
    <div className="wk-global-search-all">
      {(props.friends?.length ?? 0) > 0 && (
        <Segment
          title={t("base.globalSearch.tab.contacts")}
          moreTab="contacts"
          onSelectTab={props.onSelectTab}
          moreLabel={moreLabel}
        >
          {contacts.map((item) => (
            <ItemContacts
              key={item.channel_id}
              name={item.channel_name}
              avatar={WKApp.shared.avatarUser(item.channel_id)}
              isBot={isBot(item.channel_id)}
              sourceSpaceName={contactSources.get(item.channel_id)}
              onClick={() => void handleContactClick(item)}
            />
          ))}
        </Segment>
      )}
      <BotDetailModal
        uid={botDetailUid}
        visible={botDetailVisible}
        onClose={() => setBotDetailVisible(false)}
        onChat={(channel) => {
          WKApp.endpoints.showConversation(channel, { fromSearch: true });
          setBotDetailVisible(false);
          props.hideModal?.();
        }}
      />
      {(props.groups?.length ?? 0) > 0 && (
        <Segment
          title={t("base.globalSearch.tab.groups")}
          moreTab="groups"
          onSelectTab={props.onSelectTab}
          moreLabel={moreLabel}
        >
          {props.groups!.slice(0, LIMIT).map((item) => (
            <ItemGroup
              key={item.channel_id}
              name={item.channel_name}
              avatar={WKApp.shared.avatarGroup(item.channel_id)}
              onClick={() => props.onClick("group")(item)}
            />
          ))}
        </Segment>
      )}
      {props.contentSearchEnabled &&
        (conversations.length > 0 ||
          chats.overview.status === "loading" ||
          chats.overview.status === "error") && (
          <Segment
            title={t("base.globalSearch.tab.chat")}
            moreTab="messages"
            onSelectTab={props.onSelectTab}
            moreLabel={moreLabel}
          >
            {conversations.map((item) => (
              <button
                key={item.key}
                type="button"
                className="wk-global-search-all__conversation"
                onClick={() => props.onOpenConversation(item.key)}
              >
                <img
                  src={item.avatarUrl}
                  alt=""
                  onError={(event) => {
                    const image = event.currentTarget;
                    const fallback = WKApp.shared.avatarChannel(
                      new Channel(item.channelId, item.channelType)
                    );
                    if (fallback && image.src !== fallback) {
                      image.src = fallback;
                    } else {
                      image.style.visibility = "hidden";
                    }
                  }}
                />
                <span>{item.name}</span>
                <small>
                  {item.preview[0]?.text ? (
                    <ChannelSearchSnippetContent
                      text={item.preview[0].text}
                      keyword={props.keyword}
                    />
                  ) : (
                    item.preview[0]?.file?.name || ""
                  )}
                </small>
              </button>
            ))}
            {chats.overview.status === "error" && (
              <SegmentError
                message={searchFailedRetryLabel}
                retryLabel={retryLabel}
                onRetry={chats.retryOverview}
              />
            )}
          </Segment>
        )}
      {props.contentSearchEnabled &&
        (files.items.length > 0 || files.loading || files.error) && (
          <Segment
            title={t("base.globalSearch.tab.files")}
            moreTab="files"
            onSelectTab={props.onSelectTab}
            moreLabel={moreLabel}
          >
            {files.items.map((item) => (
              <FileResultItem
                key={item.id}
                item={item}
                keyword={props.keyword}
                getSender={props.dataSource.getSender}
                menuOpen={openFileId === item.id}
                onMenuOpenChange={(id, open) => setOpenFileId(open ? id : null)}
                onLocate={props.onLocateMessage}
              />
            ))}
            {files.error && (
              <SegmentError
                message={searchFailedRetryLabel}
                retryLabel={retryLabel}
                onRetry={files.retry}
              />
            )}
          </Segment>
        )}
      {props.docsEnabled &&
        (docs.items.length > 0 || docs.loading || docs.error) && (
          <Segment
            title={t("base.globalSearch.tab.docs")}
            moreTab="docs"
            onSelectTab={props.onSelectTab}
            moreLabel={moreLabel}
          >
            {docs.items.map((item) => (
              <button
                type="button"
                className="wk-global-search-all__plain-hit"
                key={item.docId}
                onClick={() => props.onOpenDoc(item)}
              >
                {item.title}
              </button>
            ))}
            {docs.error && (
              <SegmentError
                message={searchFailedRetryLabel}
                retryLabel={retryLabel}
                onRetry={docs.retry}
              />
            )}
          </Segment>
        )}
      {props.driveEnabled &&
        (drive.items.length > 0 || drive.loading || drive.error) && (
          <Segment
            title={t("base.globalSearch.tab.drive")}
            moreTab="drive"
            onSelectTab={props.onSelectTab}
            moreLabel={moreLabel}
          >
            {drive.items.map((item) => (
              <DriveSearchResultItem
                key={item.file_id}
                hit={item}
                onOpen={props.onOpenDriveHit}
              />
            ))}
            {drive.error && (
              <SegmentError
                message={searchFailedRetryLabel}
                retryLabel={retryLabel}
                onRetry={drive.retry}
              />
            )}
          </Segment>
        )}
      {!props.legacyLoading &&
        !props.legacyError &&
        !files.loading &&
        chats.overview.status !== "loading" &&
        !docs.loading &&
        !drive.loading &&
        !(
          props.friends?.length ||
          props.groups?.length ||
          conversations.length ||
          files.items.length ||
          docs.items.length ||
          drive.items.length
        ) &&
        !hasAggregateError && (
          <div className="wk-global-search-all__hint">
            {t("base.globalSearch.aggregated.emptyHint")}
          </div>
        )}
    </div>
  );
}

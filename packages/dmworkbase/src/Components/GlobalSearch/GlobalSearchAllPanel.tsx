import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileResultItem } from "../ChannelSearch";
import ItemContacts from "./item-contacts";
import ItemGroup from "./item-group";
import WKApp from "../../App";
import { isBot } from "../WKAvatar";
import BotDetailModal from "../BotDetailModal";
import useGlobalChatSearch from "../../bridge/globalChatSearch/useGlobalChatSearch";
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

type TopState<T> = { items: T[]; loading: boolean };

function useTopResults<T>(
  enabled: boolean,
  request: (signal: AbortSignal) => Promise<T[]>
): TopState<T> {
  const [state, setState] = useState<TopState<T>>({
    items: [],
    loading: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ items: [], loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ items: [], loading: true });
    void request(controller.signal).then(
      (items) =>
        !controller.signal.aborted && setState({ items, loading: false }),
      () =>
        !controller.signal.aborted && setState({ items: [], loading: false })
    );
    return () => controller.abort();
  }, [enabled, request]);

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
  const request = useCallback(async () => {
    const response = await searchDocs!({
      keyword: keyword.trim(),
      pageSize: LIMIT,
    });
    return response.items.slice(0, LIMIT);
  }, [keyword, searchDocs]);
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

export default function GlobalSearchAllPanel(props: Props) {
  const { t } = useI18n();
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [botDetailUid, setBotDetailUid] = useState("");
  const [botDetailVisible, setBotDetailVisible] = useState(false);

  const handleContactClick = async (item: LegacyGlobalSearchContact) => {
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
  });
  const conversations = useMemo(
    // The chat tab renders the API's group order verbatim. Keep the aggregate
    // preview aligned by taking its first three conversations without a local
    // time- or match-count-based reordering.
    () => chats.overview.conversations.slice(0, LIMIT),
    [chats.overview.conversations]
  );
  const moreLabel = t("base.globalSearch.all.more");
  const hasSearchCriteria = hasGlobalSearchCriteria(
    "messages",
    props.keyword,
    props.filters
  );

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
          {props.friends!.slice(0, LIMIT).map((item) => (
            <ItemContacts
              key={item.channel_id}
              name={item.channel_name}
              avatar={WKApp.shared.avatarUser(item.channel_id)}
              isBot={isBot(item.channel_id)}
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
        (conversations.length > 0 || chats.overview.status === "loading") && (
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
                <img src={item.avatarUrl} alt="" />
                <span>{item.name}</span>
                <small>
                  {item.preview[0]?.text || item.preview[0]?.file?.name || ""}
                </small>
              </button>
            ))}
          </Segment>
        )}
      {props.contentSearchEnabled &&
        (files.items.length > 0 || files.loading) && (
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
          </Segment>
        )}
      {props.docsEnabled && (docs.items.length > 0 || docs.loading) && (
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
        </Segment>
      )}
      {props.driveEnabled && (drive.items.length > 0 || drive.loading) && (
        <Segment
          title={t("base.globalSearch.tab.drive")}
          moreTab="drive"
          onSelectTab={props.onSelectTab}
          moreLabel={moreLabel}
        >
          {drive.items.map((item) => (
            <button
              type="button"
              className="wk-global-search-all__plain-hit"
              key={item.file_id}
              onClick={() => props.onOpenDriveHit(item)}
            >
              {item.name}
            </button>
          ))}
        </Segment>
      )}
      {!files.loading &&
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
        ) && (
          <div className="wk-global-search-all__hint">
            {t("base.globalSearch.aggregated.emptyHint")}
          </div>
        )}
    </div>
  );
}

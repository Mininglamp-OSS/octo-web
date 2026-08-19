import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WKApp } from "@octo/base";
import MailService from "../Service/MailService";
import type { MailIdentity, Mailbox, MessageSummary } from "./types";
import { getErrorMessage, hasKeyword } from "../utils";
import { useAgentMailboxContext } from "./mailboxContext";

const PAGE_SIZE = 30;
const STATE_POLL_INTERVAL_MS = 10_000;
const FULL_REFRESH_FALLBACK_INTERVAL_MS = 5 * 60_000;

interface RefreshRequest {
  revision: number;
  silent: boolean;
}

type WorkspaceErrorSource = "resources" | "messages" | "mutation";

function useSilentRefreshFlag(
  request: RefreshRequest,
  foregroundKey: unknown
): boolean {
  const previousRef = useRef<{
    revision: number;
    foregroundKey: unknown;
    silent: boolean;
  }>();
  const previous = previousRef.current;
  let silent = previous?.silent ?? false;

  if (previous && !Object.is(previous.foregroundKey, foregroundKey)) {
    silent = false;
  } else if (!previous || previous.revision !== request.revision) {
    silent = request.silent;
  }

  previousRef.current = {
    revision: request.revision,
    foregroundKey,
    silent,
  };
  return silent;
}

export interface MailWorkspaceState {
  mailboxes: Mailbox[];
  identity: MailIdentity | null;
  identityUnavailable: boolean;
  mailboxContextId: string;
  selectedMailbox: string;
  selectedMessageId: string;
  messages: MessageSummary[];
  total: number;
  page: number;
  pageCount: number;
  search: string;
  unreadOnly: boolean;
  loading: boolean;
  error: string;
  starringMessageIds: string[];
  setSearch: (value: string) => void;
  setUnreadOnly: (value: boolean) => void;
  selectMailbox: (name: string) => void;
  selectMessage: (id: string) => void;
  markMessageRead: (message: MessageSummary) => void;
  toggleStar: (message: MessageSummary) => void;
  setPage: (page: number) => void;
  reload: () => void;
}

export default function useMailWorkspace(
  fallbackError: string
): MailWorkspaceState {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [identity, setIdentity] = useState<MailIdentity | null>(null);
  const [identityUnavailable, setIdentityUnavailable] = useState(false);
  const [selectedMailbox, setSelectedMailbox] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(1);
  const [search, setSearchState] = useState("");
  const [unreadOnly, setUnreadOnlyState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [starringMessageIds, setStarringMessageIds] = useState<string[]>([]);
  const [refreshRequest, setRefreshRequest] = useState<RefreshRequest>({
    revision: 0,
    silent: false,
  });
  const context = useAgentMailboxContext();
  const mailboxContextId = context?.mailbox.id || "";
  const requestRef = useRef(0);
  const resourcesRequestRef = useRef(0);
  const starringMessageIdsRef = useRef(new Set<string>());
  const foregroundInteractionRef = useRef(0);
  const foregroundRequestCountRef = useRef(0);
  const pendingForegroundRefreshRef = useRef(false);
  const errorSourceRef = useRef<WorkspaceErrorSource | null>(null);
  const messagesRef = useRef(messages);
  const selectedMessageIdRef = useRef(selectedMessageId);

  const clearWorkspaceError = useCallback((source?: WorkspaceErrorSource) => {
    if (source && errorSourceRef.current !== source) return;
    errorSourceRef.current = null;
    setError("");
  }, []);
  const setWorkspaceError = useCallback(
    (source: WorkspaceErrorSource, reason: unknown) => {
      errorSourceRef.current = source;
      setError(getErrorMessage(reason, fallbackError));
    },
    [fallbackError]
  );

  useEffect(() => {
    messagesRef.current = messages;
    selectedMessageIdRef.current = selectedMessageId;
  }, [messages, selectedMessageId]);

  const reload = useCallback(() => {
    pendingForegroundRefreshRef.current = true;
    setRefreshRequest((current) => ({
      revision: current.revision + 1,
      silent: false,
    }));
  }, []);
  const refreshSilently = useCallback(() => {
    const silent =
      foregroundRequestCountRef.current === 0 &&
      !pendingForegroundRefreshRef.current;
    setRefreshRequest((current) => ({
      revision: current.revision + 1,
      silent,
    }));
  }, []);
  const selectMailbox = useCallback((name: string) => {
    foregroundInteractionRef.current += 1;
    setSelectedMailbox(name);
    setSelectedMessageId("");
    setMessages([]);
    setTotal(0);
    setPageState(1);
  }, []);
  const selectMessage = useCallback((id: string) => {
    setSelectedMessageId(id);
  }, []);
  const markMessageRead = useCallback(
    (message: MessageSummary) => {
      if (!mailboxContextId || !message.unread) return;
      const applyReadState = (unread: boolean) => {
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id
              ? {
                  ...item,
                  unread,
                  keywords: unread
                    ? item.keywords.filter(
                        (keyword) => keyword.toLowerCase() !== "\\seen"
                      )
                    : Array.from(new Set([...item.keywords, "\\Seen"])),
                }
              : item
          )
        );
        setMailboxes((current) =>
          current.map((mailbox) =>
            mailbox.name === selectedMailbox
              ? {
                  ...mailbox,
                  unread: Math.max(0, mailbox.unread + (unread ? 1 : -1)),
                }
              : mailbox
          )
        );
      };
      applyReadState(false);
      void MailService.updateKeywords(
        mailboxContextId,
        message.id,
        ["\\Seen"],
        []
      ).catch((reason) => {
        applyReadState(true);
        setWorkspaceError("mutation", reason);
      });
    },
    [mailboxContextId, selectedMailbox, setWorkspaceError]
  );
  const setSearch = useCallback((value: string) => {
    foregroundInteractionRef.current += 1;
    setSearchState(value);
    setPageState(1);
  }, []);
  const setUnreadOnly = useCallback((value: boolean) => {
    foregroundInteractionRef.current += 1;
    setUnreadOnlyState(value);
    setSelectedMessageId("");
    setPageState(1);
  }, []);
  const setPage = useCallback((value: number) => {
    foregroundInteractionRef.current += 1;
    setPageState(Math.max(1, value));
  }, []);
  const toggleStar = useCallback(
    (message: MessageSummary) => {
      if (!mailboxContextId || starringMessageIdsRef.current.has(message.id)) {
        return;
      }
      const starred = hasKeyword(message.keywords, "\\Flagged");
      starringMessageIdsRef.current.add(message.id);
      setStarringMessageIds((current) => [...current, message.id]);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                keywords: starred
                  ? item.keywords.filter(
                      (keyword) =>
                        keyword.toLowerCase() !== "\\flagged" &&
                        keyword.toLowerCase() !== "$flagged"
                    )
                  : [...item.keywords, "\\Flagged"],
              }
            : item
        )
      );
      void MailService.updateKeywords(
        mailboxContextId,
        message.id,
        starred ? [] : ["\\Flagged"],
        starred ? ["\\Flagged"] : []
      )
        .catch((reason) => {
          setWorkspaceError("mutation", reason);
          reload();
        })
        .finally(() => {
          starringMessageIdsRef.current.delete(message.id);
          setStarringMessageIds((current) =>
            current.filter((id) => id !== message.id)
          );
        });
    },
    [mailboxContextId, reload, setWorkspaceError]
  );

  const resourcesRefreshSilent = useSilentRefreshFlag(
    refreshRequest,
    `${mailboxContextId}\u0000${
      context?.mailbox.address || ""
    }\u0000${fallbackError}`
  );
  const messagesRefreshSilent = useSilentRefreshFlag(
    refreshRequest,
    `${mailboxContextId}\u0000${fallbackError}\u0000${foregroundInteractionRef.current}`
  );

  useEffect(() => {
    setSelectedMailbox("");
    setSelectedMessageId("");
    setMessages([]);
    setTotal(0);
    setPageState(1);
    setSearchState("");
    setUnreadOnlyState(false);
    starringMessageIdsRef.current.clear();
    setStarringMessageIds([]);
    clearWorkspaceError();
  }, [clearWorkspaceError, mailboxContextId]);

  useEffect(() => {
    if (!mailboxContextId) {
      setMailboxes([]);
      setIdentity(null);
      setIdentityUnavailable(true);
      setLoading(false);
      return undefined;
    }
    let active = true;
    let foregroundActive = !resourcesRefreshSilent;
    if (foregroundActive) {
      foregroundRequestCountRef.current += 1;
      pendingForegroundRefreshRef.current = false;
    }
    const finishForegroundRequest = () => {
      if (!foregroundActive) return;
      foregroundActive = false;
      foregroundRequestCountRef.current = Math.max(
        0,
        foregroundRequestCountRef.current - 1
      );
    };
    const request = ++resourcesRequestRef.current;
    if (!resourcesRefreshSilent) setLoading(true);
    setIdentity({ address: context?.mailbox.address || "" });
    setIdentityUnavailable(false);
    void MailService.listMailboxes(mailboxContextId)
      .then((nextMailboxes) => {
        if (!active || request !== resourcesRequestRef.current) return;
        setMailboxes(nextMailboxes);
        if (resourcesRefreshSilent) clearWorkspaceError("resources");
        setSelectedMailbox((current) => {
          if (
            current &&
            nextMailboxes.some((mailbox) => mailbox.name === current)
          ) {
            return current;
          }
          return (
            nextMailboxes.find(
              (mailbox) =>
                mailbox.role === "inbox" ||
                mailbox.name.toLowerCase() === "inbox"
            )?.name ||
            nextMailboxes[0]?.name ||
            ""
          );
        });
      })
      .catch((reason) => {
        if (active && request === resourcesRequestRef.current) {
          if (!resourcesRefreshSilent) {
            setWorkspaceError("resources", reason);
            setLoading(false);
          }
        }
      })
      .finally(finishForegroundRequest);

    return () => {
      active = false;
      finishForegroundRequest();
    };
  }, [
    clearWorkspaceError,
    context?.mailbox.address,
    mailboxContextId,
    refreshRequest.revision,
    resourcesRefreshSilent,
    setWorkspaceError,
  ]);

  useEffect(() => {
    if (!mailboxContextId || !selectedMailbox) {
      setMessages([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const request = ++requestRef.current;
    const controller = new AbortController();
    let foregroundActive = !messagesRefreshSilent;
    if (foregroundActive) {
      foregroundRequestCountRef.current += 1;
      pendingForegroundRefreshRef.current = false;
    }
    const finishForegroundRequest = () => {
      if (!foregroundActive) return;
      foregroundActive = false;
      foregroundRequestCountRef.current = Math.max(
        0,
        foregroundRequestCountRef.current - 1
      );
    };
    if (!messagesRefreshSilent) {
      setLoading(true);
      clearWorkspaceError();
    }
    const timer = window.setTimeout(
      () => {
        void MailService.listMessages({
          mailboxContextId,
          mailbox: selectedMailbox,
          search,
          unread: unreadOnly,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          signal: controller.signal,
        })
          .then((response) => {
            if (request !== requestRef.current) return;
            const responseMessages = response.messages ?? [];
            const selectedMessageId = selectedMessageIdRef.current;
            const selectedMessage = messagesRef.current.find(
              (message) => message.id === selectedMessageId
            );
            const preserveSelectedMessage =
              messagesRefreshSilent &&
              unreadOnly &&
              selectedMessage &&
              !selectedMessage.unread &&
              !responseMessages.some(
                (message) => message.id === selectedMessage.id
              );
            const nextMessages = preserveSelectedMessage
              ? [...responseMessages]
              : responseMessages;
            if (preserveSelectedMessage) {
              const previousIndex = messagesRef.current.findIndex(
                (message) => message.id === selectedMessage.id
              );
              nextMessages.splice(
                Math.min(Math.max(previousIndex, 0), nextMessages.length),
                0,
                selectedMessage
              );
            }
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
            setTotal(response.total ?? 0);
            if (messagesRefreshSilent) clearWorkspaceError("messages");
            setSelectedMessageId((current) => {
              const nextSelectedMessageId =
                current &&
                nextMessages.some((message) => message.id === current)
                  ? current
                  : "";
              selectedMessageIdRef.current = nextSelectedMessageId;
              return nextSelectedMessageId;
            });
          })
          .catch((reason) => {
            if (controller.signal.aborted || request !== requestRef.current)
              return;
            if (!messagesRefreshSilent) {
              setWorkspaceError("messages", reason);
            }
          })
          .finally(() => {
            if (request === requestRef.current) setLoading(false);
            finishForegroundRequest();
          });
      },
      search ? 250 : 0
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      finishForegroundRequest();
    };
  }, [
    clearWorkspaceError,
    mailboxContextId,
    messagesRefreshSilent,
    page,
    refreshRequest.revision,
    search,
    selectedMailbox,
    setWorkspaceError,
    unreadOnly,
  ]);

  useEffect(() => {
    if (!mailboxContextId) return undefined;

    let active = true;
    let polling = false;
    let pollWhenSettled = false;
    let knownState: string | null = null;
    let stateController: AbortController | null = null;

    const pollState = () => {
      if (!active || polling || document.visibilityState === "hidden") {
        return;
      }
      polling = true;
      stateController = new AbortController();
      void MailService.getState(mailboxContextId, stateController.signal)
        .then((nextState) => {
          if (!active || document.visibilityState === "hidden") return;
          const changed = knownState === null || knownState !== nextState;
          knownState = nextState;
          if (changed) refreshSilently();
        })
        .catch(() => {
          // State polling is an optimization. The low-frequency full refresh
          // below remains the fail-safe when this lightweight request fails.
        })
        .finally(() => {
          polling = false;
          stateController = null;
          if (pollWhenSettled) {
            pollWhenSettled = false;
            pollState();
          }
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") refreshSilently();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stateController?.abort();
        return;
      }
      if (polling) {
        pollWhenSettled = true;
        return;
      }
      pollState();
    };
    const stateInterval = window.setInterval(pollState, STATE_POLL_INTERVAL_MS);
    const fallbackInterval = window.setInterval(
      refreshWhenVisible,
      FULL_REFRESH_FALLBACK_INTERVAL_MS
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      stateController?.abort();
      window.clearInterval(stateInterval);
      window.clearInterval(fallbackInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [mailboxContextId, refreshSilently]);

  useEffect(() => {
    const refresh = () => reload();
    const handleSpaceChanged = () => {
      resourcesRequestRef.current += 1;
      requestRef.current += 1;
      setMailboxes([]);
      setIdentity(null);
      setIdentityUnavailable(false);
      setSelectedMailbox("");
      setSelectedMessageId("");
      setMessages([]);
      setTotal(0);
      setPageState(1);
      setSearchState("");
      setUnreadOnlyState(false);
      setLoading(true);
      clearWorkspaceError();
      reload();
    };
    const handleMenu = (payload: { menuId?: string }) => {
      if (payload?.menuId === "mail") reload();
    };
    WKApp.mittBus.on("mail-refresh" as never, refresh);
    WKApp.mittBus.on("wk:nav-menu-activated", handleMenu);
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => {
      WKApp.mittBus.off("mail-refresh" as never, refresh);
      WKApp.mittBus.off("wk:nav-menu-activated", handleMenu);
      WKApp.mittBus.off("space-changed", handleSpaceChanged);
    };
  }, [clearWorkspaceError, reload]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  return {
    mailboxes,
    identity,
    identityUnavailable,
    mailboxContextId,
    selectedMailbox,
    selectedMessageId,
    messages,
    total,
    page,
    pageCount,
    search,
    unreadOnly,
    loading,
    error,
    starringMessageIds,
    setSearch,
    setUnreadOnly,
    selectMailbox,
    selectMessage,
    markMessageRead,
    toggleStar,
    setPage,
    reload,
  };
}

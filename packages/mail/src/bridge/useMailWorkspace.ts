import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WKApp } from "@octo/base";
import MailService from "../Service/MailService";
import type { MailIdentity, Mailbox, MessageSummary } from "./types";
import { getErrorMessage, hasKeyword } from "../utils";
import { useAgentMailboxContext } from "./mailboxContext";

const PAGE_SIZE = 30;

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
  const [revision, setRevision] = useState(0);
  const context = useAgentMailboxContext();
  const mailboxContextId = context?.mailbox.id || "";
  const requestRef = useRef(0);
  const resourcesRequestRef = useRef(0);
  const starringMessageIdsRef = useRef(new Set<string>());

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const selectMailbox = useCallback((name: string) => {
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
        setError(getErrorMessage(reason, fallbackError));
      });
    },
    [fallbackError, mailboxContextId, selectedMailbox]
  );
  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPageState(1);
  }, []);
  const setUnreadOnly = useCallback((value: boolean) => {
    setUnreadOnlyState(value);
    setSelectedMessageId("");
    setPageState(1);
  }, []);
  const setPage = useCallback((value: number) => {
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
          setError(getErrorMessage(reason, fallbackError));
          reload();
        })
        .finally(() => {
          starringMessageIdsRef.current.delete(message.id);
          setStarringMessageIds((current) =>
            current.filter((id) => id !== message.id)
          );
        });
    },
    [fallbackError, mailboxContextId, reload]
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
    setError("");
  }, [mailboxContextId]);

  useEffect(() => {
    if (!mailboxContextId) {
      setMailboxes([]);
      setIdentity(null);
      setIdentityUnavailable(true);
      setLoading(false);
      return undefined;
    }
    let active = true;
    const request = ++resourcesRequestRef.current;
    setLoading(true);
    setIdentity({ address: context?.mailbox.address || "" });
    setIdentityUnavailable(false);
    void MailService.listMailboxes(mailboxContextId)
      .then((nextMailboxes) => {
        if (!active || request !== resourcesRequestRef.current) return;
        setMailboxes(nextMailboxes);
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
          setError(getErrorMessage(reason, fallbackError));
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [context?.mailbox.address, fallbackError, mailboxContextId, revision]);

  useEffect(() => {
    if (!mailboxContextId || !selectedMailbox) {
      setMessages([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const request = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError("");
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
            setMessages(response.messages ?? []);
            setTotal(response.total ?? 0);
            setSelectedMessageId((current) =>
              current &&
              response.messages?.some((message) => message.id === current)
                ? current
                : ""
            );
          })
          .catch((reason) => {
            if (controller.signal.aborted || request !== requestRef.current)
              return;
            setError(getErrorMessage(reason, fallbackError));
          })
          .finally(() => {
            if (request === requestRef.current) setLoading(false);
          });
      },
      search ? 250 : 0
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    fallbackError,
    mailboxContextId,
    page,
    revision,
    search,
    selectedMailbox,
    unreadOnly,
  ]);

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
      setError("");
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
  }, [reload]);

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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppBotService from "../Service/AppBotService";
import { useAppBotHost } from "../host/AppBotHostContext";
import { filterAppBots, groupAppBots, toAppBotViewItem } from "./appBotList";
import type { AppBotLoadState } from "./types";

interface UseAppBotsOptions {
  onSpaceChanged?: () => void;
}

export function useAppBots({ onSpaceChanged }: UseAppBotsOptions = {}) {
  const host = useAppBotHost();
  const [bots, setBots] = useState(
    () => [] as ReturnType<typeof toAppBotViewItem>[]
  );
  const [state, setState] = useState<AppBotLoadState>("loading");
  const [spaceName, setSpaceName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const requestIdRef = useRef(0);
  const silentRequestIdRef = useRef(0);
  const spaceNameRequestIdRef = useRef(0);

  const reload = useCallback(() => {
    setReloadTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    let stale = false;

    const loadData = async (spaceId: string, silent = false) => {
      const thisRequest = silent ? requestIdRef.current : ++requestIdRef.current;
      const thisSilentRequest = silent ? ++silentRequestIdRef.current : 0;
      const isCurrent = () => !stale &&
        thisRequest === requestIdRef.current &&
        (!silent || thisSilentRequest === silentRequestIdRef.current) &&
        host.getCurrentSpace().id === spaceId;
      if (!silent) setState("loading");
      try {
        const items = await AppBotService.getAvailableBots(spaceId);
        if (!isCurrent()) return;
        if (silent) requestIdRef.current++;
        setBots(items.map(toAppBotViewItem));
        setState("ready");
      } catch (err) {
        if (!isCurrent()) return;
        console.warn("[AppBotPage] Failed to load bots:", err);
        if (silent) return;
        setBots([]);
        setState("error");
      }
    };

    const resolveSpaceName = async (
      spaceId: string,
      knownName: string,
      requestId: number
    ) => {
      const commitName = (name: string) => {
        if (
          !stale &&
          requestId === spaceNameRequestIdRef.current &&
          host.getCurrentSpace().id === spaceId
        ) {
          setSpaceName(name);
        }
      };
      if (!spaceId) {
        commitName("");
        return;
      }
      if (knownName) {
        commitName(knownName);
        return;
      }
      try {
        const name = await host.resolveSpaceName(spaceId);
        commitName(name);
      } catch {
        commitName("");
      }
    };

    const refresh = () => {
      const currentSpace = host.getCurrentSpace();
      const spaceNameRequestId = ++spaceNameRequestIdRef.current;
      void loadData(currentSpace.id);
      void resolveSpaceName(
        currentSpace.id,
        currentSpace.name,
        spaceNameRequestId
      );
    };

    refresh();

    const handler = () => {
      onSpaceChanged?.();
      refresh();
    };
    const unsubscribe = host.subscribeSpaceChanged(handler);
    const unsubscribeInvalidation = host.subscribeInvalidation?.(() => {
      void loadData(host.getCurrentSpace().id, true);
    });
    return () => {
      stale = true;
      unsubscribe();
      unsubscribeInvalidation?.();
    };
  }, [host, onSpaceChanged, reloadTick]);

  const filteredBots = useMemo(
    () => filterAppBots(bots, keyword),
    [bots, keyword]
  );
  const sections = useMemo(() => groupAppBots(filteredBots), [filteredBots]);

  // §336 apps_searched:纯客户端过滤,无请求、输入无 testid,故命令式去抖补点。
  // 仅关键词非空时发,清空不计;props 恒空,不采关键词。
  useEffect(() => {
    if (!keyword.trim()) return;
    const timer = setTimeout(() => {
      host.track("apps_searched", {});
    }, 400);
    return () => clearTimeout(timer);
  }, [host, keyword]);

  return {
    state,
    keyword,
    setKeyword,
    reload,
    spaceName,
    filteredBots,
    sections,
  };
}

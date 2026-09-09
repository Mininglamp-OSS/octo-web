import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { ThemeMode, WKApp, i18n } from "@octo/base";
import {
  setSummaryAttentionRuntimeVisible,
  resetSummaryAttentionScope,
  SummaryWorkspace,
  type SummaryMessagingPort,
  type SummaryWorkspaceRoute,
} from "@dmwork/summary";
import type { OctoBuddySummaryBridge, SummaryHostCommand } from "./hostBridge";
import { createReadyReporter } from "../client-feature/readyReporter";
import "./index.css";

function reportSafely(label: string, action: () => void | Promise<void>) {
  void Promise.resolve()
    .then(action)
    .catch((error) => console.error(`[client-summary] ${label}`, error));
}

export function SummaryShell({
  bridge,
  initialRoute,
  initialSpaceId,
  onReady,
}: {
  bridge: OctoBuddySummaryBridge;
  initialRoute: SummaryWorkspaceRoute;
  initialSpaceId: string;
  onReady: (state: {
    route: SummaryWorkspaceRoute;
    spaceId: string;
  }) => Promise<void>;
}) {
  const [route, setRoute] = useState(initialRoute);
  const routeRef = useRef(route);
  const spaceIdRef = useRef(initialSpaceId);
  const scopeRevision = useRef(0);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const invalidationListeners = useRef(new Set<() => void>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const setControlledRoute = useCallback(
    (next: SummaryWorkspaceRoute, report = true) => {
      routeRef.current = next;
      setRoute(next);
      if (report) {
        const revision = scopeRevision.current;
        const spaceId = spaceIdRef.current;
        reportSafely("failed to report route", () => {
          if (revision === scopeRevision.current) bridge.reportRoute({ route: next, spaceId });
        });
      }
    },
    [bridge]
  );

  const messaging = useMemo<SummaryMessagingPort>(
    () => ({
      getCurrentUser: () => ({
        uid: WKApp.loginInfo.uid ?? "",
        displayName:
          WKApp.loginInfo.selfDisplayName?.() ||
          WKApp.loginInfo.name ||
          WKApp.loginInfo.uid ||
          "",
      }),
      loadConversationMembers: async (target) => {
        if (workspaceRevision !== scopeRevision.current) return [];
        const members = await bridge.loadConversationMembers(target, spaceIdRef.current);
        return workspaceRevision === scopeRevision.current ? members : [];
      },
      openConversation: async (target) => {
        if (workspaceRevision === scopeRevision.current) await bridge.openConversation(target, spaceIdRef.current);
      },
      notifySummaryCompleted: async (input) => {
        if (workspaceRevision === scopeRevision.current) await bridge.notifySummaryCompleted(input, spaceIdRef.current);
      },
      requestForward: ({ content, title, onComplete, onError, onCancel }) => {
        if (workspaceRevision !== scopeRevision.current) return;
        void bridge
          .requestForward({ content, title }, spaceIdRef.current)
          .then((result) => {
            if (workspaceRevision !== scopeRevision.current) return;
            if (result) onComplete(result);
            else onCancel?.();
          })
          .catch((error) => {
            if (workspaceRevision === scopeRevision.current) onError?.(error);
          });
      },
      subscribeInvalidation: (listener) => {
        invalidationListeners.current.add(listener);
        return () => invalidationListeners.current.delete(listener);
      },
    }),
    [bridge, workspaceRevision]
  );

  const onWorkspaceRouteChange = useCallback((next: SummaryWorkspaceRoute) => {
    if (workspaceRevision === scopeRevision.current) setControlledRoute(next);
  }, [workspaceRevision, setControlledRoute]);

  const onBadgeChange = useCallback((count: number) => {
    if (workspaceRevision !== scopeRevision.current) return;
    try {
      bridge.reportBadge({ count, spaceId: spaceIdRef.current });
    } catch (error) {
      console.error("[client-summary] failed to report badge", error);
    }
  }, [bridge, workspaceRevision]);

  useEffect(() => {
    const dispose = bridge.onCommand((command: SummaryHostCommand) => {
      if (command.type === "navigate") {
        setControlledRoute(command.route, false);
        return;
      }
      if (command.type === "spaceChanged") {
        if (spaceIdRef.current === command.space.id) return;
        scopeRevision.current++;
        invalidationListeners.current.clear();
        spaceIdRef.current = command.space.id;
        WKApp.shared.currentSpaceId = command.space.id;
        document.documentElement.dataset.spaceId = command.space.id;
        resetSummaryAttentionScope();
        // Unmount every old page before subsequent host commands can navigate.
        flushSync(() => {
          setWorkspaceRevision(scopeRevision.current);
          setControlledRoute({ view: "list" }, false);
        });
        WKApp.mittBus.emit("space-changed", command.space.id);
        return;
      }
      if (command.type === "appearanceChanged") {
        WKApp.config.themeMode =
          command.theme === "dark" ? ThemeMode.dark : ThemeMode.light;
        WKApp.config.locale = command.locale;
        i18n.setLocale(command.locale, { persist: false });
        document.documentElement.dataset.theme = command.theme;
        document.documentElement.lang = command.locale;
        WKApp.shared.notifyListener();
        return;
      }
      if (command.type === "invalidate") {
        invalidationListeners.current.forEach((listener) => listener());
        return;
      }
      if (command.type === "sessionRevoked") {
        WKApp.loginInfo.logout();
        window.location.reload();
        return;
      }
      if (command.type === "hostVisibilityChanged") {
        document.documentElement.dataset.hostVisibility = command.visible
          ? "visible"
          : "hidden";
        setSummaryAttentionRuntimeVisible(command.visible);
        return;
      }
      if (command.type === "suspend") {
        document.documentElement.dataset.hostVisibility = "hidden";
        return;
      }
      if (command.type === "resume") {
        document.documentElement.dataset.hostVisibility = "visible";
        return;
      }
      // Unknown commands must not change visibility
      return;
    });
    return dispose;
  }, [bridge, setControlledRoute]);

  useEffect(() => {
    const reporter = createReadyReporter(
      () =>
        onReadyRef.current({
          route: routeRef.current,
          spaceId: spaceIdRef.current,
        }),
      {
        onExhausted: (error) => {
          console.error("[client-summary] failed to report ready", error);
        },
      }
    );
    reporter.request();
    return () => reporter.dispose();
  }, []);

  return (
    <SummaryWorkspace
      key={workspaceRevision}
      route={route}
      onRouteChange={onWorkspaceRouteChange}
      onBadgeChange={onBadgeChange}
      messaging={messaging}
    />
  );
}

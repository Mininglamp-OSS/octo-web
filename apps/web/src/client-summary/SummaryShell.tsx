import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ThemeMode, WKApp, i18n } from "@octo/base";
import {
  setSummaryAttentionRuntimeVisible,
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
  const invalidationListeners = useRef(new Set<() => void>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const setControlledRoute = useCallback(
    (next: SummaryWorkspaceRoute, report = true) => {
      routeRef.current = next;
      setRoute(next);
      if (report) {
        reportSafely("failed to report route", () => bridge.reportRoute(next));
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
      loadConversationMembers: (target) =>
        bridge.loadConversationMembers(target),
      openConversation: (target) => bridge.openConversation(target),
      notifySummaryCompleted: (input) => bridge.notifySummaryCompleted(input),
      requestForward: ({ content, title, onComplete, onError }) => {
        void bridge
          .requestForward({ content, title })
          .then((result) => {
            if (result) onComplete(result);
          })
          .catch((error) => onError?.(error));
      },
      subscribeInvalidation: (listener) => {
        invalidationListeners.current.add(listener);
        return () => invalidationListeners.current.delete(listener);
      },
    }),
    [bridge]
  );

  useEffect(() => {
    const dispose = bridge.onCommand((command: SummaryHostCommand) => {
      if (command.type === "navigate") {
        setControlledRoute(command.route, false);
        return;
      }
      if (command.type === "spaceChanged") {
        spaceIdRef.current = command.space.id;
        WKApp.shared.currentSpaceId = command.space.id;
        document.documentElement.dataset.spaceId = command.space.id;
        invalidationListeners.current.forEach((listener) => listener());
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
      const visible = command.type === "resume";
      document.documentElement.dataset.hostVisibility = visible
        ? "visible"
        : "hidden";
      setSummaryAttentionRuntimeVisible(visible);
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
      route={route}
      onRouteChange={setControlledRoute}
      onBadgeChange={(count) => {
        try {
          bridge.reportBadge(count);
        } catch (error) {
          console.error("[client-summary] failed to report badge", error);
        }
      }}
      messaging={messaging}
    />
  );
}

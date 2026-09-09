import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dap, SpaceService, ThemeMode, WKApp, i18n } from "@octo/base";
import { AppsWorkspace, type AppBotHostCapabilities } from "@dmwork/appbot";
import type { AppsHostCommand, OctoBuddyAppsBridge } from "./hostBridge";
import { createReadyReporter } from "../client-feature/readyReporter";
import "./index.css";

export function AppsShell({
  bridge,
  initialSpace,
  onReady,
}: {
  bridge: OctoBuddyAppsBridge;
  initialSpace: { id: string; name: string };
  onReady: (state: { spaceId: string }) => Promise<void>;
}) {
  const [space, setSpace] = useState(initialSpace);
  const [reloadKey, setReloadKey] = useState(0);
  const spaceRef = useRef(space);
  const listeners = useRef(new Set<() => void>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const host = useMemo<AppBotHostCapabilities>(
    () => ({
      getCurrentSpace: () => spaceRef.current,
      async resolveSpaceName(spaceId) {
        if (!spaceId) return "";
        const spaces = await SpaceService.shared.getMySpaces();
        return spaces?.find((item) => item.space_id === spaceId)?.name || "";
      },
      subscribeSpaceChanged(listener) {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
      openConversation: (target) => bridge.openConversation(target),
      clearConversation: () => undefined,
      isOctoAssistant: (uid) =>
        WKApp.remoteConfig.octoAssistantUids.includes(uid),
      track: (event, properties = {}) => Dap.shared.track(event, properties),
    }),
    [bridge]
  );

  useEffect(() => {
    const dispose = bridge.onCommand((command: AppsHostCommand) => {
      if (command.type === "spaceChanged") {
        spaceRef.current = command.space;
        setSpace(command.space);
        WKApp.shared.currentSpaceId = command.space.id;
        document.documentElement.dataset.spaceId = command.space.id;
        listeners.current.forEach((listener) => listener());
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
      if (command.type === "reload") {
        setReloadKey((value) => value + 1);
        listeners.current.forEach((listener) => listener());
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
  }, [bridge]);

  useEffect(() => {
    const reporter = createReadyReporter(
      () => onReadyRef.current({ spaceId: spaceRef.current.id }),
      {
        onExhausted: (error) => {
          console.error("[client-apps] failed to report ready", error);
        },
      }
    );
    reporter.request();
    return () => reporter.dispose();
  }, []);

  return <AppsWorkspace key={reloadKey} host={host} />;
}

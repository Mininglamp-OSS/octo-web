import {
  applyImSpaceContext, getCurrentImConversationStore, getCurrentImUnreadObserver,
  installImReadAttentionGate, ThemeMode, WKApp, i18n,
} from "@octo/base";
import { isImConnected } from "@octo/base/src/im-runtime/connectStatus";
import { resetDocPreviewCache } from "@octo/base/src/Messages/DocumentShareCard/preview";
import { createDesktopSummaryAttention } from "@dmwork/summary/src/runtime/desktopAttention";
import { WKSDK } from "wukongimjssdk";
import type { CommunicationBootstrap, OctoBuddyCommunicationBridge } from "../hostBridge";
import type { RuntimeBadge } from "../../client-feature/runtimeContract";
import { installSummaryRequests } from "../summaryRequests";
import { installHostDocumentPreview } from "../documentPreview";
import { createLazyCommunicationUi } from "./lazyUi";
import { installLazyDocumentForward } from "./lazyDocumentForward";
import { createCommunicationOwner } from "./owner";
import { createRuntimeHostScheduler } from "./hostScheduler";

export function assertBackgroundRuntimeHost(host: OctoBuddyCommunicationBridge, bootstrap: CommunicationBootstrap): void {
  if (!bootstrap.runtime) return;
  if (!host.onRuntimeCommand || !host.reportRuntimeReady || !host.reportRuntimeSnapshot || !host.reportRuntimeCommandResult) {
    throw new Error("Background runtime protocol unavailable");
  }
  if (bootstrap.runtime.summaryAttention === "owner" && (!host.scheduleRuntimeTask || !host.cancelRuntimeTask)) {
    throw new Error("Background summary scheduler unavailable");
  }
}

export async function startCommunicationRuntime(host: OctoBuddyCommunicationBridge, bootstrap: CommunicationBootstrap) {
  assertBackgroundRuntimeHost(host, bootstrap);
  if (!bootstrap.runtime) throw new Error("Missing owner runtime bootstrap");
  const sdk = WKSDK.shared();
  const store = getCurrentImConversationStore();
  const unread = getCurrentImUnreadObserver();
  const gate = installImReadAttentionGate(false);
  let disposed = false;
  const cleanups: Array<() => void> = [];
  let owner: ReturnType<typeof createCommunicationOwner>;
  let forward: ReturnType<typeof installLazyDocumentForward>;
  const ui = createLazyCommunicationUi(async () => {
    const { mountCommunicationUi } = await import("../mountUi");
    return { mount: (onReady) => mountCommunicationUi({
      ...host,
      onCommand: ui.subscribe,
      onSummaryRequest: undefined,
      onDocumentForward: forward.subscribe,
    }, bootstrap, {
      runtimeOwned: true, onReady, isActive: () => !disposed,
      isDocumentForwardCurrent: request => !!request.runtimeScope && owner.isCurrent(request.runtimeScope),
    }) };
  });
  const hostScheduler = bootstrap.runtime.summaryAttention === "owner"
    ? createRuntimeHostScheduler(host, () => owner.getScope()) : undefined;
  const summary = hostScheduler ? createDesktopSummaryAttention({
    scheduler: hostScheduler.scheduler,
    onBadge: (badge) => owner.updateSummary(badge as RuntimeBadge),
  }) : undefined;
  const reportError = (error: unknown) => console.error("[communication-runtime]", error);
  const disposeData = () => {
    disposed = true;
    for (const cleanup of [
      ...cleanups.splice(0).reverse(), () => forward?.dispose(),
      () => store.dispose(), () => sdk.disconnect(), () => hostScheduler?.dispose(), () => gate.dispose(),
    ]) {
      try { cleanup(); } catch (error) { reportError(error); }
    }
  };
  owner = createCommunicationOwner({
    bootstrap: bootstrap.runtime,
    retainData: () => store.retain({ syncOnStart: false }),
    subscribeData(listener) {
      const offStore = store.subscribe(listener);
      try {
        const offUnread = unread.subscribe(listener);
        return () => { offUnread(); offStore(); };
      } catch (error) { offStore(); throw error; }
    },
    readMessages: () => {
      const { freshness } = store.getSnapshot();
      return freshness === "ready" || freshness === "stale"
        ? { status: freshness, count: unread.getSnapshot() }
        : { status: freshness, count: null };
    },
    isConnected: () => isImConnected(sdk),
    refreshMessages: () => store.refresh({ reload: true, reusePending: true }),
    applySpace: (space) => {
      forward.invalidate();
      resetDocPreviewCache();
      document.documentElement.dataset.spaceId = space.id;
      applyImSpaceContext({ space_id: space.id, name: space.name });
    },
    setReadAttention: gate.setAllowed,
    disposeData,
    reportReady: (state) => host.reportRuntimeReady!(state),
    reportSnapshot: (snapshot) => host.reportRuntimeSnapshot!(snapshot),
    reportCommandResult: (result) => host.reportRuntimeCommandResult!(result),
    onCommand: (listener) => host.onRuntimeCommand!(listener),
    dispatchUi: ui.dispatch,
    startUi: ui.start,
    disposeUi: ui.dispose,
    fireTimer: (timer) => hostScheduler?.fire({ ...timer, version: 1 }),
    summary,
    onError: reportError,
  });
  try {
    cleanups.push(installHostDocumentPreview(host, bootstrap.space.id, () => {
      const scope = owner.getScope();
      return () => owner.isCurrent(scope);
    }));
    forward = installLazyDocumentForward(host, owner, ui.ensureReady);
    cleanups.push(installSummaryRequests(host, {
      capture(request) {
        const scope = request.runtimeScope;
        const spaceId = WKApp.shared.currentSpaceId;
        return () => !!scope && request.spaceId === spaceId && owner.isCurrent(scope);
      },
      ensureUi: ui.ensureReady,
    }));
    cleanups.push(host.onCommand(command => {
      if (command.type === "sessionRevoked") {
        owner.dispose();
        WKApp.loginInfo.logout();
      } else if (command.type === "filePreviewClosed" || command.type === "filePreviewState") {
        ui.dispatch(command);
      } else if (command.type === "appearanceChanged") {
        WKApp.config.themeMode = command.theme === "dark" ? ThemeMode.dark : ThemeMode.light;
        WKApp.config.locale = command.locale;
        i18n.setLocale(command.locale, { persist: false });
        document.documentElement.dataset.theme = command.theme;
        document.documentElement.lang = command.locale;
        WKApp.shared.notifyListener();
      } else if (command.type === "suspend" || command.type === "resume") {
        // Trusted host visibility: forward to the UI so queued target callbacks are cancelled on hide.
        ui.dispatch(command);
      }
      // Legacy navigation/Space/visibility messages are not owner-scoped.
    }));
    const previousLogout = WKApp.apiClient.logoutCallback;
    const logout = () => { owner.dispose(); previousLogout?.(); };
    WKApp.apiClient.logoutCallback = logout;
    cleanups.push(() => {
      if (WKApp.apiClient.logoutCallback === logout) WKApp.apiClient.logoutCallback = previousLogout;
    });
    const onPageHide = () => owner.dispose();
    window.addEventListener("pagehide", onPageHide);
    cleanups.push(() => window.removeEventListener("pagehide", onPageHide));
    await owner.start();
    return owner;
  } catch (error) {
    owner.dispose();
    throw error;
  }
}

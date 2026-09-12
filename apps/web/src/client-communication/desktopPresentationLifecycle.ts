import type { OctoBuddyCommunicationBridge } from "./hostBridge";
import { installDesktopPresentation } from "./desktopPresentation";
import { installDesktopLifecycle } from "../client-feature/desktop/lifecycle";

type ReadyState = Omit<Parameters<OctoBuddyCommunicationBridge["reportReady"]>[0],
  "desktopPresentationVersion" | "desktopPresentationPages">;

export function installDesktopPresentationLifecycle(
  view: Window,
  host: OctoBuddyCommunicationBridge,
  root: HTMLElement,
  getContext: () => Pick<ReadyState, "page" | "spaceId">,
) {
  return installDesktopLifecycle<ReadyState>(view, {
    install: () => installDesktopPresentation(host, root),
    getContext,
    report: (state, available) => host.reportReady({
      ...state,
      ...(available ? {
        desktopPresentationVersion: 1 as const,
        desktopPresentationPages: ["chat", "contacts"] as const,
      } : {}),
    }),
  });
}

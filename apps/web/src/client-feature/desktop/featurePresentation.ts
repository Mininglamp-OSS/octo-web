import { installDesktopLifecycle } from "./lifecycle";
import {
  installDesktopPresentation,
  type DesktopPresentationBridge,
  type DesktopReadyCapability,
} from "./presentation";

export function installFeaturePresentation<State extends object, Page extends string>(
  host: DesktopPresentationBridge & {
    reportReady: (state: State & DesktopReadyCapability<Page>) => Promise<void>;
  },
  options: {
    root: HTMLElement;
    pages: readonly Page[];
    getContext: () => Partial<State>;
  },
) {
  const pages = [...options.pages];
  return installDesktopLifecycle<State>(options.root.ownerDocument.defaultView!, {
    install: () => installDesktopPresentation(host, options.root),
    getContext: options.getContext,
    report: (state, available) => host.reportReady({
      ...state,
      ...(available ? {
        desktopPresentationVersion: 1 as const,
        desktopPresentationPages: [...pages],
      } : {}),
    }),
  });
}

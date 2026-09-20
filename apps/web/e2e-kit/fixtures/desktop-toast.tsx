import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Toast from "@douyinfe/semi-ui/lib/es/toast";
import Notification from "@douyinfe/semi-ui/lib/es/notification";
import "@douyinfe/semi-ui/lib/es/_base/base.css";
import "../../../../packages/dmworkbase/src/theme/index.css";
import "../../src/client-feature/desktop/presentation.css";
import { installDesktopPresentation, type DesktopPresentation } from "../../src/client-feature/desktop/presentation";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const params = new URLSearchParams(location.search);
const platform = params.get("platform") ?? "darwin";
const root = document.getElementById("root")!;
let toastCount = 0;

function ToastFixture() {
  const [closed, setClosed] = useState(0);
  useEffect(() => {
    if (platform === "web") return;
    const state = (): DesktopPresentation => {
      const headerHeight = platform === "darwin" ? 52 : 48;
      const controlsWidth = platform === "darwin" ? 96 : 138;
      return {
        version: 1, revision: 1, platform: platform === "darwin" ? "darwin" : "win32",
        canFuse: true, headerHeight, fallbackHeight: headerHeight,
        topArea: { x: 0, y: 0, width: innerWidth, height: headerHeight },
        controls: [{
          x: platform === "darwin" ? 0 : innerWidth - controlsWidth,
          y: 0, width: controlsWidth, height: headerHeight,
        }],
        focused: true, maximized: false, fullScreen: false,
      };
    };
    let active = true;
    let release: (() => void) | null = null;
    void installDesktopPresentation({
      getDesktopPresentation: async () => state(),
      onDesktopPresentation: () => () => {},
    }, root).then(dispose => {
      if (active) release = dispose;
      else dispose?.();
    });
    return () => { active = false; release?.(); };
  }, []);

  const onClose = () => setClosed(value => value + 1);
  const showToast = (duration: number) => Toast.warning({
    content: `Voice input is disabled (${++toastCount})`,
    duration,
    onClose,
  });

  return (
    <>
      <header data-desktop-chrome="header" style={{ height: 52 }} />
      <main style={{ padding: "var(--wk-sp-4)" }}>
        <button onClick={() => showToast(0)}>Show toast</button>
        <button onClick={() => showToast(1)}>Auto-dismiss toast</button>
        <button onClick={() => Notification.warning({
          title: "Voice input is disabled",
          content: "Enable voice input in settings.",
          position: "top",
          duration: 0,
          onClose,
        })}>Show notification</button>
        <p role="alert" data-testid="inline-alert">Inline validation error</p>
        <output data-testid="closed-count">{closed}</output>
      </main>
    </>
  );
}

createRoot(root).render(<ToastFixture />);

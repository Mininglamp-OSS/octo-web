import { useCallback, useEffect, useState } from "react";
import WKApp from "../../App";
import { documentRepository } from "./service";
import type { DocumentState, DocumentViewer } from "./types";

export function useDocumentState(viewer: DocumentViewer) {
  const [state, setState] = useState<DocumentState | null>(null);

  const reload = useCallback(async () => {
    const next = await documentRepository.load(viewer);
    setState(next);
    return next;
  }, [viewer]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handleNavMenuActivated = ({ menuId }: { menuId: string }) => {
      if (menuId === "documents") {
        void reload();
      }
    };

    WKApp.mittBus.on("wk:nav-menu-activated", handleNavMenuActivated);
    return () => {
      WKApp.mittBus.off("wk:nav-menu-activated", handleNavMenuActivated);
    };
  }, [reload]);

  return { state, setState, reload };
}

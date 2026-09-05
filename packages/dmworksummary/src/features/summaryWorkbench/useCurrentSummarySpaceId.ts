import { useEffect, useState } from "react";
import WKApp from "@octo/base/src/App";

function currentSpaceId(): string {
    return String(WKApp.shared.currentSpaceId ?? "").trim();
}

export default function useCurrentSummarySpaceId(): string {
    const [spaceId, setSpaceId] = useState(currentSpaceId);

    useEffect(() => {
        const handleSpaceChange = () => setSpaceId(currentSpaceId());
        WKApp.mittBus.on("space-changed", handleSpaceChange);
        WKApp.mittBus.on("space-ready", handleSpaceChange);
        return () => {
            WKApp.mittBus.off("space-changed", handleSpaceChange);
            WKApp.mittBus.off("space-ready", handleSpaceChange);
        };
    }, []);

    return spaceId;
}

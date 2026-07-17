import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, WKSDK } from "wukongimjssdk";
import WKApp from "../../App";
import { IncomingWebhook, IncomingWebhookService } from "../../Service/IncomingWebhook";
import { subscriberDisplayName, SubscriberLike } from "../../Utils/displayName";

export interface UseChannelWebhookListOptions {
    channel: Channel;
    threadShortId?: string;
    selfFallback: string;
    onLoadError: (error: unknown) => void;
}

/** Runtime bridge for Webhook list data. UI state for edit/confirm overlays stays in the container. */
export function useChannelWebhookList({
    channel,
    threadShortId,
    selfFallback,
    onLoadError,
}: UseChannelWebhookListOptions) {
    const [items, setItems] = useState<IncomingWebhook[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const requestSequenceRef = useRef(0);
    const mountedRef = useRef(true);
    const groupNo = channel.channelID;
    const scopeKey = `${groupNo}:${threadShortId || "group"}`;
    const myUid = WKApp.loginInfo.uid || "";

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestSequenceRef.current += 1;
        };
    }, []);

    const load = useCallback(async (showLoading = false) => {
        const requestSequence = ++requestSequenceRef.current;
        if (showLoading) setLoading(true);
        setError(false);
        try {
            const list = await IncomingWebhookService.list(groupNo, threadShortId);
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
            setItems(list);
        } catch (loadError) {
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
            setError(true);
            onLoadError(loadError);
        } finally {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setLoading(false);
            }
        }
    }, [groupNo, onLoadError, threadShortId]);

    useEffect(() => {
        requestSequenceRef.current += 1;
        setItems([]);
        setLoading(true);
        setError(false);
        void load();
    }, [load, scopeKey]);

    const creatorNames = useMemo(() => {
        const wanted = new Set(items.map((item) => item.creator_uid));
        const names = new Map<string, string>();
        try {
            const subscribers = WKSDK.shared().channelManager.getSubscribes(channel) as
                | Array<({ uid?: string } & SubscriberLike)>
                | null
                | undefined;
            for (const subscriber of subscribers || []) {
                if (!subscriber?.uid || !wanted.has(subscriber.uid) || names.has(subscriber.uid)) continue;
                const name = subscriberDisplayName(subscriber);
                if (name) names.set(subscriber.uid, name);
            }
        } catch {
            // SDK member cache may not be ready; metadata gracefully falls back to creation time.
        }
        if (wanted.has(myUid) && !names.has(myUid)) {
            names.set(myUid, WKApp.loginInfo.selfDisplayName?.() || selfFallback);
        }
        return names;
    }, [channel, items, myUid, selfFallback]);

    return { items, loading, error, myUid, creatorNames, reload: load };
}

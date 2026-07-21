import { useState, useEffect } from 'react';
import {
  addImChannelInfoListener,
  fetchImChannelInfo,
  getImChannelInfo,
} from '@octo/base';
import WKSDK, { Channel, ChannelTypePerson } from 'wukongimjssdk';
import type { ChannelInfo } from 'wukongimjssdk';

/**
 * Resolve a user_id to a display name via WKSDK channel info.
 * Returns the cached title if available, otherwise fetches it asynchronously.
 * Falls back to a truncated uid if lookup fails.
 */
export function useUserName(uid: string): string {
  const [name, setName] = useState<string>(() => {
    const info = getImChannelInfo(WKSDK.shared(), new Channel(uid, ChannelTypePerson));
    return info?.title || '';
  });

  useEffect(() => {
    if (!uid) return;
    let aborted = false;

    const channel = new Channel(uid, ChannelTypePerson);
    const sdk = WKSDK.shared();
    const cached = getImChannelInfo(sdk, channel);
    if (cached?.title) {
      setName(cached.title);
      return;
    }

    // Listen for channel info updates
    const listener = (channelInfo: ChannelInfo) => {
      if (
        !aborted &&
        channelInfo.channel.channelID === uid &&
        channelInfo.channel.channelType === ChannelTypePerson
      ) {
        setName(channelInfo.title || uid);
      }
    };

    const unsubscribe = addImChannelInfoListener(sdk, listener);
    // Trigger async fetch; on failure set fallback name
    fetchImChannelInfo(sdk, channel).catch(() => {
      if (!aborted) setName((prev) => prev || uid);
    });

    return () => {
      aborted = true;
      unsubscribe();
    };
  }, [uid]);

  if (name) return name;
  // Fallback: show first 8 chars of uid
  return uid.length > 8 ? `${uid.slice(0, 8)}…` : uid;
}

/**
 * Batch-resolve multiple user_ids. Returns a Map<uid, displayName>.
 */
export function useUserNames(uids: string[]): Map<string, string> {
  const [nameMap, setNameMap] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const uid of uids) {
      const info = getImChannelInfo(WKSDK.shared(), new Channel(uid, ChannelTypePerson));
      m.set(uid, info?.title || '');
    }
    return m;
  });

  useEffect(() => {
    if (uids.length === 0) return;
    let aborted = false;

    const channels = uids.map((uid) => new Channel(uid, ChannelTypePerson));
    const sdk = WKSDK.shared();

    // Initial resolve from cache
    const m = new Map<string, string>();
    const toFetch: Channel[] = [];
    for (let i = 0; i < uids.length; i++) {
      const info = getImChannelInfo(sdk, channels[i]);
      if (info?.title) {
        m.set(uids[i], info.title);
      } else {
        m.set(uids[i], '');
        toFetch.push(channels[i]);
      }
    }
    setNameMap(new Map(m));

    // Listen for updates
    const listener = (channelInfo: ChannelInfo) => {
      if (aborted) return;
      const uid = channelInfo.channel.channelID;
      if (channelInfo.channel.channelType === ChannelTypePerson && uids.includes(uid)) {
        setNameMap((prev) => {
          const next = new Map(prev);
          next.set(uid, channelInfo.title || uid);
          return next;
        });
      }
    };

    const unsubscribe = addImChannelInfoListener(sdk, listener);

    // Fetch uncached in batches of 5 to avoid flooding the IM SDK
    const BATCH_SIZE = 5;
    (async () => {
      for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
        if (aborted) break;
        const batch = toFetch.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((ch) =>
            fetchImChannelInfo(sdk, ch).catch(() => {
              if (aborted) return;
              setNameMap((prev) => {
                const next = new Map(prev);
                if (!next.get(ch.channelID)) {
                  next.set(ch.channelID, ch.channelID);
                }
                return next;
              });
            })
          )
        );
      }
    })();

    return () => {
      aborted = true;
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uids.join('\0')]);

  return nameMap;
}

import { useEffect, useReducer, useRef } from "react";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import type { LegacyGlobalSearchContact } from "../../Service/SearchService";
import {
  addCurrentImChannelInfoListener,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../im-runtime/currentChannelRuntime";
import {
  hasGlobalSearchContactSource,
  resolveGlobalSearchContactSource,
} from "./contactSource";

export function useGlobalSearchContactSources(
  contacts: LegacyGlobalSearchContact[],
  isActive: boolean
) {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const fetchedUids = useRef(new Set<string>());

  useEffect(() => {
    if (!isActive || contacts.length === 0) return;
    const uids = new Set(contacts.map((contact) => contact.channel_id));
    const unsubscribe = addCurrentImChannelInfoListener((info) => {
      if (
        info.channel.channelType === ChannelTypePerson &&
        uids.has(info.channel.channelID)
      ) {
        refresh();
      }
    });
    for (const contact of contacts) {
      if (
        !contact.channel_id ||
        hasGlobalSearchContactSource(contact) ||
        fetchedUids.current.has(contact.channel_id)
      )
        continue;
      const channel = new Channel(contact.channel_id, ChannelTypePerson);
      if (getCurrentImChannelInfo(channel)) continue;
      fetchedUids.current.add(contact.channel_id);
      void fetchCurrentImChannelInfo(channel).catch(() => {
        fetchedUids.current.delete(contact.channel_id);
      });
    }
    return unsubscribe;
  }, [contacts, isActive]);

  return new Map(
    contacts.map((contact) => [
      contact.channel_id,
      resolveGlobalSearchContactSource(contact),
    ])
  );
}

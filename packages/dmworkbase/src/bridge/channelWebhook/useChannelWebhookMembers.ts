import { useEffect, useMemo, useRef, useState } from "react";
import { Channel, ChannelTypePerson } from "wukongimjssdk";

import WKApp from "../../App";
import { isFlagOn, normalizeMentionUids } from "../../Service/IncomingWebhook";
import { subscriberDisplayName } from "../../Utils/displayName";
import {
  getCurrentImChannelInfo,
  getCurrentImChannelSubscribers,
  syncCurrentImChannelSubscribers,
} from "../../im-runtime/currentChannelRuntime";
import {
  ChannelWebhookGroupSubscriber,
  ChannelWebhookMemberOption,
  ChannelWebhookMemberRuntime,
} from "./types";

function defaultMemberRuntime(): ChannelWebhookMemberRuntime {
  return {
    getSubscribers(channel) {
      return getCurrentImChannelSubscribers<
        Channel,
        ChannelWebhookGroupSubscriber
      >(channel) as ChannelWebhookGroupSubscriber[];
    },
    syncSubscribers(channel) {
      return syncCurrentImChannelSubscribers<
        Channel,
        ChannelWebhookGroupSubscriber
      >(channel);
    },
    isBotMember(uid, subscriber) {
      if (isFlagOn(subscriber.orgData?.robot)) return true;
      try {
        const info = getCurrentImChannelInfo(
          new Channel(uid, ChannelTypePerson)
        ) as { orgData?: { robot?: unknown } } | null | undefined;
        return isFlagOn(info?.orgData?.robot);
      } catch {
        return false;
      }
    },
    getSelfUid() {
      return WKApp.loginInfo?.uid || "";
    },
    getSelfDisplayName() {
      return WKApp.loginInfo?.selfDisplayName?.() || "";
    },
  };
}

function runtimeOrDefault(runtime?: ChannelWebhookMemberRuntime) {
  return runtime ?? defaultMemberRuntime();
}

export function readChannelWebhookMemberOptions(params: {
  channel: Channel;
  runtime?: ChannelWebhookMemberRuntime;
}): ChannelWebhookMemberOption[] {
  const runtime = runtimeOrDefault(params.runtime);
  let subscribers: ChannelWebhookGroupSubscriber[];
  try {
    subscribers = runtime.getSubscribers(params.channel);
  } catch {
    return [];
  }

  const options: ChannelWebhookMemberOption[] = [];
  const seen = new Set<string>();
  for (const subscriber of subscribers || []) {
    const uid = subscriber?.uid;
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    options.push({
      uid,
      name: subscriberDisplayName(subscriber) || uid,
      isBot: runtime.isBotMember(uid, subscriber),
    });
  }
  return options;
}

export function buildChannelWebhookMemberOptionsForSelect(params: {
  memberOptions: ChannelWebhookMemberOption[];
  mentionUids: string[];
  selfFallback: string;
  runtime?: ChannelWebhookMemberRuntime;
}): ChannelWebhookMemberOption[] {
  const runtime = runtimeOrDefault(params.runtime);
  const known = new Set(params.memberOptions.map((member) => member.uid));
  const options = [...params.memberOptions];
  const selfUid = runtime.getSelfUid();
  if (selfUid && !known.has(selfUid)) {
    options.push({
      uid: selfUid,
      name: runtime.getSelfDisplayName() || params.selfFallback,
      isBot: false,
    });
    known.add(selfUid);
  }

  const extras = normalizeMentionUids(params.mentionUids)
    .filter((uid) => !known.has(uid))
    .map((uid) => ({ uid, name: uid, isBot: false }));
  return [...options, ...extras];
}

export function useChannelWebhookMembers(params: {
  channel: Channel;
  mentionUids: string[];
  selfFallback: string;
  runtime?: ChannelWebhookMemberRuntime;
}) {
  const runtime = useMemo(
    () => runtimeOrDefault(params.runtime),
    [params.runtime]
  );
  const [memberOptions, setMemberOptions] = useState<
    ChannelWebhookMemberOption[]
  >(() =>
    readChannelWebhookMemberOptions({
      channel: params.channel,
      runtime,
    })
  );
  const scopeKey = params.channel.getChannelKey?.() || params.channel.channelID;
  const channelRef = useRef(params.channel);
  const requestSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  channelRef.current = params.channel;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current;
    const channel = channelRef.current;
    setMemberOptions(
      readChannelWebhookMemberOptions({
        channel,
        runtime,
      })
    );
    runtime
      .syncSubscribers(channel)
      .then(() => {
        if (
          !mountedRef.current ||
          requestSequence !== requestSequenceRef.current
        ) {
          return;
        }
        setMemberOptions(
          readChannelWebhookMemberOptions({
            channel,
            runtime,
          })
        );
      })
      .catch(() => {
        // Keep cached member options. The server still validates membership.
      });
  }, [runtime, scopeKey]);

  const memberOptionsForSelect = useMemo(
    () =>
      buildChannelWebhookMemberOptionsForSelect({
        memberOptions,
        mentionUids: params.mentionUids,
        selfFallback: params.selfFallback,
        runtime,
      }),
    [memberOptions, params.mentionUids, params.selfFallback, runtime]
  );

  const aiOptionCount = useMemo(
    () =>
      memberOptionsForSelect.filter(
        (member: ChannelWebhookMemberOption) => member.isBot
      ).length,
    [memberOptionsForSelect]
  );

  const optionByUid = useMemo(
    () =>
      new Map(
        memberOptionsForSelect.map((member: ChannelWebhookMemberOption) => [
          member.uid,
          member,
        ])
      ),
    [memberOptionsForSelect]
  );

  return {
    memberOptionsForSelect,
    aiOptionCount,
    optionByUid,
  };
}

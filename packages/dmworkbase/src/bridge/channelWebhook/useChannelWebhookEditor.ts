import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "wukongimjssdk";

import {
  buildWebhookUpsertReq,
  IncomingWebhook,
  IncomingWebhookCreateResp,
  IncomingWebhookService,
  isFlagOn,
  validateMentionUids,
} from "../../Service/IncomingWebhook";

export type ChannelWebhookEditorSubmitResult =
  | { ok: true; status: "busy" }
  | { ok: true; status: "stale" }
  | { ok: true; status: "noop" }
  | { ok: true; status: "updated" }
  | {
      ok: true;
      status: "created";
      created: IncomingWebhookCreateResp;
      stale?: boolean;
    }
  | { ok: false; reason: "tooMany" | "tooLong" };

export interface ChannelWebhookEditorRuntime {
  create(
    groupNo: string,
    request: Parameters<typeof IncomingWebhookService.create>[1],
    threadShortId?: string
  ): Promise<IncomingWebhookCreateResp>;
  update(
    groupNo: string,
    webhookId: string,
    request: Parameters<typeof IncomingWebhookService.update>[2],
    threadShortId?: string
  ): Promise<IncomingWebhook>;
}

function defaultEditorRuntime(): ChannelWebhookEditorRuntime {
  return {
    create(groupNo, request, threadShortId) {
      return IncomingWebhookService.create(groupNo, request, threadShortId);
    },
    update(groupNo, webhookId, request, threadShortId) {
      return IncomingWebhookService.update(
        groupNo,
        webhookId,
        request,
        threadShortId
      );
    },
  };
}

function runtimeOrDefault(runtime?: ChannelWebhookEditorRuntime) {
  return runtime ?? defaultEditorRuntime();
}

export function useChannelWebhookEditor(params: {
  channel: Channel;
  isManager: boolean;
  webhook?: IncomingWebhook;
  threadShortId?: string;
  runtime?: ChannelWebhookEditorRuntime;
}) {
  const runtime = useMemo(
    () => runtimeOrDefault(params.runtime),
    [params.runtime]
  );
  const isEdit = !!params.webhook;
  const [name, setName] = useState(params.webhook?.name ?? "");
  const [avatar, setAvatar] = useState(params.webhook?.avatar ?? "");
  const [mentionAll, setMentionAll] = useState(
    isFlagOn(params.webhook?.allow_mention_all)
  );
  const [mentionBots, setMentionBots] = useState(
    isFlagOn(params.webhook?.allow_mention_bots)
  );
  const [mentionUids, setMentionUids] = useState<string[]>(
    params.webhook?.mention_uids ?? []
  );
  const [saving, setSaving] = useState(false);
  const requestSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const scopeKey = `${params.channel.channelID}:${
    params.threadShortId || "group"
  }:${params.webhook?.webhook_id || "create"}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setName(params.webhook?.name ?? "");
    setAvatar(params.webhook?.avatar ?? "");
    setMentionAll(isFlagOn(params.webhook?.allow_mention_all));
    setMentionBots(isFlagOn(params.webhook?.allow_mention_bots));
    setMentionUids(params.webhook?.mention_uids ?? []);
    setSaving(false);
  }, [scopeKey, params.webhook]);

  const isCurrentRequest = useCallback(
    (requestSequence: number) =>
      mountedRef.current && requestSequence === requestSequenceRef.current,
    []
  );

  const toggleMentionUid = useCallback((uid: string) => {
    setMentionUids((current: string[]) =>
      current.includes(uid)
        ? current.filter((item: string) => item !== uid)
        : [...current, uid]
    );
  }, []);

  const submit =
    useCallback(async (): Promise<ChannelWebhookEditorSubmitResult> => {
      if (saving) return { ok: true, status: "busy" };

      const mentionCheck = validateMentionUids(mentionUids);
      if (!mentionCheck.ok) {
        return { ok: false, reason: mentionCheck.reason };
      }

      const request = buildWebhookUpsertReq({
        isEdit,
        isManager: params.isManager,
        name,
        avatar,
        mentionAll,
        mentionBots,
        mentionUids,
        webhook: params.webhook,
      });
      if (request === null) return { ok: true, status: "noop" };

      const requestSequence = ++requestSequenceRef.current;
      setSaving(true);
      try {
        if (isEdit && params.webhook) {
          try {
            await runtime.update(
              params.channel.channelID,
              params.webhook.webhook_id,
              request,
              params.threadShortId
            );
          } catch (error) {
            if (!isCurrentRequest(requestSequence)) {
              return { ok: true, status: "stale" };
            }
            throw error;
          }
          if (!isCurrentRequest(requestSequence)) {
            return { ok: true, status: "stale" };
          }
          return { ok: true, status: "updated" };
        }
        let created: IncomingWebhookCreateResp;
        try {
          created = await runtime.create(
            params.channel.channelID,
            request,
            params.threadShortId
          );
        } catch (error) {
          if (!isCurrentRequest(requestSequence)) {
            return { ok: true, status: "stale" };
          }
          throw error;
        }
        if (!isCurrentRequest(requestSequence)) {
          return { ok: true, status: "created", created, stale: true };
        }
        return { ok: true, status: "created", created };
      } finally {
        if (isCurrentRequest(requestSequence)) {
          setSaving(false);
        }
      }
    }, [
      saving,
      mentionUids,
      isEdit,
      params.isManager,
      params.webhook,
      params.channel.channelID,
      params.threadShortId,
      name,
      avatar,
      mentionAll,
      mentionBots,
      runtime,
      isCurrentRequest,
    ]);

  return {
    isEdit,
    name,
    setName,
    avatar,
    setAvatar,
    mentionAll,
    setMentionAll,
    mentionBots,
    setMentionBots,
    mentionUids,
    setMentionUids,
    toggleMentionUid,
    saving,
    submit,
  };
}

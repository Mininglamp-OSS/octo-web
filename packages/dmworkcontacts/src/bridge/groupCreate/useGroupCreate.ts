import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadGroupCreateCandidates,
  submitGroupCreateAction,
} from "./groupCreateRuntime";
import {
  buildGroupCreateSearchIndex,
  createEmptyGroupCreateSearchIndex,
  filterGroupCreateCandidates,
} from "./groupCreateSearch";
import type {
  GroupCreateCandidateContact,
  GroupCreateChannelInput,
  GroupCreateSubmitAction,
} from "./types";

interface GroupCreateNotice {
  onError: (message: string) => void;
  onNameRequired: () => void;
  onMembersRequired: () => void;
}

export interface UseGroupCreateOptions {
  action: GroupCreateSubmitAction;
  channel: GroupCreateChannelInput;
  isOpen: boolean;
  defaultCategoryId?: string;
  keepSidebarTab?: boolean;
  notice: GroupCreateNotice;
  onClose: () => void;
  onSuccess?: () => void;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "msg" in error) {
    return String((error as { msg?: unknown }).msg || "");
  }
  return error instanceof Error ? error.message : "";
}

export function useGroupCreate(options: UseGroupCreateOptions) {
  const [candidates, setCandidates] = useState<GroupCreateCandidateContact[]>(
    []
  );
  const [visibleCandidates, setVisibleCandidates] = useState<
    GroupCreateCandidateContact[]
  >([]);
  const [selected, setSelected] = useState<GroupCreateCandidateContact[]>([]);
  const [keyword, setKeyword] = useState("");
  const [groupName, setGroupName] = useState("");
  const [avatarText, setAvatarText] = useState("");
  const [avatarColorIndex, setAvatarColorIndex] = useState<
    number | undefined
  >();
  const [isAvatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const loadSequence = useRef(0);
  const searchIndex = useRef(createEmptyGroupCreateSearchIndex());

  useEffect(() => {
    if (!options.isOpen) {
      setSelected([]);
      setGroupName("");
      setAvatarText("");
      setAvatarColorIndex(undefined);
      setAvatarEditorOpen(false);
      return;
    }

    const sequence = ++loadSequence.current;
    setGroupName("");
    setAvatarText("");
    setAvatarColorIndex(undefined);
    setAvatarEditorOpen(false);

    void loadGroupCreateCandidates({ channel: options.channel }).then(
      (next) => {
        if (loadSequence.current === sequence) {
          searchIndex.current = buildGroupCreateSearchIndex(next);
          setCandidates(next);
          setVisibleCandidates(next);
        }
      }
    );

    return () => {
      loadSequence.current += 1;
    };
  }, [options.channel.channelID, options.channel.channelType, options.isOpen]);

  const selectedUidSet = useMemo(
    () => new Set(selected.map((member) => member.uid)),
    [selected]
  );

  const toggleMember = useCallback(
    (uid: string) => {
      setSelected((current) => {
        if (current.some((member) => member.uid === uid)) {
          return current.filter((member) => member.uid !== uid);
        }
        const candidate = candidates.find((member) => member.uid === uid);
        return candidate ? [...current, candidate] : current;
      });
    },
    [candidates]
  );

  const changeKeyword = useCallback((value: string) => {
    setKeyword(value);
    setVisibleCandidates(
      filterGroupCreateCandidates(searchIndex.current, value)
    );
  }, []);

  const submit = useCallback(async () => {
    const name = groupName.trim();
    if (options.action === "createGroup" && !name) {
      options.notice.onNameRequired();
      return;
    }
    if (selected.length === 0) {
      options.notice.onMembersRequired();
      return;
    }

    setSubmitting(true);
    try {
      await submitGroupCreateAction({
        action: options.action,
        channel: options.channel,
        selectedUids: selected.map((member) => member.uid),
        createOptions:
          options.action === "createGroup"
            ? {
                categoryId: options.defaultCategoryId,
                name,
                avatarText: avatarText || undefined,
                avatarColor: avatarColorIndex,
              }
            : undefined,
        keepSidebarTab: options.keepSidebarTab,
      });
      if (options.action === "createGroup") options.onSuccess?.();
      options.onClose();
    } catch (error) {
      options.notice.onError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [avatarColorIndex, avatarText, groupName, options, selected]);

  return {
    avatar: {
      colorIndex: avatarColorIndex,
      isEditorOpen: isAvatarEditorOpen,
      text: avatarText,
      closeEditor: () => setAvatarEditorOpen(false),
      openEditor: () => setAvatarEditorOpen(true),
      save: (text: string, colorIndex?: number) => {
        setAvatarText(text);
        setAvatarColorIndex(colorIndex);
        setAvatarEditorOpen(false);
      },
    },
    candidates: visibleCandidates,
    groupName,
    isSubmitting,
    keyword,
    selected,
    selectedUidSet,
    setGroupName,
    setKeyword: changeKeyword,
    submit,
    toggleMember,
  };
}

import type { GroupCreateCandidateContact } from "../../bridge/groupCreate/types";

export interface GroupMemberPickerProps {
  mode: "createGroup" | "addMember";
  candidates: GroupCreateCandidateContact[];
  selected: GroupCreateCandidateContact[];
  selectedUids: Set<string>;
  keyword: string;
  copy: {
    searchPlaceholder: string;
    selectedTitle: string;
    confirm: string;
    cancel: string;
  };
  avatarForUid: (uid: string) => string;
  actions: {
    onKeywordChange: (value: string) => void;
    onToggleMember: (uid: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
  };
}

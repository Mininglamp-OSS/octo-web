import type { GroupMemberPickerProps } from "../GroupMemberPicker";

export interface GroupCreateDialogProps {
  mode: "createGroup" | "addMember";
  isOpen: boolean;
  copy: {
    title: string;
    avatarLabel: string;
    editAvatar: string;
    nameLabel: string;
    namePlaceholder: string;
    membersLabel: string;
    confirm: string;
    cancel: string;
  };
  form: {
    groupName: string;
    avatarText: string;
    avatarColorIndex?: number;
    maxNameLength: number;
    isAvatarEditorOpen: boolean;
  };
  memberPicker: GroupMemberPickerProps;
  actions: {
    onCancel: () => void;
    onConfirm: () => void;
    onGroupNameChange: (value: string) => void;
    onOpenAvatarEditor: () => void;
    onCloseAvatarEditor: () => void;
    onSaveAvatar: (avatarText: string, colorIndex?: number) => void;
  };
}

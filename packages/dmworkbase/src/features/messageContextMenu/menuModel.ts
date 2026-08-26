import type { MessageContextMenus, MessageContextMenuGroup } from "../../EndpointCommon";
import type { ContextMenusData } from "../../Components/ContextMenus";

const GROUP_ORDER: MessageContextMenuGroup[] = ["processing", "control", "derived"];
const ACTION_ORDER = [
  "reply",
  "copy",
  "copyImage",
  "addSticker",
  "reaction",
  "forward",
  "multiSelect",
  "revoke",
  "createThread",
  "saveDrive",
  "viewDrive",
];

const actionOrder = (actionKey: string) => {
  const index = ACTION_ORDER.indexOf(actionKey);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export function buildGroupedMessageContextMenus(
  actions: MessageContextMenus[],
): ContextMenusData[] {
  const groups = GROUP_ORDER
    .map((group) => actions
      .filter((action) => (action.group ?? "processing") === group)
      .sort((left, right) => actionOrder(left.actionKey) - actionOrder(right.actionKey)))
    .filter((group) => group.length > 0);

  return groups.flatMap((group, groupIndex) => [
    ...(groupIndex > 0 ? [{ separator: true } as ContextMenusData] : []),
    ...group.map((action) => ({
      actionKey: action.actionKey,
      title: action.title,
      icon: action.icon,
      danger: action.danger,
      testid: action.testid,
      onClick: action.onClick,
    })),
  ]);
}

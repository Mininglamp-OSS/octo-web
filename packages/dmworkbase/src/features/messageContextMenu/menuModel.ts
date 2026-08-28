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

const LEGACY_DRIVE_ACTION_KEY = "contextmenus.driveSave";

export function buildGroupedMessageContextMenus(
  actions: MessageContextMenus[],
): ContextMenusData[] {
  // The private Drive module historically registered this action. The host now
  // owns the icon-backed save/view action, so never render the legacy duplicate.
  const visibleActions = actions.filter(
    (action) => action.actionKey !== LEGACY_DRIVE_ACTION_KEY,
  );
  const groups = GROUP_ORDER
    .map((group) => visibleActions
      .filter((action) => (action.group ?? "processing") === group)
      .sort((left, right) => actionOrder(left.actionKey ?? "") - actionOrder(right.actionKey ?? "")))
    .filter((group) => group.length > 0);

  return groups.flatMap((group, groupIndex) => [
    ...(groupIndex > 0 ? [{ separator: true } as ContextMenusData] : []),
    ...group.map((action) => ({
      ...action,
      actionKey: action.actionKey,
    })),
  ]);
}

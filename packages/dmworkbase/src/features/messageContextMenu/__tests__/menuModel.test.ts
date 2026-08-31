import { describe, expect, it, vi } from "vitest";
import { Copy, MessageSquareMore, Undo2 } from "lucide-react";
import type { MessageContextMenus } from "../../../EndpointCommon";
import { buildGroupedMessageContextMenus } from "../menuModel";

function action(
  actionKey: string,
  group: NonNullable<MessageContextMenus["group"]>,
  icon = Copy,
): MessageContextMenus {
  return { actionKey, group, icon, title: actionKey, onClick: vi.fn() };
}

describe("buildGroupedMessageContextMenus", () => {
  it("orders groups and inserts separators only between non-empty groups", () => {
    const menus = buildGroupedMessageContextMenus([
      action("createThread", "derived"),
      action("copy", "processing"),
      action("reply", "processing", MessageSquareMore),
      action("revoke", "control", Undo2),
    ]);

    expect(menus.map((item) => item.separator ? "separator" : item.actionKey)).toEqual([
      "reply",
      "copy",
      "separator",
      "revoke",
      "separator",
      "createThread",
    ]);
  });

  it("does not render leading, trailing, or duplicate separators", () => {
    const menus = buildGroupedMessageContextMenus([
      action("reply", "processing"),
      action("createThread", "derived"),
    ]);

    expect(menus.map((item) => item.separator ? "separator" : item.actionKey)).toEqual([
      "reply",
      "separator",
      "createThread",
    ]);
  });

  it("drops the legacy private Drive action and keeps the host action", () => {
    const menus = buildGroupedMessageContextMenus([
      action("reply", "processing"),
      action("contextmenus.driveSave", "processing"),
      action("saveDrive", "derived"),
    ]);

    expect(menus.map((item) => item.separator ? "separator" : item.actionKey)).toEqual([
      "reply",
      "separator",
      "saveDrive",
    ]);
  });
});

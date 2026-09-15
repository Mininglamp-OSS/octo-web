import WKApp from "../App";
import type { Space } from "../Service/SpaceService";

/** Update authority first; downstream listeners only consume the committed context. */
export function applyImSpaceContext(space: Pick<Space, "space_id" | "name"> | undefined): boolean {
  const spaceId = space?.space_id || "";
  if (WKApp.shared.currentSpaceId === spaceId) return false;
  WKApp.shared.currentSpaceId = spaceId;
  WKApp.mittBus.emit("space-changed", space);
  return true;
}

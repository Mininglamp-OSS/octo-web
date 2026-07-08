// @octo/loop — Workspace API（真实 HTTP，对齐 multica REST 契约）
import type { Workspace } from "./types";
import { httpGet } from "./http";

export function listWorkspaces(): Promise<Workspace[]> {
  return httpGet<Workspace[]>("/workspaces");
}

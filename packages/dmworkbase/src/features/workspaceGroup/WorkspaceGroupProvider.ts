import { createContext } from "react";
import type { WorkspaceGroupHost } from "./contract";

export const WorkspaceGroupHostContext = createContext<WorkspaceGroupHost | null>(null);
export const WorkspaceGroupProvider = WorkspaceGroupHostContext.Provider;

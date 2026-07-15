import { useEffect, useState } from "react";
import { WKApp } from "@octo/base";
import { listWorkspaceMembers } from "../api/workspaceApi";
import { currentWorkspaceId } from "../api/http";

/**
 * Whether the signed-in user is an owner/admin of the current workspace;
 * `undefined` while resolving. The roster endpoint is membership-gated (not
 * role-gated), so every role can read it to learn its own role. Fails closed
 * (`false`) on any error or an unresolved identity.
 */
export function useIsWorkspaceAdmin(): boolean | undefined {
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const wsId = currentWorkspaceId();
    const uid = WKApp.loginInfo?.uid;
    if (!wsId || !uid) { setIsAdmin(false); return; }
    let cancelled = false;
    listWorkspaceMembers(wsId)
      .then((members) => {
        if (cancelled) return;
        const me = members.find((m) => m.octo_uid === uid);
        setIsAdmin(me?.role === "owner" || me?.role === "admin");
      })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, []);
  return isAdmin;
}

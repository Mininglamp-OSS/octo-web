import { useEffect, useRef, useState } from "react";
import { SpaceService, WKApp, type Space } from "@octo/base";

/**
 * ⚠️ THE TWO ROLE ENCODINGS IN THIS SYSTEM ARE INVERTED. DO NOT "FIX" THIS. ⚠️
 *
 *   octo-web  (`Space.role`, from `GET space/my`):  1 = owner, 2 = admin, 3 = member
 *   marketplace / octo-server `space_member.role`:  0 = member, 1 = admin, 2 = owner
 *
 * So the reviewer test on THIS side is `role <= 2` (privilege rises as the
 * number goes DOWN), while the backend's is `role >= 1`. A drive-by change to
 * `role >= 2` here to "match the backend" would hand the reviewer queue to
 * every ordinary member. The authoritative wire comment lives at
 * `packages/dmworkbase/src/Service/SpaceService.tsx` (`interface Space`), and
 * `hooks/__tests__/useSpaceRole.test.ts` pins the encoding.
 *
 * This gate is COSMETIC ONLY. It hides the "组织审核" tab from non-admins so
 * they are not shown an action they cannot take; it is NOT an authorization
 * boundary. The server independently enforces the reviewer role and answers
 * `mode=space` list / approve / reject with 403, and cross-Space reads with 404,
 * regardless of what this hook decides.
 */
const OCTO_WEB_REVIEWER_MAX_ROLE = 2;

export function isSpaceReviewerRole(role: number | undefined): boolean {
  return (
    typeof role === "number" && role > 0 && role <= OCTO_WEB_REVIEWER_MAX_ROLE
  );
}

export interface UseSpaceRoleResult {
  /** octo-web encoding (1 owner / 2 admin / 3 member); undefined until resolved. */
  role?: number;
  /** Cosmetic gate — true when the current user may see reviewer-only UI. */
  isReviewer: boolean;
  loading: boolean;
}

/**
 * Resolve the current user's role in `WKApp.shared.currentSpaceId`.
 *
 * This package has no space-role state of its own, so the role comes from
 * `SpaceService.getMySpaces()`. Space switches are picked up from the
 * `space-changed` mitt event, whose payload is the `Space` object itself — used
 * directly when it carries the switched-to space, with a re-query as fallback
 * for the emit path that fires before the space list has loaded.
 *
 * NOTE on `utils/spaceId.ts`: that helper only sanitizes a space id for
 * embedding in shell command examples. It deliberately is NOT applied here —
 * a server-issued id that happens not to be shell-safe is still a legitimate
 * space, and rejecting it would silently drop the reviewer UI.
 */
export function useSpaceRole(): UseSpaceRoleResult {
  const [role, setRole] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // Generation counter, NOT just an unmount flag. Every resolution attempt —
  // the initial probe, a re-probe, and the `space-changed` payload fast-path —
  // claims a new generation, so an older in-flight `getMySpaces()` whose
  // closure still holds the PREVIOUS spaceId cannot overwrite a role that has
  // since been resolved for the new Space.
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;

    const resolveFromServer = () => {
      generationRef.current += 1;
      const attempt = generationRef.current;
      const spaceId = WKApp.shared?.currentSpaceId;
      if (!spaceId) {
        setRole(undefined);
        setLoading(false);
        return;
      }
      setLoading(true);
      SpaceService.shared
        .getMySpaces()
        .then((spaces: Space[]) => {
          if (attempt !== generationRef.current) return;
          setRole(spaces.find((space) => space.space_id === spaceId)?.role);
        })
        .catch(() => {
          // Fail closed: no role means no reviewer UI. The server is the
          // authority either way, so a failed probe costs visibility, not safety.
          if (attempt !== generationRef.current) return;
          setRole(undefined);
        })
        .finally(() => {
          if (attempt !== generationRef.current) return;
          setLoading(false);
        });
    };

    resolveFromServer();

    const handleSpaceChanged = (payload?: unknown) => {
      const space = payload as Space | undefined;
      if (space && typeof space.role === "number") {
        // Claim a generation so the in-flight probe for the OLD Space can no
        // longer land on top of this value.
        generationRef.current += 1;
        setRole(space.role);
        setLoading(false);
        return;
      }
      resolveFromServer();
    };

    WKApp.mittBus.on("space-changed", handleSpaceChanged as () => void);
    return () => {
      // Invalidate every outstanding attempt on unmount.
      generationRef.current += 1;
      WKApp.mittBus.off("space-changed", handleSpaceChanged as () => void);
    };
  }, []);

  return { role, isReviewer: isSpaceReviewerRole(role), loading };
}

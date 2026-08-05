import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SpaceService, type SpaceMember } from "../../Service/SpaceService";
import type {
  SpaceMemberOption,
  UseSpaceMembersOptions,
  UseSpaceMembersResult,
} from "./types";

function toMemberOptions(
  members: SpaceMember[],
  includeBots: boolean
): SpaceMemberOption[] {
  const seen = new Set<string>();
  const options: SpaceMemberOption[] = [];

  members.forEach((member) => {
    if (
      !member.uid ||
      (!includeBots && member.robot === 1) ||
      seen.has(member.uid)
    ) {
      return;
    }
    seen.add(member.uid);
    options.push({
      uid: member.uid,
      name: member.name || member.uid,
      avatar: member.avatar || undefined,
    });
  });

  return options;
}

export function useSpaceMembers({
  spaceId,
  includeBots = false,
  isEnabled = true,
}: UseSpaceMembersOptions): UseSpaceMembersResult {
  const [sourceMembers, setSourceMembers] = useState<SpaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!spaceId || !isEnabled) {
      setSourceMembers([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setSourceMembers([]);
    setIsLoading(true);
    setError(null);

    void SpaceService.shared.getAllMembers(spaceId).then(
      (members) => {
        if (requestIdRef.current !== requestId) return;
        setSourceMembers(members);
        setIsLoading(false);
      },
      (nextError: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setSourceMembers([]);
        setError(nextError);
        setIsLoading(false);
      }
    );

    return () => {
      if (requestIdRef.current === requestId) {
        requestIdRef.current += 1;
      }
    };
  }, [isEnabled, reloadVersion, spaceId]);

  const reload = useCallback(() => {
    setReloadVersion((current) => current + 1);
  }, []);

  const members = useMemo(
    () => toMemberOptions(sourceMembers, includeBots),
    [includeBots, sourceMembers]
  );

  return { members, isLoading, error, reload };
}

export default useSpaceMembers;

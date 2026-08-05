export interface SpaceMemberOption {
  uid: string;
  name: string;
  avatar?: string;
}

export interface UseSpaceMembersOptions {
  spaceId?: string;
  /** Human members are returned by default. Enable this only for bot-aware pickers. */
  includeBots?: boolean;
  isEnabled?: boolean;
}

export interface UseSpaceMembersResult {
  members: SpaceMemberOption[];
  isLoading: boolean;
  error: unknown;
  reload: () => void;
}

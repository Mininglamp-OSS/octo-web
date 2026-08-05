import React, { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";

import WKInput from "../../Components/WKInput";
import type { SpaceMemberOption } from "../../bridge/spaceMembers/types";
import { filterSpaceMemberOptions } from "./search";
import "./index.css";

export interface SpaceMemberSelectLabels {
  searchPlaceholder: string;
  loading: string;
  empty: string;
  noResults: string;
}

export interface SpaceMemberSelectState {
  isLoading?: boolean;
  error?: React.ReactNode;
}

export interface SpaceMemberSelectProps {
  members: SpaceMemberOption[];
  selectedUid?: string | null;
  labels: SpaceMemberSelectLabels;
  state?: SpaceMemberSelectState;
  isDisabled?: boolean;
  onChange: (uid: string, member: SpaceMemberOption) => void;
}

function MemberAvatar({ member }: { member: SpaceMemberOption }) {
  if (member.avatar) {
    return (
      <img
        className="wk-space-member-select__avatar"
        src={member.avatar}
        alt=""
      />
    );
  }

  return (
    <span
      className="wk-space-member-select__avatar-fallback"
      aria-hidden="true"
    >
      {(member.name || member.uid).trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SpaceMemberSelect({
  members,
  selectedUid,
  labels,
  state = {},
  isDisabled = false,
  onChange,
}: SpaceMemberSelectProps) {
  const [keyword, setKeyword] = useState("");
  const filteredMembers = useMemo(
    () => filterSpaceMemberOptions(members, keyword),
    [keyword, members]
  );
  const isEmpty = !state.isLoading && !state.error && members.length === 0;
  const hasNoResults =
    !state.isLoading &&
    !state.error &&
    members.length > 0 &&
    filteredMembers.length === 0;

  return (
    <div
      className="wk-space-member-select"
      aria-busy={state.isLoading || undefined}
      aria-disabled={isDisabled || undefined}
    >
      <WKInput
        value={keyword}
        onChange={setKeyword}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchPlaceholder}
        prefix={<Search size={16} aria-hidden="true" />}
        disabled={isDisabled}
      />

      <div
        className="wk-space-member-select__list"
        role="listbox"
        aria-label={labels.searchPlaceholder}
      >
        {state.isLoading && (
          <div className="wk-space-member-select__state" role="status">
            <span
              className="wk-space-member-select__spinner"
              aria-hidden="true"
            />
            {labels.loading}
          </div>
        )}
        {!state.isLoading && state.error && (
          <div className="wk-space-member-select__state is-error" role="alert">
            {state.error}
          </div>
        )}
        {isEmpty && (
          <div className="wk-space-member-select__state">{labels.empty}</div>
        )}
        {hasNoResults && (
          <div className="wk-space-member-select__state">
            {labels.noResults}
          </div>
        )}
        {!state.isLoading &&
          !state.error &&
          filteredMembers.map((member) => {
            const isSelected = member.uid === selectedUid;
            return (
              <button
                key={member.uid}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`wk-space-member-select__option${
                  isSelected ? " is-selected" : ""
                }`}
                disabled={isDisabled}
                onClick={() => onChange(member.uid, member)}
              >
                <MemberAvatar member={member} />
                <span className="wk-space-member-select__member-copy">
                  <span className="wk-space-member-select__member-name">
                    {member.name}
                  </span>
                  <span className="wk-space-member-select__member-uid">
                    {member.uid}
                  </span>
                </span>
                {isSelected && (
                  <Check
                    className="wk-space-member-select__check"
                    size={16}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}

export default SpaceMemberSelect;
export { filterSpaceMemberOptions } from "./search";

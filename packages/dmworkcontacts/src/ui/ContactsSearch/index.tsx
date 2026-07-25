import React from "react";
import { Search as SearchIcon } from "lucide-react";
import type { ContactsSearchProps } from "./types";
import "./index.css";

function ContactsSearch({
  copy,
  state,
  results,
  onKeywordChange,
  onClear,
}: ContactsSearchProps) {
  return (
    <>
      <div className="wk-contacts-search">
        <div className="wk-contacts-search-input">
          <SearchIcon size={14} className="wk-contacts-search-icon" />
          <input
            type="text"
            placeholder={copy.placeholder}
            value={state.keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
          {state.keyword && (
            <span className="wk-contacts-search-clear" onClick={onClear}>
              &times;
            </span>
          )}
        </div>
      </div>
      {state.isSearching &&
        (state.hasResults ? (
          <div className="wk-contacts-search-results">
            {results.contacts && (
              <div className="wk-contacts-search-section">
                <div className="wk-contacts-search-section-title">
                  {copy.contactsTitle}
                </div>
                {results.contacts}
              </div>
            )}
            {results.groups && (
              <div className="wk-contacts-search-section">
                <div className="wk-contacts-search-section-title">
                  {copy.groupsTitle}
                </div>
                {results.groups}
              </div>
            )}
          </div>
        ) : (
          <div className="wk-contacts-empty">
            <SearchIcon size={28} className="wk-contacts-empty-icon" />
            <div className="wk-contacts-empty-text">{copy.emptyText}</div>
          </div>
        ))}
    </>
  );
}

export default ContactsSearch;
export { ContactsSearch };

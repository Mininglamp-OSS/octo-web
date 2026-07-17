import React from "react";
import { Search } from "lucide-react";
import "./index.css";

export interface SearchWorkspaceTab {
  key: string;
  label: string;
}

export interface SearchWorkspaceInput {
  value: string;
  placeholder: string;
  autoFocus?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onChange: (value: string) => void;
  onCompositionStart?: React.CompositionEventHandler<HTMLInputElement>;
  onCompositionEnd?: React.CompositionEventHandler<HTMLInputElement>;
}

export interface SearchWorkspaceProps {
  search: SearchWorkspaceInput;
  tabs: SearchWorkspaceTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  actions?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}

export function SearchWorkspace({
  search,
  tabs,
  activeTab,
  onTabChange,
  actions,
  error,
  children,
}: SearchWorkspaceProps) {
  return (
    <div className="wk-search-workspace">
      <header className="wk-search-workspace__header">
        <div className="wk-search-workspace__input-wrap">
          <span className="wk-search-workspace__leading" aria-hidden="true">
            {search.leading ?? <Search size={18} />}
          </span>
          <input
            autoFocus={search.autoFocus}
            value={search.value}
            placeholder={search.placeholder}
            onChange={(event) => search.onChange(event.currentTarget.value)}
            onCompositionStart={search.onCompositionStart}
            onCompositionEnd={search.onCompositionEnd}
          />
          {search.trailing && (
            <span className="wk-search-workspace__trailing">
              {search.trailing}
            </span>
          )}
        </div>
      </header>

      <nav className="wk-search-workspace__nav" aria-label={search.placeholder}>
        <div className="wk-search-workspace__tabs">
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                className={isActive ? "is-active" : undefined}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onTabChange(tab.key)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {actions && (
          <div className="wk-search-workspace__actions">{actions}</div>
        )}
      </nav>

      {error && (
        <div className="wk-search-workspace__error" role="alert">
          {error}
        </div>
      )}
      <div className="wk-search-workspace__content">{children}</div>
    </div>
  );
}

export default SearchWorkspace;

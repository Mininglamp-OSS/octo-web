import React, { forwardRef, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { t, useI18n, WKInput } from "@octo/base";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { value, onChange, placeholder = t("skillMarket.common.search"), autoFocus = false },
  ref,
) {
  useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const input = rootRef.current?.querySelector("input") ?? null;
    input?.focus();
    if (typeof ref === "function") {
      ref(input);
    } else if (ref) {
      ref.current = input;
    }
  }, [autoFocus, ref]);

  return (
    <div ref={rootRef} className="skill-market-search">
      <WKInput
        size="md"
        value={value}
        onChange={onChange}
        prefix={<Search size={16} />}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
});

export default SearchBar;
